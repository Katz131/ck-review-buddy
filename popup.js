// popup.js — CK Review Buddy Game Logic

// VERSION: must match content.js AND manifest.json -- run `node bump.js` to update all 3
const CKRB_VERSION = '433';
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// !! CLAUDE: YOU MUST RUN `node bump.js` AFTER EVERY EDIT    !!
// !! THEN `node verify-versions.js` TO CONFIRM               !!
// !! TELL THE USER THE NEW VERSION NUMBER                     !!
// !! THIS IS NON-NEGOTIABLE. DO NOT FORGET. DO NOT SKIP.      !!
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
const STORAGE_KEY_QUESTIONS = 'ckrb_questions';
const STORAGE_KEY_STATUS    = 'ckrb_status';

// Safeguard 1: Log version on popup load so stale-cache is obvious in console
console.log('[CK Buddy v' + CKRB_VERSION + '] popup.js loaded');

// Safeguard 2: Show version in the popup UI footer (if element exists)
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('ckrb-version-tag');
  if (el) el.textContent = 'v' + CKRB_VERSION;
  // Also inject a tiny version tag at the bottom if no element exists
  if (!el) {
    try {
      const tag = document.createElement('div');
      tag.id = 'ckrb-version-tag';
      tag.style.cssText = 'position:fixed;bottom:2px;right:6px;font-size:9px;color:#475569;font-family:monospace;pointer-events:none;z-index:99;';
      tag.textContent = 'v' + CKRB_VERSION;
      document.body.appendChild(tag);
    } catch(_) {}
  }
});

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
  // One-shot legacy migration: if the user had a quiz in progress before v143
  // (ckrb_quiz_progress + ckrb_questions present, but no ckrb_active_quiz yet),
  // silently rebuild the queue and write a snapshot NOW — before any scrape
  // can wipe ckrb_questions. This guarantees their pre-update quiz survives
  // the first time they open the popup on v143.
  try {
    const mig = await getStorage(['ckrb_active_quiz', 'ckrb_quiz_progress', STORAGE_KEY_QUESTIONS]);
    const hasSnap = !!(mig.ckrb_active_quiz && mig.ckrb_active_quiz.triviaQueue && mig.ckrb_active_quiz.triviaQueue.length);
    const legacyProgress = mig.ckrb_quiz_progress;
    const legacyQuestions = mig[STORAGE_KEY_QUESTIONS];
    if (!hasSnap && legacyProgress?.active && legacyQuestions?.length) {
      const mQueue = [];
      const mSorted = [...legacyQuestions].sort((a, b) => a.id - b.id);
      mSorted.forEach(q => {
        const type = q.analysis?._type;
        const trivia = q.analysis?.triviaQuestions || [];
        if (type === 'incorrect' || type === 'unknown' ||
            type === 'marked' || type === 'incorrect_marked' || type === 'correct_marked') {
          trivia.slice(0, 3).forEach(t => mQueue.push({ trivia: t, parentQ: q }));
        } else {
          trivia.slice(0, 1).forEach(t => mQueue.push({ trivia: t, parentQ: q }));
        }
      });
      if (mQueue.length && legacyProgress.currentIndex < mQueue.length) {
        chrome.storage.local.set({
          ckrb_active_quiz: {
            allQuestions: legacyQuestions,
            triviaQueue: mQueue,
            currentIndex: legacyProgress.currentIndex || 0,
            score: legacyProgress.score || 0,
            streak: legacyProgress.streak || 0,
            correct: legacyProgress.correct || 0,
            wrong: legacyProgress.wrong || 0,
            total: legacyProgress.total || mQueue.length,
            startedAt: legacyProgress.savedAt || Date.now(),
            savedAt: Date.now(),
            _migratedFromLegacy: true
          }
        });
        console.log('[CK Buddy] Legacy quiz state migrated to snapshot — your pre-update quiz is now locked in.');
      }
    }
  } catch (e) { console.warn('[CK Buddy] Legacy migration skipped:', e); }

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

  // Check for resumable quiz — snapshot is canonical (survives scrapes/reloads)
  const { ckrb_active_quiz: snap, ckrb_quiz_progress: progress } = await getStorage(['ckrb_active_quiz', 'ckrb_quiz_progress']);
  const btnResume = document.getElementById('btnResumeQuiz');
  let resumable = null;
  if (snap && Array.isArray(snap.triviaQueue) && snap.triviaQueue.length &&
      typeof snap.currentIndex === 'number' && snap.currentIndex < snap.triviaQueue.length) {
    resumable = {
      currentIndex: snap.currentIndex,
      total: snap.total || snap.triviaQueue.length,
      score: snap.score || 0
    };
  } else if (progress?.active && questions?.length && progress.currentIndex < progress.total) {
    resumable = {
      currentIndex: progress.currentIndex,
      total: progress.total,
      score: progress.score || 0
    };
  }
  if (resumable) {
    btnResume.classList.remove('hidden');
    document.getElementById('btnResumeLabel').textContent =
      `Resume Quiz (${resumable.currentIndex}/${resumable.total} · ${resumable.score}pts)`;
  } else {
    btnResume.classList.add('hidden');
  }
}

/* ─────────────────────────────────────────────
   ABORT EVERYTHING — called before any new scrape
───────────────────────────────────────────── */
async function abortAll() {
  // Stop polling
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  // Abort any running scrape in any tab
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      try { chrome.tabs.sendMessage(tab.id, { type: 'ABORT_SCRAPE' }); } catch (_) {}
    }
  } catch (_) {}
  // Abort any running generation
  try { chrome.runtime.sendMessage({ type: 'ABORT_GENERATING' }); } catch (_) {}
  // Clear state
  chrome.storage.local.remove(['ckrb_status', 'ckrb_questions', 'ckrb_pr_session', 'ckrb_abort']);
  // Small delay to let abort signals propagate
  await new Promise(r => setTimeout(r, 300));
}

/* ─────────────────────────────────────────────
   SCRAPE → SEND TO BACKGROUND
───────────────────────────────────────────── */
document.getElementById('btnScrape').addEventListener('click', async () => {
  // Abort any ongoing work and clear state
  await abortAll();

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
    // Refocus the Q-bank tab so click events work from the popout window
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
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
var _pollStartTime = 0;
// v202: Guard against stale 'ready' from a previous background processBatch.
// Only launch quiz after the poll has seen 'processing' from the CURRENT batch.
var _pollSawProcessing = false;
function pollProcessing() {
  if (_pollInterval) clearInterval(_pollInterval);
  _pollStartTime = Date.now();
  _pollSawProcessing = false;
  _pollInterval = setInterval(async () => {
    // Auto-abort if stuck for more than 15 minutes
    if (Date.now() - _pollStartTime > 15 * 60 * 1000) {
      clearInterval(_pollInterval); _pollInterval = null;
      // Don't clear ckrb_status — background may still finish
      showScreen('screen-home');
      var sb = document.getElementById('status-box');
      if (sb) { sb.classList.remove('hidden'); sb.textContent = '⚠ Processing timed out after 15 minutes. If you see a Ready notification, re-open the extension. Otherwise click Scan to try again.'; }
      initHome(); // Re-check if questions/quiz are available
      return;
    }
    const { ckrb_status: status } = await getStorage([STORAGE_KEY_STATUS]);

    const procBar   = document.getElementById('proc-bar');
    const procCount = document.getElementById('proc-count');
    const procTitle = document.getElementById('proc-title');
    const procPhase = document.getElementById('proc-phase');

    const btnAbortScrape = document.getElementById('btnAbortScrape');
    const btnAbortGen = document.getElementById('btnAbortGenerating');

    if (!status) {
      // Still scraping — phase 1
      if (procPhase) procPhase.textContent = 'PHASE 1 OF 2 — SCRAPING';
      if (btnAbortScrape) btnAbortScrape.style.display = '';
      if (btnAbortGen) btnAbortGen.style.display = 'none';
      return;
    }

    if (status.state === 'processing') {
      _pollSawProcessing = true; // v202: current batch is active
      if (procPhase) procPhase.textContent = 'PHASE 2 OF 2 — GENERATING';
      if (btnAbortScrape) btnAbortScrape.style.display = 'none';
      if (btnAbortGen) btnAbortGen.style.display = '';
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
      if (btnAbortScrape) btnAbortScrape.style.display = 'none';
      if (btnAbortGen) btnAbortGen.style.display = 'none';
      procTitle.textContent = '✓ Ready! Launching quiz…';
      procBar.style.width = '100%';
      const continueBtn = document.getElementById('btnContinueChunk');
      if (continueBtn) continueBtn.classList.add('hidden');
      // v363: Audio chime + browser notification so user knows to come back
      try {
        var _ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 150, 300, 500].forEach(function(delay, i) {
          var osc = _ctx.createOscillator(); var g = _ctx.createGain();
          osc.connect(g); g.connect(_ctx.destination);
          osc.frequency.value = [523, 659, 784, 1047][i]; // C5 E5 G5 C6 — ascending major
          osc.type = 'sine';
          g.gain.value = 0.12;
          osc.start(_ctx.currentTime + delay / 1000);
          g.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + delay / 1000 + 0.4);
          osc.stop(_ctx.currentTime + delay / 1000 + 0.45);
        });
      } catch(_) {}
      try {
        chrome.notifications.create('ckrb-ready-' + Date.now(), {
          type: 'basic',
          iconUrl: 'icon128.png',
          title: 'DRK Buddy — Quiz Ready!',
          message: 'Your review questions are generated. Switch back to start!',
          priority: 2
        });
      } catch(_) {}
      setTimeout(() => startQuiz(), 1000);
    }

    if (status.state === 'error') {
      clearInterval(_pollInterval); _pollInterval = null;
      if (btnAbortScrape) btnAbortScrape.style.display = 'none';
      if (btnAbortGen) btnAbortGen.style.display = 'none';
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
  // Clear the stuck processing state so the popup doesn't loop back to
  // the processing screen on next open
  chrome.storage.local.remove(['ckrb_status', 'ckrb_pr_session']);
  initHome();
});

/* ── ABORT SCRAPING ── */
document.getElementById('btnAbortScrape').addEventListener('click', async () => {
  // Send abort to ALL possible tabs (NBME, UWorld, AMBOSS)
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    try { chrome.tabs.sendMessage(tab.id, { type: 'ABORT_SCRAPE' }); } catch (_) {}
  }
  // Also abort any generating in progress
  chrome.runtime.sendMessage({ type: 'ABORT_GENERATING' });
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  chrome.storage.local.remove(['ckrb_status', 'ckrb_pr_session']);
  document.getElementById('proc-title').textContent = 'Aborted.';
  document.getElementById('proc-sub').textContent = 'Scraping stopped.';
  setTimeout(() => initHome(), 1500);
});

/* ── ABORT GENERATING ── */
document.getElementById('btnAbortGenerating').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'ABORT_GENERATING' });
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  document.getElementById('proc-title').textContent = 'Aborting…';
  document.getElementById('proc-sub').textContent = 'Stopping generation. Partial results will be saved.';
  // Give background.js a moment to process the abort and save partial results
  setTimeout(() => initHome(), 2000);
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
  await abortAll();
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
  await abortAll();
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
var _readyGatePending = false; // v361: True when waiting for user to click START REVIEW

/* ── QUIZ STATE PERSISTENCE ──
   Two keys:
     ckrb_quiz_progress → lightweight counters (fast sync on every answer)
     ckrb_active_quiz   → full snapshot of queue + questions, taken at startQuiz()
                          and refreshed on progress changes. This snapshot is
                          IMMUNE to new scrapes — so the running quiz stays
                          intact even if the user scrapes new questions into
                          ckrb_questions. (Belt-and-suspenders: even if the
                          questions pool is wiped/replaced, the active quiz
                          can still resume off this snapshot.) */
function saveQuizProgress() {
  const payload = {
    currentIndex: quizState.currentIndex,
    score: quizState.score,
    streak: quizState.streak,
    correct: quizState.correct,
    wrong: quizState.wrong,
    total: quizState.total,
    active: true,
    savedAt: Date.now()
  };
  chrome.storage.local.set({ ckrb_quiz_progress: payload });
  // Also update the snapshot's progress counters so reopening the popup after
  // an extension reload picks up exactly where we were.
  chrome.storage.local.get(['ckrb_active_quiz'], r => {
    const snap = r && r.ckrb_active_quiz;
    if (snap && snap.triviaQueue) {
      snap.currentIndex = quizState.currentIndex;
      snap.score = quizState.score;
      snap.streak = quizState.streak;
      snap.correct = quizState.correct;
      snap.wrong = quizState.wrong;
      snap.savedAt = Date.now();
      chrome.storage.local.set({ ckrb_active_quiz: snap });
    }
  });
}

function saveActiveQuizSnapshot() {
  chrome.storage.local.set({
    ckrb_active_quiz: {
      allQuestions: quizState.allQuestions,
      triviaQueue: quizState.triviaQueue,
      currentIndex: quizState.currentIndex,
      score: quizState.score,
      streak: quizState.streak,
      correct: quizState.correct,
      wrong: quizState.wrong,
      total: quizState.total,
      startedAt: Date.now(),
      savedAt: Date.now()
    }
  });
}

function clearQuizProgress() {
  chrome.storage.local.remove(['ckrb_quiz_progress', 'ckrb_active_quiz', 'ckrb_qstats']);
}

