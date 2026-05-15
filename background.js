// background.js — CK Review Buddy Service Worker

/* ─────────────────────────────────────────────
   STEM CLEANER — strips non-clinical metadata the
   qbank UIs interleave into scraped stems (item
   numbers, question IDs, navigation labels, etc.)
   so Claude never sees them and can't pick them
   as a vignetteQuote.
───────────────────────────────────────────── */
function cleanStem(raw) {
  if (!raw) return '';
  return raw
    .replace(/Strikeout\/Eliminate [A-F] text\n?/g, '')
    .replace(/Strikeout\/Restore [A-F] text\n?/g, '')
    .replace(/Option is eliminated\.\n?/g, '')
    .replace(/\nOption is eliminated\./g, '')
    // Generic pagination / item counters
    .replace(/^\s*Item\s+\d+\s+of\s+\d+\s*$/gmi, '')
    .replace(/^\s*Question\s+(Id|ID|#)?\s*:?\s*\d+\s*$/gmi, '')
    .replace(/^\s*Q\s*#?\s*\d+\s*$/gmi, '')
    .replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gmi, '')
    .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, '')
    // UWorld toolbar/navigation labels that sometimes slip in
    .replace(/^\s*(Mark|Marked|Unmark|Previous|Next|Full Screen|Tutorial|Lab Values|Calculator|Notes|Flag)\s*$/gmi, '')
    // Collapse runs of newlines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STORAGE_KEY_QUESTIONS = 'ckrb_questions';
const STORAGE_KEY_API_KEY   = 'ckrb_apikey';
const STORAGE_KEY_STATUS    = 'ckrb_status';

/* ─────────────────────────────────────────────
   KEEPALIVE — prevents MV3 service worker from
   being killed by Chrome during long batch jobs
───────────────────────────────────────────── */
function startKeepalive() {
  chrome.alarms.create('ckrb_keepalive', { periodInMinutes: 0.4 }); // every ~24s
}
function stopKeepalive() {
  chrome.alarms.clear('ckrb_keepalive');
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'ckrb_keepalive') {
    // No-op — just wakes the SW so Chrome doesn't kill it
    chrome.storage.local.get([STORAGE_KEY_STATUS], () => {});
  }
});

/* ─────────────────────────────────────────────
   AUTO-POPOUT — clicking the toolbar icon opens
   popup.html as a standalone window (instead of
   the small anchored popup). Requires no
   default_popup in manifest.json.
───────────────────────────────────────────── */
const CKRB_POPOUT_WINDOW_KEY = 'ckrb_popout_window_id';

// On extension reload/install, close any leftover popup window and clear
// stuck processing state so the user gets a clean start.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get([CKRB_POPOUT_WINDOW_KEY]);
    const oldId = stored[CKRB_POPOUT_WINDOW_KEY];
    if (oldId) {
      try { await chrome.windows.remove(oldId); } catch (_) {}
      chrome.storage.local.remove(CKRB_POPOUT_WINDOW_KEY);
    }
  } catch (_) {}
  // Clear any stuck "processing" state from a previous session
  try {
    const { ckrb_status: status } = await chrome.storage.local.get(['ckrb_status']);
    if (status && status.state === 'processing') {
      chrome.storage.local.remove(['ckrb_status', 'ckrb_pr_session']);
      console.log('[CK Buddy] Cleared stuck processing state on reload');
    }
  } catch (_) {}
});

