// background.js — CK Review Buddy Service Worker

const STORAGE_KEY_QUESTIONS = 'ckrb_questions';
const STORAGE_KEY_API_KEY   = 'ckrb_apikey';
const STORAGE_KEY_STATUS    = 'ckrb_status';

/* ─────────────────────────────────────────────
   HELPER: Get API key from storage
───────────────────────────────────────────── */
async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.sync.get([STORAGE_KEY_API_KEY], r => resolve(r[STORAGE_KEY_API_KEY] || ''));
  });
}

/* ─────────────────────────────────────────────
   ANTHROPIC API CALL
───────────────────────────────────────────── */
async function callClaude(systemPrompt, userPrompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

/* ─────────────────────────────────────────────
   PROCESS INCORRECT QUESTION
   → Diagnose misconception + generate trivia
───────────────────────────────────────────── */
async function processIncorrect(q, apiKey) {
  const cleanText = q.questionText
    .replace(/Strikeout\/Eliminate [A-F] text\n?/g, '')
    .replace(/Strikeout\/Restore [A-F] text\n?/g, '')
    .replace(/Option is eliminated\.\n?/g, '')
    .replace(/\nOption is eliminated\./g, '')
    .trim();
  const cleanChoices = q.choices
    .map(c => c.replace(/Option is eliminated\.\s*/g, '').replace(/Strikeout\/[^\n]*/g, '').trim())
    .filter(c => c.length > 1);
  const safeUA = (q.userAnswer || 'Unknown').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const safeCA = (q.correctAnswer || '').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const safeExp = (q.explanation || '').replace(/[\n\r]/g, ' ').trim();

  const systemPrompt = `You are a USMLE Step 2 CK tutor. Analyze a wrongly-answered question. Return ONLY valid JSON, no prose, no markdown.`;
  const choicesText = cleanChoices.map((c, i) => String.fromCharCode(65+i) + '. ' + c).join('\n');
  const userPrompt = `QUESTION STEM:
${cleanText}

ANSWER CHOICES:
${choicesText}

STUDENT ANSWERED: ${safeUA}
CORRECT ANSWER: ${safeCA}
EXPLANATION: ${safeExp}

Return this JSON exactly:
{
  "userAnswer": "${safeUA}",
  "correctAnswer": "${safeCA}",
  "likelyMisconception": "<1 sentence: what the student probably assumed>",
  "zczc": {
    "brain": "<1-3 word core concept>",
    "eli4": "<toddler explanation of the vignette concept only>",
    "eli5": "<one step above eli4>",
    "equations": "<relevant formulas or values only, max 4 lines, or N/A>",
    "clinical": "<max 30 words, bold non-obvious pivotal terms only>",
    "arrows": "<pathophysiology as arrows only>",
    "quotes": ["<exact verbatim quote from stem>", "<exact verbatim quote from stem>", "<exact verbatim quote from stem>"]
  },
  "triviaQuestions": [
    {
      "vignetteQuote": "<verbatim excerpt from the stem above — must be exact>",
      "question": "<question referencing that exact quote>",
      "choices": ["<A>", "<B>", "<C>", "<D>"],
      "correctIndex": 0,
      "explanation": "<why, referencing the quote, 1-2 sentences>",
      "difficulty": "easy|medium|hard"
    }
  ]
}
Rules: vignetteQuote must be verbatim from the stem. zczc quotes must be plain strings only — no colons, no explanations. Generate 3-4 trivia questions. All choices similar length.`;

  let raw = await callClaude(systemPrompt, userPrompt, apiKey);
  if (!raw || raw.trim().length < 30) {
    raw = await callClaude(systemPrompt, userPrompt + '\n\nIMPORTANT: Return ONLY the JSON object starting with {', apiKey);
  }
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const clean = jsonMatch ? jsonMatch[0] : raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.triviaQuestions || parsed.triviaQuestions.length === 0) {
      parsed.triviaQuestions = [{
        vignetteQuote: cleanText.slice(0, 80),
        question: "Based on the clinical clues in this vignette, what is the most likely diagnosis?",
        choices: cleanChoices.length >= 4 ? cleanChoices.slice(0,4) : ["Option A","Option B","Option C","Option D"],
        correctIndex: 0,
        explanation: parsed.likelyMisconception || "Review the explanation.",
        difficulty: "medium"
      }];
    }
    parsed._type = 'incorrect';
    return parsed;
  } catch(e) {
    console.error('[CKRB] processIncorrect parse failed:', e.message, raw ? raw.slice(0,200) : 'empty');
    return { _type: 'incorrect', userAnswer: safeUA, correctAnswer: safeCA, likelyMisconception: 'Review explanation.', triviaQuestions: [] };
  }
}