async function resumeQuiz() {
  // Prefer the full snapshot — it survives scrapes and question-pool churn.
  const r = await getStorage(['ckrb_active_quiz', 'ckrb_quiz_progress', STORAGE_KEY_QUESTIONS]);
  const snap = r.ckrb_active_quiz;

  if (snap && Array.isArray(snap.triviaQueue) && snap.triviaQueue.length &&
      typeof snap.currentIndex === 'number' && snap.currentIndex < snap.triviaQueue.length) {
    quizState = {
      allQuestions: snap.allQuestions || [],
      triviaQueue: snap.triviaQueue,
      currentIndex: snap.currentIndex,
      score: snap.score || 0,
      streak: snap.streak || 0,
      correct: snap.correct || 0,
      wrong: snap.wrong || 0,
      total: snap.total || snap.triviaQueue.length
    };
    showScreen('screen-quiz');
    startSessionClock();
    window._lastNavNum = null;
    _readyGatePending = true; // v361: Show ready gate
    renderTriviaQuestion();
    // v363: Loom bridge setup moved to btnReadyGo handler
    _loomBlockStartTime = 0; // Will be set when user clicks START REVIEW
  // v347: Restore _qStats from storage instead of resetting (persist across reloads)
  chrome.storage.local.get(['ckrb_qstats'], function(r) {
    if (r.ckrb_qstats && r.ckrb_qstats.feedItems && r.ckrb_qstats.feedItems.length > 0) {
      _restoreQStats(r.ckrb_qstats);
      console.log('[CK Buddy] Restored _qStats from storage: ' + _qStats.feedItems.length + ' feed items, $' + _calcProjectedPayout().net + ' projected');
      _updateRewardFeed('reward-feed-proj', 'reward-feed-items');
      _updateRewardFeed('amboss-reward-feed-proj', 'amboss-reward-feed-items');
    } else {
      _qStats.reset();
      var _feedItems = document.getElementById('reward-feed-items'); if (_feedItems) _feedItems.innerHTML = '';
      var _feedProj = document.getElementById('reward-feed-proj'); if (_feedProj) { _feedProj.textContent = '$100 projected'; _feedProj.className = 'reward-feed-proj'; }
      var _afeedItems = document.getElementById('amboss-reward-feed-items'); if (_afeedItems) _afeedItems.innerHTML = '';
      var _afeedProj = document.getElementById('amboss-reward-feed-proj'); if (_afeedProj) { _afeedProj.textContent = '$100 projected'; _afeedProj.className = 'reward-feed-proj'; }
    }
  }); // v329: Reset tooltip stats for new block
    // v364: Loom bridge calls removed — now handled exclusively in btnReadyGo handler
    return true;
  }

  // Fallback (legacy): rebuild from ckrb_questions + progress counters
  const progress = r.ckrb_quiz_progress;
  const questions = r[STORAGE_KEY_QUESTIONS];
  if (!progress?.active || !questions?.length) return false;

  const queue = [];
  const sorted = [...questions].sort((a, b) => a.id - b.id);
  sorted.forEach(q => {
    const type = q.analysis?._type;
    const trivia = q.analysis?.triviaQuestions || [];
    if (type === 'incorrect' || type === 'unknown' ||
        type === 'marked' || type === 'incorrect_marked' || type === 'correct_marked') {
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

  // Migrate legacy state into a snapshot so future reloads are robust
  saveActiveQuizSnapshot();

  showScreen('screen-quiz');
  startSessionClock();
  window._lastNavNum = null;
  _readyGatePending = true; // v361: Show ready gate
  renderTriviaQuestion();
  // v363: Loom bridge setup moved to btnReadyGo handler
  return true;
}

document.getElementById('btnStartQuiz').addEventListener('click', startQuiz);

// v361: Ready gate START REVIEW button
// v384: Add hover/click sounds to START REVIEW button
(function() {
  var _rgBtn = document.getElementById('btnReadyGo');
  if (_rgBtn) {
    _rgBtn.addEventListener('mouseenter', function() {
      try {
        var c = new (window.AudioContext || window.webkitAudioContext)();
        var o = c.createOscillator(); var g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.frequency.value = 660; o.type = 'sine'; g.gain.value = 0.04;
        o.start(); o.stop(c.currentTime + 0.018);
      } catch(_) {}
    });
  }
})();
document.getElementById('btnReadyGo').addEventListener('click', function() {
  // Click sound
  try {
    var c = new (window.AudioContext || window.webkitAudioContext)();
    var o = c.createOscillator(); var g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.value = 880; o.type = 'sine'; g.gain.value = 0.06;
    o.start(); o.stop(c.currentTime + 0.035);
  } catch(_) {}
  _readyGatePending = false;
  _moreTimeUsed = 0; // v368: Reset more-time uses for this block
  // v374: Restore Double or Nothing state
  chrome.storage.local.get([_DON_STORAGE_KEY], function(r) {
    var don = r[_DON_STORAGE_KEY];
    if (don && don.active) {
      _donActive = true;
      _donStakes = don.stakes || 0;
      _donLost = false;
      console.log('[CK Buddy] Double or Nothing ACTIVE: stakes=$' + _donStakes);
    }
  });
  var _mtBtn = document.getElementById('btnMoreTime');
  if (_mtBtn) { _mtBtn.classList.remove('exhausted'); _mtBtn.textContent = '+5m (' + _MORE_TIME_MAX + ')'; }
  var _rgEl = document.getElementById('ready-gate');
  if (_rgEl) _rgEl.classList.add('hidden');
  // v363: NOW start the Loom bridge + idle checker (not before user is ready)
  _loomBlockStartTime = Date.now();
  _loomBlockSite = _loomDetectSite(quizState.triviaQueue);
  _sendToLoom({ type: 'CKRB_BLOCK_STARTED', blockSize: quizState.triviaQueue.length - quizState.currentIndex, site: _loomBlockSite, timestamp: _loomBlockStartTime });
  _startLoomIdleChecker();
  renderTriviaQuestion(); // Now actually render Q1
});
// v368: More Time button — adds 15s to current question thresholds
document.getElementById('btnMoreTime').addEventListener('click', function() {
  if (_moreTimeUsed >= _MORE_TIME_MAX) return;
  _moreTimeUsed++;
  // Extend both the module-scope thresholds (for feed recording) and closure thresholds (for visual)
  _qTimerFastSec += _MORE_TIME_ADD;
  _qTimerOkSec += _MORE_TIME_ADD;
  // Also extend the closure vars in the running timer interval via a shared flag
  window._ckrbTimerExtendSec = (window._ckrbTimerExtendSec || 0) + _MORE_TIME_ADD;
  // v370: Also extend Loom idle threshold so it doesn't penalize during extended time
  _loomIdleThresholdMs += _MORE_TIME_ADD * 1000;
  _loomLastAnswerTime = Date.now(); // Reset idle timer so the extension starts fresh
  var btn = document.getElementById('btnMoreTime');
  var remaining = _MORE_TIME_MAX - _moreTimeUsed;
  if (remaining <= 0) {
    btn.classList.add('exhausted');
    btn.textContent = '+5m (0)';
  } else {
    btn.textContent = '+5m (' + remaining + ')';
  }
  // Visual feedback
  btn.style.borderColor = '#10b981';
  btn.style.color = '#10b981';
  setTimeout(function() { btn.style.borderColor = ''; btn.style.color = ''; }, 600);
  console.log('[CK Buddy] More Time used (' + _moreTimeUsed + '/' + _MORE_TIME_MAX + '): thresholds now ' + _qTimerFastSec + '/' + _qTimerOkSec);
});

// v374: Double or Nothing — accept the bet
document.getElementById('btnDoubleOrNothing').addEventListener('click', function() {
  var _resPayout = _calcProjectedPayout();
  _donStakes = Math.abs(_resPayout.net);
  _donActive = true;
  _donLost = false;
  // Persist across reload
  chrome.storage.local.set({ [_DON_STORAGE_KEY]: { stakes: _donStakes, active: true, lost: false } });
  // Visual feedback
  var wrap = document.getElementById('double-or-nothing-wrap');
  wrap.style.borderColor = '#10b981';
  document.querySelector('.don-label').textContent = '✅ BET ACCEPTED';
  document.getElementById('don-desc').textContent = 'Next block: finish ALL green to win +$' + _donStakes + '. Good luck!';
  this.style.display = 'none';
  // Play a dramatic sound
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    [440, 554, 659, 880].forEach(function(f, i) {
      var o = ctx.createOscillator(); var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = f; o.type = 'square'; g.gain.value = 0.06;
      o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.1);
    });
  } catch(_) {}
  console.log('[CK Buddy] Double or Nothing ACCEPTED: stakes=$' + _donStakes);
});

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
    // Any type that deserves deep review → 3 trivia (incorrect, marked, unknown).
    // Only plain "correct" (answered right, not flagged) gets a single reinforcer.
    if (type === 'incorrect' || type === 'unknown' ||
        type === 'marked' || type === 'incorrect_marked' || type === 'correct_marked') {
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
  // v347: Reset reward stats for new quiz block + clear persisted stats
  _qStats.reset();
  _saveQStats();
  var _nfItems = document.getElementById('reward-feed-items'); if (_nfItems) _nfItems.innerHTML = '';
  var _nfProj = document.getElementById('reward-feed-proj'); if (_nfProj) { _nfProj.textContent = '$100 projected'; _nfProj.className = 'reward-feed-proj'; }
  var _nafItems = document.getElementById('amboss-reward-feed-items'); if (_nafItems) _nafItems.innerHTML = '';
  var _nafProj = document.getElementById('amboss-reward-feed-proj'); if (_nafProj) { _nafProj.textContent = '$100 projected'; _nafProj.className = 'reward-feed-proj'; }
  saveActiveQuizSnapshot();   // full snapshot — survives future scrapes/reloads
  saveQuizProgress();
  _readyGatePending = true; // v361: Show ready gate before first question
  renderTriviaQuestion();
  // v363: Loom bridge setup moved to btnReadyGo handler — don't start penalties before user is ready
}

/* ── DIRECT NAV — popup calls chrome.scripting.executeScript on AMBOSS tab ── */
async function directNavToQuestion(targetQ, source) {
  console.log('[CK Buddy Popup] directNavToQuestion called for Q' + targetQ + ' source=' + source);
  try {
    // Use question source to determine which platform tab to navigate
    let targetTab = null;
    let platform = '';

    if (source === 'uworld_qbank') {
      // UWorld first
      const uworldTabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
      const uworldTest = uworldTabs.find(t => /testinterface/.test(t.url));
      if (uworldTest) { targetTab = uworldTest; platform = 'uworld'; }
    } else if (source === 'amboss_qbank') {
      // AMBOSS first
      const ambossTabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
      const ambossReview = ambossTabs.find(t => /\/(review|session)\//.test(t.url));
      if (ambossReview) { targetTab = ambossReview; platform = 'amboss'; }
    }

    // Fallback: try all platforms if source didn't match
    if (!targetTab) {
      const nbmeTabs = await chrome.tabs.query({ url: '*://*.starttest.com/*' });
      if (nbmeTabs.length) {
        chrome.tabs.sendMessage(nbmeTabs[0].id, { type: 'NAV_TO_QUESTION', questionNum: targetQ });
        console.log('[CK Buddy Popup] Sent NAV to NBME tab');
        return;
      }
      const ambossTabs = await chrome.tabs.query({ url: '*://next.amboss.com/*' });
      const ambossReview = ambossTabs.find(t => /\/(review|session)\//.test(t.url));
      if (ambossReview) { targetTab = ambossReview; platform = 'amboss'; }
      if (!targetTab) {
        const uworldTabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
        const uworldTest = uworldTabs.find(t => /testinterface/.test(t.url));
        if (uworldTest) { targetTab = uworldTest; platform = 'uworld'; }
      }
    }

    if (!targetTab) {
      console.log('[CK Buddy Popup] No exam tab found (NBME/AMBOSS/UWorld)');
      return;
    }

    console.log('[CK Buddy Popup] Found ' + platform + ' tab:', targetTab.id);

    // Direct executeScript — click sidebar + verify + retry.
    // allFrames: true because UWorld's content lives in an iframe,
    // not the main frame. The injected code returns null from frames
    // that don't have the question content, so we pick the real result.
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id, allFrames: true },
      func: async (qNum, plat) => {
        // Frame guard: only run in the frame that has question content
        if (plat === 'uworld' || plat === '') {
          if (!document.getElementById('questionText') &&
              !document.getElementById('answerContainer') &&
              !document.querySelector('tr.mat-row .questionindex')) {
            // Also check for AMBOSS content if platform unknown
            if (plat !== 'amboss' && !document.querySelector('[data-e2e-test-id]')) {
              return null; // not the content frame
            }
          }
        }
        function getCurrentQ() {
          if (plat === 'amboss') {
            var m = location.pathname.match(/\/review\/[^/]+\/(\d+)/);
            return m ? parseInt(m[1]) : null;
          } else {
            // UWorld: parse "Item X of Y" from page
            var match = document.body.innerText.match(/Item[:\s]+(\d+)\s+of\s+(\d+)/);
            return match ? parseInt(match[1]) : null;
          }
        }
        function clickSidebar(q) {
          if (plat === 'amboss') {
            var btn = document.querySelector('[data-e2e-test-id="question-' + q + '"]');
            if (btn) { btn.click(); return true; }
          } else {
            // UWorld: find sidebar row by .questionindex text
            var rows = document.querySelectorAll('tr.mat-row');
            for (var r = 0; r < rows.length; r++) {
              var idx = rows[r].querySelector('.questionindex');
              if (idx && parseInt(idx.innerText.trim()) === q) { rows[r].click(); return true; }
            }
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
        if (getCurrentQ() === qNum) return { ok: true, landed: qNum, method: 'already_there' };
        for (var attempt = 1; attempt <= 3; attempt++) {
          clickSidebar(qNum);
          var landed = await waitForNav(qNum, 3000);
          if (landed === qNum) return { ok: true, landed: landed, method: 'sidebar', attempt: attempt };
        }
        // URL fallback (AMBOSS only)
        if (plat === 'amboss') {
          var m = location.pathname.match(/(\/[^/]+\/review\/[^/]+\/)\d+/);
          if (m) {
            location.href = location.origin + m[1] + qNum;
            await new Promise(function(r) { setTimeout(r, 2000); });
            return { ok: getCurrentQ() === qNum, landed: getCurrentQ(), method: 'url_nav' };
          }
        }
        return { ok: false, landed: getCurrentQ(), method: 'failed' };
      },
      args: [targetQ, platform]
    });
    // Pick the first non-null result (from the content frame)
    const r = results && results.find(f => f && f.result !== null && f.result !== undefined);
    const navResult = r ? r.result : null;
    console.log('[CK Buddy Popup] Nav result:', JSON.stringify(navResult));
  } catch (err) {
    console.error('[CK Buddy Popup] directNavToQuestion error:', err);
    // Last resort fallback to background message
    chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_QUESTION', questionNum: targetQ });
  }
}

// Sanitize vignetteQuote: reject metadata-looking strings (item counters, Q IDs,
// UI toolbar labels, pure numbers, section headers) and fall back to a salient
// clinical-looking sentence pulled from the parent question stem.
function _ckrbSanitizeVignetteQuote(quote, stem) {
  var q = (quote || '').trim();
  // Strip surrounding quotes the model sometimes wraps around its own output
  q = q.replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();

  var FORBIDDEN_PATTERNS = [
    /^item\s+\d+\s+of\s+\d+$/i,
    /^question\s*(id|#|number)?\s*:?\s*\d+$/i,
    /^q\s*#?\s*\d+$/i,
    /^page\s+\d+\s+of\s+\d+$/i,
    /^\d+\s*[\/\.of]+\s*\d+$/i,
    /^(mark|marked|unmark|previous|next|full\s*screen|tutorial|lab\s*values|calculator|notes|flag|abc|pause|end\s*block|suspend)$/i,
    /^(explanation|educational\s*objective|references?|learning\s*objective)s?:?$/i,
    /^(history|physical\s*exam(ination)?|laboratory|imaging|assessment|plan|chief\s*complaint)[:\s]*$/i,
    /^[\d\s\.\-:]+$/ // pure punctuation/numbers
  ];
  function looksLikeMetadata(s) {
    if (!s) return true;
    var trimmed = s.trim();
    if (trimmed.length < 10) return true;
    var wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) return true;
    for (var i = 0; i < FORBIDDEN_PATTERNS.length; i++) {
      if (FORBIDDEN_PATTERNS[i].test(trimmed)) return true;
    }
    return false;
  }

  if (!looksLikeMetadata(q)) return q;

  // Fallback: extract the most clinical-looking sentence from the stem
  var src = (stem || '').toString();
  if (!src) return '';
  // Strip known metadata from the stem before sentence-splitting
  src = src
    .replace(/^\s*Item\s+\d+\s+of\s+\d+\s*$/gmi, '')
    .replace(/^\s*Question\s+(Id|ID|#)?\s*:?\s*\d+\s*$/gmi, '')
    .replace(/^\s*Q\s*#?\s*\d+\s*$/gmi, '')
    .replace(/^\s*(Mark|Marked|Unmark|Previous|Next|Full Screen|Tutorial|Lab Values|Calculator|Notes|Flag|ABC)\s*$/gmi, '')
    .trim();
  // Split into sentences; prefer one with clinical cues
  var sentences = src.split(/(?<=[.!?])\s+/).map(function(s) { return s.trim(); }).filter(Boolean);
  var CLINICAL_CUES = /(year[- ]old|patient|presents?|complains?|history|examination|exam reveals|blood pressure|heart rate|temperature|mg\/dL|mmHg|hemoglobin|laboratory|culture|biopsy|diagnos|symptoms?|pain|fever|cough|nausea|vomit|lesion|rash|swell)/i;
  for (var si = 0; si < sentences.length; si++) {
    var s = sentences[si];
    var w = s.split(/\s+/).filter(Boolean).length;
    if (w >= 6 && w <= 40 && CLINICAL_CUES.test(s) && !looksLikeMetadata(s)) {
      return s;
    }
  }
  // Secondary fallback: first long-enough sentence
  for (var si2 = 0; si2 < sentences.length; si2++) {
    var s2 = sentences[si2];
    var w2 = s2.split(/\s+/).filter(Boolean).length;
    if (w2 >= 6 && w2 <= 40 && !looksLikeMetadata(s2)) return s2;
  }
  return '';
}

// v384: Helper for ready gate chime [READY_GATE_SOUND]
function _rgPlayChime(ctx) {
  var notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach(function(freq, i) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
    osc.start(ctx.currentTime + i * 0.15);
    osc.stop(ctx.currentTime + i * 0.15 + 0.45);
  });
}

function renderTriviaQuestion() {
  // v361: Ready gate — if pending, show overlay instead of question
  if (_readyGatePending) {
    var _rgEl = document.getElementById('ready-gate');
    var _rgInfo = document.getElementById('ready-gate-info');
    if (_rgEl) {
      _rgEl.classList.remove('hidden');
      // ═══════════════════════════════════════════════════════════════
      // v384: READY GATE SOUND — 3 independent mechanisms + debug logs
      // Search tag: [READY_GATE_SOUND] for future debugging
      // ═══════════════════════════════════════════════════════════════
      console.log('[READY_GATE_SOUND] Ready gate shown — attempting 3 sound methods');

      // METHOD 1: AudioContext oscillator chime (ascending C major)
      try {
        var _rgCtx = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[READY_GATE_SOUND] Method 1 (AudioContext): state=' + _rgCtx.state);
        if (_rgCtx.state === 'suspended') {
          _rgCtx.resume().then(function() {
            console.log('[READY_GATE_SOUND] Method 1: resumed from suspended, playing');
            _rgPlayChime(_rgCtx);
          }).catch(function(e) { console.warn('[READY_GATE_SOUND] Method 1: resume failed:', e.message); });
        } else {
          _rgPlayChime(_rgCtx);
          console.log('[READY_GATE_SOUND] Method 1: playing immediately (state=' + _rgCtx.state + ')');
        }
      } catch(e1) { console.warn('[READY_GATE_SOUND] Method 1 FAILED:', e1.message); }

      // METHOD 2: HTML5 Audio element with data URI (PCM beep)
      try {
        // Tiny WAV: 44100Hz, mono, 8-bit, 0.15s sine wave at 880Hz
        var _rgAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=');
        _rgAudio.volume = 0.3;
        var _rgAudioPromise = _rgAudio.play();
        if (_rgAudioPromise && _rgAudioPromise.then) {
          _rgAudioPromise.then(function() {
            console.log('[READY_GATE_SOUND] Method 2 (Audio element): playing');
          }).catch(function(e) {
            console.warn('[READY_GATE_SOUND] Method 2 BLOCKED by autoplay:', e.message);
          });
        } else {
          console.log('[READY_GATE_SOUND] Method 2 (Audio element): play() returned void');
        }
      } catch(e2) { console.warn('[READY_GATE_SOUND] Method 2 FAILED:', e2.message); }

      // METHOD 3: chrome.tts.speak a short word (uses system TTS engine, bypasses autoplay)
      try {
        if (chrome.tts && chrome.tts.speak) {
          chrome.tts.speak('Ready', { rate: 1.5, volume: 0.5, enqueue: false }, function() {
            if (chrome.runtime.lastError) {
              console.warn('[READY_GATE_SOUND] Method 3 (chrome.tts): error:', chrome.runtime.lastError.message);
            } else {
              console.log('[READY_GATE_SOUND] Method 3 (chrome.tts): spoke "Ready"');
            }
          });
        } else {
          console.warn('[READY_GATE_SOUND] Method 3: chrome.tts not available');
        }
      } catch(e3) { console.warn('[READY_GATE_SOUND] Method 3 FAILED:', e3.message); }
      var _qCount = quizState.triviaQueue ? quizState.triviaQueue.length : 0;
      var _parentCount = 0;
      if (quizState.triviaQueue) {
        var _seen = {};
        for (var _ri = 0; _ri < quizState.triviaQueue.length; _ri++) {
          var _pid = quizState.triviaQueue[_ri].parentQ ? quizState.triviaQueue[_ri].parentQ.id : _ri;
          if (!_seen[_pid]) { _seen[_pid] = true; _parentCount++; }
        }
      }
      if (_rgInfo) _rgInfo.textContent = _parentCount + ' questions (' + _qCount + ' trivia parts)';
    }
    return; // Don't render the question yet
  }
  // v414: Kill any running highlight recheck interval
  if (_alwaysHlCheckInterval) { clearInterval(_alwaysHlCheckInterval); _alwaysHlCheckInterval = null; }
  // v408: Clear old injected buttons from UWorld when moving to next question
  try {
    var _qbCleanUrls = ['uworld.com', 'amboss.com', 'starttest.com', 'nbme.org'];
    chrome.tabs.query({}, function(tabs) {
      tabs.filter(function(t) { return t.url && _qbCleanUrls.some(function(u) { return t.url.includes(u); }); }).forEach(function(t) {
        chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: true }, world: 'MAIN',
          func: function() {
            var b1 = document.getElementById('__ckrb_goto_hl_btn'); if (b1) b1.remove();
            var b2 = document.getElementById('__ckrb_nav_q_btn'); if (b2) b2.remove();
          }
        }).catch(function() {});
      });
    });
  } catch(_) {}
  // v360: Clear stale orange highlights from previous question
  try { _clearWrongChoiceHighlights(); } catch(_) {}
  // Stop any in-flight explanation TTS from the previous question
  try { _explStopAll(); } catch(_) {}
  if (typeof _explHideReadPanel === 'function') try { _explHideReadPanel(); } catch(_) {}
  const { triviaQueue, currentIndex, score, streak } = quizState;
  if (currentIndex >= triviaQueue.length) { showResults(); return; }

  const { trivia, parentQ } = triviaQueue[currentIndex];
  const type = parentQ.analysis?._type || 'unknown';
  // v326: Start per-question timer — longer thresholds for 3-part questions
  const _isDeepQ = (type === 'incorrect' || type === 'unknown' || type === 'marked' || type === 'incorrect_marked' || type === 'correct_marked');
  // v367: Deep debug — log question type + timer config
  console.log('[CK Buddy DEBUG] renderTriviaQuestion: idx=' + currentIndex + ' type=' + type + ' _isDeepQ=' + _isDeepQ + ' → thresholds will be ' + (_isDeepQ ? '135/195' : '45/90'));
  _startQTimer('q-timer', _isDeepQ);
  const analysis = parentQ.analysis || {};

  // v419: Log everything for debugging
  console.log('[HL_DEBUG] PRE-CHECK: type=' + type + ' ua="' + (analysis.userAnswer || 'NONE').substring(0,30) + '" ca="' + (analysis.correctAnswer || 'NONE').substring(0,30) + '"');
  var _isActuallyWrong = (type === 'incorrect' || type === 'incorrect_marked');
  if (!_isActuallyWrong && analysis.userAnswer && analysis.correctAnswer) {
    // For unknown, marked, correct_marked, or any other type — check if answers differ
    var _uaFirst = analysis.userAnswer.trim().charAt(0).toUpperCase();
    var _caFirst = analysis.correctAnswer.trim().charAt(0).toUpperCase();
    if (_uaFirst !== _caFirst && /^[A-G]$/.test(_uaFirst) && /^[A-G]$/.test(_caFirst)) {
      _isActuallyWrong = true;
      console.log('[HL_DEBUG] _isActuallyWrong=true via answer comparison: ua=' + _uaFirst + ' ca=' + _caFirst + ' type=' + type);
    }
  }
  console.log('[HL_DEBUG] _isActuallyWrong=' + _isActuallyWrong + ' type=' + type);
  if (_isActuallyWrong) {
    var _alwaysUA = (analysis.userAnswer || '');
    var _alwaysLetter = (_alwaysUA.match(/^\s*([A-G])[.):\s,]/i) || _alwaysUA.match(/^\s*([A-G])$/i) || [])[1] || '';
    if (!_alwaysLetter) {
      var _alwaysTrim = _alwaysUA.trim();
      if (_alwaysTrim.length >= 1 && /^[A-G]$/i.test(_alwaysTrim.charAt(0)) && (_alwaysTrim.length === 1 || /[^a-zA-Z]/.test(_alwaysTrim.charAt(1)))) {
        _alwaysLetter = _alwaysTrim.charAt(0);
      }
    }
    if (_alwaysLetter) {
      console.log('[HL_DEBUG] ALWAYS-FIRE: Scheduling highlight for Choice ' + _alwaysLetter.toUpperCase() + ' (idx=' + currentIndex + ', type=' + type + ')');
      var _hlCurrentIdx = currentIndex;
      // v404: Inject inline 🔍 button next to the WRONG answer choice on the qbank page
      var _qbUrls2 = ['uworld.com', 'amboss.com', 'starttest.com', 'nbme.org'];
      var _gotoLetter = _alwaysLetter.toUpperCase();
      setTimeout(function() {
        chrome.tabs.query({}, function(tabs) {
          var targets = tabs.filter(function(t) { return t.url && _qbUrls2.some(function(u) { return t.url.includes(u); }); });
          targets.forEach(function(t) {
            chrome.scripting.executeScript({
              target: { tabId: t.id, allFrames: true },
              world: 'MAIN',
              func: function(letter) {
                // Remove old button
                var old = document.getElementById('__ckrb_goto_hl_btn');
                if (old) old.remove();
                // Find the wrong answer row — has fa-times + mat-radio-checked
                var rows = document.querySelectorAll('#answerContainer tr.answer-choice-background, [class*="answer-choice"]');
                var targetRow = null;
                for (var ri = 0; ri < rows.length; ri++) {
                  var hasTimes = !!rows[ri].querySelector('.fa-times');
                  var radio = rows[ri].querySelector('mat-radio-button');
                  var isSelected = radio && radio.classList.contains('mat-radio-checked');
                  if (hasTimes && isSelected) { targetRow = rows[ri]; break; }
                }
                // Fallback: find row whose text starts with the letter
                if (!targetRow) {
                  for (var ri2 = 0; ri2 < rows.length; ri2++) {
                    var txt = (rows[ri2].textContent || '').trim();
                    if (txt.match(new RegExp('^\\s*' + letter + '[.)\\s]', 'i'))) { targetRow = rows[ri2]; break; }
                  }
                }
                if (!targetRow) return;
                var btn = document.createElement('button');
                btn.id = '__ckrb_goto_hl_btn';
                btn.type = 'button';
                btn.innerHTML = '\uD83D\uDD0D';
                btn.title = 'Scroll to explanation for Choice ' + letter;
                btn.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:8px;' +
                  'font-size:16px;padding:5px 9px;line-height:1;' +
                  'background:linear-gradient(180deg,#fb923c,#f97316);color:#fff;' +
                  'border:2px solid #fdba74;border-bottom:4px solid #9a3412;border-radius:8px;' +
                  'cursor:pointer;' +
                  'box-shadow:0 3px 0 #9a3412,0 4px 10px rgba(249,115,22,0.4);' +
                  'transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);' +
                  'text-shadow:0 1px 2px rgba(0,0,0,0.3);';
                // ① Hover: enlarge + darker shade + noise
                btn.addEventListener('mouseenter', function() {
                  btn.style.transform = 'translateY(-2px) scale(1.1)';
                  btn.style.background = 'linear-gradient(180deg,#fdba74,#fb923c)';
                  btn.style.borderColor = '#fed7aa';
                  btn.style.boxShadow = '0 5px 0 #9a3412,0 6px 14px rgba(249,115,22,0.5)';
                  try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=660;o.type='sine';g.gain.value=0.04;o.start();o.stop(c.currentTime+0.018);}catch(_){}
                });
                btn.addEventListener('mouseleave', function() {
                  btn.style.transform = '';
                  btn.style.background = 'linear-gradient(180deg,#fb923c,#f97316)';
                  btn.style.borderColor = '#fdba74';
                  btn.style.boxShadow = '0 3px 0 #9a3412,0 4px 10px rgba(249,115,22,0.4)';
                });
                // ② Click: color shift + different noise + compressed
                btn.addEventListener('mousedown', function(e) {
                  e.preventDefault(); e.stopPropagation();
                  btn.style.transform = 'translateY(3px) scale(0.97)';
                  btn.style.boxShadow = '0 1px 0 #9a3412,0 2px 4px rgba(249,115,22,0.2)';
                  btn.style.borderBottom = '1px solid #9a3412';
                  btn.style.background = 'linear-gradient(180deg,#f97316,#ea580c)';
                });
                btn.addEventListener('mouseup', function(e) {
                  e.stopPropagation();
                  btn.style.transform = 'translateY(-2px) scale(1.1)';
                  btn.style.boxShadow = '0 5px 0 #9a3412,0 6px 14px rgba(249,115,22,0.5)';
                  btn.style.borderBottom = '4px solid #9a3412';
                  btn.style.background = 'linear-gradient(180deg,#fdba74,#fb923c)';
                });
                btn.addEventListener('click', function(e) {
                  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                  try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=880;o.type='sine';g.gain.value=0.06;o.start();o.stop(c.currentTime+0.035);}catch(_){}
                  var hl = document.querySelector('.ckrb-wrong-para-hl');
                  if (hl) {
                    hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else {
                    btn.style.background = 'linear-gradient(180deg,#ef4444,#dc2626)';
                    btn.title = 'No highlight found yet — waiting for it to appear';
                    setTimeout(function() { btn.style.background = 'linear-gradient(180deg,#fb923c,#f97316)'; btn.title = 'Scroll to explanation for Choice ' + letter; }, 2000);
                  }
                });
                var _lastTd = targetRow.querySelectorAll("td"); (_lastTd.length ? _lastTd[_lastTd.length - 1] : targetRow).appendChild(btn);
              },
              args: [_gotoLetter]
            }).catch(function() {});
            // v411: Nav button moved to renderTriviaQuestion (runs for ALL questions)
          });
        });
      }, 5000);
      setTimeout(function() {
        console.log('[HL_DEBUG] ALWAYS-FIRE: Firing now for Choice ' + _alwaysLetter.toUpperCase());
        _highlightWrongChoiceOnPage(_alwaysLetter.toUpperCase());
      }, 2000);
      if (_alwaysHlCheckInterval) clearInterval(_alwaysHlCheckInterval);
      _alwaysHlCheckInterval = setInterval(function() {
        if (quizState.currentIndex !== _hlCurrentIdx) { clearInterval(_alwaysHlCheckInterval); _alwaysHlCheckInterval = null; return; }
        _highlightWrongChoiceOnPage(_alwaysLetter.toUpperCase());
      }, 5000);
    } else {
      console.warn('[HL_DEBUG] ALWAYS-FIRE: No letter extracted from ua="' + _alwaysUA.substring(0, 40) + '"');
    }
  }
  // v411: Inject nav button for EVERY question (not just incorrect)
  var _navQNum = parentQ.absoluteId || (parentQ.id + 1);
  var _navCurrentIdx = currentIndex;
  setTimeout(function() {
    // v416: No index guard — nav button should always appear, even if user answered fast
    var _qbNavUrls = ['uworld.com', 'amboss.com', 'starttest.com', 'nbme.org'];
    chrome.tabs.query({}, function(tabs) {
      tabs.filter(function(t) { return t.url && _qbNavUrls.some(function(u) { return t.url.includes(u); }); }).forEach(function(t) {
        chrome.scripting.executeScript({
          target: { tabId: t.id },
          world: 'MAIN',
          func: function(qNum) {
            var old = document.getElementById('__ckrb_nav_q_btn'); if (old) old.remove();
            var header = null;
            var allEls = document.querySelectorAll('*');
            for (var i = 0; i < allEls.length; i++) {
              var dt = '';
              for (var j = 0; j < allEls[i].childNodes.length; j++) { if (allEls[i].childNodes[j].nodeType === 3) dt += allEls[i].childNodes[j].textContent; }
              // UWorld: "Item: X of Y", AMBOSS: "Question X of Y", NBME: "Item X of Y"
              if (/(?:Item|Question):?\s+\d+\s+(?:of|\/)\s+\d+/i.test(dt.trim()) && dt.trim().length < 35) { header = allEls[i]; break; }
            }
            // Fallback: first visible header-like element in the top area
            if (!header) {
              var topEls = document.querySelectorAll('h1, h2, h3, [class*="header"], [class*="title"], [class*="nav"]');
              for (var hi = 0; hi < topEls.length; hi++) {
                if (topEls[hi].offsetParent !== null && topEls[hi].getBoundingClientRect().top < 80) { header = topEls[hi]; break; }
              }
            }
            if (!header) return;
            var btn = document.createElement('button');
            btn.id = '__ckrb_nav_q_btn';
            btn.innerHTML = '\u{1F4CD} Q' + qNum;
            btn.title = 'Navigate to Question ' + qNum + ' (current CK Buddy quiz question)';
            btn.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:10px;font-size:12px;font-weight:800;padding:4px 10px;line-height:1;background:linear-gradient(180deg,#818cf8,#6366f1);color:#fff;border:2px solid #a5b4fc;border-bottom:4px solid #3730a3;border-radius:8px;cursor:pointer;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 3px 0 #3730a3,0 4px 10px rgba(99,102,241,0.4);transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);text-shadow:0 1px 2px rgba(0,0,0,0.3);';
            btn.addEventListener('mouseenter', function() { btn.style.transform='translateY(-2px) scale(1.05)'; btn.style.background='linear-gradient(180deg,#a5b4fc,#818cf8)'; btn.style.borderColor='#c7d2fe'; btn.style.boxShadow='0 5px 0 #3730a3,0 6px 14px rgba(99,102,241,0.5)'; try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=660;o.type='sine';g.gain.value=0.04;o.start();o.stop(c.currentTime+0.018);}catch(_){} });
            btn.addEventListener('mouseleave', function() { btn.style.transform=''; btn.style.background='linear-gradient(180deg,#818cf8,#6366f1)'; btn.style.borderColor='#a5b4fc'; btn.style.boxShadow='0 3px 0 #3730a3,0 4px 10px rgba(99,102,241,0.4)'; });
            btn.addEventListener('mousedown', function(e) { e.preventDefault();e.stopPropagation(); btn.style.transform='translateY(3px) scale(0.97)'; btn.style.boxShadow='0 1px 0 #3730a3'; btn.style.borderBottom='1px solid #3730a3'; btn.style.background='linear-gradient(180deg,#6366f1,#4f46e5)'; });
            btn.addEventListener('mouseup', function(e) { e.stopPropagation(); btn.style.transform='translateY(-2px) scale(1.05)'; btn.style.boxShadow='0 5px 0 #3730a3,0 6px 14px rgba(99,102,241,0.5)'; btn.style.borderBottom='4px solid #3730a3'; btn.style.background='linear-gradient(180deg,#a5b4fc,#818cf8)'; });
            btn.addEventListener('click', function(e) {
              e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
              try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=880;o.type='sine';g.gain.value=0.06;o.start();o.stop(c.currentTime+0.035);}catch(_){}
              var clicked = false;
              // UWorld: span.questionindex
              var spans = document.querySelectorAll('span.questionindex');
              for (var si = 0; si < spans.length; si++) {
                if (spans[si].textContent.trim() === String(qNum)) { (spans[si].parentElement||spans[si]).click(); clicked = true; break; }
              }
              // AMBOSS: [data-e2e-test-id="question-X"]
              if (!clicked) {
                var ambossBtn = document.querySelector('[data-e2e-test-id="question-' + qNum + '"]');
                if (ambossBtn) { ambossBtn.click(); clicked = true; }
              }
              // NBME/generic: look for any clickable element with just the number
              if (!clicked) {
                var allNums = document.querySelectorAll('a, button, [role="button"], span, td');
                for (var ni = 0; ni < allNums.length; ni++) {
                  var nt = allNums[ni].textContent.trim();
                  if (nt === String(qNum) && allNums[ni].offsetParent !== null && allNums[ni].offsetWidth < 60) {
                    allNums[ni].click(); clicked = true; break;
                  }
                }
              }
              if (clicked) { btn.innerHTML='\u2705 Q'+qNum; setTimeout(function(){btn.innerHTML='\u{1F4CD} Q'+qNum;},2000); }
              else { btn.innerHTML='\u274C Q'+qNum; setTimeout(function(){btn.innerHTML='\u{1F4CD} Q'+qNum;},2000); }
            });
            header.parentNode.insertBefore(btn, header.nextSibling);
          },
          args: [_navQNum]
        }).catch(function() {});
      });
    });
  }, 1000);

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

  // v300: Render Duolingo-style 3D progress tiles
  // Use question TYPE to determine expected parts (not actual trivia count)
  const progressEl = document.getElementById('trivia-progress');
  if (progressEl) {
    // Compare by ID — object refs break after JSON round-trip (resumed quiz)
    const parentId = parentQ.id;
    let parentStart = -1, parentCount = 0;
    for (let pi = 0; pi < triviaQueue.length; pi++) {
      if (triviaQueue[pi].parentQ.id === parentId) {
        if (parentStart === -1) parentStart = pi;
        parentCount++;
      }
    }
    const partIndex = currentIndex - parentStart;
    // Incorrect/marked/unknown → expect 3 parts; correct → 1
    const isDeepReview = (type === 'incorrect' || type === 'unknown' ||
      type === 'marked' || type === 'incorrect_marked' || type === 'correct_marked');
    const expectedParts = isDeepReview ? 3 : 1;
    const displayParts = Math.max(parentCount, expectedParts);

    let phtml = '';
    if (displayParts === 1) {
      phtml += '<div class="trivia-tile single-tile">1</div>';
    } else {
      for (let bi = 0; bi < displayParts; bi++) {
        if (bi > 0) {
          const connClass = bi <= partIndex ? (bi === partIndex ? 'active-line' : 'done') : '';
          phtml += '<div class="trivia-tile-connector ' + connClass + '"></div>';
        }
        if (bi < partIndex) {
          phtml += '<div class="trivia-tile completed"></div>';
        } else if (bi === partIndex) {
          phtml += '<div class="trivia-tile active">' + (bi + 1) + '</div>';
        } else {
          phtml += '<div class="trivia-tile upcoming">' + (bi + 1) + '</div>';
        }
      }
    }
    progressEl.innerHTML = phtml;
  }

  // Answer comparison box — always show on first trivia for this question
  const misBox = document.getElementById('misconception-box');
  const misText = document.getElementById('misconception-text');
  // [HL_DEBUG] Step 1: check question type for highlight
  console.log('[HL_DEBUG] Step 1: isFirstForParent=' + isFirstForParent + ' type=' + type + ' idx=' + currentIndex);
  if (isFirstForParent) {
    misBox.classList.remove('hidden');
  }
  // v394: Fire highlight on EVERY incorrect question render, not just first-for-parent
  if (type === 'incorrect' || type === 'unknown' || type === 'incorrect_marked' || type === 'marked') {
    if (isFirstForParent) {
      console.log('[HL_DEBUG] Step 2: Wrong-answer question (type=' + type + ') — will attempt highlight');
      const ua = analysis.userAnswer || 'Unknown';
      const ca = analysis.correctAnswer || 'Unknown';
      const mc = analysis.likelyMisconception || '';
      misText.innerHTML =
        `<div style="margin-bottom:6px"><span style="color:#f87171">✗ You answered:</span> ${ua}</div>` +
        `<div style="margin-bottom:6px"><span style="color:#34d399">✓ Correct:</span> ${ca}</div>` +
        (mc ? `<div style="color:#94a3b8;font-size:11px;margin-top:4px">${mc}</div>` : '');
      // v325/v330: Send wrong choice letter to content script for explanation highlighting
      // Delayed 4s to wait for UWorld auto-navigation to complete loading the explanation
      // v389: Conservative letter extraction — only match letter at START of answer text
      // Pattern 1: "A. answer" or "A) answer" or "A answer" (letter + separator at start)
      // Pattern 2: standalone single letter "A"
      // REMOVED: \b([A-G])\. which falsely matched mid-text like "E. coli" or "B. fragilis"
      var _choiceLetter = (ua.match(/^\s*([A-G])[.):\s,]/i) || ua.match(/^\s*([A-G])$/i) || [])[1] || '';
      // Fallback: if first non-space char is A-G and total answer is short, trust it
      if (!_choiceLetter) {
        var _trimUa = ua.trim();
        if (_trimUa.length >= 1 && /^[A-G]$/i.test(_trimUa.charAt(0)) && (_trimUa.length === 1 || /[^a-zA-Z]/.test(_trimUa.charAt(1)))) {
          _choiceLetter = _trimUa.charAt(0);
        }
      }
      console.log('[HL_DEBUG] Step 3: Letter extracted: "' + _choiceLetter + '" from ua="' + ua.substring(0, 60) + '"');
      console.log('[HL_DEBUG] Step 3b: ca="' + ca.substring(0, 60) + '"');
      if (!_choiceLetter) console.error('[HL_DEBUG] ⛔ Step 3 FAILED — no letter extracted!');
      // Show detected letter in the Answer Review box so user can verify
      if (_choiceLetter) {
        console.log('[HL_DEBUG] Step 4: Will call _highlightWrongChoiceOnPage("' + _choiceLetter.toUpperCase() + '") in 4 seconds');
        misText.innerHTML += '<div style="color:#64748b;font-size:10px;margin-top:6px;">🔍 Highlighting Choice ' + _choiceLetter.toUpperCase() + ' in explanation</div>';
        setTimeout(function() {
          console.log('[HL_DEBUG] Step 5: setTimeout fired — calling _highlightWrongChoiceOnPage("' + _choiceLetter.toUpperCase() + '") NOW');
          _highlightWrongChoiceOnPage(_choiceLetter.toUpperCase());
        }, 4000);
      } else {
        misText.innerHTML += '<div style="color:#64748b;font-size:10px;margin-top:6px;">⚠ Could not detect choice letter from: "' + ua.substring(0, 30) + '"</div>';
      }
    } else {
      // Correct — show confirmation + skip option
      const ca = analysis.correctAnswer || analysis.userAnswer || '';
      misText.innerHTML =
        `<div style="margin-bottom:6px"><span style="color:#34d399">✓ You got this right:</span> ${ca}</div>` +
        `<div style="margin-top:6px"><button id="btnSkipQ" style="background:#334155;border:1px solid #475569;color:#94a3b8;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">Skip — I know this ›</button></div>`;
      // v327/v330: Also highlight the correct answer choice in the explanation
      // Delayed 4s to wait for UWorld auto-navigation to complete loading the explanation
      // v358: Removed — no highlight for correct answers
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
  const safeQuote = _ckrbSanitizeVignetteQuote(trivia.vignetteQuote, parentQ && parentQ.questionText);
  if (safeQuote && safeQuote.length > 3) {
    quoteBox.classList.remove('hidden');
    quoteText.textContent = '"' + safeQuote + '"';
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
    // Right-click to rule out / restore (strikethrough toggle — same UX as content.js)
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const ruled = btn.classList.toggle('ruled-out');
      if (ruled) {
        btn.style.textDecoration = 'line-through';
        btn.style.opacity = '0.45';
        btn.style.transform = 'scale(0.97)';
        btn.style.filter = 'grayscale(0.5)';
        btn.style.borderBottomWidth = '1px';
        btn.style.transition = 'all 0.2s ease';
      } else {
        btn.style.textDecoration = '';
        btn.style.opacity = '';
        btn.style.transform = '';
        btn.style.filter = '';
        btn.style.borderBottomWidth = '';
      }
    });
    choicesWrap.appendChild(btn);
  });

  document.getElementById('feedback-box').classList.add('hidden');
  startTimer();

  // Auto-navigate exam tab — use actual question number
  // Navigate whenever the parent question changes (tracked by absoluteId/question number)
  const absNavNum = parentQ.absoluteId || (parentQ.id + 1);
  const qSource = parentQ.source || '';
  console.log('[CK Buddy Popup] renderTrivia: absNavNum=' + absNavNum + ' lastNav=' + window._lastNavNum + ' autonav=' + (SETTINGS && SETTINGS.autonav) + ' source=' + qSource);
  if (SETTINGS && SETTINGS.autonav && absNavNum !== window._lastNavNum) {
    window._lastNavNum = absNavNum;
    console.log('[CK Buddy Popup] Navigating to Q' + absNavNum + ' on ' + (qSource || 'auto-detect'));
    directNavToQuestion(absNavNum, qSource);
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
  // v198: Use Azure REST (_explSpeakChunked) instead of local speechSynthesis
  if (SETTINGS.readAloud) {
    _explStopAll();
    const quoteBox = document.getElementById('vignette-quote-box');
    const quoteEl  = document.getElementById('vignette-quote-text');
    const qEl      = document.getElementById('quiz-question-text');
    const quoteText    = (quoteEl && !quoteBox.classList.contains('hidden')) ? quoteEl.textContent.trim().replace(/^"|"$/g, '') : '';
    const questionText = qEl ? qEl.textContent.trim() : '';

    if (SETTINGS.readQuote !== false && quoteText.length > 3) {
      // v318: Read quote (glow quote box), then question (glow question box) separately
      (async function() {
        var done = await _explSpeakChunked(quoteText, true, 'vignette-quote-box');
        if (done && questionText.length > 10) _explSpeakChunked(questionText, true, 'quiz-question-text');
      })();
    } else if (questionText.length > 10) {
      _explSpeakChunked(questionText, true, 'quiz-question-text');
    }
  }
}

