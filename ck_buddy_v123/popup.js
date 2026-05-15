// popup.js — CK Review Buddy Game Logic

const STORAGE_KEY_QUESTIONS = 'ckrb_questions';
const STORAGE_KEY_STATUS    = 'ckrb_status';

/* ─────────────────────────────────────────────
   SCREEN MANAGER
───────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id !== 'screen-quiz') stopTimer();
}

/* ─────────────────────────────────────────────
   STORAGE HELPERS
───────────────────────────────────────────── */
function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/* ─────────────────────────────────────────────
   HOME SCREEN INIT
───────────────────────────────────────────── */
async function initHome() {
  // Detect current NBME position and update button
  const posEl = document.getElementById('scan-position');
  const labelEl = document.getElementById('btnScrapeLabel');
  chrome.tabs.query({ url: '*://*.starttest.com/*' }, tabs => {
    if (!tabs.length) {
      if (posEl) posEl.textContent = 'No NBME tab found — open NBME first';
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id, frameIds: [0] },
      func: () => {
        var el = document.getElementById('QuestionNumber');
        if (!el) return null;
        var m = el.innerText.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
        return m ? { section: parseInt(m[1]), question: parseInt(m[2]) } : null;
      }
    }, results => {
      const pos = results && results[0] && results[0].result;
      if (pos) {
        if (posEl) posEl.textContent = 'NBME: Section ' + pos.section + ' Q' + pos.question;
        if (labelEl) labelEl.textContent = 'Generate 25 — Starting S' + pos.section + ' Q' + pos.question;
        // Store for scraper to use
        chrome.storage.local.set({ ckrb_start_pos: pos });
      } else {
        if (posEl) posEl.textContent = 'CMS block detected — Q1 onwards';
        if (labelEl) labelEl.textContent = 'Generate 25 Questions';
      }
    });
  });

  showScreen('screen-home');

  // Detect AMBOSS session if available
  if (typeof detectAmbossSession === 'function') detectAmbossSession();

  // Detect current NBME position and update button
  chrome.tabs.query({ url: '*://*.starttest.com/*' }, tabs => {
    const posEl = document.getElementById('scrape-position');
    if (!tabs.length) { if (posEl) posEl.textContent = ''; return; }
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id, frameIds: [0] },
      func: () => {
        const el = document.getElementById('QuestionNumber');
        return el ? el.innerText : null;
      }
    }, results => {
      const text = results && results[0] && results[0].result;
      if (text && posEl) {
        const m = text.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
        if (m) posEl.textContent = 'Starting from S' + m[1] + ' Q' + m[2];
        else posEl.textContent = '';
      } else if (posEl) {
        posEl.textContent = '';
      }
    });
  });

  const { ckrb_questions: questions, ckrb_status: status } = await getStorage([STORAGE_KEY_QUESTIONS, STORAGE_KEY_STATUS]);

  const statusBox = document.getElementById('status-box');
  const btnStart  = document.getElementById('btnStartQuiz');
  const btnClear  = document.getElementById('btnClear');
  const preview   = document.getElementById('scrape-preview');

  if (status) {
    statusBox.classList.remove('hidden');
    statusBox.textContent = status.message || '';
  }

  if (status?.state === 'processing') {
    showScreen('screen-processing');
    document.getElementById('proc-title').textContent = 'Analyzing questions…';
    document.getElementById('proc-sub').textContent = 'Claude is diagnosing your misconceptions and building your quiz.';
    pollProcessing();
    return;
  }

  if (status?.state === 'chunk_done') {
    showScreen('screen-processing');
    document.getElementById('proc-title').textContent = `✓ ${status.done} done — ${status.remaining} more waiting`;
    document.getElementById('proc-bar').style.width = Math.round((status.done / status.total) * 100) + '%';
    document.getElementById('proc-count').textContent = `${status.done} / ${status.total}`;
    const continueBtn = document.getElementById('btnContinueChunk');
    if (continueBtn) { continueBtn.classList.remove('hidden'); continueBtn.textContent = `▶ Continue next 10 (${status.remaining} remaining)`; }
    pollProcessing();
    return;
  }

  if (status?.state === 'ready') {
    // Just fall through — home screen will show Start Quiz button normally
  }

  if (questions?.length) {
    btnStart.classList.remove('hidden');
    btnClear.classList.remove('hidden');
    preview.classList.remove('hidden');

    const wrong   = questions.filter(q => q.isCorrect === false).length;
    const right   = questions.filter(q => q.isCorrect === true).length;
    const unknown = questions.filter(q => q.isCorrect === null).length;

    document.getElementById('count-wrong').textContent   = `${wrong} ✗`;
    document.getElementById('count-right').textContent   = `${right} ✓`;
    document.getElementById('count-unknown').textContent = `${unknown} ?`;
  }

  // Check for resumable quiz
  const { ckrb_quiz_progress: progress } = await getStorage(['ckrb_quiz_progress']);
  const btnResume = document.getElementById('btnResumeQuiz');
  if (progress?.active && questions?.length && progress.currentIndex < progress.total) {
    btnResume.classList.remove('hidden');
    const pct = progress.total ? Math.round((progress.currentIndex / progress.total) * 100) : 0;
    document.getElementById('btnResumeLabel').textContent =
      `Resume Quiz (${progress.currentIndex}/${progress.total} · ${progress.score}pts)`;
  } else {
    btnResume.classList.add('hidden');
  }
}

/* ─────────────────────────────────────────────
   SCRAPE → SEND TO BACKGROUND
───────────────────────────────────────────── */
document.getElementById('btnScrape').addEventListener('click', async () => {
  // Clear any previous error/status before scanning
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);

  // Target NBME tab specifically, not active tab
  let tabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true });
  const [tab] = tabs;

  // Inject content script and wait for it to initialize
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  // Switch to processing screen right away
  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Navigating through questions…';
  document.getElementById('proc-sub').textContent = 'Watch the page — clicking through each question automatically.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PAGE' }, async (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      alert('Could not scrape this page. Make sure you are on a Q-bank review/results page.');
      return;
    }
    // Page-reload mode (NBME): scraping navigates across full page reloads automatically
    if (response.mode === 'page_reload') {
      document.getElementById('proc-title').textContent = 'Scraping questions…';
      document.getElementById('proc-sub').textContent = 'Navigating through each question automatically. Keep the Q-bank tab open.';
      document.getElementById('proc-count').textContent = 'Please wait…';
      pollProcessing();
      return;
    }
    if (!response.data?.questions?.length) {
      showScreen('screen-home');
      alert('No questions detected. Make sure you are on a Q-bank review/results page.');
      return;
    }
    const { questions } = response.data;
    document.getElementById('proc-title').textContent = `Analyzing ${questions.length} questions…`;
    document.getElementById('proc-sub').textContent = 'Claude is diagnosing your gaps and building your quiz.';
    document.getElementById('proc-count').textContent = `0 / ${questions.length}`;
    chrome.runtime.sendMessage({ type: 'START_PROCESSING', questions });
    pollProcessing();
  });
});

/* ─────────────────────────────────────────────
   POLL PROCESSING STATUS
───────────────────────────────────────────── */
let _pollInterval = null;
function pollProcessing() {
  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(async () => {
    const { ckrb_status: status } = await getStorage([STORAGE_KEY_STATUS]);

    const procBar   = document.getElementById('proc-bar');
    const procCount = document.getElementById('proc-count');
    const procTitle = document.getElementById('proc-title');
    const procPhase = document.getElementById('proc-phase');

    if (!status) {
      // Still scraping — phase 1
      if (procPhase) procPhase.textContent = 'PHASE 1 OF 2 — SCRAPING';
      return;
    }

    if (status.state === 'processing') {
      if (procPhase) procPhase.textContent = 'PHASE 2 OF 2 — GENERATING';
      if (procTitle) procTitle.textContent = 'Generating quiz…';
      const procSub = document.getElementById('proc-sub');
      if (procSub) procSub.textContent = 'Claude is diagnosing your misconceptions and building your quiz.';
      const pct = status.total ? (status.done / status.total) * 100 : 0;
      if (procBar) procBar.style.width = pct + '%';
      if (procCount) procCount.textContent = `${status.done} / ${status.total}`;
    }

    if (status.state === 'chunk_done') {
      procTitle.textContent = `✓ ${status.done} done — ${status.remaining} more waiting`;
      procBar.style.width = Math.round((status.done / status.total) * 100) + '%';
      const continueBtn = document.getElementById('btnContinueChunk');
      if (continueBtn) {
        continueBtn.classList.remove('hidden');
        continueBtn.textContent = `▶ Continue next 10 (${status.remaining} remaining)`;
      }
    }

    if (status.state === 'ready') {
      clearInterval(_pollInterval); _pollInterval = null;
      procTitle.textContent = '✓ Ready! Launching quiz…';
      procBar.style.width = '100%';
      const continueBtn = document.getElementById('btnContinueChunk');
      if (continueBtn) continueBtn.classList.add('hidden');
      setTimeout(() => startQuiz(), 1000);
    }

    if (status.state === 'error') {
      clearInterval(_pollInterval); _pollInterval = null;
      showScreen('screen-home');
      document.getElementById('status-box').classList.remove('hidden');
      document.getElementById('status-box').textContent = '⚠ ' + status.message;
    }
  }, 800);
}