async function processCorrect(q, apiKey) {
  const cleanText = q.questionText
    .replace(/Strikeout\/Eliminate [A-F] text\n?/g, '')
    .replace(/Strikeout\/Restore [A-F] text\n?/g, '')
    .replace(/Option is eliminated\.\n?/g, '')
    .replace(/\nOption is eliminated\./g, '')
    .trim();
  const safeCA = (q.correctAnswer || '').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();

  const systemPrompt = `You are a USMLE Step 2 CK tutor. Student answered correctly. Return ONLY valid JSON, no markdown.`;
  const userPrompt = `QUESTION STEM:
${cleanText}

STUDENT ANSWERED CORRECTLY: ${safeCA}

Return this JSON exactly:
{
  "userAnswer": "${safeCA}",
  "correctAnswer": "${safeCA}",
  "keyFact": "<the core concept tested, 1 sentence>",
  "zczc": {
    "brain": "<1-3 word core concept>",
    "eli4": "<toddler explanation>",
    "eli5": "<one step above eli4>",
    "equations": "<relevant formulas or N/A>",
    "clinical": "<max 30 words, bold pivotal terms>",
    "arrows": "<mechanism as arrows>",
    "quotes": ["<exact verbatim quote from stem>", "<exact verbatim quote from stem>", "<exact verbatim quote from stem>"]
  },
  "triviaQuestions": [
    {
      "vignetteQuote": "<verbatim excerpt from stem>",
      "question": "<reinforcement question referencing that quote>",
      "choices": ["<A>", "<B>", "<C>", "<D>"],
      "correctIndex": 0,
      "explanation": "<1 sentence>",
      "difficulty": "easy|medium|hard"
    }
  ]
}
Generate 1 question only. zczc quotes must be plain strings only.`;

  const raw = await callClaude(systemPrompt, userPrompt, apiKey);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const clean = jsonMatch ? jsonMatch[0] : raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed._type = 'correct';
    return parsed;
  } catch {
    return { _type: 'correct', userAnswer: safeCA, correctAnswer: safeCA, keyFact: '', triviaQuestions: [] };
  }
}