function skipToNextParent() {
  _explStopAll();
  // v320: Notify Todo of the Loom — skip counts as an answer
  var _loomElapsed = _loomLastAnswerTime ? Date.now() - _loomLastAnswerTime : Date.now() - _loomBlockStartTime;
  _loomLastAnswerTime = Date.now();
  _sendToLoom({ type: 'CKRB_QUESTION_ANSWERED', questionIndex: quizState.currentIndex + 1, correct: true, elapsedMs: _loomElapsed, timestamp: Date.now() });
  // v355: Use sub-part label so each trivia part gets its own feed entry
  var _feedSubLabel = _getFeedSubLabel(triviaQueue, quizState.currentIndex);
  // v367: Deep debug — log raw timer values at skip
  var _dbgSkipElapsed = _qTimerStart > 0 ? Math.floor((Date.now() - _qTimerStart) / 1000) : -1;
  console.log('[CK Buddy DEBUG] skipToNextParent: Q=' + _feedSubLabel + ' elapsed=' + _dbgSkipElapsed + 's thresholds=' + _qTimerFastSec + '/' + _qTimerOkSec + ' _qTimerStart=' + _qTimerStart);
  _recordQFeedItem(_feedSubLabel, true);
  // Skip all remaining trivia for this parent question
  const { triviaQueue, currentIndex } = quizState;
  const parentQ = triviaQueue[currentIndex].parentQ;
  let i = currentIndex + 1;
  while (i < triviaQueue.length && triviaQueue[i].parentQ.id === parentQ.id) i++;
  quizState.currentIndex = i;
  quizState.correct++; // credit for knowing it
  saveQuizProgress();
  renderTriviaQuestion();
}