/* ─────────────────────────────────────────────
   CLEAR DATA
───────────────────────────────────────────── */
document.getElementById('btnContinueChunk').addEventListener('click', () => {
  const continueBtn = document.getElementById('btnContinueChunk');
  if (continueBtn) continueBtn.classList.add('hidden');
  chrome.storage.local.set({ ckrb_continue: true });
});

document.getElementById('btnForceHome').addEventListener('click', () => {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  initHome();
});

// Set Start Q — grid modal
function buildSetStartGrid(section) {
  const grid = document.getElementById('set-start-grid');
  if (!grid) return;
  grid.innerHTML = '';
  grid.dataset.section = section;
  for (let q = 1; q <= 50; q++) {
    const absNum = (section - 1) * 50 + q;
    const btn = document.createElement('button');
    btn.textContent = q;
    btn.dataset.abs = absNum;
    btn.style.cssText = 'padding:6px 0;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid #334155;background:#1e293b;color:#94a3b8;';
    btn.addEventListener('mouseenter', () => { btn.style.borderColor='#6366f1'; btn.style.color='#e2e8f0'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor='#334155'; btn.style.color='#94a3b8'; });
    btn.addEventListener('click', () => {
      const absNum = parseInt(btn.dataset.abs);
      const sec = parseInt(grid.dataset.section);
      const statusEl = document.getElementById('set-start-status');
      if (statusEl) statusEl.textContent = 'Navigating to S' + sec + ' Q' + q + '…';
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_QUESTION', questionNum: absNum }, () => {
        setTimeout(() => {
          if (statusEl) statusEl.textContent = 'Ready at S' + sec + ' Q' + q + ' — close and click Scan 5';
          const homeStatus = document.getElementById('test-scan-status');
          if (homeStatus) homeStatus.textContent = 'Start set: S' + sec + ' Q' + q;
          document.getElementById('set-start-modal').style.display = 'none';
        }, 1800);
      });
    });
    grid.appendChild(btn);
  }
}

document.getElementById('btnSetStart').addEventListener('click', () => {
  buildSetStartGrid(1);
  document.getElementById('set-start-modal').style.display = 'flex';
});

document.getElementById('btnSetStartClose').addEventListener('click', () => {
  document.getElementById('set-start-modal').style.display = 'none';
});

document.querySelectorAll('.set-start-section-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = parseInt(btn.dataset.s);
    document.querySelectorAll('.set-start-section-btn').forEach(b => {
      const active = parseInt(b.dataset.s) === section;
      b.style.background = active ? '#6366f1' : '#1e293b';
      b.style.borderColor = active ? '#6366f1' : '#334155';
      b.style.color = active ? '#fff' : '#94a3b8';
    });
    buildSetStartGrid(section);
  });
});

document.getElementById('btnScrape5').addEventListener('click', async () => {
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);
  let tabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true });
  const [tab] = tabs;
  // Always re-inject and wait for it to initialize
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await new Promise(r => setTimeout(r, 800));
  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (5 questions)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scanning 5 questions only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph5 = document.getElementById('proc-phase'); if (_ph5) _ph5.textContent = 'PHASE 1 OF 2 — SCRAPING';
  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PAGE_N', count: 5 }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      alert('Could not scrape. Make sure you are on the NBME exam tab.');
    }
  });
});

document.getElementById('btnScrape1').addEventListener('click', async () => {
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);
  let tabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true });
  const [tab] = tabs;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}
  await new Promise(r => setTimeout(r, 800));
  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (1 question)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scanning 1 question only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph1 = document.getElementById('proc-phase'); if (_ph1) _ph1.textContent = 'PHASE 1 OF 2 — SCRAPING';
  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PAGE_N', count: 1 }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      alert('Could not scrape. Make sure you are on the NBME exam tab.');
    }
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  clearQuizProgress();
  chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, () => initHome());
});

document.getElementById('btnDebug').addEventListener('click', async () => {
  let tabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true });
  const [tab] = tabs;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}
  chrome.tabs.sendMessage(tab.id, { type: 'DUMP_PAGE' }, (response) => {
    if (!response?.ok) {
      alert('Could not dump page. Make sure you are on the NBME question page first.');
      return;
    }
    // Download as JSON
    const blob = new Blob([JSON.stringify(response.dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'ckrb-debug.json', saveAs: false });
    alert('Debug file downloaded as ckrb-debug.json — send it to Claude for analysis.');
  });
});

/* ─────────────────────────────────────────────
   SETTINGS LINK
───────────────────────────────────────────── */
document.getElementById('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('openWindow').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?window=1'),
    type: 'normal',
    width: 480,
    height: 700,
    focused: true
  });
});

/* ─────────────────────────────────────────────
   QUIZ ENGINE
───────────────────────────────────────────── */
let quizState = {
  allQuestions: [],      // enriched question objects
  triviaQueue: [],       // flat array of {trivia, parentQ}
  currentIndex: 0,
  score: 0,
  streak: 0,
  correct: 0,
  wrong: 0,
  total: 0
};

/* ── QUIZ STATE PERSISTENCE ── */
function saveQuizProgress() {
  // Save lightweight progress (indices + scores) to chrome.storage
  chrome.storage.local.set({
    ckrb_quiz_progress: {
      currentIndex: quizState.currentIndex,
      score: quizState.score,
      streak: quizState.streak,
      correct: quizState.correct,
      wrong: quizState.wrong,
      total: quizState.total,
      active: true,
      savedAt: Date.now()
    }
  });
}

function clearQuizProgress() {
  chrome.storage.local.remove(['ckrb_quiz_progress']);
}

async function resumeQuiz() {
  const r = await getStorage(['ckrb_quiz_progress', STORAGE_KEY_QUESTIONS]);
  const progress = r.ckrb_quiz_progress;
  const questions = r[STORAGE_KEY_QUESTIONS];
  if (!progress?.active || !questions?.length) return false;

  // Rebuild trivia queue from stored questions (same logic as startQuiz)
  const queue = [];
  const sorted = [...questions].sort((a, b) => a.id - b.id);
  sorted.forEach(q => {
    const type = q.analysis?._type;
    const trivia = q.analysis?.triviaQuestions || [];
    if (type === 'incorrect' || type === 'unknown') {
      trivia.slice(0, 3).forEach(t => queue.push({ trivia: t, parentQ: q }));
    } else {
      trivia.slice(0, 1).forEach(t => queue.push({ trivia: t, parentQ: q }));
    }
  });

  if (!queue.length || progress.currentIndex >= queue.length) return false;

  quizState = {
    allQuestions: questions,
    triviaQueue: queue,
    currentIndex: progress.currentIndex,
    score: progress.score || 0,
    streak: progress.streak || 0,
    correct: progress.correct || 0,
    wrong: progress.wrong || 0,
    total: queue.length
  };

  showScreen('screen-quiz');
  startSessionClock();
  window._lastNavNum = null; // Reset so resumed question triggers auto-nav
  renderTriviaQuestion();
  return true;
}

document.getElementById('btnStartQuiz').addEventListener('click', startQuiz);
document.getElementById('btnResumeQuiz').addEventListener('click', async () => {
  const resumed = await resumeQuiz();
  if (!resumed) {
    // Fallback to fresh start if resume data is stale
    startQuiz();
  }
});

async function startQuiz() {
  const { ckrb_questions: questions } = await getStorage([STORAGE_KEY_QUESTIONS]);
  if (!questions?.length) return;

  // Build trivia queue in EXAM ORDER (q.id preserves original order)
  const queue = [];
  const sorted = [...questions].sort((a, b) => a.id - b.id);

  sorted.forEach(q => {
    const type = q.analysis?._type;
    const trivia = q.analysis?.triviaQuestions || [];
    if (type === 'incorrect' || type === 'unknown') {
      trivia.slice(0, 3).forEach(t => queue.push({ trivia: t, parentQ: q }));
    } else {
      trivia.slice(0, 1).forEach(t => queue.push({ trivia: t, parentQ: q }));
    }
  });

  if (!queue.length) {
    alert('No trivia questions generated. Try clearing data and scanning again.');
    return;
  }

  quizState = {
    allQuestions: questions,
    triviaQueue: queue,
    currentIndex: 0,
    score: 0,
    streak: 0,
    correct: 0,
    wrong: 0,
    total: queue.length
  };

  showScreen('screen-quiz');
  startSessionClock();
  window._lastNavNum = null; // Reset so first question triggers auto-nav
  saveQuizProgress();
  renderTriviaQuestion();
}