async function processBatch(questions) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    await setStatus({ state: 'error', message: 'No API key set. Open Settings.' });
    return;
  }

  const total = questions.length;
  let done = 0;

  // Process in chunks of 10, pause between chunks
  const CHUNK_SIZE = 25;
  await setStatus({ state: 'processing', done: 0, total, message: `Analyzing 0/${total} questions…` });

  const enriched = [];
  let chunkStart = 0;

  while (chunkStart < questions.length) {
    const chunk = questions.slice(chunkStart, chunkStart + CHUNK_SIZE);
    
  for (const q of chunk) {
    try {
      let analysis;
      if (q.isCorrect === false) {
        analysis = await processIncorrect(q, apiKey);
        analysis._type = 'incorrect';
      } else if (q.isCorrect === true) {
        analysis = await processCorrect(q, apiKey);
        analysis._type = 'correct';
      } else {
        // Unknown — treat as incorrect for safety
        analysis = await processIncorrect(q, apiKey);
        analysis._type = 'unknown';
      }
      enriched.push({ ...q, analysis });
    } catch (e) {
      console.error('[CKRB] API error on Q' + done, e.message);
      enriched.push({ ...q, analysis: { _type: 'error', error: e.message, triviaQuestions: [] } });
      // If first question fails, it's likely an API key issue — abort early
      if (done === 0) {
        await setStatus({ state: 'error', message: 'API error: ' + e.message.slice(0, 120) });
        return;
      }
    }

    done++;
    await setStatus({ state: 'processing', done, total, message: `Analyzed ${done}/${total} questions…` });
    chrome.action.setBadgeText({ text: `${done}` });
    chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  }

  chunkStart += CHUNK_SIZE;

  // After each chunk of 10, save what we have and pause for user
  const partialSave = [...(await new Promise(r => chrome.storage.local.get([STORAGE_KEY_QUESTIONS], d => r(d[STORAGE_KEY_QUESTIONS] || [])))), ...enriched.slice(chunkStart - CHUNK_SIZE)];
  chrome.storage.local.set({ [STORAGE_KEY_QUESTIONS]: enriched });

  if (chunkStart < questions.length) {
    const remaining = questions.length - chunkStart;
    await setStatus({ 
      state: 'chunk_done', 
      done, 
      total, 
      chunkEnd: Math.min(chunkStart, questions.length),
      remaining,
      message: `Ready! First ${done} questions prepared. ${remaining} more waiting.`
    });
    chrome.action.setBadgeText({ text: `${done}` });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
    chrome.notifications.create('ckrb_chunk', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🩺 CK Buddy — 10 done!',
      message: `${done} questions ready. Open the extension to continue with the next ${remaining}.`,
      priority: 2
    });
    // Wait for user to request continuation
    await new Promise(resolve => {
      const check = setInterval(() => {
        chrome.storage.local.get(['ckrb_continue'], r => {
          if (r.ckrb_continue) {
            chrome.storage.local.remove(['ckrb_continue']);
            clearInterval(check);
            resolve();
          }
        });
      }, 1000);
    });
    await setStatus({ state: 'processing', done, total, message: `Continuing… ${done}/${total} done` });
  }
  } // end while

  // Save enriched questions
  chrome.storage.local.set({ [STORAGE_KEY_QUESTIONS]: enriched });

  // Done!
  await setStatus({ state: 'ready', done: total, total, message: `Ready! ${total} questions prepared.` });
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#10B981' });

  // Desktop notification
  chrome.notifications.create('ckrb_ready', {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '🩺 CK Review Buddy — Ready!',
    message: `${total} questions processed. Click the extension to start your quiz.`,
    priority: 2
  });
}

function setStatus(s) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY_STATUS]: s }, resolve);
  });
}

/* ─────────────────────────────────────────────
   MESSAGE LISTENER
───────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'NAVIGATE_TO_QUESTION') {
    chrome.tabs.query({ url: '*://*.starttest.com/*' }, tabs => {
      if (!tabs.length) { sendResponse({ ok: false }); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'NAV_TO_QUESTION', questionNum: msg.questionNum }, () => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg.type === 'START_PROCESSING') {
    processBatch(msg.questions).catch(console.error);
    sendResponse({ ok: true });
  }
  if (msg.type === 'PR_SCRAPE_COMPLETE') {
    // Page-reload scrape finished — kick off AI processing
    const questions = msg.data?.questions || [];
    if (questions.length > 0) {
      processBatch(questions).catch(console.error);
    }
    sendResponse({ ok: true });
  }
  if (msg.type === 'CLEAR_DATA') {
    chrome.storage.local.remove([STORAGE_KEY_QUESTIONS, STORAGE_KEY_STATUS, 'ckrb_pr_session']);
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
  return true;
});

/* ─── RELAY: child iframe → parent frame ─── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHILD_SCRAPED' && sender.tab) {
    // Relay to the top-level (parent) frame in the same tab
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'CHILD_RELAY',
      data: msg.data
    }, { frameId: 0 }); // frameId 0 = top-level frame
    sendResponse({ ok: true });
  }
  return true;
});