function findFirstIndexForParent(queue, currentIdx, parentQ) {
  return queue.findIndex(item => item.parentQ.id === parentQ.id);
}

function handleAnswer(selectedIdx, trivia) {
  stopTimer();
  const isCorrect = selectedIdx === trivia.correctIndex;
  // v320: Notify Todo of the Loom — question answered
  var _loomElapsed = _loomLastAnswerTime ? Date.now() - _loomLastAnswerTime : Date.now() - _loomBlockStartTime;
  _loomLastAnswerTime = Date.now();
  _sendToLoom({ type: 'CKRB_QUESTION_ANSWERED', questionIndex: quizState.currentIndex + 1, correct: isCorrect, elapsedMs: _loomElapsed, timestamp: Date.now() });
  // v355: Use sub-part label (Q6a, Q6b, Q6c) so each trivia part gets its own feed entry
  var _feedParentNum2 = quizState.triviaQueue[quizState.currentIndex] ? (quizState.triviaQueue[quizState.currentIndex].parentQ.absoluteId || (quizState.triviaQueue[quizState.currentIndex].parentQ.id + 1)) : (quizState.currentIndex + 1);
  var _feedSubLabel2 = _getFeedSubLabel(quizState.triviaQueue, quizState.currentIndex);
  // v367: Deep debug — log raw timer values at moment of answer
  var _dbgElapsed = _qTimerStart > 0 ? Math.floor((Date.now() - _qTimerStart) / 1000) : -1;
  var _dbgTier = _dbgElapsed < _qTimerFastSec ? 'FAST' : (_dbgElapsed < _qTimerOkSec ? 'OK' : 'SLOW');
  console.log('[CK Buddy DEBUG] handleAnswer: Q=' + _feedSubLabel2 + ' elapsed=' + _dbgElapsed + 's thresholds=' + _qTimerFastSec + '/' + _qTimerOkSec + ' → ' + _dbgTier + ' _qTimerStart=' + _qTimerStart + ' now=' + Date.now());
  _recordQFeedItem(_feedSubLabel2, isCorrect);
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
  if (SETTINGS.readExplain) {
    _explTTSText = explanation;
    _explSpeakChunked(explanation, true, 'feedback-box'); // v220: read straight through, no pausing
  }

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
  // v315: Auto-scroll to make Next button visible after answering
  setTimeout(function() {
    var nextBtn = document.getElementById('btnNextQ');
    if (nextBtn) nextBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 150);
  // v381: Auto-advance to results after last question — no need to click Next
  if (quizState.currentIndex + 1 >= quizState.triviaQueue.length) {
    var nextBtn2 = document.getElementById('btnNextQ');
    if (nextBtn2) nextBtn2.textContent = 'See Results →';
    // v432: No auto-advance — user clicks See Results when ready
  }
  startTimer();
}

document.getElementById('btnNextQ').addEventListener('click', () => {
  _explStopAll();
  if (typeof _explHideReadPanel === 'function') _explHideReadPanel();
  quizState.currentIndex++;
  saveQuizProgress();
  renderTriviaQuestion();
  // v318: Scroll back to top so new question is visible
  var quizScreen = document.getElementById('screen-quiz');
  if (quizScreen) quizScreen.scrollTop = 0;
  window.scrollTo(0, 0);
});

// ── NBME EXPLANATION TTS ──
var _explTTSText = '';
var _explWordSpans = [];     // DOM spans for each word (for follow-along highlight)
var _explWordOffsets = [];   // char offset in _explTTSText where each word begins
var _explActiveIdx = -1;

// Render the explanation text into the read-panel with each word wrapped in a span.
// Builds parallel arrays mapping utterance char offsets -> span index so we can
// highlight the currently-spoken word on SpeechSynthesisUtterance.onboundary.
function _explRenderReadPanel(text) {
  var panel = document.getElementById('tts-read-panel');
  if (!panel) return;
  _explWordSpans = [];
  _explWordOffsets = [];
  _explActiveIdx = -1;
  panel.innerHTML = '';
  panel.classList.remove('hidden');

  // Tokenize into [word] and [whitespace/punct] segments, preserving offsets
  var re = /\S+|\s+/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var seg = m[0];
    if (/^\s+$/.test(seg)) {
      panel.appendChild(document.createTextNode(seg));
    } else {
      var span = document.createElement('span');
      span.className = 'ckrb-word';
      span.textContent = seg;
      panel.appendChild(span);
      _explWordSpans.push(span);
      _explWordOffsets.push(m.index);
    }
  }
}

function _explHighlightAtChar(charIndex) {
  if (!_explWordSpans.length) return;
  // Find the latest word whose offset <= charIndex
  var idx = -1;
  for (var i = 0; i < _explWordOffsets.length; i++) {
    if (_explWordOffsets[i] <= charIndex) idx = i;
    else break;
  }
  if (idx < 0 || idx === _explActiveIdx) return;
  if (_explActiveIdx >= 0 && _explWordSpans[_explActiveIdx]) {
    _explWordSpans[_explActiveIdx].classList.remove('ckrb-active');
    _explWordSpans[_explActiveIdx].classList.add('ckrb-spoken');
  }
  _explActiveIdx = idx;
  var cur = _explWordSpans[idx];
  if (cur) {
    cur.classList.add('ckrb-active');
    cur.classList.remove('ckrb-spoken');
    // Keep the active word visible in the scrolling panel
    try {
      var panel = document.getElementById('tts-read-panel');
      if (panel) {
        var pRect = panel.getBoundingClientRect();
        var wRect = cur.getBoundingClientRect();
        if (wRect.bottom > pRect.bottom - 20 || wRect.top < pRect.top + 20) {
          cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    } catch(e) {}
  }
}

function _explResetHighlight() {
  for (var i = 0; i < _explWordSpans.length; i++) {
    if (_explWordSpans[i]) _explWordSpans[i].classList.remove('ckrb-active', 'ckrb-spoken');
  }
  _explActiveIdx = -1;
}

function _explHideReadPanel() {
  var panel = document.getElementById('tts-read-panel');
  if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
  _explWordSpans = [];
  _explWordOffsets = [];
  _explActiveIdx = -1;
}

// ── Popup-side chunked Azure TTS with confirm dialogs ──
// Everything runs in the popup — no dispatching to qbank tab, no double-voice.
var _explSpeakSeq = 0;
var _ckrbTTSGlowEls = []; // v317: elements currently glowing during TTS
var _explCurrentAudio = null;

function _explSplitSentences(text) {
  // Split on period/semicolon/!/? followed by whitespace then a capital letter
  // This avoids splitting on abbreviations like "e.g.", "i.e.", "Dr.", "mg.", "5.2 mg/dL"
  var parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    // Merge very short fragments (< 40 chars) with the previous sentence
    // to avoid tiny chunks like "E." or "Dr. Smith noted:"
    if (out.length > 0 && p.length < 40) {
      out[out.length - 1] += ' ' + p;
    } else {
      out.push(p);
    }
  }
  return out.length ? out : [text];
}

/* _explCleanForSSML REMOVED in v279 -- replaced by _explSanitizeForTTS (charCodeAt-based).
   Old code stripped: zero-width chars U+200B-U+200F, line/para seps U+2028-U+2029,
   BOM U+FEFF, replacement chars U+FFFD-U+FFFF, and C0/C1 control chars.
   DO NOT paste old regex back -- it contained literal null/control bytes. */

function _explSanitizeForTTS(s) {
  // v279: Strip Unicode chars that cause Azure TTS failures.
  // Uses charCodeAt — NO literal Unicode in source to avoid U+2028 bugs.
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0x200B && c <= 0x200F) continue; // zero-width spaces/marks
    if (c === 0x2028 || c === 0x2029) continue; // line/paragraph separator
    if (c === 0xFEFF) continue; // BOM
    if (c === 0xFFFD || c === 0xFFFE || c === 0xFFFF) continue; // replacement/nonchars
    if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) continue; // C0 control (keep tab/nl/cr)
    if (c >= 0x80 && c <= 0x9F) continue; // C1 control chars
    out += s.charAt(i);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function _explEscapeXml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function _explShowConfirm(sentNum, totalSent, sentPreview, onAction) {
  // onAction('next'), onAction('back'), onAction('replay'), onAction('stop')
  var old = document.getElementById('ckrb-expl-confirm');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.id = 'ckrb-expl-confirm';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;';
  var box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;color:#e2e8f0;padding:20px 28px;border-radius:12px;' +
    'max-width:420px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;' +
    'box-shadow:0 16px 48px rgba(0,0,0,0.5);text-align:center;';
  var preview = sentPreview.length > 100 ? sentPreview.substring(0, 100) + '...' : sentPreview;
  var btnStyle = 'border:none;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600;margin:0 4px;';
  box.innerHTML = '<div style="margin-bottom:14px;color:#94a3b8;font-size:12px;">Sentence ' + sentNum + ' / ' + totalSent + '</div>' +
    '<div style="margin-bottom:16px;font-size:13px;color:#cbd5e1;font-style:italic;">"' + preview.replace(/</g,'&lt;').replace(/"/g,'&quot;') + '"</div>' +
    '<div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">' +
    (sentNum > 1 ? '<button id="ckrb-expl-back" style="' + btnStyle + 'background:#6366f1;color:white;">&#9664; Back</button>' : '') +
    '<button id="ckrb-expl-replay" style="' + btnStyle + 'background:#8b5cf6;color:white;">&#x21BB; Replay</button>' +
    (sentNum < totalSent ? '<button id="ckrb-expl-next" style="' + btnStyle + 'background:#3b82f6;color:white;">Next &#9654;</button>' : '') +
    '<button id="ckrb-expl-stop" style="' + btnStyle + 'background:#ef4444;color:white;">&#x25A0; Stop</button>' +
    '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  function wire(id, action) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', function() { overlay.remove(); onAction(action); });
  }
  wire('ckrb-expl-back', 'back');
  wire('ckrb-expl-replay', 'replay');
  wire('ckrb-expl-next', 'next');
  wire('ckrb-expl-stop', 'stop');
}

function _explStopAll() {
  _explSpeakSeq++;
  if (_explCurrentAudio) { try { _explCurrentAudio.pause(); _explCurrentAudio.src = ''; } catch(_) {} _explCurrentAudio = null; }
  try { window.speechSynthesis.cancel(); } catch(_) {}
  var overlay = document.getElementById('ckrb-expl-confirm');
  if (overlay) overlay.remove();
  // v317: Remove TTS reading glow from all illuminated elements
  _ckrbTTSGlowEls.forEach(function(el) { try { el.classList.remove('tts-reading'); } catch(_) {} });
  _ckrbTTSGlowEls = [];
}