/* ── DIRECT NAV — popup calls chrome.scripting.executeScript on AMBOSS tab ── */
async function directNavToQuestion(targetQ) {
  console.log('[CK Buddy Popup] directNavToQuestion called for Q' + targetQ);
  try {
    // Find AMBOSS review/session tab
    const ambossTabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
    const reviewTab = ambossTabs.find(t => /\/(review|session)\//.test(t.url));
    if (!reviewTab) {
      // Try NBME fallback
      const nbmeTabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
      if (nbmeTabs.length) {
        chrome.tabs.sendMessage(nbmeTabs[0].id, { type: 'NAV_TO_QUESTION', questionNum: targetQ });
        console.log('[CK Buddy Popup] Sent NAV to NBME tab');
        return;
      }
      console.log('[CK Buddy Popup] No AMBOSS or NBME tab found');
      return;
    }
    console.log('[CK Buddy Popup] Found AMBOSS tab:', reviewTab.id, reviewTab.url);
    // Direct executeScript — click sidebar + verify + retry
    const results = await chrome.scripting.executeScript({
      target: { tabId: reviewTab.id },
      func: async (qNum) => {
        function getCurrentQ() {
          var m = location.pathname.match(/\/review\/[^/]+\/(\d+)/);
          return m ? parseInt(m[1]) : null;
        }
        function clickSidebar(q) {
          var btn = document.querySelector('[data-e2e-test-id="question-' + q + '"]');
          if (btn) { btn.click(); return true; }
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
        if (getCurrentQ() === qNum) return { ok: true, landed: qNum, method: 'already_there' };
        for (var attempt = 1; attempt <= 3; attempt++) {
          clickSidebar(qNum);
          var landed = await waitForNav(qNum, 3000);
          if (landed === qNum) return { ok: true, landed: landed, method: 'sidebar', attempt: attempt };
        }
        // URL fallback
        var m = location.pathname.match(/(\/[^/]+\/review\/[^/]+\/)\d+/);
        if (m) {
          location.href = location.origin + m[1] + qNum;
          await new Promise(function(r) { setTimeout(r, 2000); });
          return { ok: getCurrentQ() === qNum, landed: getCurrentQ(), method: 'url_nav' };
        }
        return { ok: false, landed: getCurrentQ(), method: 'failed' };
      },
      args: [targetQ]
    });
    const r = results && results[0] && results[0].result;
    console.log('[CK Buddy Popup] Nav result:', JSON.stringify(r));
  } catch (err) {
    console.error('[CK Buddy Popup] directNavToQuestion error:', err);
    // Last resort fallback to background message
    chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_QUESTION', questionNum: targetQ });
  }
}

function renderTriviaQuestion() {
  const { triviaQueue, currentIndex, score, streak } = quizState;
  if (currentIndex >= triviaQueue.length) { showResults(); return; }

  const { trivia, parentQ } = triviaQueue[currentIndex];
  const type = parentQ.analysis?._type || 'unknown';
  const analysis = parentQ.analysis || {};
  const isFirstForParent = currentIndex === findFirstIndexForParent(triviaQueue, currentIndex, parentQ);

  // Header
  const labelEl = document.getElementById('quiz-label');
  if (type === 'incorrect' || type === 'unknown') {
    labelEl.textContent = 'MISSED'; labelEl.className = 'quiz-label incorrect-label';
  } else {
    labelEl.textContent = 'CORRECT'; labelEl.className = 'quiz-label correct-label';
  }
  const actualQNum = parentQ.absoluteId || (parentQ.id + 1);
  document.getElementById('quiz-qnum').textContent = 'Exam Q' + actualQNum + ' · trivia ' + (currentIndex + 1) + '/' + quizState.total;
  document.getElementById('score-display').textContent = score;
  document.getElementById('streak-display').textContent = streak >= 3 ? `🔥 ×${streak}` : '';

  // Answer comparison box — always show on first trivia for this question
  const misBox = document.getElementById('misconception-box');
  const misText = document.getElementById('misconception-text');
  if (isFirstForParent) {
    misBox.classList.remove('hidden');
    if (type === 'incorrect' || type === 'unknown') {
      const ua = analysis.userAnswer || 'Unknown';
      const ca = analysis.correctAnswer || 'Unknown';
      const mc = analysis.likelyMisconception || '';
      misText.innerHTML =
        `<div style="margin-bottom:6px"><span style="color:#f87171">✗ You answered:</span> ${ua}</div>` +
        `<div style="margin-bottom:6px"><span style="color:#34d399">✓ Correct:</span> ${ca}</div>` +
        (mc ? `<div style="color:#94a3b8;font-size:11px;margin-top:4px">${mc}</div>` : '');
    } else {
      // Correct — show confirmation + skip option
      const ca = analysis.correctAnswer || analysis.userAnswer || '';
      misText.innerHTML =
        `<div style="margin-bottom:6px"><span style="color:#34d399">✓ You got this right:</span> ${ca}</div>` +
        `<div style="margin-top:6px"><button id="btnSkipQ" style="background:#334155;border:1px solid #475569;color:#94a3b8;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">Skip — I know this ›</button></div>`;
      setTimeout(() => {
        const skipBtn = document.getElementById('btnSkipQ');
        if (skipBtn) skipBtn.addEventListener('click', skipToNextParent);
      }, 0);
    }
  } else {
    misBox.classList.add('hidden');
  }

  // Vignette quote callout
  const quoteBox = document.getElementById('vignette-quote-box');
  const quoteText = document.getElementById('vignette-quote-text');
  if (trivia.vignetteQuote && trivia.vignetteQuote.length > 3) {
    quoteBox.classList.remove('hidden');
    quoteText.textContent = '"' + trivia.vignetteQuote + '"';
  } else {
    quoteBox.classList.add('hidden');
  }

  // Question
  document.getElementById('quiz-question-text').textContent = trivia.question;

  // Choices
  const choicesWrap = document.getElementById('choices-wrap');
  choicesWrap.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E'];
  (trivia.choices || []).forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-letter">${letters[i]}</span><span>${choice}</span>`;
    btn.addEventListener('click', () => handleAnswer(i, trivia));
    choicesWrap.appendChild(btn);
  });

  document.getElementById('feedback-box').classList.add('hidden');
  startTimer();

  // Auto-navigate exam tab — use actual question number
  // Navigate whenever the parent question changes (tracked by absoluteId/question number)
  const absNavNum = parentQ.absoluteId || (parentQ.id + 1);
  console.log('[CK Buddy Popup] renderTrivia: absNavNum=' + absNavNum + ' lastNav=' + window._lastNavNum + ' autonav=' + (SETTINGS && SETTINGS.autonav));
  if (SETTINGS && SETTINGS.autonav && absNavNum !== window._lastNavNum) {
    window._lastNavNum = absNavNum;
    console.log('[CK Buddy Popup] Navigating AMBOSS to Q' + absNavNum);
    directNavToQuestion(absNavNum);
  }

  // Render zczc panel from parent question analysis
  const zczc = parentQ.analysis?.zczc;
  const zczcPanel = document.getElementById('zczc-panel');
  if (zczc && zczcPanel) {
    const boldify = s => (s||'').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    zczcPanel.innerHTML = `
      <div class="zczc-row"><span class="zczc-icon">🧠</span><span>${boldify(zczc.brain)}</span></div>
      <div class="zczc-row"><span class="zczc-icon">🧒⁴</span><span>${boldify(zczc.eli4)}</span></div>
      <div class="zczc-row"><span class="zczc-icon">🧒⁵</span><span>${boldify(zczc.eli5)}</span></div>
      ${zczc.equations && zczc.equations !== 'N/A' ? `<div class="zczc-row"><span class="zczc-icon">🧮</span><span>${boldify(zczc.equations)}</span></div>` : ''}
      <div class="zczc-row"><span class="zczc-icon">👨‍⚕️</span><span>${boldify(zczc.clinical)}</span></div>
      <div class="zczc-row"><span class="zczc-icon">🤖</span><span>${boldify(zczc.arrows)}</span></div>
      ${(zczc.quotes || []).map(q => `<div class="zczc-row"><span class="zczc-icon">💬</span><span>${q}</span></div>`).join('')}
    `;
    zczcPanel.classList.remove('hidden');
  } else if (zczcPanel) {
    zczcPanel.classList.add('hidden');
  }

  // ── DIRECT TTS — called here, guaranteed, no observer needed ──
  if (SETTINGS.readAloud) {
    window.speechSynthesis.cancel();
    window._quoteHandlingTTS = false;
    const voices = getCachedVoices();
    const main = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en'));
    const quoteBox = document.getElementById('vignette-quote-box');
    const quoteEl  = document.getElementById('vignette-quote-text');
    const qEl      = document.getElementById('quiz-question-text');
    const quoteText    = (quoteEl && !quoteBox.classList.contains('hidden')) ? quoteEl.textContent.trim().replace(/^"|"$/g, '') : '';
    const questionText = qEl ? qEl.textContent.trim() : '';

    if (SETTINGS.readQuote !== false && quoteText.length > 3) {
      window._quoteHandlingTTS = true;
      const uQ = new SpeechSynthesisUtterance(quoteText);
      uQ.rate = 0.85; uQ.pitch = 1.5; uQ.volume = 1; if (main) uQ.voice = main;
      const uS = new SpeechSynthesisUtterance(questionText);
      uS.rate = 0.95; uS.pitch = 1.0; uS.volume = 1; if (main) uS.voice = main;
      uS.onend = () => { window._quoteHandlingTTS = false; };
      uQ.onend = () => { if (questionText.length > 10) window.speechSynthesis.speak(uS); else window._quoteHandlingTTS = false; };
      window.speechSynthesis.speak(uQ);
    } else if (questionText.length > 10) {
      const uS = new SpeechSynthesisUtterance(questionText);
      uS.rate = 0.95; uS.pitch = 1.0; uS.volume = 1; if (main) uS.voice = main;
      window.speechSynthesis.speak(uS);
    }
  }
}