chrome.action.onClicked.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get([CKRB_POPOUT_WINDOW_KEY]);
    const existingId = stored[CKRB_POPOUT_WINDOW_KEY];
    if (existingId) {
      try {
        const win = await chrome.windows.get(existingId);
        if (win) {
          await chrome.windows.update(existingId, { focused: true });
          return;
        }
      } catch (_) { /* window was closed; fall through to create */ }
    }
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 480,
      height: 760
    });
    if (created && created.id) {
      chrome.storage.local.set({ [CKRB_POPOUT_WINDOW_KEY]: created.id });
    }
  } catch (e) {
    console.error('[CK Buddy] popout open failed:', e);
  }
});
chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.local.get([CKRB_POPOUT_WINDOW_KEY]);
  if (stored[CKRB_POPOUT_WINDOW_KEY] === windowId) {
    chrome.storage.local.remove(CKRB_POPOUT_WINDOW_KEY);
  }
});

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
async function callClaude(systemPrompt, userPrompt, apiKey, _retry) {
  _retry = _retry || 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000); // 45s hard timeout
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
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
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('API timeout after 45s — skipping question');
    throw e;
  }
  clearTimeout(timeout);
  if (res.status === 529 && _retry < 4) {
    const wait = (2 ** _retry) * 2000; // 2s, 4s, 8s, 16s
    console.warn(`[CKRB] 529 overloaded — retrying in ${wait/1000}s (attempt ${_retry+1}/4)`);
    await new Promise(r => setTimeout(r, wait));
    return callClaude(systemPrompt, userPrompt, apiKey, _retry + 1);
  }
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
  const cleanText = cleanStem(q.questionText);
  const cleanChoices = q.choices
    .map(c => c.replace(/Option is eliminated\.\s*/g, '').replace(/Strikeout\/[^\n]*/g, '').trim())
    .filter(c => c.length > 1);
  const safeUA = (q.userAnswer || 'Unknown').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const safeCA = (q.correctAnswer || '').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const safeExp = (q.explanation || '').replace(/[\n\r]/g, ' ').trim();

  const systemPrompt = `You are a USMLE Step 2 CK tutor. Analyze a wrongly-answered question. Return ONLY valid JSON, no prose, no markdown.`;
  const choicesText = cleanChoices.map((c, i) => String.fromCharCode(65+i) + '. ' + c).join('\n');
  const imagNote = q.isImageBased ? '\n\nNOTE: This question contained an image or chart. Generate trivia from choices and explanation only. Set vignetteQuote to the first answer choice.' : '';
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
Rules:
- vignetteQuote must be a clinically meaningful verbatim excerpt from the stem (symptoms, vitals, lab values, exam findings, history, demographics). It MUST be germane to why this answer is correct.
- vignetteQuote MUST NOT be: an item number ("Item 2 of 3"), question ID ("Question Id: 12345"), UI label ("Mark", "Previous", "Next", "Full Screen"), page counter, a section header ("Past Medical History"), or any navigational/metadata string. Do not select anything that a clinician would not call out as a clue.
- vignetteQuote must be at least 4 words and reference a specific clinical finding, not generic framing.
- zczc quotes must be plain strings only — no colons, no explanations.
- Generate 3-4 trivia questions. All choices similar length.${imagNote}`;

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

/* ─────────────────────────────────────────────
   PROCESS MARKED QUESTION (answered correctly but flagged)
   → Same depth as incorrect (3 trivia) but framed as reinforcement
───────────────────────────────────────────── */
async function processMarked(q, apiKey) {
  const cleanText = q.questionText
    .replace(/Strikeout\/Eliminate [A-F] text\n?/g, '')
    .replace(/Strikeout\/Restore [A-F] text\n?/g, '')
    .replace(/Option is eliminated\.\n?/g, '')
    .trim();
  const cleanChoices = q.choices
    .map(c => c.replace(/Option is eliminated\.\s*/g, '').replace(/Strikeout\/[^\n]*/g, '').trim())
    .filter(c => c.length > 1);
  const safeCA  = (q.correctAnswer || '').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const safeExp = (q.explanation   || '').replace(/[\n\r]/g, ' ').trim();
  const choicesText = cleanChoices.map((c, i) => String.fromCharCode(65+i) + '. ' + c).join('\n');
  const imagNote = q.isImageBased ? '\n\nNOTE: This question contained an image. Generate trivia from choices and explanation only. Set vignetteQuote to the correct answer.' : '';

  const systemPrompt = `You are a USMLE Step 2 CK tutor. The student answered this question correctly but FLAGGED/MARKED it for review — meaning they were uncertain or want deeper reinforcement. Generate a rigorous review. Return ONLY valid JSON, no prose, no markdown.`;
  const userPrompt = `QUESTION STEM:
${cleanText}

ANSWER CHOICES:
${choicesText}

CORRECT ANSWER (student picked this): ${safeCA}
EXPLANATION: ${safeExp}

Return this JSON exactly:
{
  "userAnswer": "${safeCA}",
  "correctAnswer": "${safeCA}",
  "likelyMisconception": "<1 sentence: the subtle/tricky point the student likely wasn't 100% sure about>",
  "zczc": {
    "brain": "<1-3 word core concept>",
    "eli4": "<toddler explanation of the vignette concept>",
    "eli5": "<one step above eli4>",
    "equations": "<relevant formulas or values, max 4 lines, or N/A>",
    "clinical": "<max 30 words, bold non-obvious pivotal terms only>",
    "arrows": "<pathophysiology as arrows only>",
    "quotes": ["<exact verbatim quote from stem>", "<exact verbatim quote from stem>", "<exact verbatim quote from stem>"]
  },
  "triviaQuestions": [
    {
      "vignetteQuote": "<verbatim excerpt from the stem — must be exact>",
      "question": "<challenging reinforcement question referencing that quote>",
      "choices": ["<A>", "<B>", "<C>", "<D>"],
      "correctIndex": 0,
      "explanation": "<why, referencing the quote, 1-2 sentences>",
      "difficulty": "easy|medium|hard"
    }
  ]
}
Rules: vignetteQuote must be verbatim from the stem. zczc quotes must be plain strings only — no colons, no explanations. Generate 3 trivia questions at medium/hard difficulty. All choices similar length.${imagNote}`;

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
        question: "Based on the clinical clues, what is the most likely diagnosis?",
        choices: cleanChoices.length >= 4 ? cleanChoices.slice(0,4) : ["Option A","Option B","Option C","Option D"],
        correctIndex: 0,
        explanation: parsed.likelyMisconception || "Review the explanation.",
        difficulty: "medium"
      }];
    }
    parsed._type = 'marked';
    return parsed;
  } catch(e) {
    console.error('[CKRB] processMarked parse failed:', e.message, raw ? raw.slice(0,200) : 'empty');
    return { _type: 'marked', userAnswer: safeCA, correctAnswer: safeCA, likelyMisconception: 'Marked for review.', triviaQuestions: [] };
  }
}

async function processCorrect(q, apiKey) {
  const cleanText = cleanStem(q.questionText);
  const safeCA = (q.correctAnswer || '').replace(/[\n\r]/g, ' ').replace(/"/g, "'").trim();
  const imagNote2 = q.isImageBased ? '\n\nNOTE: Image-based question. Generate trivia from choices and explanation only. Set vignetteQuote to the correct answer.' : '';

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
Generate 1 question only. zczc quotes must be plain strings only.${imagNote2}`;

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
  // Clear any stale abort flag from a previous run
  chrome.storage.local.remove(['ckrb_abort']);
  startKeepalive();
  const apiKey = await getApiKey();
  if (!apiKey) {
    stopKeepalive();
    await setStatus({ state: 'error', message: 'No API key set. Open Settings.' });
    return;
  }

  const total = questions.length;
  let done = 0;

  // Process all questions in one pass (up to 100)
  const CHUNK_SIZE = 100;
  await setStatus({ state: 'processing', done: 0, total, message: `Analyzing 0/${total} questions…` });

  const enriched = [];
  let chunkStart = 0;

  while (chunkStart < questions.length) {
    const chunk = questions.slice(chunkStart, chunkStart + CHUNK_SIZE);
    
  for (const q of chunk) {
    // Check for abort signal
    const abortCheck = await new Promise(r => chrome.storage.local.get(['ckrb_abort'], r));
    if (abortCheck.ckrb_abort) {
      console.log('[CKRB] Abort signal received at question ' + done + '/' + total);
      chrome.storage.local.remove(['ckrb_abort']);
      stopKeepalive();
      // Save whatever we have so far
      if (enriched.length > 0) {
        chrome.storage.local.set({ [STORAGE_KEY_QUESTIONS]: enriched });
        await setStatus({ state: 'ready', done: enriched.length, total: enriched.length, message: `Aborted. ${enriched.length} questions saved.` });
        chrome.action.setBadgeText({ text: String(enriched.length) });
        chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
      } else {
        chrome.storage.local.remove([STORAGE_KEY_QUESTIONS]);
        await setStatus({ state: 'error', message: 'Generation aborted — no questions saved.' });
        chrome.action.setBadgeText({ text: '' });
      }
      return;
    }
    try {
      let analysis;
      if (q.isCorrect === false && q.isMarked === true) {
        // Wrong AND marked — treat as incorrect (already produces 3 trivia)
        analysis = await processIncorrect(q, apiKey);
        analysis._type = 'incorrect_marked';
      } else if (q.isCorrect === false) {
        analysis = await processIncorrect(q, apiKey);
        analysis._type = 'incorrect';
      } else if (q.isMarked === true) {
        // Correct but flagged — use dedicated marked-reinforcement prompt (3 trivia)
        analysis = await processMarked(q, apiKey);
        analysis._type = 'marked';
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
      // Only abort on first question AND it's not a timeout (timeout = skip and continue)
      if (done === 0 && !e.message.includes('timeout')) {
        stopKeepalive();
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
  stopKeepalive();
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
    console.log('[CK Buddy BG] NAVIGATE_TO_QUESTION received, questionNum:', msg.questionNum);
    // Try NBME tab first, then AMBOSS
    chrome.tabs.query({ url: '*://*.starttest.com/*' }, nbmeTabs => {
      if (nbmeTabs.length) {
        chrome.tabs.sendMessage(nbmeTabs[0].id, { type: 'NAV_TO_QUESTION', questionNum: msg.questionNum }, () => sendResponse({ ok: true }));
        return;
      }
      // AMBOSS review/session tab — use direct executeScript (no content script needed)
      chrome.tabs.query({ url: '*://next.amboss.com/*' }, ambossTabs => {
        const reviewTab = ambossTabs.find(t => /\/(review|session)\//.test(t.url));
        if (reviewTab) {
          console.log('[CK Buddy BG] AMBOSS direct nav to Q' + msg.questionNum + ' on tab', reviewTab.id);
          chrome.scripting.executeScript({
            target: { tabId: reviewTab.id },
            func: async (targetQ) => {
              function getCurrentQ() {
                var m = location.pathname.match(/\/review\/[^/]+\/(\d+)/);
                return m ? parseInt(m[1]) : null;
              }
              function clickSidebar(q) {
                var btn = document.querySelector('[data-e2e-test-id="question-' + q + '"]');
                if (btn) { btn.click(); return true; }
                return false;
              }
              function waitForNav(targetQ, timeout) {
                return new Promise(function(resolve) {
                  var start = Date.now();
                  var iv = setInterval(function() {
                    if (getCurrentQ() === targetQ || Date.now() - start > timeout) {
                      clearInterval(iv);
                      resolve(getCurrentQ());
                    }
                  }, 200);
                });
              }
              if (getCurrentQ() === targetQ) return { ok: true, landed: targetQ, method: 'already_there' };
              for (var attempt = 1; attempt <= 3; attempt++) {
                clickSidebar(targetQ);
                var landed = await waitForNav(targetQ, 3000);
                if (landed === targetQ) return { ok: true, landed: landed, method: 'sidebar', attempt: attempt };
              }
              var m = location.pathname.match(/(\/[^/]+\/review\/[^/]+\/)\d+/);
              if (m) {
                location.href = location.origin + m[1] + targetQ;
                await new Promise(function(r) { setTimeout(r, 2000); });
                return { ok: getCurrentQ() === targetQ, landed: getCurrentQ(), method: 'url_nav' };
              }
              return { ok: false, landed: getCurrentQ(), method: 'all_failed' };
            },
            args: [msg.questionNum]
          }).then(results => {
            var r = results && results[0] && results[0].result;
            console.log('[CK Buddy BG] AMBOSS nav result:', JSON.stringify(r));
            sendResponse(r || { ok: true });
          }).catch(err => {
            console.error('[CK Buddy BG] AMBOSS nav executeScript error:', err);
            sendResponse({ ok: false, error: String(err) });
          });
          return;
        }

        // UWorld testinterface tab
        chrome.tabs.query({ url: '*://apps.uworld.com/*' }, uworldTabs => {
          const uworldTab = uworldTabs.find(t => /testinterface/.test(t.url));
          if (!uworldTab) {
            console.log('[CK Buddy BG] No AMBOSS or UWorld tab found');
            sendResponse({ ok: false, error: 'no_exam_tab' });
            return;
          }
          console.log('[CK Buddy BG] UWorld direct nav to Q' + msg.questionNum + ' on tab', uworldTab.id);
          chrome.scripting.executeScript({
            target: { tabId: uworldTab.id },
            func: async (targetQ) => {
              function getCurrentQ() {
                var match = document.body.innerText.match(/Item[:\s]+(\d+)\s+of\s+(\d+)/);
                return match ? parseInt(match[1]) : null;
              }
              function clickSidebar(q) {
                var rows = document.querySelectorAll('tr.mat-row');
                for (var r = 0; r < rows.length; r++) {
                  var idx = rows[r].querySelector('.questionindex');
                  if (idx && parseInt(idx.innerText.trim()) === q) { rows[r].click(); return true; }
                }
                return false;
              }
              function waitForNav(tgt, timeout) {
                return new Promise(function(resolve) {
                  var start = Date.now();
                  var iv = setInterval(function() {
                    if (getCurrentQ() === tgt || Date.now() - start > timeout) {
                      clearInterval(iv);
                      resolve(getCurrentQ());
                    }
                  }, 200);
                });
              }
              if (getCurrentQ() === targetQ) return { ok: true, landed: targetQ, method: 'already_there' };
              for (var attempt = 1; attempt <= 3; attempt++) {
                clickSidebar(targetQ);
                var landed = await waitForNav(targetQ, 3000);
                if (landed === targetQ) return { ok: true, landed: landed, method: 'sidebar_uworld', attempt: attempt };
              }
              return { ok: false, landed: getCurrentQ(), method: 'all_failed' };
            },
            args: [msg.questionNum]
          }).then(results => {
            var r = results && results[0] && results[0].result;
            console.log('[CK Buddy BG] UWorld nav result:', JSON.stringify(r));
            sendResponse(r || { ok: true });
          }).catch(err => {
            console.error('[CK Buddy BG] UWorld nav executeScript error:', err);
            sendResponse({ ok: false, error: String(err) });
          });
        });
      });
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
  if (msg.type === 'ABORT_GENERATING') {
    // Set abort flag — processBatch checks this each iteration
    chrome.storage.local.set({ ckrb_abort: true });
    sendResponse({ ok: true });
  }
  if (msg.type === 'CLEAR_DATA') {
    chrome.storage.local.remove([STORAGE_KEY_QUESTIONS, STORAGE_KEY_STATUS, 'ckrb_pr_session']);
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
  if (msg.type === 'AMBOSS_PROCESS') {
    processAmboss(msg.data).catch(console.error);
    sendResponse({ ok: true });
  }
  return true;
});

/* ─── RELAY: child iframe → parent frame ─── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHILD_SCRAPED' && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'CHILD_RELAY',
      data: msg.data
    }, { frameId: 0 });
    sendResponse({ ok: true });
  }
  // Download debug report from content script
  if (msg.type === 'CKRB_DOWNLOAD_DEBUG') {
    try {
      chrome.downloads.download({
        url: msg.url,
        filename: msg.filename || 'ckbuddy-debug.json',
        saveAs: false
      }, () => {
        sendResponse({ ok: true });
      });
    } catch(e) {
      console.warn('[CK Buddy BG] Debug download failed:', e);
      sendResponse({ ok: false, error: String(e) });
    }
    return true; // async
  }
  return true;
});

/* ─────────────────────────────────────────────
   AMBOSS PROCESSOR
   → Generates Step 2 CK vignette questions
     from scraped AMBOSS article sections
───────────────────────────────────────────── */
async function processAmboss(data) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    await setStatus({ state: 'error', message: 'No API key set. Open Settings.' });
    return;
  }

  const sections = data.sections || [];
  if (!sections.length) {
    await setStatus({ state: 'error', message: 'No AMBOSS content found to process.' });
    return;
  }

  startKeepalive();
  const total = sections.length;
  let done = 0;
  await setStatus({ state: 'amboss_processing', done: 0, total, message: `Generating AMBOSS questions 0/${total}…` });

  const questions = [];

  for (const section of sections) {
    try {
      const systemPrompt = `You are a USMLE Step 2 CK question writer specializing in medical ethics and quality improvement. Generate realistic board-style vignette questions from the provided content. Return ONLY valid JSON.`;

      const userPrompt = `ARTICLE: ${data.title}
SECTION: ${section.heading}
CONTENT:
${section.body}

Generate 2 USMLE Step 2 CK style vignette questions from this content. Each must be a realistic clinical or ethics scenario.

Return this JSON exactly:
{
  "section": "${section.heading.replace(/"/g, "'")}",
  "questions": [
    {
      "questionText": "<clinical vignette stem, 3-5 sentences>",
      "choices": ["<A>", "<B>", "<C>", "<D>", "<E>"],
      "correctIndex": 0,
      "explanation": "<why correct, 2-3 sentences referencing the vignette>",
      "keyPrinciple": "<1 sentence: the ethics/QI concept tested>",
      "difficulty": "easy|medium|hard",
      "zczc": {
        "brain": "<1-3 word concept>",
        "eli4": "<toddler explanation>",
        "eli5": "<one step above eli4>",
        "clinical": "<max 30 words, bold pivotal terms with **>",
        "arrows": "<mechanism as arrows only>"
      }
    }
  ]
}
Rules: All 5 choices must be plausible. correctIndex is 0-based. Vignette must feel like a real NBME question.`;

      const raw = await callClaude(systemPrompt, userPrompt, apiKey);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw.replace(/```json|```/g, '').trim());
      if (parsed.questions && parsed.questions.length) {
        parsed.questions.forEach((q, i) => {
          questions.push({
            id: questions.length,
            source: 'amboss',
            articleTitle: data.title,
            articleUrl: data.url,
            section: parsed.section || section.heading,
            questionText: q.questionText,
            choices: q.choices,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            keyPrinciple: q.keyPrinciple,
            difficulty: q.difficulty,
            zczc: q.zczc
          });
        });
      }
    } catch(e) {
      console.error('[CKRB] AMBOSS section error:', section.heading, e.message);
    }

    done++;
    await setStatus({ state: 'amboss_processing', done, total, message: `Generating AMBOSS questions ${done}/${total}…` });
  }

  chrome.storage.local.set({ ckrb_amboss_questions: questions });
  stopKeepalive();
  await setStatus({ state: 'amboss_ready', done: total, total, message: `${questions.length} AMBOSS questions ready!` });
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
}