// skipConfirm=true → play all sentences continuously (for questions/taunts)
// skipConfirm=false (default) → pause between sentences with Next/Stop dialog (for explanations)
async function _explSpeakChunked(text, skipConfirm, glowElId) {
  _explStopAll(); // Kill anything already playing
  // v317: Apply glowing outline to target element while TTS reads
  if (glowElId) {
    var _glowEl = document.getElementById(glowElId);
    console.log('[CK Buddy] TTS glow: target=' + glowElId + ', found=' + !!_glowEl);
    if (_glowEl) { _glowEl.classList.add('tts-reading'); _ckrbTTSGlowEls.push(_glowEl); console.log('[CK Buddy] TTS glow APPLIED to', glowElId, _glowEl.classList.toString()); }
  } else {
    console.log('[CK Buddy] TTS glow: no glowElId passed');
  }
  var mySeq = ++_explSpeakSeq;

  // Get Azure credentials
  var settings = await new Promise(function(resolve) {
    chrome.storage.sync.get(['ckrb_azure_key', 'ckrb_azure_region'], function(r) { resolve(r || {}); });
  });
  var azureKey = (settings.ckrb_azure_key || '').trim();
  var azureRegion = (settings.ckrb_azure_region || '').trim().toLowerCase();

  if (!azureKey || !azureRegion) {
    // v199: No fallback — Azure only
    console.error('[CK Buddy] No Azure key/region — add them in extension settings. No TTS.');
    return;
  }

  var chunks = _explSplitSentences(text);
  console.log('[CK Buddy] Popup chunked TTS: ' + chunks.length + ' sentences via Azure REST');
  var voice = 'en-US-JennyNeural';

  async function synthChunk(rawChunkText) {
    var chunkText = _explSanitizeForTTS(rawChunkText);
    if (!chunkText) return new ArrayBuffer(0);

    // v310: Go straight to Azure REST — content script SDK detour removed (was causing startup delay)
    var ssml = "<speak version='1.0' xml:lang='en-US'><voice name='" + voice + "'>" + "<prosody rate='-5%'>" + _explEscapeXml(chunkText) + "</prosody></voice></speak>";
    var restResp = await fetch('https://' + azureRegion + '.tts.speech.microsoft.com/cognitiveservices/v1', {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ckrb'
      },
      body: ssml
    });
    if (!restResp.ok) throw new Error('Azure REST ' + restResp.status);
    return await restResp.arrayBuffer();
  }

  // v246: Loop-based playback with prefetch, back/replay/next/stop transport
  var _prefetchCache = {};

  async function prefetchChunk(idx) {
    if (idx < 0 || idx >= chunks.length || mySeq !== _explSpeakSeq) return;
    if (_prefetchCache[idx]) return;
    try {
      _prefetchCache[idx] = await synthChunk(chunks[idx]);
    } catch(_) {}
  }

  async function getChunkBuf(idx) {
    if (_prefetchCache[idx]) {
      var cached = _prefetchCache[idx];
      delete _prefetchCache[idx];
      return cached;
    }
    return await synthChunk(chunks[idx]);
  }

  async function playSingleChunk(idx) {
    var buf = await getChunkBuf(idx);
    if (mySeq !== _explSpeakSeq) return;
    // Prefetch neighbors while playing
    if (idx + 1 < chunks.length) prefetchChunk(idx + 1);
    if (idx - 1 >= 0) prefetchChunk(idx - 1);

    await new Promise(function(resolve, reject) {
      var blob = new Blob([buf], { type: 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      _explCurrentAudio = audio;
      audio.addEventListener('ended', function() {
        try { URL.revokeObjectURL(url); } catch(_) {}
        if (_explCurrentAudio === audio) _explCurrentAudio = null;
        resolve();
      });
      audio.addEventListener('error', function() {
        if (_explCurrentAudio === audio) _explCurrentAudio = null;
        reject(new Error('audio error'));
      });
      audio.play().catch(reject);
    });
  }

  prefetchChunk(0);
  var idx = 0;
  while (idx < chunks.length && mySeq === _explSpeakSeq) {
    try {
      await playSingleChunk(idx);
    } catch(err) {
      console.warn('[CK Buddy] Chunk ' + idx + ' error:', err);
      if (idx === 0) console.error('[CK Buddy] First chunk failed — check Azure key/region in settings');
      // v291: Skip failed chunks — do NOT fall back to local speechSynthesis
      // (local voice sounds different and plays delayed, confusing the user)
    }
    if (mySeq !== _explSpeakSeq) break;

    if (skipConfirm) {
      // Auto-advance (questions, taunts)
      idx++;
    } else {
      // Show transport panel, wait for user action
      var action = await new Promise(function(resolve) {
        _explShowConfirm(idx + 1, chunks.length, chunks[idx],
          function(act) { resolve(act); }
        );
      });
      if (action === 'next')        idx++;
      else if (action === 'back')   idx = Math.max(0, idx - 1);
      else if (action === 'replay') { /* idx stays the same */ }
      else                          break; // 'stop' or unknown
    }
  }
  if (mySeq === _explSpeakSeq) {
    console.log('[CK Buddy] Explanation TTS complete (' + chunks.length + ' sentences)');
    // v317: Remove glow when TTS finishes naturally
    _ckrbTTSGlowEls.forEach(function(el) { try { el.classList.remove('tts-reading'); } catch(_) {} });
    _ckrbTTSGlowEls = [];
    return true; // v318: completed naturally
  }
  return false; // v318: was interrupted
}

// _explSpeakLocal REMOVED in v199 — no more local speechSynthesis fallback.
function _explSpeakLocal() {
  console.error('[CK Buddy] _explSpeakLocal called but DISABLED — Azure REST only');
}

function _explSpeak() {
  if (!_explTTSText) return;
  _explSpeakChunked(_explTTSText, true); // v220: read straight through
}

document.getElementById('btnReadExplanation').addEventListener('click', async function() {
  _explStopAll();
  var item = quizState.triviaQueue && quizState.triviaQueue[quizState.currentIndex];
  var parentQ = item && item.parentQ;
  var nativeExpl = (parentQ && typeof parentQ.explanation === 'string') ? parentQ.explanation.trim() : '';
  if (nativeExpl.length > 5) {
    _explTTSText = nativeExpl;
    console.log('[CK Buddy] Read explanation -- popup chunked TTS, length:', nativeExpl.length);
    _explSpeakChunked(nativeExpl, true); // v220: read straight through
  } else {
    _explTTSText = '';
    console.warn('[CK Buddy] Read explanation -- native explanation missing/empty');
    var btn = document.getElementById('btnReadExplanation');
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = 'No native explanation';
      btn.disabled = true;
      setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 2200);
    }
  }
});
document.getElementById('btnReplayExplanation').addEventListener('click', async function() {
  var txt = _explTTSText || '';
  if (txt) _explSpeakChunked(txt, true); // v220: read straight through
});
document.getElementById('btnStopExplanation').addEventListener('click', async function() {
  _explStopAll();
  _explHideReadPanel();
});


/* ─────────────────────────────────────────────
   RESULTS SCREEN
───────────────────────────────────────────── */
function showResults() {
  _stopQTimer(); // v323
  clearQuizProgress();
  showScreen('screen-results');
  // v320: Notify Todo of the Loom — block completed
  _stopLoomIdleChecker();
  var _blockPayout = _calcProjectedPayout();
  var _blockMsg = { type: 'CKRB_BLOCK_COMPLETED', totalQuestions: quizState.total, correctCount: quizState.correct, totalMs: Date.now() - _loomBlockStartTime, timestamp: Date.now(), calculatedBonus: _blockPayout.net };
  console.log('[CK Buddy] Block complete! Sending to Loom with bonus=$' + _blockPayout.net);
  _sendToLoom(_blockMsg);
  // v383: Retry after 2s — Loom SW may be asleep. Dedup guard in Loom bg.js prevents double-processing.
  setTimeout(function() { _sendToLoom(_blockMsg); }, 2000);
  setTimeout(function() { _sendToLoom(_blockMsg); }, 5000);

  const { correct, total, score } = quizState;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  // Trophy
  const trophy = document.getElementById('trophy-icon');
  if (pct >= 90) trophy.textContent = '🏆';
  else if (pct >= 70) trophy.textContent = '🥈';
  else if (pct >= 50) trophy.textContent = '💪';
  else trophy.textContent = '📚';

  document.getElementById('result-title').textContent =
    pct >= 80 ? 'Outstanding! 🎉' : pct >= 60 ? 'Solid work! 💪' : 'Block complete! 📚';

  document.getElementById('result-score-big').textContent = `${score} pts`;

  // v374: Show payout breakdown on results screen — no surprise penalties
  var _resPayout = _calcProjectedPayout();
  var _resNet = _resPayout.net;
  var _resPenalties = _resPayout.redPenalty + _resPayout.yellowPenalty;
  var _resEarned = _resPayout.base + _resPayout.greenBonus;
  var _payoutHtml = '';
  if (_resNet >= 0) {
    _payoutHtml = '<div style="margin-top:10px;font-size:14px;color:#10b981;font-weight:700;">💰 +$' + _resNet + ' earned</div>';
  } else {
    _payoutHtml = '<div style="margin-top:10px;font-size:14px;color:#fbbf24;font-weight:700;">💰 $' + _resEarned + ' base - $' + _resPenalties + ' time penalties = ' + (_resNet >= 0 ? '+' : '') + '$' + _resNet + '</div>';
  }
  if (_resPayout.greenBonus > 0) {
    _payoutHtml += '<div style="font-size:11px;color:#10b981;margin-top:2px;">⭐ Speed bonus: +$' + _resPayout.greenBonus + '</div>';
  }
  document.getElementById('result-breakdown').innerHTML =
    '✅ ' + correct + ' correct &nbsp;·&nbsp; ❌ ' + quizState.wrong + ' wrong<br/>Accuracy: ' + pct + '%' + _payoutHtml;

  // Show Generate next 10 button
  const genNext = document.getElementById('btnGenNext10');
  if (genNext) genNext.classList.remove('hidden');

  setTimeout(() => {
    document.getElementById('result-bar').style.width = pct + '%';
  }, 100);

  // v374: Double or Nothing — show bet option if net negative
  var _donWrap = document.getElementById('double-or-nothing-wrap');
  var _donDescEl = document.getElementById('don-desc');
  if (_donWrap) {
    if (_resNet < 0 && !_donActive) {
      var _donAmt = Math.abs(_resNet);
      _donWrap.classList.remove('hidden');
      _donDescEl.textContent = 'You\'re down $' + _donAmt + '. Finish the next block ALL green (FAST) to flip it to +$' + _donAmt + '. Any yellow or red = -$' + (_donAmt * 2) + ' total.';
    } else if (_donActive && !_donLost) {
      // Bet was active and they WON — show celebration
      _donWrap.classList.remove('hidden');
      _donWrap.style.borderColor = '#10b981';
      _donWrap.style.background = 'rgba(16,185,129,0.08)';
      document.querySelector('.don-label').textContent = '🎉 BET WON!';
      _donDescEl.textContent = 'All green! You earned +$' + _donStakes + ' — loss wiped and flipped to profit!';
      document.getElementById('btnDoubleOrNothing').style.display = 'none';
      // Apply winnings to Loom
      _sendToLoom({ type: 'CKRB_BLOCK_COMPLETED', totalQuestions: quizState.total, correctCount: quizState.correct, totalMs: Date.now() - _loomBlockStartTime, timestamp: Date.now() + 1, calculatedBonus: _donStakes * 2 });
      _donActive = false; _donStakes = 0;
      chrome.storage.local.remove(_DON_STORAGE_KEY);
    } else if (_donActive && _donLost) {
      // Bet was active and they LOST
      _donWrap.classList.remove('hidden');
      _donWrap.style.borderColor = '#ef4444';
      _donWrap.style.background = 'rgba(239,68,68,0.08)';
      document.querySelector('.don-label').textContent = '💀 BET LOST';
      _donDescEl.textContent = 'You went non-green. Double penalty: -$' + (_donStakes * 2) + ' total.';
      document.getElementById('btnDoubleOrNothing').style.display = 'none';
      // Apply double loss to Loom
      _sendToLoom({ type: 'CKRB_BLOCK_COMPLETED', totalQuestions: quizState.total, correctCount: quizState.correct, totalMs: Date.now() - _loomBlockStartTime, timestamp: Date.now() + 2, calculatedBonus: -_donStakes });
      _donActive = false; _donStakes = 0;
      chrome.storage.local.remove(_DON_STORAGE_KEY);
    } else {
      _donWrap.classList.add('hidden');
    }
  }
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
   UWORLD QBANK — SCRAPE & QUIZ
═══════════════════════════════════════════ */
document.getElementById('btnUworldQbank').addEventListener('click', async () => {
  // FIRST: capture current question number BEFORE abortAll() or anything else
  // that might cause UWorld to shift questions.
  let tabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
  let testTabs = tabs.filter(t => /testinterface/.test(t.url));
  if (!testTabs.length) {
    if (!tabs.length) {
      alert('No UWorld tab found. Open a UWorld question block first.');
      return;
    }
    testTabs = tabs;
  }
  const tab = testTabs[0];

  // v204: Ask user what question to start on — auto-detection was unreliable
  var userInput = prompt('What question number are you on? (e.g. 5)');
  if (!userInput || !userInput.trim()) return; // cancelled
  var preCapStart = parseInt(userInput.trim());
  if (isNaN(preCapStart) || preCapStart < 1) {
    alert('Please enter a valid question number (1 or higher).');
    return;
  }

  await abortAll();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['uworld_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Scraping UWorld questions…';
  document.getElementById('proc-sub').textContent = 'Navigating through each question in the block. Keep the UWorld tab open.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'UWORLD_QBANK_SCRAPE', preCapStart: preCapStart }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      alert('Could not scrape UWorld. Make sure you are on a UWorld test page with completed questions.');
      return;
    }
    // Refocus the UWorld tab so Angular click events work even when
    // the popup is a standalone window that would otherwise steal focus.
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    document.getElementById('proc-title').textContent = 'Scraping UWorld questions…';
    document.getElementById('proc-sub').textContent = 'Watch the UWorld tab — clicking through each question automatically.';
    document.getElementById('proc-count').textContent = 'Please wait…';
    pollProcessing();
  });
});

// Detect UWorld session on home screen
async function detectUworldSession() {
  const posEl = document.getElementById('uworld-qbank-position');
  if (!posEl) return;
  const tabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
  const testTabs = tabs.filter(t => /testinterface/.test(t.url));
  if (testTabs.length) {
    const title = testTabs[0].title || '';
    posEl.textContent = '✓ UWorld block: ' + title.slice(0, 45);
    posEl.style.color = '#fb923c';
  } else {
    posEl.textContent = '';
  }
}
detectUworldSession();

/* ── UWORLD SCAN 1 ── */
document.getElementById('btnUworldScan1').addEventListener('click', async () => {
  let tabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
  let testTabs = tabs.filter(t => /testinterface/.test(t.url));
  if (!testTabs.length) {
    document.getElementById('uworld-scan-status').textContent = '⚠ No UWorld test tab found';
    return;
  }
  const tab = testTabs[0];

  // v204: Ask user what question to start on
  var userInput = prompt('What question number are you on? (e.g. 5)');
  if (!userInput || !userInput.trim()) return;
  var preCapStart = parseInt(userInput.trim());
  if (isNaN(preCapStart) || preCapStart < 1) {
    alert('Please enter a valid question number (1 or higher).');
    return;
  }

  await abortAll();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['uworld_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  document.getElementById('uworld-scan-status').textContent = 'Scraping 1 question…';

  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (1 UWorld question)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scraping 1 question only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'UWORLD_QBANK_SCRAPE', count: 1, preCapStart: preCapStart }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      document.getElementById('uworld-scan-status').textContent = '⚠ Could not scrape. Check UWorld tab.';
      return;
    }
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    document.getElementById('uworld-scan-status').textContent = 'Scraping done, generating…';
    pollProcessing();
  });
});

/* ── UWORLD SCAN 5 ── */
document.getElementById('btnUworldScan5').addEventListener('click', async () => {
  let tabs = await chrome.tabs.query({ url: '*://apps.uworld.com/*' });
  let testTabs = tabs.filter(t => /testinterface/.test(t.url));
  if (!testTabs.length) {
    document.getElementById('uworld-scan-status').textContent = '⚠ No UWorld test tab found';
    return;
  }
  const tab = testTabs[0];

  // v204: Ask user what question to start on
  var userInput = prompt('What question number are you on? (e.g. 5)');
  if (!userInput || !userInput.trim()) return;
  var preCapStart = parseInt(userInput.trim());
  if (isNaN(preCapStart) || preCapStart < 1) {
    alert('Please enter a valid question number (1 or higher).');
    return;
  }

  await abortAll();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['uworld_qbank.js'] });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));

  document.getElementById('uworld-scan-status').textContent = 'Scraping 5 questions…';

  showScreen('screen-processing');
  document.getElementById('proc-title').textContent = 'Test scan (5 UWorld questions)…';
  document.getElementById('proc-sub').textContent = 'Quick test — scraping 5 questions only.';
  document.getElementById('proc-count').textContent = 'Scraping…';
  const _ph = document.getElementById('proc-phase');
  if (_ph) _ph.textContent = 'PHASE 1 OF 2 — SCRAPING';

  chrome.tabs.sendMessage(tab.id, { type: 'UWORLD_QBANK_SCRAPE', count: 5, preCapStart: preCapStart }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showScreen('screen-home');
      document.getElementById('uworld-scan-status').textContent = '⚠ Could not scrape. Check UWorld tab.';
      return;
    }
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    document.getElementById('uworld-scan-status').textContent = 'Scraping done, generating…';
    pollProcessing();
  });
});


/* ═══════════════════════════════════════════
   TODO OF THE LOOM — CROSS-EXTENSION BRIDGE (v320)
   Sends quiz activity messages to Todo of the Loom extension
   for idle penalties and block completion bonuses.
═══════════════════════════════════════════ */
var _LOOM_EXT_ID = 'ibobbkieoghidmojbdecjjdclfdiecae';
var _loomBlockStartTime = 0;
var _loomLastAnswerTime = 0;
var _loomIdleChecker = null;
var _loomIdleThresholdMs = 120000; // 2 minutes — matches Loom's penalty escalation
var _loomBlockSite = 'unknown';

function _sendToLoom(data) {
  console.log('[CK Buddy → Loom] Sending:', data.type, JSON.stringify(data));
  try {
    chrome.runtime.sendMessage(_LOOM_EXT_ID, data, function(response) {
      if (chrome.runtime.lastError) {
        console.warn('[CK Buddy → Loom] Error:', chrome.runtime.lastError.message);
      } else {
        console.log('[CK Buddy → Loom] Response:', JSON.stringify(response));
      }
    });
  } catch(e) { console.warn('[CK Buddy → Loom] Exception:', e.message); }
}

function _startLoomIdleChecker() {
  _stopLoomIdleChecker();
  _loomLastAnswerTime = Date.now();
  _loomIdleChecker = setInterval(function() {
    var idleMs = Date.now() - _loomLastAnswerTime;
    if (idleMs > _loomIdleThresholdMs) {
      _sendToLoom({
        type: 'CKRB_IDLE_WARNING',
        idleMs: idleMs,
        questionIndex: quizState.currentIndex + 1,
        lastAnswerAt: _loomLastAnswerTime,
        timestamp: Date.now()
      });
    }
  }, 45000); // check every 45 seconds
}