function skipToNextParent() {
  // Skip all remaining trivia for this parent question
  const { triviaQueue, currentIndex } = quizState;
  const parentQ = triviaQueue[currentIndex].parentQ;
  let i = currentIndex + 1;
  while (i < triviaQueue.length && triviaQueue[i].parentQ === parentQ) i++;
  quizState.currentIndex = i;
  quizState.correct++; // credit for knowing it
  saveQuizProgress();
  renderTriviaQuestion();
}

function findFirstIndexForParent(queue, currentIdx, parentQ) {
  return queue.findIndex(item => item.parentQ === parentQ);
}

function handleAnswer(selectedIdx, trivia) {
  stopTimer();
  const isCorrect = selectedIdx === trivia.correctIndex;
  document.querySelectorAll('.choice-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === trivia.correctIndex) btn.classList.add('correct');
    else if (i === selectedIdx && !isCorrect) btn.classList.add('wrong');
  });
  if (isCorrect) {
    quizState.streak++;
    const bonus = Math.max(0, quizState.streak - 2);
    const points = 10 + bonus * 5;
    quizState.score += points;
    quizState.correct++;
    showFeedback(true, trivia.explanation, points, trivia);
  } else {
    quizState.streak = 0;
    quizState.wrong++;
    showFeedback(false, trivia.explanation, 0, trivia);
  }
  document.getElementById('score-display').textContent = quizState.score;
  document.getElementById('streak-display').textContent = quizState.streak >= 3 ? `🔥 ×${quizState.streak}` : '';
  saveQuizProgress();
}

function showFeedback(isCorrect, explanation, points, trivia) {
  const box = document.getElementById('feedback-box');
  const icon = document.getElementById('feedback-icon');
  const text = document.getElementById('feedback-text');
  box.classList.remove('hidden');
  if (isCorrect) {
    icon.textContent = points > 10 ? `🔥 +${points}` : `✅ +${points}`;
    box.style.borderColor = '#10b981';
  } else {
    icon.textContent = '❌';
    box.style.borderColor = '#ef4444';
  }
  text.textContent = explanation;
  if (SETTINGS.readExplain) readQuestionAloud(explanation);

  // Explanation zczc panel
  let expZczcEl = document.getElementById('exp-zczc-panel');
  if (!expZczcEl) {
    expZczcEl = document.createElement('div');
    expZczcEl.id = 'exp-zczc-panel';
    expZczcEl.className = 'zczc-panel';
    expZczcEl.style.marginTop = '10px';
    box.insertBefore(expZczcEl, document.getElementById('btnNextQ'));
  }
  const ez = trivia && trivia.explanation_zczc;
  if (ez) {
    expZczcEl.innerHTML =
      `<div style="font-size:10px;font-weight:700;color:#818cf8;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #334155;">📖 EXPLANATION</div>` +
      `<div class="zczc-row"><span class="zczc-icon">🧠</span><span>${ez.brain||''}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🧒⁴</span><span>${ez.eli4||''}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🧒⁵</span><span>${ez.eli5||''}</span></div>` +
      (ez.equations && ez.equations !== 'N/A' ? `<div class="zczc-row"><span class="zczc-icon">🧮</span><span>${ez.equations}</span></div>` : '') +
      `<div class="zczc-row"><span class="zczc-icon">👨‍⚕️</span><span>${ez.clinical||''}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🤖</span><span>${ez.arrows||''}</span></div>` +
      (ez.quotes||[]).map(q => `<div class="zczc-row"><span class="zczc-icon">💬</span><span>${q}</span></div>`).join('');
    expZczcEl.style.display = 'block';
  } else {
    expZczcEl.style.display = 'none';
  }
  startTimer();
}

document.getElementById('btnNextQ').addEventListener('click', () => {
  window.speechSynthesis.cancel();
  quizState.currentIndex++;
  saveQuizProgress();
  renderTriviaQuestion();
});

// ── NBME EXPLANATION TTS ──
var _explTTSText = '';
function _explSpeak() {
  if (!_explTTSText || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(_explTTSText);
  u.rate = 0.95;
  u.pitch = 1.0;
  var voices = getCachedVoices();
  var eng = voices.find(function(v) { return v.lang.startsWith('en-US'); }) || voices.find(function(v) { return v.lang.startsWith('en'); });
  if (eng) u.voice = eng;
  window.speechSynthesis.speak(u);
}
document.getElementById('btnReadExplanation').addEventListener('click', function() {
  var item = quizState.triviaQueue && quizState.triviaQueue[quizState.currentIndex];
  _explTTSText = (item && item.parentQ && item.parentQ.explanation) ? item.parentQ.explanation : '';
  _explSpeak();
});
document.getElementById('btnReplayExplanation').addEventListener('click', function() { _explSpeak(); });
document.getElementById('btnStopExplanation').addEventListener('click', function() { window.speechSynthesis.cancel(); });


/* ─────────────────────────────────────────────
   RESULTS SCREEN
───────────────────────────────────────────── */
function showResults() {
  clearQuizProgress();
  showScreen('screen-results');

  const { correct, total, score } = quizState;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  // Trophy
  const trophy = document.getElementById('trophy-icon');
  if (pct >= 90) trophy.textContent = '🏆';
  else if (pct >= 70) trophy.textContent = '🥈';
  else if (pct >= 50) trophy.textContent = '💪';
  else trophy.textContent = '📚';

  document.getElementById('result-title').textContent =
    pct >= 80 ? 'Outstanding!' : pct >= 60 ? 'Good work!' : 'Keep pushing!';

  document.getElementById('result-score-big').textContent = `${score} pts`;

  document.getElementById('result-breakdown').innerHTML =
    `✅ ${correct} correct &nbsp;·&nbsp; ❌ ${quizState.wrong} wrong<br/>Accuracy: ${pct}%`;

  // Show Generate next 10 button
  const genNext = document.getElementById('btnGenNext10');
  if (genNext) genNext.classList.remove('hidden');

  setTimeout(() => {
    document.getElementById('result-bar').style.width = pct + '%';
  }, 100);
}

document.getElementById('btnPlayAgain').addEventListener('click', startQuiz);

const _genNext = document.getElementById('btnGenNext25');
if (_genNext) _genNext.addEventListener('click', () => {
  _genNext.classList.add('hidden');
  initHome();
  showScreen('screen-home');
});
document.getElementById('btnHomeFromResult').addEventListener('click', initHome);

const _btnGenNext10 = document.getElementById('btnGenNext10');
if (_btnGenNext10) _btnGenNext10.addEventListener('click', () => {
  // Clear existing data and go back to home to scan next 10
  chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, () => initHome());
});

/* ─────────────────────────────────────────────
   BOOT
───────────────────────────────────────────── */
initHome();

/* ═══════════════════════════════════════════
   AMBOSS QBANK SCRAPER (same pipeline as NBME)
═══════════════════════════════════════════ */
document.getElementById('btnAmbossQbank').addEventListener('click', async () => {
  // Clear previous data
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);

  // Find AMBOSS tab with a review or session URL
  let tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  // Filter to review/session pages only
  let reviewTabs = tabs.filter(t => /\/(review|session)\//.test(t.url));
  if (!reviewTabs.length) {
    // Try any AMBOSS tab
    if (!tabs.length) {
      alert('No AMBOSS tab found. Open an AMBOSS question block first.');
      return;
    }
    reviewTabs = tabs;
  }
  const tab = reviewTabs[0];

  // Inject the qbank scraper
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['amboss_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  // Switch to processing screen
  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Scraping AMBOSS questions…';
  document.getElementById('proc-sub').textContent = 'Navigating through each question in the block. Keep the AMBOSS tab open.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'AMBOSS_QBANK_SCRAPE' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      alert('Could not scrape AMBOSS. Make sure you are on an AMBOSS review/session page with completed questions.');
      return;
    }
    // page_reload mode — scraping navigates through questions, then sends PR_SCRAPE_COMPLETE
    document.getElementById('proc-title').textContent = 'Scraping AMBOSS questions…';
    document.getElementById('proc-sub').textContent = 'Watch the AMBOSS tab — clicking through each question automatically.';
    document.getElementById('proc-count').textContent = 'Please wait…';
    pollProcessing();
  });
});