function _stopLoomIdleChecker() {
  if (_loomIdleChecker) { clearInterval(_loomIdleChecker); _loomIdleChecker = null; }
}

function _loomDetectSite(questions) {
  // Detect site from the first question's source field
  if (!questions || !questions.length) return 'unknown';
  var src = '';
  if (questions[0].parentQ) src = (questions[0].parentQ.source || '').toLowerCase();
  else src = (questions[0].source || '').toLowerCase();
  if (src.indexOf('amboss') >= 0) return 'amboss';
  if (src.indexOf('nbme') >= 0) return 'nbme';
  if (src.indexOf('uworld') >= 0) return 'uworld';
  return src || 'unknown';
}

// v322: Ping Todo of the Loom and update ALL indicators (home banner + dot indicators)
function _pingLoom() {
  var statusEl = document.getElementById('loom-status');
  var dots = document.querySelectorAll('.loom-dot');
  try {
    chrome.runtime.sendMessage(_LOOM_EXT_ID, { type: 'CKRB_PING' }, function(response) {
      if (chrome.runtime.lastError || !response) {
        // Not installed / disabled
        if (statusEl) { statusEl.textContent = 'Loom: not detected'; statusEl.style.color = '#64748b'; statusEl.style.background = '#1e293b'; statusEl.title = 'Todo of the Loom extension is not installed or disabled'; }
        dots.forEach(function(d) { d.className = 'loom-dot loom-unknown'; d.title = 'Loom: not detected'; });
      } else if (response.ok && response.enabled) {
        // Bridge active
        if (statusEl) { statusEl.textContent = 'Loom: connected \u2713'; statusEl.style.color = '#34d399'; statusEl.style.background = 'rgba(16,185,129,0.1)'; statusEl.title = 'Bridge active (v' + (response.version || '?') + ')'; }
        dots.forEach(function(d) { d.className = 'loom-dot loom-on'; d.title = 'Loom bridge ON \u2014 idle penalties active'; });
      } else {
        // Installed but toggle OFF
        if (statusEl) { statusEl.textContent = 'Loom: bridge disabled'; statusEl.style.color = '#fbbf24'; statusEl.style.background = 'rgba(251,191,36,0.1)'; statusEl.title = 'CK Buddy bridge toggle is OFF in Loom Settings'; }
        dots.forEach(function(d) { d.className = 'loom-dot loom-off'; d.title = 'Loom bridge OFF \u2014 toggle it on in Loom Settings'; });
      }
    });
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Loom: not detected'; statusEl.style.color = '#64748b'; statusEl.style.background = '#1e293b'; }
    dots.forEach(function(d) { d.className = 'loom-dot loom-unknown'; d.title = 'Loom: not detected'; });
  }
}

// Ping on load + poll every 10 seconds for real-time toggle detection
_pingLoom();
setInterval(_pingLoom, 10000);


// v332: Inject highlight directly into qbank page via chrome.scripting.executeScript
// v360: Generation counter — increments on each new question, stops stale retry loops
var _hlGeneration = 0;

function _clearWrongChoiceHighlights() {
  _hlGeneration++; // Invalidates any running retry loops
  var qbankUrls = ['uworld.com', 'amboss.com', 'starttest.com', 'nbme.org'];
  chrome.tabs.query({}, function(allTabs) {
    var targets = allTabs.filter(function(t) { return t.url && qbankUrls.some(function(u) { return t.url.includes(u); }); });
    targets.forEach(function(t) {
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        world: 'MAIN',
        func: function() {
          document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) { el.classList.remove('ckrb-wrong-para-hl'); });
          // Clear any running retry intervals by setting a kill flag
          window._ckrbHlKill = true;
        }
      }).catch(function() {});
      // v366: Also notify content script (runs in all frames natively)
      chrome.tabs.sendMessage(t.id, { type: 'CLEAR_WRONG_HIGHLIGHTS' }).catch(function() {});
    });
  });
}

function _highlightWrongChoiceOnPage(letter) {
  console.log('[HL_DEBUG] Step 6: _highlightWrongChoiceOnPage called with letter="' + letter + '"');
  var qbankUrls = ['uworld.com', 'amboss.com', 'starttest.com', 'nbme.org'];
  chrome.tabs.query({}, function(allTabs) {
    console.log('[HL_DEBUG] Step 7: chrome.tabs.query returned ' + allTabs.length + ' total tabs');
    // Log ALL tab URLs for debugging
    for (var _ti = 0; _ti < allTabs.length; _ti++) {
      console.log('[HL_DEBUG] Step 7b: Tab ' + _ti + ': id=' + allTabs[_ti].id + ' url=' + (allTabs[_ti].url || 'NO_URL').substring(0, 80));
    }
    var targets = allTabs.filter(function(t) { return t.url && qbankUrls.some(function(u) { return t.url.includes(u); }); });
    console.log('[HL_DEBUG] Step 8: Found ' + targets.length + ' qbank tab(s) matching URLs');
    if (targets.length === 0) {
      console.error('[HL_DEBUG] ⛔ Step 8 FAILED — no qbank tabs found! Check tab permissions.');
      // Try querying with specific URL patterns as fallback
      chrome.tabs.query({ url: '*://*.uworld.com/*' }, function(uwTabs) {
        console.log('[HL_DEBUG] Step 8b: Fallback uworld query found ' + (uwTabs ? uwTabs.length : 0) + ' tabs');
      });
    }
    targets.forEach(function(t) {
      // v391: Reset _ckrbHlKill in ALL frames BEFORE highlight injection
      console.log('[HL_DEBUG] Step 9: Resetting _ckrbHlKill on tab ' + t.id + ' (' + (t.url || '').substring(0, 50) + ')');
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        world: 'MAIN',
        func: function() { window._ckrbHlKill = false; }
      }).then(function() {
        console.log('[HL_DEBUG] Step 9b: _ckrbHlKill reset SUCCESS on tab ' + t.id);
      }).catch(function(e) {
        console.error('[HL_DEBUG] ⛔ Step 9 FAILED: _ckrbHlKill reset error:', e.message);
      });
      // v366: Also send message to content script as fallback (content.js runs in all frames)
      chrome.tabs.sendMessage(t.id, { type: 'HIGHLIGHT_WRONG_CHOICE', letter: letter }).catch(function() {});
      console.log('[HL_DEBUG] Step 10: Injecting highlight script for letter "' + letter + '" into tab ' + t.id);
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        world: 'MAIN',
        func: function(theLetter) {
          console.log('[HL_DEBUG] Step 11: Highlight script EXECUTING in frame: ' + window.location.href.substring(0, 60) + ' for letter ' + theLetter);
          // Inject CSS if not already there
          if (!document.getElementById('ckrb-para-hl-css')) {
            var s = document.createElement('style');
            s.id = 'ckrb-para-hl-css';
            s.textContent =
              '@keyframes ckrb-para-pulse {' +
              '  0%, 100% { background: rgba(249,115,22,0.08); border-left-color: rgba(249,115,22,0.6); }' +
              '  50% { background: rgba(249,115,22,0.18); border-left-color: rgba(249,115,22,1); }' +
              '}' +
              '.ckrb-wrong-para-hl {' +
              '  background: rgba(249,115,22,0.12) !important;' +
              '  border-left: 4px solid #f97316 !important;' +
              '  border-radius: 6px !important;' +
              '  padding: 8px 12px !important;' +
              '  margin: 4px 0 !important;' +
              '  animation: ckrb-para-pulse 2s ease-in-out infinite !important;' +
              '  scroll-margin-top: 120px !important;' +
              '}' +
              '';
            (document.head || document.documentElement).appendChild(s);
          }
          function doHL(ltr, att) {
            document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) { el.classList.remove('ckrb-wrong-para-hl'); });
            // v372: Find the EXPLANATION section first, then search only within it
            // UWorld explanation sections have landmarks we can use
            var explanationRoot = null;
            // Strategy 1: Look for "Educational objective" text and use its container
            var allElements = document.querySelectorAll('div, section, article, td, p, span, h1, h2, h3, h4, h5, h6, strong, b');
            for (var ei = 0; ei < allElements.length; ei++) {
              var elText = (allElements[ei].textContent || '').trim().substring(0, 50).toLowerCase();
              if (elText.indexOf('educational objective') === 0 ||
                  elText.indexOf('explanation') === 0 ||
                  elText.indexOf('bottom line') === 0 ||
                  elText.indexOf('learning objective') === 0) {
                // Found the explanation landmark — use its parent as search root
                explanationRoot = allElements[ei].parentElement || allElements[ei];
                // Walk up a couple levels to get the full explanation container
                for (var _up = 0; _up < 3 && explanationRoot.parentElement && explanationRoot.parentElement !== document.body; _up++) {
                  if ((explanationRoot.textContent || '').length > 500) break;
                  explanationRoot = explanationRoot.parentElement;
                }
                console.log('[CK Buddy] Found explanation root via landmark: ' + explanationRoot.tagName + ' (' + (explanationRoot.textContent||'').length + ' chars)');
                break;
              }
            }
            // Strategy 2: If no landmark, use the LOWER HALF of the page
            // The explanation is always below the question stem + choices
            var searchRoot = explanationRoot || document.body;
            // Now search within the explanation area
            var patterns = [
              new RegExp('\\(Choices?\\s[^)]*\\b' + ltr + '\\b', 'i'),
              new RegExp('\\(\\s*' + ltr + '\\s*\\)', 'i'),
              new RegExp('\\bChoice\\s+' + ltr + '\\b', 'i'),
              new RegExp('\\b' + ltr + '\\b[^a-z]*(?:is\\s+(?:in)?correct|wrong|right)', 'i')
            ];
            var bestBlock = null;
            var bestScore = -999;
            var walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, null, false);
            var node;
            while (node = walker.nextNode()) {
              var tag = node.parentElement ? node.parentElement.tagName : '';
              if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
              for (var _pi = 0; _pi < patterns.length; _pi++) {
                if (patterns[_pi].test(node.textContent)) {
                  var block = node.parentElement;
                  while (block && block !== document.body) {
                    var d = window.getComputedStyle(block).display;
                    if (d === 'block' || d === 'list-item' || d === 'table-cell' || d === 'flex') break;
                    block = block.parentElement;
                  }
                  if (block && block !== document.body && block.offsetParent !== null) {
                    var txt = (block.textContent || '').trim();
                    // Score: prefer longer paragraphs (explanation text), penalize short answer-choice-like blocks
                    var sc = (3 - _pi) * 2; // higher for earlier (more specific) patterns
                    if (txt.length > 200) sc += 10;
                    else if (txt.length > 80) sc += 5;
                    else if (txt.length < 40) sc -= 15;
                    // Heavy penalty for answer-choice format
                    if (/^\s*[A-G][.)\s]/.test(txt) && txt.length < 150) sc -= 30;
                    if (sc > bestScore) { bestScore = sc; bestBlock = block; }
                  }
                  break;
                }
              }
            }
            if (!bestBlock) {
              console.log('[CK Buddy] No highlight candidate found for Choice ' + ltr + ' (attempt ' + att + ', searchRoot=' + (explanationRoot ? 'explanation' : 'body') + ')');
              return false;
            }
            bestBlock.classList.add('ckrb-wrong-para-hl');
            // v398: No auto-scroll — user clicks 'Go to highlight' button instead
            console.log('[CK Buddy] Highlighted Choice ' + ltr + ' score=' + bestScore + ' len=' + (bestBlock.textContent||'').length + ' (attempt ' + att + ')');
            return true;
          }
          // v388: Retry every 5s for up to 60 attempts (5 minutes) — some pages load slowly
          // Also watch for DOM changes that wipe the highlight (UWorld SPA re-renders)
          window._ckrbHlKill = false; // Reset kill flag for this new highlight
          var _hlApplied = doHL(theLetter, 1);
          var _hlRetries = 0;
          var _hlIv = setInterval(function() {
            // v360: Stop if a new question cleared highlights
            if (window._ckrbHlKill) { clearInterval(_hlIv); clearInterval(_hlVisIv); return; }
            _hlRetries++;
            // Re-check if highlight was wiped by SPA re-render (only if still visible)
            var _vis = document.querySelectorAll('.ckrb-wrong-para-hl');
            var _anyVisible = false;
            _vis.forEach(function(el) { if (el.offsetParent !== null) _anyVisible = true; });
            if (_vis.length === 0) _hlApplied = false;
            else if (!_anyVisible) {
              // All highlighted elements are hidden (inside closed popup) — don't re-apply
              _hlApplied = true; // prevent re-apply; visibility watcher will clean up
            }
            if (!_hlApplied) {
              _hlApplied = doHL(theLetter, _hlRetries + 1);
            }
            if (_hlRetries >= 60) clearInterval(_hlIv);
          }, 5000);
          // v361: Visibility watcher — cleans up highlights inside hidden UWorld popup panels
          var _hlVisIv = setInterval(function() {
            if (window._ckrbHlKill) { clearInterval(_hlVisIv); return; }
            var _hls = document.querySelectorAll('.ckrb-wrong-para-hl');
            _hls.forEach(function(el) {
              // offsetParent is null when element or any ancestor has display:none
              if (el.offsetParent === null) {
                el.classList.remove('ckrb-wrong-para-hl');
                console.log('[CK Buddy] Removed stale highlight from hidden popup panel');
              }
            });
          }, 2000);
        },
        args: [letter]
      }).then(function(results) {
        console.log('[HL_DEBUG] Step 12: executeScript completed, ' + (results ? results.length : 0) + ' frame results');
      }).catch(function(e) { console.error('[HL_DEBUG] ⛔ Step 12 FAILED: executeScript error:', e.message); });
    });
  });
}

/* ─── PER-QUESTION COUNTDOWN TIMER (v336) ─── */
var _qTimerInterval = null;
var _qTimerStart = 0;
var _qTimerFastSec = 135;
var _qTimerOkSec = 195;
var _moreTimeUsed = 0;   // v368: count of +15s presses this block (max 4)
var _MORE_TIME_MAX = 4;
var _MORE_TIME_ADD = 300;  // seconds added per press
var _alwaysHlCheckInterval = null; // v414: module-scope so cleanup can kill it

// v374: Double or Nothing bet
var _donActive = false;    // bet is live for current block
var _donStakes = 0;        // positive number — amount at risk
var _donLost = false;      // set true on first non-green answer
var _DON_STORAGE_KEY = 'ckrb_double_or_nothing';

// v336: Per-question stats + reward feed
var _qStats = {
  totalQs: 0,
  fastQs: 0,       // <45s
  okQs: 0,          // 45-90s
  slowQs: 0,        // >90s
  idlePenalties: 0,
  idleCost: 0,
  totalTimeSec: 0,
  feedItems: [],     // {qNum, sec, tier, correct}
  reset: function() { this.totalQs = 0; this.fastQs = 0; this.okQs = 0; this.slowQs = 0; this.idlePenalties = 0; this.idleCost = 0; this.totalTimeSec = 0; this.feedItems = []; }
};

// v347: Save/restore _qStats across popup reloads
function _saveQStats() {
  chrome.storage.local.set({ ckrb_qstats: {
    totalQs: _qStats.totalQs, fastQs: _qStats.fastQs, okQs: _qStats.okQs,
    slowQs: _qStats.slowQs, idlePenalties: _qStats.idlePenalties,
    idleCost: _qStats.idleCost, totalTimeSec: _qStats.totalTimeSec,
    feedItems: _qStats.feedItems, savedAt: Date.now()
  }});
}
function _restoreQStats(saved) {
  if (!saved) return;
  _qStats.totalQs = saved.totalQs || 0;
  _qStats.fastQs = saved.fastQs || 0;
  _qStats.okQs = saved.okQs || 0;
  _qStats.slowQs = saved.slowQs || 0;
  _qStats.idlePenalties = saved.idlePenalties || 0;
  _qStats.idleCost = saved.idleCost || 0;
  _qStats.totalTimeSec = saved.totalTimeSec || 0;
  _qStats.feedItems = saved.feedItems || [];
}

// v336: Record a question result into the feed
var CKRB_RED_PENALTY = 25;        // $25 per red question
var CKRB_YELLOW_THRESHOLD = 5;    // first 5 yellows are free
var CKRB_YELLOW_PENALTY = 10;     // $10 per yellow beyond threshold
var CKRB_GREEN_BONUS_MAX_NON = 2; // ≤2 non-green = bonus
var CKRB_GREEN_BONUS = 50;        // $50 bonus for near-perfect speed

// v341: Calculate projected block payout with penalty system
function _calcProjectedPayout() {
  // v369: Recalculate all stats from feed items using their stored thresholds
  var _rFast = 0, _rOk = 0, _rSlow = 0, _rYellowSeq = 0;
  for (var _ri = 0; _ri < _qStats.feedItems.length; _ri++) {
    var _rfi = _qStats.feedItems[_ri];
    var _rFS = _rfi.fastSec || 135;
    var _rOS = _rfi.okSec || 195;
    var _rT = _rfi.sec < _rFS ? 'fast' : (_rfi.sec < _rOS ? 'ok' : 'slow');
    if (_rT === 'fast') _rFast++;
    else if (_rT === 'ok') { _rOk++; _rYellowSeq++; }
    else _rSlow++;
  }
  var base = 100;
  var redPenalty = _rSlow * CKRB_RED_PENALTY;
  var excessYellows = Math.max(0, _rOk - CKRB_YELLOW_THRESHOLD);
  var yellowPenalty = excessYellows * CKRB_YELLOW_PENALTY;
  var nonGreen = _rOk + _rSlow;
  var greenBonus = (_qStats.feedItems.length >= 3 && nonGreen <= CKRB_GREEN_BONUS_MAX_NON) ? CKRB_GREEN_BONUS : 0;
  var net = base - redPenalty - yellowPenalty + greenBonus;
  return { base: base, redPenalty: redPenalty, yellowPenalty: yellowPenalty, greenBonus: greenBonus, net: net, fastQs: _rFast, okQs: _rOk, slowQs: _rSlow };
}

// v355: Generate feed label like "Q6" or "Q6a"/"Q6b"/"Q6c" for multi-part questions
function _getFeedSubLabel(queue, idx) {
  if (!queue || !queue[idx]) return String(idx + 1);
  var parentQ = queue[idx].parentQ;
  var parentNum = parentQ.absoluteId || (parentQ.id + 1);
  // Count how many trivia items share this parent
  var count = 0;
  var myOffset = 0;
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].parentQ.id === parentQ.id) {
      if (i < idx) myOffset++;
      if (i === idx) myOffset = count;
      count++;
    }
  }
  if (count <= 1) return String(parentNum); // single-part: just "6"
  // Multi-part: "6a", "6b", "6c"
  var letter = String.fromCharCode(97 + myOffset); // a, b, c...
  return String(parentNum) + letter;
}

function _recordQFeedItem(qNum, correct, feedProjId, feedItemsId) {
  if (_qTimerStart <= 0) return;
  // v344: Skip if this exact question already has a feed entry (re-visit via tile map)
  for (var _di = 0; _di < _qStats.feedItems.length; _di++) {
    if (_qStats.feedItems[_di].qNum === qNum) return;
  }
  var sec = Math.floor((Date.now() - _qTimerStart) / 1000);
  var tier = sec < _qTimerFastSec ? 'fast' : (sec < _qTimerOkSec ? 'ok' : 'slow');
  // v378: Diagnostic logging — also check for visual/feed tier mismatch
  var _vizExt = window._ckrbTimerExtendSec || 0;
  console.log('[CK Buddy] FEED RECORD Q' + qNum + ': sec=' + sec + ' tier=' + tier +
    ' thresholds=' + _qTimerFastSec + '/' + _qTimerOkSec +
    ' ext=' + _vizExt + ' _qTimerStart=' + _qTimerStart);
  if (_vizExt > 0 && tier === 'fast') {
    console.warn('[CK Buddy] ⚠️ +90s was used — extended thresholds: ' + _qTimerFastSec + '/' + _qTimerOkSec + ' (base + ' + _vizExt + 's extension)');
  }
  // v341: Per-question penalties sent to Loom
  var penalty = 0;
  if (tier === 'slow') {
    penalty = CKRB_RED_PENALTY;
    console.log('[CK Buddy] Red zone penalty: -$' + penalty + ' for Q' + qNum + ' (' + sec + 's)');
  } else if (tier === 'ok') {
    // v369: Count yellows from feed items using stored thresholds
    var yellowsSoFar = 0;
    for (var _yc = 0; _yc < _qStats.feedItems.length; _yc++) {
      var _ycf = _qStats.feedItems[_yc];
      if (_ycf.sec >= (_ycf.fastSec || 135) && _ycf.sec < (_ycf.okSec || 195)) yellowsSoFar++;
    }
    if (yellowsSoFar >= CKRB_YELLOW_THRESHOLD) {
      penalty = CKRB_YELLOW_PENALTY;
      console.log('[CK Buddy] Yellow overflow penalty: -$' + penalty + ' for Q' + qNum + ' (yellow #' + (yellowsSoFar + 1) + ')');
    }
  }
  if (penalty > 0) {
    _qStats.idlePenalties++;
    _qStats.idleCost += penalty;
  }
  var proj = _calcProjectedPayout();
  _qStats.feedItems.push({ qNum: qNum, sec: sec, tier: tier, correct: correct, projNet: proj.net, penalty: penalty, greenBonus: proj.greenBonus > 0, fastSec: _qTimerFastSec, okSec: _qTimerOkSec });
  // v374: Double or Nothing — any non-green answer loses the bet
  if (_donActive && !_donLost && tier !== 'fast') {
    _donLost = true;
    chrome.storage.local.set({ [_DON_STORAGE_KEY]: { stakes: _donStakes, active: true, lost: true } });
    console.log('[CK Buddy] Double or Nothing LOST on Q' + qNum + ' (' + tier + ' at ' + sec + 's)');
    // Flash a warning
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(); var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 200; o.type = 'sawtooth'; g.gain.value = 0.08;
      o.start(); o.stop(ctx.currentTime + 0.3);
    } catch(_) {}
  }
  _updateRewardFeed(feedProjId, feedItemsId);
  _saveQStats(); // v347: persist feed across reloads
}
// v339: Update the reward feed UI — shows last 3, expandable
var _feedExpanded = {};  // keyed by feedItemsId
function _updateRewardFeed(feedProjId, feedItemsId) {
  var _fProjId = feedProjId || 'reward-feed-proj';
  var _fItemsId = feedItemsId || 'reward-feed-items';
  var projEl = document.getElementById(_fProjId);
  var itemsEl = document.getElementById(_fItemsId);
  if (!projEl || !itemsEl) return;
  // Calculate projected payout using penalty system
  var _proj = _calcProjectedPayout();
  var net = _proj.net;
  if (net >= 0) {
    projEl.textContent = '+$' + net + ' projected';
    projEl.className = 'reward-feed-proj';
  } else {
    projEl.textContent = '-$' + Math.abs(net) + ' projected';
    projEl.className = 'reward-feed-proj penalty';
  }
  // Tooltip on projected header
  var _pBreakdown = 'Base: $100';
  if (_proj.redPenalty > 0) _pBreakdown += '\nRed penalties (' + _proj.slowQs + 'x): -$' + _proj.redPenalty;
  var _exY = Math.max(0, _proj.okQs - CKRB_YELLOW_THRESHOLD);
  if (_exY > 0) _pBreakdown += '\nYellow penalties (' + _exY + 'x over ' + CKRB_YELLOW_THRESHOLD + ' free): -$' + _proj.yellowPenalty;
  else if (_proj.okQs > 0) _pBreakdown += '\nYellows: ' + _proj.okQs + '/' + CKRB_YELLOW_THRESHOLD + ' free used';
  if (_proj.greenBonus > 0) _pBreakdown += '\n\u2b50 Speed bonus (\u22642 non-green): +$' + CKRB_GREEN_BONUS;
  _pBreakdown += '\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nProjected payout: ' + (net >= 0 ? '+$' : '-$') + Math.abs(net);
  projEl.title = _pBreakdown;
  // Also update header border color to reflect net
  var wrapEl = projEl.parentElement;
  if (wrapEl) {
    wrapEl.style.borderColor = net > 0 ? 'rgba(16,185,129,0.2)' : (net < 0 ? 'rgba(239,68,68,0.3)' : 'rgba(71,85,105,0.2)');
    wrapEl.style.background = net > 0 ? 'rgba(16,185,129,0.08)' : (net < 0 ? 'rgba(239,68,68,0.08)' : 'rgba(71,85,105,0.08)');
  }
  // Build feed items — show last 3 unless expanded
  var items = _qStats.feedItems;
  var isExpanded = !!_feedExpanded[_fItemsId];
  var showCount = isExpanded ? items.length : 3;
  var startIdx = isExpanded ? 0 : Math.max(0, items.length - 3);
  var html = '';
  // Show expand/collapse if more than 3 items
  if (items.length > 3) {
    var hiddenCount = items.length - 3;
    if (isExpanded) {
      html += '<div class="reward-feed-expand" data-feed-toggle="' + _fItemsId + '" title="Click to show only last 3">▲ collapse</div>';
    } else {
      html += '<div class="reward-feed-expand" data-feed-toggle="' + _fItemsId + '" title="Click to show all ' + items.length + ' questions">▼ ' + hiddenCount + ' more</div>';
    }
  }
  for (var i = startIdx; i < items.length; i++) {
    var fi = items[i];
    // v369: Recalculate tier from stored seconds + thresholds
    var _fiFS = fi.fastSec || 135;
    var _fiOS = fi.okSec || 195;
    var _fiTier = fi.sec < _fiFS ? 'fast' : (fi.sec < _fiOS ? 'ok' : 'slow');
    var tierClass = _fiTier === 'fast' ? 'fast' : (_fiTier === 'ok' ? 'ok' : 'slow');
    var tierTag = _fiTier === 'fast' ? 'FAST' : (_fiTier === 'ok' ? 'OK' : 'SLOW');
    var projLabel = fi.projNet >= 0 ? '\u2192 $' + fi.projNet : '\u2192 -$' + Math.abs(fi.projNet);
    var icon = fi.correct ? '\u2713' : '\u2717';
    var penaltyTag = fi.penalty > 0 ? ' -$' + fi.penalty : '';
    var _itemTip = 'Q' + fi.qNum + ': answered in ' + fi.sec + 's (' + tierTag + ')';
    if (fi.penalty > 0) _itemTip += '\nPenalty: -$' + fi.penalty;
    if (fi.greenBonus) _itemTip += '\n\u2b50 Speed bonus active!';
    _itemTip += '\nProjected total after this Q: ' + (fi.projNet >= 0 ? '$' : '-$') + Math.abs(fi.projNet);
    html += '<div class="reward-feed-item ' + tierClass + '" title="' + _itemTip.replace(/"/g, '&quot;') + '">' +
      '<span>Q' + fi.qNum + ': ' + fi.sec + 's ' + icon + ' ' + tierTag + penaltyTag + '</span>' +
      '<span>' + projLabel + '</span></div>';
  }
  // v355: Show per-question penalty breakdown instead of generic summary
  var _penaltyParts = [];
  for (var _pi = 0; _pi < items.length; _pi++) {
    var _pfi = items[_pi];
    var _pFS = _pfi.fastSec || 135;
    var _pOS = _pfi.okSec || 195;
    var _pTier = _pfi.sec < _pFS ? 'fast' : (_pfi.sec < _pOS ? 'ok' : 'slow');
    var _pPen = 0;
    if (_pTier === 'slow') _pPen = CKRB_RED_PENALTY;
    // Note: yellow penalty depends on count, handled in _calcProjectedPayout
    if (_pPen > 0 || _pfi.penalty > 0) _penaltyParts.push('Q' + _pfi.qNum + ' (-$' + (_pPen || _pfi.penalty) + ')');
  }
  if (_penaltyParts.length > 0) {
    html += '<div class="reward-feed-item penalty"><span>Penalties: ' + _penaltyParts.join(', ') + '</span><span>-$' + _qStats.idleCost + '</span></div>';
  }
  itemsEl.innerHTML = html;
}
// Delegated click handler for feed expand/collapse toggle
document.addEventListener('click', function(e) {
  var toggle = e.target.closest('[data-feed-toggle]');
  if (!toggle) return;
  var fid = toggle.getAttribute('data-feed-toggle');
  _feedExpanded[fid] = !_feedExpanded[fid];
  _updateRewardFeed(null, fid);
});

function _startQTimer(elId, isMultiPart) {
  // v336: Record previous question's elapsed time into stats
  if (_qTimerStart > 0) {
    var prevSec = Math.floor((Date.now() - _qTimerStart) / 1000);
    _qStats.totalQs++;
    _qStats.totalTimeSec += prevSec;
    if (prevSec < _qTimerFastSec) _qStats.fastQs++;
    else if (prevSec < _qTimerOkSec) _qStats.okQs++;
    else _qStats.slowQs++;
  }
  _stopQTimer();
  _qTimerStart = Date.now();
  window._ckrbTimerExtendSec = 0; // v368: Reset per-question extension from More Time
  _loomIdleThresholdMs = 120000; // v370: Reset Loom idle threshold for new question
  // v364: Set thresholds BEFORE the !el guard so feed recording always has correct values
  // v378: Balanced thresholds — 45/105 deep, 30/75 non-deep
  var fastSec = isMultiPart ? 135 : 135;
  var okSec = isMultiPart ? 195 : 180;
  _qTimerFastSec = fastSec;
  _qTimerOkSec = okSec;
  console.log('[CK Buddy] TIMER START: fastSec=' + fastSec + ' okSec=' + okSec + ' isDeep=' + !!isMultiPart + ' _qTimerStart=' + _qTimerStart);
  // v374: Show Double or Nothing status badge near timer
  var _donBadge = document.getElementById('don-live-badge');
  if (!_donBadge && _donActive) {
    _donBadge = document.createElement('span');
    _donBadge.id = 'don-live-badge';
    var timerParent = el ? el.parentNode : null;
    if (timerParent) timerParent.appendChild(_donBadge);
  }
  if (_donBadge) {
    if (_donActive && !_donLost) {
      _donBadge.className = 'don-status active';
      _donBadge.textContent = '🎲 $' + _donStakes;
      _donBadge.title = 'Double or Nothing active! Stay green to win $' + _donStakes;
    } else if (_donActive && _donLost) {
      _donBadge.className = 'don-status lost';
      _donBadge.textContent = '💀 -$' + (_donStakes * 2);
      _donBadge.title = 'Bet lost — went non-green';
    } else {
      _donBadge.style.display = 'none';
    }
  }
  var el = document.getElementById(elId || 'q-timer');
  if (!el) return;
  var _stage2Fired = false;
  var _deadFired = false;
  var _lastTickSec = -1; // v336b: track last tick sound to fire once per second
  el.textContent = (fastSec >= 60 ? Math.floor(fastSec/60) + ':' + (fastSec%60 < 10 ? '0' : '') + (fastSec%60) : '0:' + (fastSec < 10 ? '0' : '') + fastSec);
  el.className = 'q-timer';
  el.title = 'Countdown timer — answer within ' + fastSec + 's for FAST bonus, within ' + okSec + 's for OK. After ' + okSec + 's = SLOW + penalties. Use +5min button for more time.';
  // Determine feed element IDs based on which screen
  var isAmboss = (elId === 'amboss-q-timer');
  var feedProjId = isAmboss ? 'amboss-reward-feed-proj' : 'reward-feed-proj';
  var feedItemsId = isAmboss ? 'amboss-reward-feed-items' : 'reward-feed-items';
  _qTimerInterval = setInterval(function() {
    var elapsed = Math.floor((Date.now() - _qTimerStart) / 1000);
    // v368: Read dynamic extension from More Time button
    var _ext = window._ckrbTimerExtendSec || 0;
    var _fastSecLive = fastSec + _ext;
    var _okSecLive = okSec + _ext;
    var remaining, stageLabel;
    // v367: Live debug badge — shows raw elapsed + thresholds
    var _dbgBadge = document.getElementById('q-timer-debug');
    if (!_dbgBadge) {
      _dbgBadge = document.createElement('span');
      _dbgBadge.id = 'q-timer-debug';
      _dbgBadge.style.cssText = 'font-size:9px;color:#64748b;margin-left:6px;font-family:monospace;';
      if (el.parentNode) el.parentNode.appendChild(_dbgBadge);
    }
    var _dbgVisualTier = elapsed < _fastSecLive ? 'G' : (elapsed < _okSecLive ? 'Y' : 'R');
    var _dbgFeedTier = elapsed < _qTimerFastSec ? 'G' : (elapsed < _qTimerOkSec ? 'Y' : 'R');
    _dbgBadge.textContent = '[' + elapsed + 's v:' + _dbgVisualTier + ' f:' + _dbgFeedTier + ' ' + _qTimerFastSec + '/' + _qTimerOkSec + ']';
    // Highlight MISMATCH in red
    if (_dbgVisualTier !== _dbgFeedTier) {
      _dbgBadge.style.color = '#ef4444';
      _dbgBadge.style.fontWeight = 'bold';
      console.warn('[CK Buddy DEBUG] ⚠️ TIER MISMATCH! visual=' + _dbgVisualTier + ' feed=' + _dbgFeedTier + ' elapsed=' + elapsed + ' visual_fast=' + fastSec + ' feed_fast=' + _qTimerFastSec + ' visual_ok=' + okSec + ' feed_ok=' + _qTimerOkSec);
    } else {
      _dbgBadge.style.color = '#64748b';
      _dbgBadge.style.fontWeight = 'normal';
    }
    if (elapsed < _fastSecLive) {
      // Stage 1: counting down to 0 (green = FAST zone)
      remaining = _fastSecLive - elapsed;
      el.className = 'q-timer';
      stageLabel = '';
      // v387: Countdown ticks for last 10 seconds of green (before yellow)
      if (remaining <= 10 && remaining > 0 && remaining !== _lastTickSec) {
        _lastTickSec = remaining;
        try {
          var _gCtx = new (window.AudioContext || window.webkitAudioContext)();
          var _gOsc = _gCtx.createOscillator(); var _gG = _gCtx.createGain();
          _gOsc.connect(_gG); _gG.connect(_gCtx.destination);
          _gOsc.frequency.value = 600 + (10 - remaining) * 30;
          _gOsc.type = remaining <= 3 ? 'triangle' : 'sine';
          _gG.gain.value = remaining <= 3 ? 0.08 : 0.04;
          _gOsc.start(); _gOsc.stop(_gCtx.currentTime + 0.06);
        } catch(_) {}
      }
      // v387: 30-second interval beep to track time while reviewing
      if (elapsed > 0 && elapsed % 30 === 0 && elapsed !== _lastTickSec * -1) {
        try {
          var _bCtx = new (window.AudioContext || window.webkitAudioContext)();
          var _bOsc = _bCtx.createOscillator(); var _bG = _bCtx.createGain();
          _bOsc.connect(_bG); _bG.connect(_bCtx.destination);
          _bOsc.frequency.value = 440; _bOsc.type = 'sine'; _bG.gain.value = 0.03;
          _bOsc.start(); _bOsc.stop(_bCtx.currentTime + 0.05);
        } catch(_) {}
      }
    } else if (elapsed < _okSecLive) {
      // Stage 2: counting down second period (yellow = OK zone)
      remaining = _okSecLive - elapsed;
      el.className = 'q-timer q-timer-yellow';
      if (!_stage2Fired) {
        _stage2Fired = true;
        // v367: Deep debug — log yellow transition
        console.log('[CK Buddy DEBUG] VISUAL TIMER → YELLOW at elapsed=' + elapsed + 's (fastSec=' + fastSec + ' okSec=' + okSec + ')');
        // v387: Dramatic warning — entering yellow zone (descending two-tone alert)
        try {
          var ctx = new (window.AudioContext || window.webkitAudioContext)();
          // First tone: high
          var osc1 = ctx.createOscillator(); var g1 = ctx.createGain();
          osc1.connect(g1); g1.connect(ctx.destination);
          osc1.frequency.value = 880; osc1.type = 'triangle'; g1.gain.value = 0.08;
          osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.12);
          // Second tone: lower (descending = warning feel)
          var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
          osc2.connect(g2); g2.connect(ctx.destination);
          osc2.frequency.value = 660; osc2.type = 'triangle'; g2.gain.value = 0.08;
          osc2.start(ctx.currentTime + 0.15); osc2.stop(ctx.currentTime + 0.3);
          // Third tone: even lower
          var osc3 = ctx.createOscillator(); var g3 = ctx.createGain();
          osc3.connect(g3); g3.connect(ctx.destination);
          osc3.frequency.value = 550; osc3.type = 'triangle'; g3.gain.value = 0.06;
          osc3.start(ctx.currentTime + 0.35); osc3.stop(ctx.currentTime + 0.5);
        } catch(_) {}
      }
      // v387: 30-second interval beep in yellow zone too
      if (elapsed > 0 && elapsed % 30 === 0) {
        try {
          var _byCtx = new (window.AudioContext || window.webkitAudioContext)();
          var _byOsc = _byCtx.createOscillator(); var _byG = _byCtx.createGain();
          _byOsc.connect(_byG); _byG.connect(_byCtx.destination);
          _byOsc.frequency.value = 380; _byOsc.type = 'triangle'; _byG.gain.value = 0.04;
          _byOsc.start(); _byOsc.stop(_byCtx.currentTime + 0.06);
        } catch(_) {}
      }
      // v336b: Tick sounds for last 10 seconds before red/penalties
      if (remaining <= 10 && remaining > 0 && remaining !== _lastTickSec) {
        _lastTickSec = remaining;
        try {
          var _tCtx = new (window.AudioContext || window.webkitAudioContext)();
          var _tOsc = _tCtx.createOscillator(); var _tG = _tCtx.createGain();
          _tOsc.connect(_tG); _tG.connect(_tCtx.destination);
          // Pitch rises as time runs out: 500Hz at 10s → 900Hz at 1s
          _tOsc.frequency.value = 500 + (10 - remaining) * 44;
          _tOsc.type = remaining <= 3 ? 'square' : 'triangle';
          _tG.gain.value = remaining <= 3 ? 0.1 : 0.06;
          _tOsc.start(); _tOsc.stop(_tCtx.currentTime + 0.08);
        } catch(_) {}
      }
      stageLabel = '';
    } else {
      // Dead zone: past both thresholds, count UP from 0
      remaining = elapsed - _okSecLive;
      el.className = 'q-timer q-timer-red';
      if (!_deadFired) {
        _deadFired = true;
        el.style.animation = 'q-timer-pulse 1s ease-in-out 3';
        // Harsh warning
        try {
          var ctx = new (window.AudioContext || window.webkitAudioContext)();
          var osc = ctx.createOscillator(); var g = ctx.createGain();
          osc.connect(g); g.connect(ctx.destination);
          osc.frequency.value = 440; osc.type = 'square';
          g.gain.value = 0.08;
          osc.start(); osc.stop(ctx.currentTime + 0.15);
          setTimeout(function() {
            var osc2 = ctx.createOscillator(); var g2 = ctx.createGain();
            osc2.connect(g2); g2.connect(ctx.destination);
            osc2.frequency.value = 330; osc2.type = 'square';
            g2.gain.value = 0.08;
            osc2.start(); osc2.stop(ctx.currentTime + 0.2);
          }, 200);
        } catch(_) {}
      }
      stageLabel = '';
    }
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    if (elapsed >= _okSecLive) {
      // In dead zone, show as count-up with + prefix
      el.textContent = '+' + m + ':' + (s < 10 ? '0' : '') + s;
    } else {
      el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
    // v336: Update projected bonus in feed header (live)
    var _liveProj = _calcProjectedPayout();
    // Simulate adding current question at current elapsed time
    var _curTier = elapsed < _fastSecLive ? 'fast' : (elapsed < _okSecLive ? 'ok' : 'slow');
    var _simNet = _liveProj.net;
    if (_curTier === 'slow') _simNet -= CKRB_RED_PENALTY;
    else if (_curTier === 'ok' && _qStats.okQs >= CKRB_YELLOW_THRESHOLD) _simNet -= CKRB_YELLOW_PENALTY;
    var projEl = document.getElementById(feedProjId);
    if (projEl) {
      if (_simNet >= 0) {
        projEl.textContent = '+$' + _simNet + ' projected';
        projEl.className = 'reward-feed-proj';
      } else {
        projEl.textContent = '-$' + Math.abs(_simNet) + ' projected';
        projEl.className = 'reward-feed-proj penalty';
      }
    }
    // Tooltip
    var _stageStr = elapsed < _fastSecLive ? 'FAST zone (green) — on track!' : (elapsed < okSec ? 'OK zone (yellow) — ' + (_qStats.okQs >= CKRB_YELLOW_THRESHOLD ? 'PENALTY -$' + CKRB_YELLOW_PENALTY : (CKRB_YELLOW_THRESHOLD - _qStats.okQs) + ' free yellows left') : 'SLOW zone (red) — PENALTY -$' + CKRB_RED_PENALTY);
    var _bonusStr = ((_liveProj.okQs||0) + (_liveProj.slowQs||0)) <= CKRB_GREEN_BONUS_MAX_NON && _qStats.feedItems.length >= 3 ? '\n\u2b50 Speed bonus: +$' + CKRB_GREEN_BONUS : '';
    el.title = _stageStr +
      '\nThis Q: ' + elapsed + 's' +
      '\nGreen: ' + (_liveProj.fastQs||0) + ' | Yellow: ' + (_liveProj.okQs||0) + '/' + CKRB_YELLOW_THRESHOLD + ' free | Red: ' + (_liveProj.slowQs||0) +
      '\nProjected: ' + (_simNet >= 0 ? '+$' : '-$') + Math.abs(_simNet) + _bonusStr;
  }, 1000);
}

function _stopQTimer() {
  if (_qTimerInterval) { clearInterval(_qTimerInterval); _qTimerInterval = null; }
}

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
  // v320: Notify Todo of the Loom — Amboss block started
  _loomBlockStartTime = Date.now();
  _loomBlockSite = 'amboss';
  _sendToLoom({ type: 'CKRB_BLOCK_STARTED', blockSize: qs.length, site: 'amboss', timestamp: _loomBlockStartTime });
  _startLoomIdleChecker();
});