// Detect AMBOSS session on home screen
async function detectAmbossSession() {
  const posEl = document.getElementById('amboss-qbank-position');
  if (!posEl) return;
  const tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  const reviewTabs = tabs.filter(t => /\/(review|session)\//.test(t.url));
  if (reviewTabs.length) {
    const title = reviewTabs[0].title || '';
    posEl.textContent = '✓ AMBOSS block: ' + title.slice(0, 45);
    posEl.style.color = '#a78bfa';
  } else {
    posEl.textContent = '';
  }
}

// Call on init
detectAmbossSession();

/* ── AMBOSS SCAN 1 (test single question) ── */
document.getElementById('btnAmbossScan1').addEventListener('click', async () => {
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);

  let tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  let reviewTabs = tabs.filter(t => /\/(review|session)\//.test(t.url));
  if (!reviewTabs.length) {
    document.getElementById('amboss-scan-status').textContent = '⚠ No AMBOSS review/session tab found';
    return;
  }
  const tab = reviewTabs[0];

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['amboss_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  document.getElementById('amboss-scan-status').textContent = 'Scraping 1 question…';

  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (1 AMBOSS question)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scraping 1 question only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'AMBOSS_QBANK_SCRAPE', count: 1 }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      document.getElementById('amboss-scan-status').textContent = '⚠ Could not scrape. Check AMBOSS tab.';
      return;
    }
    document.getElementById('amboss-scan-status').textContent = 'Scraping done, generating…';
    pollProcessing();
  });
});

/* ── AMBOSS SCAN 5 (test 5 questions) ── */
document.getElementById('btnAmbossScan5').addEventListener('click', async () => {
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session']);

  let tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  let reviewTabs = tabs.filter(t => /\/(review|session)\//.test(t.url));
  if (!reviewTabs.length) {
    document.getElementById('amboss-scan-status').textContent = '⚠ No AMBOSS review/session tab found';
    return;
  }
  const tab = reviewTabs[0];

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['amboss_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  document.getElementById('amboss-scan-status').textContent = 'Scraping 5 questions…';

  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (5 AMBOSS questions)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scraping 5 questions only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'AMBOSS_QBANK_SCRAPE', count: 5 }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      document.getElementById('amboss-scan-status').textContent = '⚠ Could not scrape. Check AMBOSS tab.';
      return;
    }
    document.getElementById('amboss-scan-status').textContent = 'Scraping done, generating…';
    pollProcessing();
  });
});

/* ═══════════════════════════════════════════
   AMBOSS ENGINE
═══════════════════════════════════════════ */
let ambossQuizState = { questions: [], currentIndex: 0, score: 0, correct: 0, wrong: 0 };

document.getElementById('btnAmboss').addEventListener('click', () => {
  showScreen('screen-amboss');
  refreshAmbossScreen();
});
document.getElementById('btnAmbossBack').addEventListener('click', () => initHome());
document.getElementById('btnAmbossQuizBack').addEventListener('click', () => showScreen('screen-amboss'));

async function refreshAmbossScreen() {
  const statusEl = document.getElementById('amboss-article-status');
  const startBtn = document.getElementById('btnAmbossStartQuiz');
  const ambossStatus = document.getElementById('amboss-status');

  // Check for existing questions
  const r = await new Promise(resolve => chrome.storage.local.get(['ckrb_amboss_questions', STORAGE_KEY_STATUS], resolve));
  const qs = r.ckrb_amboss_questions || [];
  if (qs.length) {
    startBtn.classList.remove('hidden');
    ambossStatus.textContent = `${qs.length} questions ready from "${qs[0]?.articleTitle || 'AMBOSS'}"`;
    ambossStatus.style.color = '#34d399';
  } else {
    startBtn.classList.add('hidden');
    ambossStatus.textContent = '';
  }

  // Check if AMBOSS tab is open
  const tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  if (tabs.length) {
    statusEl.textContent = '✓ AMBOSS tab detected: ' + (tabs[0].title || tabs[0].url).slice(0, 50);
    statusEl.style.color = '#34d399';
  } else {
    statusEl.textContent = 'No AMBOSS tab found — open an article first';
    statusEl.style.color = '#f87171';
  }

  // Poll if processing
  if (r.ckrb_status?.state === 'amboss_processing') pollAmboss();
}

document.getElementById('btnAmbosScrape').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
  if (!tabs.length) {
    document.getElementById('amboss-status').textContent = '⚠ Open an AMBOSS article first';
    document.getElementById('amboss-status').style.color = '#f87171';
    return;
  }
  const tab = tabs[0];
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['amboss.js'] }); } catch(_) {}
  await new Promise(r => setTimeout(r, 600));

  chrome.tabs.sendMessage(tab.id, { type: 'AMBOSS_SCRAPE' }, async (response) => {
    if (chrome.runtime.lastError || !response?.ok || !response?.data) {
      document.getElementById('amboss-status').textContent = '⚠ Could not scrape — make sure you are on an AMBOSS article page';
      document.getElementById('amboss-status').style.color = '#f87171';
      return;
    }
    const data = response.data;
    document.getElementById('amboss-status').textContent = `Scraped "${data.title}" — ${data.sections.length} sections. Generating questions…`;
    document.getElementById('amboss-status').style.color = '#a78bfa';
    document.getElementById('amboss-progress-wrap').style.display = 'block';
    chrome.runtime.sendMessage({ type: 'AMBOSS_PROCESS', data });
    pollAmboss();
  });
});

function pollAmboss() {
  const interval = setInterval(async () => {
    const r = await getStorage([STORAGE_KEY_STATUS]);
    const status = r.ckrb_status;
    if (!status) return;

    if (status.state === 'amboss_processing') {
      const pct = status.total ? (status.done / status.total) * 100 : 0;
      document.getElementById('amboss-bar').style.width = pct + '%';
      document.getElementById('amboss-count').textContent = `${status.done} / ${status.total} sections`;
      document.getElementById('amboss-status').textContent = status.message;
      document.getElementById('amboss-status').style.color = '#a78bfa';
    }

    if (status.state === 'amboss_ready') {
      clearInterval(interval);
      document.getElementById('amboss-bar').style.width = '100%';
      document.getElementById('amboss-status').textContent = status.message;
      document.getElementById('amboss-status').style.color = '#34d399';
      document.getElementById('btnAmbossStartQuiz').classList.remove('hidden');
      document.getElementById('amboss-progress-wrap').style.display = 'none';
    }

    if (status.state === 'error') {
      clearInterval(interval);
      document.getElementById('amboss-status').textContent = '⚠ ' + status.message;
      document.getElementById('amboss-status').style.color = '#f87171';
    }
  }, 800);
}

document.getElementById('btnAmbosClear').addEventListener('click', () => {
  chrome.storage.local.remove(['ckrb_amboss_questions']);
  document.getElementById('btnAmbossStartQuiz').classList.add('hidden');
  document.getElementById('amboss-status').textContent = 'Cleared.';
  document.getElementById('amboss-status').style.color = '#94a3b8';
});

document.getElementById('btnAmbossStartQuiz').addEventListener('click', async () => {
  const r = await new Promise(resolve => chrome.storage.local.get(['ckrb_amboss_questions'], resolve));
  const qs = r.ckrb_amboss_questions || [];
  if (!qs.length) return;
  ambossQuizState = { questions: qs, currentIndex: 0, score: 0, correct: 0, wrong: 0 };
  showScreen('screen-amboss-quiz');
  renderAmbossQuestion();
});

document.getElementById('btnAmbossNextQ').addEventListener('click', () => {
  ambossQuizState.currentIndex++;
  renderAmbossQuestion();
});