document.getElementById('btnAmbossNextQ').addEventListener('click', () => {
  ambossQuizState.currentIndex++;
  renderAmbossQuestion();
});

function renderAmbossQuestion() {
  // v323: Start per-question timer for Amboss
  _startQTimer('amboss-q-timer');
  const { questions, currentIndex, score } = ambossQuizState;
  if (currentIndex >= questions.length) {
    showScreen('screen-amboss');
    document.getElementById('amboss-status').textContent = `Quiz done! Score: ${score} pts (${ambossQuizState.correct}/${questions.length} correct)`;
    document.getElementById('amboss-status').style.color = '#34d399';
    // v320: Notify Todo of the Loom — Amboss block completed
    _stopLoomIdleChecker();
    var _blockPayout = _calcProjectedPayout();
    _sendToLoom({ type: 'CKRB_BLOCK_COMPLETED', totalQuestions: questions.length, correctCount: ambossQuizState.correct, totalMs: Date.now() - _loomBlockStartTime, timestamp: Date.now(), calculatedBonus: _blockPayout.net });
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
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const ruled = btn.classList.toggle('ruled-out');
      if (ruled) { btn.style.textDecoration = 'line-through'; btn.style.opacity = '0.55'; }
      else { btn.style.textDecoration = ''; btn.style.opacity = ''; }
    });
    wrap.appendChild(btn);
  });

  // TTS — use Azure REST via _explSpeakChunked (no local speechSynthesis)
  if (SETTINGS.readAloud) {
    _explSpeakChunked(q.questionText, true, 'amboss-question-text');
  }
}

function handleAmbossAnswer(selectedIdx, q) {
  const isCorrect = selectedIdx === q.correctIndex;
  // v320: Notify Todo of the Loom — Amboss question answered
  var _loomElapsed = _loomLastAnswerTime ? Date.now() - _loomLastAnswerTime : Date.now() - _loomBlockStartTime;
  _loomLastAnswerTime = Date.now();
  _sendToLoom({ type: 'CKRB_QUESTION_ANSWERED', questionIndex: ambossQuizState.currentIndex + 1, correct: isCorrect, elapsedMs: _loomElapsed, timestamp: Date.now() });
  _recordQFeedItem(ambossQuizState.currentIndex + 1, isCorrect, 'amboss-reward-feed-proj', 'amboss-reward-feed-items');
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

  if (SETTINGS.readExplain) {
    var _explText = q.explanation || '';
    _explTTSText = _explText;
    _explSpeakChunked(_explText, true, 'amboss-feedback-box'); // v220: read straight through
  }
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
let SETTINGS = { autonav: true, timer: true, timelimit: 45, readAloud: true, readExplain: true, readQuote: true, highlightTTS: true };
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
  const ht = document.getElementById('set-highlighttts');
  if (ht) SETTINGS.highlightTTS = ht.checked;
  chrome.storage.local.set({ ckrb_settings: SETTINGS });
  // Also mirror to dedicated key content scripts can listen to
  chrome.storage.local.set({ ckrb_highlight_tts: SETTINGS.highlightTTS });
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
    const ht = document.getElementById('set-highlighttts');
    if (ht) ht.checked = SETTINGS.highlightTTS !== false;
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
  // v199: Use Azure REST via _explSpeakChunked — no local speechSynthesis
  setTimeout(() => {
    try { _explSpeakChunked(taunt, true); } catch(e) {}
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
        if (node.tagName === 'BUTTON' || (node.classList && (node.classList.contains('choice-btn') || node.classList.contains('btn')))) {
          attachSounds(node);
        }
        node.querySelectorAll && node.querySelectorAll('button, .choice-btn, .btn, [role="button"]').forEach(attachSounds);
      }
    });
  });
});

// Watch entire quiz screen + feedback area for any new buttons
const quizWrap = document.getElementById('screen-quiz');
if (quizWrap) choicesObserver.observe(quizWrap, { childList: true, subtree: true });
const ambossQuizWrap = document.getElementById('screen-amboss-quiz');
if (ambossQuizWrap) choicesObserver.observe(ambossQuizWrap, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('button, .choice-btn, .btn').forEach(attachSounds);
});
// v302: Watch entire body for ANY new button (settings panels, modals, etc.)
const bodyObserver = new MutationObserver(mutations => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BUTTON') attachSounds(node);
      if (node.querySelectorAll) node.querySelectorAll('button').forEach(attachSounds);
    });
  });
});
bodyObserver.observe(document.body, { childList: true, subtree: true });


/* ─── READ QUESTION ALOUD ─── */
// v199: Uses Azure REST via _explSpeakChunked — no local speechSynthesis
function readQuestionAloud(text) {
  if (!SETTINGS.readAloud) return;
  _explSpeakChunked(text, true, 'quiz-question-text'); // skipConfirm — play straight through
}

// v199: Uses Azure REST via _explSpeakChunked — no local speechSynthesis
function replayQuizAudio() {
  const quoteEl    = document.getElementById('vignette-quote-text');
  const questionEl = document.getElementById('quiz-question-text');
  const quoteText    = quoteEl ? quoteEl.textContent.trim().replace(/^"|"$/g, '') : '';
  const questionText = questionEl ? questionEl.textContent.trim() : '';
  if (quoteText.length > 3 && questionText.length > 10) {
    // v318: Read quote then question with separate glow targets
    (async function() {
      var done = await _explSpeakChunked(quoteText, true, 'vignette-quote-box');
      if (done) _explSpeakChunked(questionText, true, 'quiz-question-text');
    })();
  } else if (quoteText.length > 3) {
    _explSpeakChunked(quoteText, true, 'vignette-quote-box');
  } else if (questionText.length > 10) {
    _explSpeakChunked(questionText, true, 'quiz-question-text');
  }
}

const _btnReplay = document.getElementById('btnReplayAudio');
if (_btnReplay) _btnReplay.addEventListener('click', () => { initAudio(); replayQuizAudio(); });

let _quoteHandlingTTS = false;


/* ─── QUESTION GRID ─── */
let _gridMissing = [];

// Show a "THIS QUESTION DID NOT WORK" modal with the extensive debug info
// captured at scrape time, so we can root out why some Qs fail to scrape.
function _ckrbShowFailedQuestionDebug(q, qNum) {
  let modal = document.getElementById('__ckrb_failed_modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = '__ckrb_failed_modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;';
  const dbg = q.debug || {};
  const dbgJson = JSON.stringify(dbg, null, 2);
  const reason = q.failureReason || 'unknown';
  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  modal.innerHTML =
    '<div style="background:#0f172a;border:2px solid #ef4444;border-radius:12px;max-width:760px;width:100%;max-height:88vh;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#e2e8f0;box-shadow:0 12px 48px rgba(0,0,0,0.7)">' +
      '<div style="padding:14px 18px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;background:rgba(239,68,68,0.12)">' +
        '<div>' +
          '<div style="font-size:11px;color:#fca5a5;font-weight:700;letter-spacing:.08em">Q' + qNum + ' SCRAPE FAILED</div>' +
          '<div style="font-size:18px;font-weight:800;margin-top:2px">⚠️ THIS QUESTION DID NOT WORK</div>' +
        '</div>' +
        '<button id="__ckrb_failed_close" style="background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px">Close</button>' +
      '</div>' +
      '<div style="padding:14px 18px;overflow-y:auto;flex:1">' +
        '<div style="font-size:13px;color:#fbbf24;margin-bottom:8px"><strong>Reason:</strong> ' + escHtml(reason) + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:12px;color:#cbd5e1;margin-bottom:12px">' +
          '<div><span style="color:#94a3b8">EDF found:</span> ' + (dbg.edfFound ? '✓' : '✗') + '</div>' +
          '<div><span style="color:#94a3b8">Body text:</span> ' + (dbg.bodyTextLength || 0) + ' chars</div>' +
          '<div><span style="color:#94a3b8">Radios:</span> ' + (dbg.radioCount != null ? dbg.radioCount : 'n/a') + '</div>' +
          '<div><span style="color:#94a3b8">Iframes:</span> ' + (dbg.iframeCount != null ? dbg.iframeCount : 'n/a') + '</div>' +
          '<div><span style="color:#94a3b8">Choices regex:</span> ' + (dbg.choicesRegexMatch ? '✓' : '✗') + '</div>' +
          '<div><span style="color:#94a3b8">Correct-answer regex:</span> ' + (dbg.correctAnswerRegexMatch ? '✓' : '✗') + '</div>' +
          '<div><span style="color:#94a3b8">Rationale regex:</span> ' + (dbg.rationaleRegexMatch ? '✓' : '✗') + '</div>' +
          '<div><span style="color:#94a3b8">Has Next btn:</span> ' + (dbg.hasNextBtn ? '✓' : '✗') + '</div>' +
        '</div>' +
        (dbg.bodyTextPrefix ?
          '<div style="margin-top:10px"><div style="font-size:11px;color:#94a3b8;font-weight:700;margin-bottom:4px">BODY TEXT (first 600)</div>' +
          '<pre style="background:#020617;border:1px solid #1e293b;border-radius:6px;padding:8px;font-size:11px;color:#94a3b8;white-space:pre-wrap;max-height:160px;overflow:auto;margin:0">' + escHtml(dbg.bodyTextPrefix) + '</pre></div>' : '') +
        '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:#818cf8;font-weight:700">Full debug JSON (copy for diagnosis)</summary>' +
          '<pre style="background:#020617;border:1px solid #1e293b;border-radius:6px;padding:8px;font-size:10px;color:#cbd5e1;white-space:pre-wrap;max-height:280px;overflow:auto;margin-top:6px">' + escHtml(dbgJson) + '</pre>' +
          '<button id="__ckrb_failed_copy" style="margin-top:6px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">📋 Copy debug JSON</button>' +
        '</details>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  document.getElementById('__ckrb_failed_close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  const copyBtn = document.getElementById('__ckrb_failed_copy');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    try { navigator.clipboard.writeText(dbgJson); copyBtn.textContent = '✓ Copied'; }
    catch(_) { copyBtn.textContent = 'Copy failed'; }
  });
}

function buildGrid(questions, total) {
  const grid = document.getElementById('question-grid');
  const status = document.getElementById('grid-status');
  const regenWrap = document.getElementById('grid-regen-wrap');
  grid.innerHTML = '';
  _gridMissing = [];

  // Use real exam question number (absoluteId) everywhere, fall back to scrape order
  const getQNum = q => q.absoluteId || (q.id + 1);

  const currentParentId = quizState.triviaQueue[quizState.currentIndex]
    ? getQNum(quizState.triviaQueue[quizState.currentIndex].parentQ) : null;

  // Determine grid range from actual question numbers present
  const allNums = questions.map(getQNum);
  const gridStart = allNums.length ? Math.min(...allNums) : 1;
  const gridEnd = Math.max(total, ...allNums);

  for (let i = gridStart; i <= gridEnd; i++) {
    const q = questions.find(q => getQNum(q) === i);
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:6px 0;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid;';
    btn.textContent = i;

    const isFailed = q && q.scrapeFailed;
    const notReady = !q || isFailed || !q.analysis || !q.analysis.triviaQuestions || q.analysis.triviaQuestions.length === 0;

    if (isFailed) {
      // Scrape-failed: mark in distinct red/orange so user can see WHY it broke
      _gridMissing.push(q);
      btn.style.background = 'rgba(245, 158, 11, 0.15)';
      btn.style.borderColor = '#f59e0b';
      btn.style.color = '#fbbf24';
      btn.textContent = '⚠';
      btn.title = 'Q' + i + ' — SCRAPE FAILED: ' + (q.failureReason || 'unknown');
      btn.addEventListener('click', () => _ckrbShowFailedQuestionDebug(q, i));
    } else if (notReady) {
      _gridMissing.push(q || { id: i - 1, absoluteId: i, missing: true });
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
        const idx = quizState.triviaQueue.findIndex(item => getQNum(item.parentQ) === i);
        if (idx >= 0) { _explStopAll(); quizState.currentIndex = idx; showScreen('screen-quiz'); renderTriviaQuestion(); }
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
    const inferredTotal = questions.length > 0 ? Math.max(...questions.map(q => q.absoluteId || (q.id + 1))) : 50;
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
  // Skip both never-scraped (missing) and scrape-failed placeholders
  const toProcess = _gridMissing.filter(q => !q.missing && !q.scrapeFailed && q.questionText);
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
// ── STRATEGY CARDS ──
var btnStrat = document.getElementById('btnStrategyCards');
if (btnStrat) {
  btnStrat.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs.length) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_STRATEGY_CARDS' }, function() {
        if (chrome.runtime.lastError) {
          // Try injecting content.js first, then retry
          chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }, function() {
            setTimeout(function() {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_STRATEGY_CARDS' });
            }, 500);
          });
        }
      });
      window.close();
    });
  });
}

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
    });  });
}