function renderAmbossQuestion() {
  const { questions, currentIndex, score } = ambossQuizState;
  if (currentIndex >= questions.length) {
    showScreen('screen-amboss');
    document.getElementById('amboss-status').textContent = `Quiz done! Score: ${score} pts (${ambossQuizState.correct}/${questions.length} correct)`;
    document.getElementById('amboss-status').style.color = '#34d399';
    return;
  }

  const q = questions[currentIndex];
  document.getElementById('amboss-quiz-qnum').textContent = `Q${currentIndex + 1}/${questions.length} · ${q.section}`;
  document.getElementById('amboss-score-display').textContent = score;

  // Key principle
  const kp = document.getElementById('amboss-key-principle');
  if (q.keyPrinciple) { kp.textContent = '🔑 ' + q.keyPrinciple; kp.style.display = 'block'; }
  else kp.style.display = 'none';

  document.getElementById('amboss-question-text').textContent = q.questionText;
  document.getElementById('amboss-feedback-box').classList.add('hidden');
  document.getElementById('amboss-zczc-panel').style.display = 'none';

  const wrap = document.getElementById('amboss-choices-wrap');
  wrap.innerHTML = '';
  const letters = ['A','B','C','D','E'];
  (q.choices || []).forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-letter">${letters[i]}</span><span>${choice}</span>`;
    btn.addEventListener('click', () => handleAmbossAnswer(i, q));
    wrap.appendChild(btn);
  });

  // TTS
  if (SETTINGS.readAloud) {
    window.speechSynthesis.cancel();
    const voices = getCachedVoices();
    const main = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en'));
    const u = new SpeechSynthesisUtterance(q.questionText);
    u.rate = 0.95; u.pitch = 1.0; u.volume = 1; if (main) u.voice = main;
    window.speechSynthesis.speak(u);
  }
}

function handleAmbossAnswer(selectedIdx, q) {
  const isCorrect = selectedIdx === q.correctIndex;
  document.querySelectorAll('#amboss-choices-wrap .choice-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correctIndex) btn.classList.add('correct');
    else if (i === selectedIdx && !isCorrect) btn.classList.add('wrong');
  });
  if (isCorrect) { ambossQuizState.score += 10; ambossQuizState.correct++; }
  else ambossQuizState.wrong++;

  document.getElementById('amboss-score-display').textContent = ambossQuizState.score;

  const box = document.getElementById('amboss-feedback-box');
  document.getElementById('amboss-feedback-icon').textContent = isCorrect ? '✅ +10' : '❌';
  document.getElementById('amboss-feedback-text').textContent = q.explanation || '';
  box.classList.remove('hidden');
  box.style.borderColor = isCorrect ? '#10b981' : '#ef4444';

  // ZCZC panel
  const zczc = q.zczc;
  const zp = document.getElementById('amboss-zczc-panel');
  if (zczc) {
    const boldify = s => (s||'').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    zp.innerHTML =
      `<div class="zczc-row"><span class="zczc-icon">🧠</span><span>${boldify(zczc.brain)}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🧒⁴</span><span>${boldify(zczc.eli4)}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🧒⁵</span><span>${boldify(zczc.eli5)}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">👨‍⚕️</span><span>${boldify(zczc.clinical)}</span></div>` +
      `<div class="zczc-row"><span class="zczc-icon">🤖</span><span>${boldify(zczc.arrows)}</span></div>`;
    zp.style.display = 'block';
  }

  if (SETTINGS.readExplain) readQuestionAloud(q.explanation || '');
} // reads from storage what content script auto-scraped
document.getElementById('btnCollect').addEventListener('click', async () => {
  const r = await new Promise(resolve => chrome.storage.local.get(['ckrb_frame_data'], resolve));
  const frames = r.ckrb_frame_data || [];
  
  if (frames.length === 0) {
    alert('No data collected yet. Navigate through your questions first, then click Collect.');
    return;
  }

  // Deduplicate by question text
  const seen = new Set();
  const questions = frames
    .filter(f => {
      const key = f.qText.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f, i) => ({
      id: i,
      source: 'nbme',
      questionText: f.qText,
      choices: f.choices,
      userAnswer: f.userAnswer,
      correctAnswer: f.correctAnswer,
      isCorrect: f.isCorrect,
      explanation: ''
    }));

  if (questions.length === 0) {
    alert('No valid questions found.');
    return;
  }

  alert('Collected ' + questions.length + ' questions. Starting AI analysis...');
  chrome.runtime.sendMessage({ type: 'START_PROCESSING', questions });
  
  // Show processing screen
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-processing').classList.add('active');
  document.getElementById('proc-title').textContent = 'Analyzing ' + questions.length + ' questions…';
  document.getElementById('proc-count').textContent = '0 / ' + questions.length;
});

/* ─── QUIZ SETTINGS ─── */
let SETTINGS = { autonav: true, timer: true, timelimit: 45, readAloud: true, readExplain: true, readQuote: true };
window.SETTINGS = SETTINGS;

function loadSettings(cb) {
  chrome.storage.local.get(['ckrb_settings'], r => {
    if (r.ckrb_settings) SETTINGS = Object.assign(SETTINGS, r.ckrb_settings);
    if (cb) cb();
  });
}
function saveSettings() {
  const an = document.getElementById('set-autonav');
  const tm = document.getElementById('set-timer');
  const tl = document.getElementById('set-timelimit');
  if (an) SETTINGS.autonav = an.checked;
  if (tm) SETTINGS.timer = tm.checked;
  if (tl) SETTINGS.timelimit = parseInt(tl.value) || 45;
  const ra = document.getElementById('set-readaloud');
  if (ra) SETTINGS.readAloud = ra.checked;
  const re = document.getElementById('set-readexplain');
  if (re) SETTINGS.readExplain = re.checked;
  const rq = document.getElementById('set-readquote');
  if (rq) SETTINGS.readQuote = rq.checked;
  chrome.storage.local.set({ ckrb_settings: SETTINGS });
}
function openSettingsModal() {
  loadSettings(() => {
    const an = document.getElementById('set-autonav');
    const tm = document.getElementById('set-timer');
    const tl = document.getElementById('set-timelimit');
    if (an) an.checked = SETTINGS.autonav;
    if (tm) tm.checked = SETTINGS.timer;
    if (tl) tl.value = SETTINGS.timelimit;
    const ra = document.getElementById('set-readaloud');
    if (ra) ra.checked = SETTINGS.readAloud;
    const re = document.getElementById('set-readexplain');
    if (re) re.checked = SETTINGS.readExplain;
    const rq = document.getElementById('set-readquote');
    if (rq) rq.checked = SETTINGS.readQuote !== false;
    const m = document.getElementById('settings-modal');
    if (m) m.style.display = 'flex';
  });
}

const _sc = document.getElementById('set-close');
if (_sc) _sc.addEventListener('click', () => { saveSettings(); document.getElementById('settings-modal').style.display = 'none'; });
const _sm = document.getElementById('settings-modal');
if (_sm) _sm.addEventListener('click', e => { if (e.target === _sm) { saveSettings(); _sm.style.display = 'none'; } });
const _oqs = document.getElementById('openQuizSettings');
if (_oqs) _oqs.addEventListener('click', e => { e.preventDefault(); openSettingsModal(); });
const _bqs = document.getElementById('btnQuizSettings');
if (_bqs) _bqs.addEventListener('click', () => openSettingsModal());

loadSettings();

/* ─── TAUNTS & AUDIO ─── */
const TAUNTS = [
  "Adam, slower than fuhk—UWorld's laughing at your ayyss.",
  "Bro, pace slower than shit—prions beat you.",
  "Vignette? You're slower than a muthuhfuhkuh.",
  "Adam, slower than a lazy bihtch—smash it.",
  "Speed slower than fuhk—amyloid's winning.",
  "Reviewing slower than a manatee—move, shit.",
  "Lazy ayss—throughput slower than botox.",
  "Slower than shit on ultra-rapid—pure sloth.",
  "Pace slower than fuhk—TB caseates faster.",
  "Dragging like a bihtch in labor—push!",
  "Review slower than fuhk in MS—crawling.",
  "Slower than fuhk on amiodarone—thyroid storm incoming.",
  "Slow-ayss muthuhfuhkuh—Miami heat waits for no one.",
  "Slower than shit in Whipple's—macrophages lap you.",
  "Clicks slower than fuhk—ketamine already hit.",
  "Slower than diabetic sans insulin—score spiking.",
  "Goddamn slowpoke—Huntington's has better rhythm.",
  "Pace slower than fuhk in Vice suit—lag king.",
  "Slower than bihtch on slow acetyl—neuropathy first.",
  "Dragging slower than shit in amyloid—restrictive AF.",
  "Incubation longer than fuhking rabies—hurry.",
  "Slower than fuhk in TB cavity—necrosis wins.",
  "SuperGrok ayss slower than shit on dial-up.",
  "Slower than bihtch post-seizure—wake up.",
  "Review like heat index kills—fuhk up speed.",
  "Pace slower than shit in p53 mutant—cancer faster.",
  "Slower than fuhking tertiary hyperpara—groan.",
  "Stuck in lag phase—slow-ayss bacterium.",
  "Mouse hand slower than fuhk in GBS—paralyzed.",
  "Slower than shit in sinkhole—score sinking.",
  "Slow muthuhfuhkuh—type IV ain't this delayed.",
  "Slower than fuhk with prions—vacuoles incoming.",
  "Speed slower than Miami roach—scurry fuhking faster.",
  "Slower than shit on dig toxicity—yellow vision.",
  "Pick's atrophy faster than your review—gains now.",
  "Slower than fuhk in nephrogenic DI—concentrate!",
  "Pace slower than fuhking JC in PML—oligos dying.",
  "Slower than shit from Barrett's to adeno.",
  "Manatee heart rate—give SVT you slow bihtch.",
  "Slower than fuhk in mad cow—spongier brain needed.",
  "Slower than Cat 5 landfall—hurricane your ayss.",
  "Shingles latency shorter—dermatomes wait, dumb bihtch.",
  "Speed slower than shit on CYP3A4—rhabdo soon.",
  "Slower than fuhk in amyloid bleed—click quicker.",
  "BRCA checkpoint faster than your sorry ayss.",
  "Wilson's copper faster—basal ganglia browning.",
  "Slower than fuhking CGD neuts—work harder.",
  "Pace slower than fuhk in Vice episode—85 called.",
  "Slower than shit with prion retrograde—insomnia win.",
  "Slower than every muthuhfuhkuh above—close shit, UWorld now, GO ADAM GO!"
];
let tauntIndex = Math.floor(Math.random() * TAUNTS.length);
let timerInterval = null;
let questionStartTime = null;
let audioCtx = null;
let audioReady = false;

/* ── VOICE CACHE — getVoices() returns [] on first call, so cache on voiceschanged ── */
let _cachedVoices = [];
function getCachedVoices() {
  if (_cachedVoices.length) return _cachedVoices;
  _cachedVoices = window.speechSynthesis.getVoices();
  return _cachedVoices;
}
window.speechSynthesis.onvoiceschanged = () => {
  _cachedVoices = window.speechSynthesis.getVoices();
};
// Also try loading immediately
_cachedVoices = window.speechSynthesis.getVoices();

function initAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
  } catch(e) {}
}
document.addEventListener('click', initAudio, { once: true });

function playBeep(freq, dur, vol) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq || 440;
    gain.gain.setValueAtTime(vol || 0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (dur || 0.3));
    osc.start(); osc.stop(audioCtx.currentTime + (dur || 0.3));
  } catch(e) {}
}

function speakTaunt() {
  if (!SETTINGS.timer) return;
  const taunt = TAUNTS[tauntIndex % TAUNTS.length];
  tauntIndex++;
  playBeep(330, 0.15, 0.5);
  setTimeout(() => playBeep(220, 0.15, 0.4), 160);
  setTimeout(() => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(taunt);
      u.rate = 1.1; u.pitch = 0.85;
      const voices = getCachedVoices();
      const eng = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en'));
      if (eng) u.voice = eng;
      window.speechSynthesis.speak(u);
    } catch(e) {}
  }, 350);
}

function startTimer() {
  if (!SETTINGS.timer) return;
  stopTimer();
  questionStartTime = Date.now();
  const limit = SETTINGS.timelimit * 1000;
  const bar = document.getElementById('timer-bar');
  const wrap = document.getElementById('timer-bar-wrap');
  const label = document.getElementById('timer-label');
  if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; bar.style.background = '#10b981'; }
  if (wrap) wrap.style.display = 'block';
  if (label) { label.style.display = 'block'; label.textContent = SETTINGS.timelimit + 's'; }
  setTimeout(() => { if (bar) bar.style.transition = 'width 0.5s linear'; }, 100);

  let _taunted = false;
  timerInterval = setInterval(() => {
    try {
      const elapsed = Date.now() - questionStartTime;
      const pct = Math.max(0, 100 - (elapsed / limit * 100));
      const rem = Math.max(0, Math.ceil((limit - elapsed) / 1000));
      if (bar) {
        bar.style.width = pct + '%';
        bar.style.background = pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444';
      }
      if (label) label.textContent = rem + 's';
      if (elapsed >= limit && !_taunted) {
        _taunted = true;
        speakTaunt();
        setTimeout(() => { _taunted = false; questionStartTime = Date.now(); }, 800);
      }
    } catch(e) {}
  }, 250);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const wrap = document.getElementById('timer-bar-wrap');
  const label = document.getElementById('timer-label');
  if (wrap) wrap.style.display = 'none';
  if (label) label.style.display = 'none';
  // Play correct/wrong sound handled elsewhere
}

/* timer and answer sounds handled directly in renderTriviaQuestion and handleAnswer */


/* ─── SESSION CLOCK ─── */
let sessionStartTime = null;
let sessionClockInterval = null;

function startSessionClock() {
  if (sessionStartTime) return;
  sessionStartTime = Date.now();
  const clockEl = document.getElementById('session-clock');
  if (clockEl) clockEl.style.display = 'inline-block';
  sessionClockInterval = setInterval(() => {
    const el = document.getElementById('session-clock');
    if (!el) return;
    const elapsed = Date.now() - sessionStartTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    el.textContent = '⏱ ' + mins + ':' + String(secs).padStart(2, '0');
  }, 1000);
}

/* ─── UI SOUNDS ─── */
let lastExamQNum = null;

function playTone(freq, dur, vol, type) {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch(e) {}
}

function playNewQuestion() {
  // Rising chime — new question loaded
  playTone(523, 0.08, 0.2);
  setTimeout(() => playTone(659, 0.08, 0.2), 80);
  setTimeout(() => playTone(784, 0.12, 0.25), 160);
}

function playHover() {
  playTone(880, 0.04, 0.06, 'sine');
}

function playClick() {
  playTone(440, 0.06, 0.15, 'square');
  setTimeout(() => playTone(330, 0.08, 0.1, 'square'), 40);
}

// Hook into renderTriviaQuestion to detect question number change
const _qs_origRender = window.renderTriviaQuestion;
if (typeof renderTriviaQuestion === 'function') {
  const __origRTQ = renderTriviaQuestion;
  // Can't reassign function declaration, so we patch via the btnNextQ handler
}

// Detect question number change via MutationObserver on quiz-qnum
const qnumObserver = new MutationObserver(() => {
  const el = document.getElementById('quiz-qnum');
  if (!el) return;
  const text = el.textContent || '';
  const m = text.match(/Exam Q(\d+)/);
  const num = m ? m[1] : null;
  if (num && num !== lastExamQNum) {
    lastExamQNum = num;
    playNewQuestion();
  }
});

// Start observing once quiz screen is shown
const quizScreen = document.getElementById('screen-quiz');
if (quizScreen) {
  qnumObserver.observe(quizScreen, { childList: true, subtree: true, characterData: true });
}

// Add hover + click sounds to all buttons
function attachSounds(el) {
  if (el._soundsAttached) return;
  el._soundsAttached = true;
  el.addEventListener('mouseenter', () => { initAudio(); playHover(); });
  el.addEventListener('mousedown', () => { initAudio(); playClick(); });
}

// Attach to existing buttons
document.querySelectorAll('button, .choice-btn, .btn').forEach(attachSounds);

// Attach to dynamically created choice buttons via MutationObserver
const choicesObserver = new MutationObserver(mutations => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.nodeType === 1) {
        if (node.classList && (node.classList.contains('choice-btn') || node.classList.contains('btn'))) {
          attachSounds(node);
        }
        node.querySelectorAll && node.querySelectorAll('button, .choice-btn, .btn').forEach(attachSounds);
      }
    });
  });
});

const choicesWrap = document.getElementById('choices-wrap');
if (choicesWrap) choicesObserver.observe(choicesWrap, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('button, .choice-btn, .btn').forEach(attachSounds);
});


/* ─── READ QUESTION ALOUD ─── */
function readQuestionAloud(text) {
  if (!SETTINGS.readAloud) return;
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.0;
  const voices = getCachedVoices();
  const eng = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en'));
  if (eng) u.voice = eng;
  window.speechSynthesis.speak(u);
}

function replayQuizAudio() {
  if (!('speechSynthesis' in window)) return;
  const quoteEl    = document.getElementById('vignette-quote-text');
  const questionEl = document.getElementById('quiz-question-text');
  const quoteText    = quoteEl ? quoteEl.textContent.trim().replace(/^"|"$/g, '') : '';
  const questionText = questionEl ? questionEl.textContent.trim() : '';
  const voices = getCachedVoices();
  const main = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en'));
  window.speechSynthesis.cancel();
  if (quoteText.length > 3) {
    const u2 = new SpeechSynthesisUtterance(quoteText);
    u2.rate = 0.85; u2.pitch = 1.5; u2.volume = 1; if (main) u2.voice = main;
    const u3 = new SpeechSynthesisUtterance(questionText);
    u3.rate = 0.95; u3.pitch = 1.0; u3.volume = 1; if (main) u3.voice = main;
    u2.onend = () => { if (questionText.length > 10) window.speechSynthesis.speak(u3); };
    window.speechSynthesis.speak(u2);
  } else if (questionText.length > 10) {
    const u3 = new SpeechSynthesisUtterance(questionText);
    u3.rate = 0.95; u3.pitch = 1.0; u3.volume = 1; if (main) u3.voice = main;
    window.speechSynthesis.speak(u3);
  }
}

const _btnReplay = document.getElementById('btnReplayAudio');
if (_btnReplay) _btnReplay.addEventListener('click', () => { initAudio(); replayQuizAudio(); });

let _quoteHandlingTTS = false;


/* ─── QUESTION GRID ─── */
let _gridMissing = [];

function buildGrid(questions, total) {
  const grid = document.getElementById('question-grid');
  const status = document.getElementById('grid-status');
  const regenWrap = document.getElementById('grid-regen-wrap');
  grid.innerHTML = '';
  _gridMissing = [];

  const currentParentId = quizState.triviaQueue[quizState.currentIndex]
    ? quizState.triviaQueue[quizState.currentIndex].parentQ.id + 1 : null;

  for (let i = 1; i <= total; i++) {
    const q = questions.find(q => q.id + 1 === i);
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:6px 0;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid;';
    btn.textContent = i;

    const notReady = !q || !q.analysis || !q.analysis.triviaQuestions || q.analysis.triviaQuestions.length === 0;

    if (notReady) {
      _gridMissing.push(q || { id: i - 1, missing: true });
      btn.style.background = '#0f172a';
      btn.style.borderColor = '#475569';
      btn.style.color = '#475569';
      btn.title = 'Q' + i + ' — not ready';
    } else {
      const isWrong = q.isCorrect === false;
      const isCorrect = q.isCorrect === true;
      const isCurrent = i === currentParentId;
      btn.style.background = isCurrent ? '#6366f1' : isWrong ? 'rgba(239,68,68,0.15)' : isCorrect ? 'rgba(16,185,129,0.1)' : '#1e293b';
      btn.style.borderColor = isCurrent ? '#818cf8' : isWrong ? '#ef4444' : isCorrect ? '#10b981' : '#334155';
      btn.style.color = isCurrent ? '#fff' : isWrong ? '#f87171' : isCorrect ? '#34d399' : '#94a3b8';
      btn.title = 'Q' + i + (isWrong ? ' ✗' : isCorrect ? ' ✓' : '');
      btn.addEventListener('click', () => {
        const idx = quizState.triviaQueue.findIndex(item => item.parentQ.id + 1 === i);
        if (idx >= 0) { quizState.currentIndex = idx; showScreen('screen-quiz'); renderTriviaQuestion(); }
      });
    }
    grid.appendChild(btn);
  }

  if (_gridMissing.length > 0) {
    status.textContent = _gridMissing.length + ' question' + (_gridMissing.length > 1 ? 's' : '') + ' not ready — click below to generate';
    status.style.color = '#f87171';
    regenWrap.style.display = 'block';
  } else {
    status.textContent = 'All ' + total + ' questions ready ✓';
    status.style.color = '#34d399';
    regenWrap.style.display = 'none';
  }
}

function showQuestionGrid() {
  document.getElementById('settings-modal').style.display = 'none';
  chrome.storage.local.get(['ckrb_questions', 'ckrb_grid_total'], r => {
    const questions = r.ckrb_questions || [];
    const savedTotal = r.ckrb_grid_total;
    const inferredTotal = questions.length > 0 ? Math.max(...questions.map(q => q.id + 1)) : 50;
    const total = savedTotal || inferredTotal;
    document.getElementById('grid-total-input').value = total;
    buildGrid(questions, total);
    showScreen('screen-grid');
  });
}

document.getElementById('btnRefreshGrid').addEventListener('click', () => {
  const total = parseInt(document.getElementById('grid-total-input').value) || 50;
  chrome.storage.local.set({ ckrb_grid_total: total });
  chrome.storage.local.get(['ckrb_questions'], r => buildGrid(r.ckrb_questions || [], total));
});

document.getElementById('btnRegenMissing').addEventListener('click', () => {
  // Generate only the questions that have scraped data but no analysis
  const toProcess = _gridMissing.filter(q => !q.missing && q.questionText);
  if (toProcess.length === 0) {
    alert('Missing questions have no scraped data — please rescan first.');
    return;
  }
  document.getElementById('btnRegenMissing').textContent = 'Generating ' + toProcess.length + ' questions…';
  document.getElementById('btnRegenMissing').disabled = true;
  chrome.runtime.sendMessage({ type: 'START_PROCESSING', questions: toProcess });
  showScreen('screen-processing');
});

const _gridBtn = document.getElementById('btnOpenGrid');
if (_gridBtn) _gridBtn.addEventListener('click', showQuestionGrid);

const _gridBack = document.getElementById('btnGridBack');
if (_gridBack) _gridBack.addEventListener('click', () => showScreen('screen-quiz'));


/* ─── NAV TEST ─── */
function buildNavGrid(sections, perSection, activeSection) {
  const grid = document.getElementById('nav-grid');
  const status = document.getElementById('nav-status');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = 'repeat(10, 1fr)';
  status.textContent = 'Click any question to jump.';

  const sectionsToShow = activeSection === 0 ? 
    Array.from({length: sections}, (_, i) => i + 1) : [activeSection];

  for (const s of sectionsToShow) {
    if (sections > 1) {
      const header = document.createElement('div');
      header.style.cssText = 'grid-column:1/-1;font-size:11px;font-weight:700;color:#6366f1;padding:6px 0 2px;border-top:1px solid #334155;margin-top:4px;';
      header.textContent = 'Section ' + s;
      grid.appendChild(header);
    }
    for (let q = 1; q <= perSection; q++) {
      const absNum = (s - 1) * perSection + q;
      const btn = document.createElement('button');
      btn.textContent = q;
      btn.title = 'S' + s + ' Q' + q;
      btn.style.cssText = 'padding:7px 0;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid #334155;background:#1e293b;color:#94a3b8;';
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#6366f1'; btn.style.color = '#e2e8f0'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#334155'; btn.style.color = '#94a3b8'; });
      btn.addEventListener('click', () => {
        grid.querySelectorAll('button').forEach(b => { b.style.background = '#1e293b'; b.style.borderColor = '#334155'; b.style.color = '#94a3b8'; });
        btn.style.background = '#6366f1'; btn.style.borderColor = '#818cf8'; btn.style.color = '#fff';
        const label = 'S' + s + ' Q' + q;
        status.textContent = 'Jumping to ' + label + '…';
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_QUESTION', questionNum: absNum }, () => {
          setTimeout(() => { status.textContent = 'Jumped to ' + label + ' ✓'; }, 1500);
        });
      });
      grid.appendChild(btn);
    }
  }
}

let _navSections = 4;
let _navPerSection = 50;
let _navActiveSection = 1;

const _navTestBtn = document.getElementById('btnNavTest');
if (_navTestBtn) _navTestBtn.addEventListener('click', () => {
  _navActiveSection = 1;
  buildNavGrid(_navSections, _navPerSection, _navActiveSection);
  // Set S1 active
  document.querySelectorAll('.nav-section-btn').forEach(b => {
    const s = parseInt(b.dataset.s);
    b.style.background = s === _navActiveSection ? '#6366f1' : '#1e293b';
    b.style.borderColor = s === _navActiveSection ? '#6366f1' : '#334155';
    b.style.color = s === _navActiveSection ? '#fff' : '#94a3b8';
  });
  showScreen('screen-nav');
});

document.querySelectorAll('.nav-section-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = parseInt(btn.dataset.s);
    _navActiveSection = s;
    document.querySelectorAll('.nav-section-btn').forEach(b => {
      const bs = parseInt(b.dataset.s);
      b.style.background = bs === s ? '#6366f1' : '#1e293b';
      b.style.borderColor = bs === s ? '#6366f1' : '#334155';
      b.style.color = bs === s ? '#fff' : '#94a3b8';
    });
    buildNavGrid(_navSections, _navPerSection, s);
  });
});

const _navBack = document.getElementById('btnNavBack');
if (_navBack) _navBack.addEventListener('click', () => showScreen('screen-home'));

const _navRefresh = document.getElementById('btnNavRefresh');
if (_navRefresh) _navRefresh.addEventListener('click', () => {
  buildNavGrid(_navSections, _navPerSection, _navActiveSection);
});


// ── DISABLE/ENABLE TOGGLE ──
const btnToggle = document.getElementById('btnToggleExtension');
if (btnToggle) {
  chrome.management.getSelf(function(info) {
    if (!info.enabled) {
      btnToggle.innerHTML = '<span class="btn-icon">▶</span> Re-enable Extension';
      btnToggle.style.borderColor = '#10b981';
      btnToggle.style.color = '#34d399';
    }
  });
  btnToggle.addEventListener('click', function() {
    chrome.management.getSelf(function(info) {
      chrome.management.setEnabled(info.id, !info.enabled, function() {});
    });
  });
}
