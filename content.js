// CK Buddy v176 — sentence-isolated TTS + abort buttons

(function () {
  // VERSION: must match popup.js AND manifest.json -- run `node bump.js` to update all 3
  var CKRB_VERSION = '432';
  try { console.log('[CK Buddy v' + CKRB_VERSION + '] content.js loaded on', location.hostname); } catch(_) {}
  // v306: Audio + 3D button hover/click helper
  var _ckrbBtnAudioCtx = null;
  function _ckrbBtnTone(freq, dur, vol, type) {
    try {
      if (!_ckrbBtnAudioCtx) _ckrbBtnAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_ckrbBtnAudioCtx.state === 'suspended') _ckrbBtnAudioCtx.resume();
      var osc = _ckrbBtnAudioCtx.createOscillator();
      var gain = _ckrbBtnAudioCtx.createGain();
      osc.connect(gain); gain.connect(_ckrbBtnAudioCtx.destination);
      osc.type = type || 'sine';
      osc.frequency.value = freq || 440;
      gain.gain.setValueAtTime(vol || 0.1, _ckrbBtnAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _ckrbBtnAudioCtx.currentTime + (dur || 0.1));
      osc.start(); osc.stop(_ckrbBtnAudioCtx.currentTime + (dur || 0.1));
    } catch(e) {}
  }
  function _ckrbBtnHoverSound() { _ckrbBtnTone(880, 0.04, 0.06, 'sine'); }
  function _ckrbBtnClickSound() { _ckrbBtnTone(440, 0.06, 0.15, 'square'); setTimeout(function() { _ckrbBtnTone(330, 0.08, 0.1, 'square'); }, 40); }

  function _ckrb3dBtn(b) {
    if (!b || b._ckrb3d) return;
    b._ckrb3d = true;
    var origTransform = '';
    var origShadow = '';
    var origBBW = '';
    b.addEventListener('mouseenter', function() {
      origTransform = b.style.transform || '';
      origShadow = b.style.boxShadow || '';
      origBBW = b.style.borderBottomWidth || '';
      b.style.transform = 'translateY(-2px) scale(1.05)';
      b.style.filter = 'brightness(1.15)';
      b.style.boxShadow = (origShadow ? origShadow.replace(/\d+px\s+\d+px/, '0 6px') : '0 6px 16px rgba(0,0,0,0.35)');
      _ckrbBtnHoverSound();
    });
    b.addEventListener('mouseleave', function() {
      b.style.transform = origTransform;
      b.style.filter = '';
      b.style.boxShadow = origShadow;
      b.style.borderBottomWidth = origBBW;
    });
    b.addEventListener('mousedown', function() {
      b.style.transform = 'translateY(2px) scale(0.97)';
      b.style.filter = 'brightness(0.92)';
      b.style.borderBottomWidth = '1px';
      _ckrbBtnClickSound();
    });
    b.addEventListener('mouseup', function() {
      b.style.transform = origTransform;
      b.style.filter = '';
      b.style.borderBottomWidth = origBBW;
    });
  }


  /* ── ABORT FLAG ── */
  var _ckrbAbortScrape = false;

  /* ── TIMING CONFIG (editable via popup ⚙ → Scrape Timing) ── */
  var CKRB_DELAYS = { settle: 800, change: 8000, nav: 6000, initial: 2000, pass1: 500, pass2: 400, retry: 1000 };
  try { chrome.storage.local.get(['ckrb_timing'], function(r){ if(r.ckrb_timing) Object.assign(CKRB_DELAYS, r.ckrb_timing); }); } catch(e){}
  /* ────────────────────────────────────────────────────────── */

  var overlay = null;
  function showOverlay(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__ckrb_ol';
      overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e293b;color:#e2e8f0;border:2px solid #6366f1;border-radius:10px;padding:12px 18px;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 24px rgba(0,0,0,0.7);display:flex;align-items:center;gap:10px;min-width:260px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<span style="font-size:18px">🩺</span><span>' + text + '</span>';
  }
  function removeOverlay() { var e = document.getElementById('__ckrb_ol'); if(e) e.remove(); overlay = null; }

  /* ── EXPLANATION COPY UNLOCK (NBME EDF iframe) ──
     Previously this also painted ::selection yellow and auto-wrapped every
     left-click selection with an orange <span class="__ckrb_mark"> — that
     made "everything highlighted". User reserved left-click-drag for pure
     native browser selection, so we now only unlock copy/select and do NOT
     paint selections any color. Right-click-drag (TTS) lives elsewhere. */
  function enableEDFHighlight() {
    var edf = getEDF();
    if (!edf || edf.__ckrb_hl) return;
    edf.__ckrb_hl = true;
    var s = edf.createElement('style');
    s.textContent = [
      '* { user-select: text !important; -webkit-user-select: text !important; }'
      // ::selection override removed — native browser selection color only.
    ].join('\n');
    (edf.head || edf.documentElement).appendChild(s);
    edf.addEventListener('selectstart', function(e) { e.stopImmediatePropagation(); }, true);
    // v227: Let contextmenu through on answer choices so UWorld strikethrough works
    edf.addEventListener('contextmenu', function(e) {
      if (findAnswerRow(e.target)) return; // don't block — UWorld needs this for strikethrough
      e.stopImmediatePropagation();
    }, true);
    edf.addEventListener('copy',        function(e) { e.stopImmediatePropagation(); }, true);
    // NOTE: auto-wrap-on-mouseup has been removed. Left-click-drag is now
    // pure native selection — no __ckrb_mark span gets injected.
  }
  setInterval(enableEDFHighlight, 1500);
  /* ───────────────────────────────────────── */

  function getEDF() {
    try {
      var f = document.querySelector('#ElementDisplayFrame');
      if (f && f.contentDocument && f.contentDocument.body) return f.contentDocument;
    } catch(e) {}
    return null;
  }

  function getProgress() {
    var m = document.title.match(/question\s+(\d+)\s+of\s+(\d+)/i);
    if (m) return { current: +m[1], total: +m[2] };
    var el = document.getElementById('QuestionNumber');
    if (el) {
      var t = el.innerText || '';
      var m3 = t.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
      if (m3) return { current: +m3[2], total: 50, section: +m3[1] };
      var m2 = t.match(/Item:\s*(\d+)\s+of\s+(\d+)/i);
      if (m2) return { current: +m2[1], total: +m2[2] };
    }
    // UWorld: "Item: X of Y" in page body (SPA, no #QuestionNumber element)
    if (/uworld\.com/i.test(location.hostname)) {
      var uwM = (document.body.textContent || '').match(/Item[:\s]+(\d+)\s+of\s+(\d+)/);
      if (uwM) return { current: +uwM[1], total: +uwM[2] };
    }
    return null;
  }

  function nextBtn() { return document.querySelector('button#Next') || document.querySelector('button.Next'); }

  // Build a structured failure record so the user can still navigate to a
  // skipped question in the quiz/grid and see WHY it failed.
  function _ckrbBuildFailureDebug(reason, edf, fullText, extra) {
    var dbg = {
      timestamp: new Date().toISOString(),
      url: location.href,
      title: document.title,
      failureReason: reason,
      edfFound: !!edf,
      bodyTextLength: fullText ? fullText.length : 0,
      bodyTextPrefix: fullText ? fullText.slice(0, 1200) : '',
      bodyTextTail: fullText ? fullText.slice(-600) : '',
      progress: getProgress(),
      iframeCount: document.querySelectorAll('iframe').length,
      hasNextBtn: !!nextBtn(),
      docTitle: document.title,
      docReadyState: document.readyState,
      visibilityState: document.visibilityState,
      windowInnerW: window.innerWidth,
      windowInnerH: window.innerHeight
    };
    try {
      // All iframes on the page — cross-origin or not
      var allIframes = Array.from(document.querySelectorAll('iframe'));
      dbg.allIframes = allIframes.slice(0, 10).map(function(f) {
        var info = { id: f.id, name: f.name, src: (f.src || '').slice(0, 300),
          width: f.offsetWidth, height: f.offsetHeight, visible: f.offsetWidth > 0 && f.offsetHeight > 0 };
        try { info.hasContentDoc = !!(f.contentDocument); } catch(_) { info.hasContentDoc = false; info.crossOrigin = true; }
        try { info.hasBody = !!(f.contentDocument && f.contentDocument.body); } catch(_) { info.hasBody = false; }
        try { info.bodyTextLen = f.contentDocument && f.contentDocument.body ? (f.contentDocument.body.innerText || '').length : 0; } catch(_) { info.bodyTextLen = -1; }
        return info;
      });
      dbg.totalIframes = allIframes.length;

      if (edf) {
        var radios = edf.querySelectorAll('input[type="radio"]');
        dbg.radioCount = radios.length;
        var labels = [];
        Array.from(radios).slice(0, 8).forEach(function(r) {
          var lbl = edf.querySelector('label[for="' + r.id + '"]');
          labels.push({ id: r.id, checked: r.checked, labelText: lbl ? (lbl.innerText || '').slice(0, 200) : null });
        });
        dbg.radioLabels = labels;
        dbg.choicesRegexMatch = !!fullText.match(/\d+ choices\.\n/i);
        dbg.correctAnswerRegexMatch = !!fullText.match(/Correct Answer:\s*([A-F])/i);
        dbg.rationaleRegexMatch = !!fullText.match(/Rationale:|Explanation:|Educational Objective:|Answer Explanation:/i);
        dbg.edfBodyHTMLPrefix = (edf.body && edf.body.innerHTML ? edf.body.innerHTML.slice(0, 2000) : '');
        dbg.edfBodyHTMLTail = (edf.body && edf.body.innerHTML ? edf.body.innerHTML.slice(-1000) : '');
        dbg.edfChildCount = edf.body ? edf.body.children.length : 0;
        dbg.edfChildTags = edf.body ? Array.from(edf.body.children).slice(0, 20).map(function(c) {
          return { tag: c.tagName, id: c.id, cls: (c.className || '').toString().slice(0, 80), textLen: (c.innerText || '').length };
        }) : [];
        // Check for images
        var imgs = edf.querySelectorAll('img');
        dbg.imageCount = imgs.length;
        dbg.images = Array.from(imgs).slice(0, 5).map(function(im) {
          return { src: (im.src || '').slice(0, 200), alt: (im.alt || '').slice(0, 100), w: im.naturalWidth, h: im.naturalHeight };
        });
        // Style sheets that might block content
        dbg.edfStyleSheets = edf.styleSheets ? edf.styleSheets.length : 0;
      } else {
        dbg.outerIframes = Array.from(document.querySelectorAll('iframe')).slice(0, 8).map(function(f){
          return { id: f.id, src: (f.src || '').slice(0, 300), name: f.name };
        });
        // Page-level selectors that should exist
        dbg.hasElementDisplayFrame = !!document.querySelector('#ElementDisplayFrame');
        dbg.hasQuestionNumber = !!document.getElementById('QuestionNumber');
        dbg.questionNumberText = (document.getElementById('QuestionNumber') || {}).innerText || '';
      }
      // Outer page context
      dbg.outerBodyChildCount = document.body ? document.body.children.length : 0;
      dbg.outerBodyTextLen = document.body ? (document.body.innerText || '').length : 0;
    } catch(e) { dbg.debugError = String(e); }
    // Merge any extra info from retry attempts
    if (extra) {
      for (var k in extra) { if (extra.hasOwnProperty(k)) dbg[k] = extra[k]; }
    }
    return dbg;
  }

  function _ckrbMakeFailedQuestion(index, reason, edf, fullText) {
    return {
      id: index,
      source: 'nbme',
      scrapeFailed: true,
      failureReason: reason,
      questionText: '⚠️ THIS QUESTION DID NOT WORK',
      choices: [],
      userAnswer: '',
      correctAnswer: '',
      isCorrect: null,
      explanation: '',
      isImageBased: false,
      debug: _ckrbBuildFailureDebug(reason, edf, fullText || '')
    };
  }

  function scrapeCurrentQuestion(index) {
    var edf = getEDF();
    if (!edf) return _ckrbMakeFailedQuestion(index, 'EDF iframe not found', null, '');
    var fullText = edf.body.innerText || '';
    if (fullText.length < 100) return _ckrbMakeFailedQuestion(index, 'EDF body text too short (<100 chars)', edf, fullText);

    var qText = fullText;
    var choicesMatch = fullText.match(/\d+ choices\.\n([\s\S]+?)(?:\nA\s*\.\n|\nA\s*\n)/i);
    if (choicesMatch) {
      qText = choicesMatch[1].trim();
    } else {
      var fallbackMatch = fullText.match(/\d+ choices\.\n([\s\S]{50,1500})/i);
      if (fallbackMatch) qText = fallbackMatch[1].trim();
    }

    var choices = [];
    var userAnswer = '';
    Array.from(edf.querySelectorAll('input[type="radio"]')).forEach(function(radio) {
      var lbl = edf.querySelector('label[for="' + radio.id + '"]');
      var raw = (lbl && lbl.innerText || '').trim();
      var t = raw.replace(/Option is eliminated\.\s*/g, '').replace(/Strikeout\/(?:Eliminate|Restore) [A-F] text\s*/g, '').trim();
      if (t && t.length > 1) {
        choices.push(t);
        if (radio.checked) userAnswer = t;
      }
    });

    var correctAnswer = '';
    var cM = fullText.match(/Correct Answer:\s*([A-F])/i);
    if (cM) correctAnswer = cM[1].trim();

    var isCorrect = null;
    if (correctAnswer && userAnswer) {
      isCorrect = userAnswer[0].toUpperCase() === correctAnswer[0].toUpperCase();
    }

    var explanation = '';
    var ratPatterns = [
      /Correct Answer:\s*[A-F]\.?\s*\n+([\s\S]{20,})/i,
      /Rationale:\s*([\s\S]{20,})/i,
      /Explanation:\s*([\s\S]{20,})/i,
      /Educational Objective:\s*([\s\S]{20,})/i,
      /Answer Explanation:\s*([\s\S]{20,})/i
    ];
    for (var rpi = 0; rpi < ratPatterns.length && !explanation; rpi++) {
      var m = fullText.match(ratPatterns[rpi]);
      if (m && m[1]) explanation = m[1].replace(/^Correct Answer:\s*[A-F]\.?\s*\n+/i, '').trim();
    }
    if (!explanation) {
      var idx = fullText.search(/Correct Answer:\s*[A-F]/i);
      if (idx >= 0) {
        var tail = fullText.slice(idx).replace(/^Correct Answer:\s*[A-F]\.?\s*/i, '').trim();
        if (tail.length > 20) explanation = tail;
      }
    }

    var isImageBased = !qText || qText.length < 30;
    if (isImageBased) qText = '[Image-based question — answer choices and explanation below]';
    return { id: index, source: 'nbme', questionText: qText.trim(), choices: choices, userAnswer: userAnswer, correctAnswer: correctAnswer, isCorrect: isCorrect, explanation: explanation, isImageBased: isImageBased };
  }

  function waitForChange(prevText, timeout) {
    timeout = timeout || CKRB_DELAYS.change;
    return new Promise(function(resolve) {
      var start = Date.now();
      var iv = setInterval(function() {
        var edf = getEDF();
        var cur = edf ? (edf.body.innerText || '').slice(600, 1000) : '';
        if (cur !== prevText || Date.now() - start > timeout) {
          clearInterval(iv);
          setTimeout(resolve, CKRB_DELAYS.settle);
        }
      }, 300);
    });
  }

  async function runFullScrape(limit, skipGap) {
    limit = limit || 25;
    skipGap = skipGap || false;
    _ckrbAbortScrape = false; // Reset abort flag at start of new scrape
    var questions = [];
    var seenNums = new Set();
    var retries = 0;
    await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.initial); });

    for (var i = 0; i < limit * 2; i++) {
      // Check abort flag
      if (_ckrbAbortScrape) {
        console.log('[CK Buddy] NBME scrape aborted by user');
        showOverlay('Scrape aborted.');
        await new Promise(function(r) { setTimeout(r, 1500); });
        removeOverlay();
        _ckrbAbortScrape = false;
        if (questions.length > 0) {
          questions.sort(function(a, b) { return a.id - b.id; });
          chrome.runtime.sendMessage({ type: 'PR_SCRAPE_COMPLETE', data: { url: location.href, title: document.title, scrapedAt: Date.now(), questions: questions } });
        }
        return;
      }
      var progress = getProgress();
      var total = progress ? progress.total : '?';
      var currentNum = progress ? progress.current : (i + 1);

      if (seenNums.has(currentNum)) {
        var nb2 = nextBtn();
        if (!nb2 || nb2.disabled) break;
        var edf3 = getEDF();
        var pt2 = edf3 ? (edf3.body.innerText || '').slice(600, 1000) : '';
        nb2.click();
        await waitForChange(pt2, CKRB_DELAYS.change);
        continue;
      }

      showOverlay('Verifying Q' + currentNum + '/' + total + '\u2026');
      await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.pass1); });

      var progress2 = getProgress();
      var confirmedNum = progress2 ? progress2.current : currentNum;

      if (confirmedNum !== currentNum) {
        retries = (retries || 0) + 1;
        if (retries < 3) {
          await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.retry); });
          i--;
        } else {
          retries = 0;
          var nbSkip = nextBtn();
          if (nbSkip && !nbSkip.disabled) {
            var edfSkip = getEDF();
            var ptSkip = edfSkip ? (edfSkip.body.innerText || '').slice(600, 1000) : '';
            nbSkip.click();
            await waitForChange(ptSkip, 8000);
          }
        }
        continue;
      }
      retries = 0;

      showOverlay('Scraping Q' + currentNum + '/' + total + '\u2026');
      await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.pass2); });

      var q = scrapeCurrentQuestion(questions.length);
      // q is now ALWAYS truthy — failures return a placeholder with debug info
      q.id = currentNum - 1;
      var sectionNum = progress2 && progress2.section ? progress2.section : 1;
      q.absoluteId = (sectionNum - 1) * 50 + currentNum;
      seenNums.add(currentNum);
      questions.push(q);
      if (q.scrapeFailed) {
        showOverlay('Q' + currentNum + ' \u26a0\ufe0f DID NOT WORK \u2014 ' + (q.failureReason || 'no content') + ' (saved with debug info)');
        try { console.warn('[CK Buddy] Q' + currentNum + ' scrape failed:', q.failureReason, q.debug); } catch(_) {}
      } else {
        var s = q.isCorrect === true ? '\u2713' : q.isCorrect === false ? '\u2717' : '?';
        showOverlay('Q' + currentNum + ' scraped [' + s + '] \u2014 ' + questions.length + '/' + total);
      }

      var nb = nextBtn();
      if (!nb || nb.disabled || (progress && progress.current >= progress.total) || questions.length >= limit) break;

      var navRetries = 0;
      var moved = false;
      while (navRetries < 3 && !moved) {
        var edf2 = getEDF();
        var prevText = edf2 ? (edf2.body.innerText || '').slice(600, 1000) : '';
        var prevNum = getProgress() ? getProgress().current : currentNum;
        nextBtn().click();
        await waitForChange(prevText, CKRB_DELAYS.nav);
        var newNum = getProgress() ? getProgress().current : -1;
        if (newNum !== prevNum) {
          moved = true;
        } else {
          navRetries++;
          await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.retry); });
        }
      }
      if (!moved) break;
    }

    removeOverlay();
    questions.sort(function(a, b) { return a.id - b.id; });
    chrome.runtime.sendMessage({ type: 'PR_SCRAPE_COMPLETE', data: { url: location.href, title: document.title, scrapedAt: Date.now(), questions: questions } });
  }

  function _ckrbFinishScrape(questions) {
    questions.sort(function(a, b) { return a.id - b.id; });
    chrome.runtime.sendMessage({ type: 'PR_SCRAPE_COMPLETE', data: { url: location.href, title: document.title, scrapedAt: Date.now(), questions: questions } });
  }

  // Navigate to a specific question number using Previous/Next buttons.
  // Returns a Promise that resolves when we've arrived (or given up).
  function _ckrbNavToQuestion(targetNum) {
    return new Promise(function(resolve) {
      var attempts = 0;
      var maxAttempts = 60; // safety cap
      function step() {
        if (attempts++ > maxAttempts) { resolve(false); return; }
        var p = getProgress();
        if (!p) { resolve(false); return; }
        if (p.current === targetNum) { resolve(true); return; }
        var btn = p.current < targetNum
          ? (document.querySelector('button.Next') || document.querySelector('button#Next'))
          : (document.querySelector('button.Previous') || document.querySelector('button#Previous'));
        if (!btn || btn.disabled) { resolve(false); return; }
        btn.click();
        setTimeout(step, 1200);
      }
      step();
    });
  }

  // Show a retry window after scraping when some questions failed.
  function _ckrbShowRetryWindow(questions, failedQs) {
    return new Promise(function(resolve) {
      var modal = document.createElement('div');
      modal.id = '__ckrb_retry_modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif;';

      var failedNums = failedQs.map(function(q) { return (q.id || 0) + 1; });
      var listHtml = failedQs.map(function(q) {
        var qn = (q.id || 0) + 1;
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b">' +
          '<span style="color:#fbbf24;font-weight:700">Q' + qn + '</span>' +
          '<span style="color:#94a3b8;font-size:12px">' + (q.failureReason || 'unknown') + '</span>' +
          '</div>';
      }).join('');

      modal.innerHTML =
        '<div style="background:#0f172a;border:2px solid #f59e0b;border-radius:14px;max-width:520px;width:100%;max-height:85vh;display:flex;flex-direction:column;color:#e2e8f0;box-shadow:0 12px 48px rgba(0,0,0,0.7)">' +
          '<div style="padding:16px 20px;border-bottom:1px solid #334155;background:rgba(245,158,11,0.1);border-radius:14px 14px 0 0">' +
            '<div style="font-size:18px;font-weight:800">\u26a0\ufe0f ' + failedQs.length + ' question' + (failedQs.length > 1 ? 's' : '') + ' failed to scrape</div>' +
            '<div style="font-size:13px;color:#94a3b8;margin-top:4px">These questions can be retried out of sequence with longer wait times.</div>' +
          '</div>' +
          '<div style="padding:14px 20px;overflow-y:auto;flex:1;max-height:300px">' + listHtml + '</div>' +
          '<div style="padding:14px 20px;border-top:1px solid #334155;display:flex;gap:10px">' +
            '<button id="__ckrb_retry_yes" style="flex:1;padding:10px;background:linear-gradient(180deg,#fbbf24 0%,#f59e0b 100%);color:#0f172a;border:none;border-bottom:3px solid #d97706;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;text-shadow:0 1px 1px rgba(255,255,255,0.2);box-shadow:0 2px 8px rgba(245,158,11,0.4);transition:all 0.15s">Retry Failed Questions</button>' +
            '<button id="__ckrb_retry_skip" style="flex:1;padding:10px;background:linear-gradient(180deg,#334155 0%,#1e293b 100%);color:#94a3b8;border:1px solid #475569;border-bottom:3px solid #0f172a;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);transition:all 0.15s">Skip &amp; Continue</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(modal);

      document.getElementById('__ckrb_retry_skip').addEventListener('click', function() {
        modal.remove();
        // Save debug report then finish
        _ckrbSaveDebugReport(questions, failedQs, []);
        _ckrbFinishScrape(questions);
        resolve();
      });

      document.getElementById('__ckrb_retry_yes').addEventListener('click', function() {
        modal.remove();
        _ckrbRunRetries(questions, failedQs).then(function() { resolve(); });
      });
    });
  }

  // Retry each failed question: navigate to it, wait extra long, scrape multiple times
  // with increasing delays, collect extensive debug on every attempt.
  async function _ckrbRunRetries(questions, failedQs) {
    var retryResults = []; // { qNum, attempts: [{ attemptNum, delay, result, debug }], recovered }

    for (var fi = 0; fi < failedQs.length; fi++) {
      var fq = failedQs[fi];
      var qNum = (fq.id || 0) + 1;
      var retryRecord = { qNum: qNum, originalReason: fq.failureReason, attempts: [], recovered: false };

      showOverlay('Retrying Q' + qNum + ' (' + (fi + 1) + '/' + failedQs.length + ') — navigating\u2026');

      // Navigate to the question
      var arrived = await _ckrbNavToQuestion(qNum);
      if (!arrived) {
        retryRecord.attempts.push({
          attemptNum: 0, delay: 0, result: 'nav_failed',
          debug: _ckrbBuildFailureDebug('Navigation to Q' + qNum + ' failed', null, '', { retryPhase: 'navigation', navTarget: qNum })
        });
        retryResults.push(retryRecord);
        continue;
      }

      // Try scraping with increasing delays: 1.5s, 3s, 5s, 8s
      var delays = [1500, 3000, 5000, 8000];
      for (var di = 0; di < delays.length; di++) {
        showOverlay('Retrying Q' + qNum + ' — attempt ' + (di + 1) + '/4, waiting ' + (delays[di] / 1000) + 's\u2026');
        await new Promise(function(r) { setTimeout(r, delays[di]); });

        var q = scrapeCurrentQuestion(fq.id);
        q.id = fq.id;
        if (fq.absoluteId) q.absoluteId = fq.absoluteId;

        var attemptDebug = _ckrbBuildFailureDebug(
          q.scrapeFailed ? q.failureReason : 'SUCCESS',
          getEDF(),
          getEDF() ? (getEDF().body.innerText || '') : '',
          { retryPhase: 'attempt', attemptNum: di + 1, delayMs: delays[di], retryQNum: qNum }
        );

        retryRecord.attempts.push({
          attemptNum: di + 1,
          delay: delays[di],
          result: q.scrapeFailed ? 'failed' : 'success',
          failureReason: q.scrapeFailed ? q.failureReason : null,
          debug: attemptDebug
        });

        if (!q.scrapeFailed) {
          // Recovered! Replace the failed question in the array.
          retryRecord.recovered = true;
          for (var qi = 0; qi < questions.length; qi++) {
            if (questions[qi].id === fq.id) {
              questions[qi] = q;
              break;
            }
          }
          showOverlay('Q' + qNum + ' \u2714 recovered on attempt ' + (di + 1));
          await new Promise(function(r) { setTimeout(r, 800); });
          break;
        }
      }

      if (!retryRecord.recovered) {
        showOverlay('Q' + qNum + ' \u2717 still failing after 4 attempts');
        await new Promise(function(r) { setTimeout(r, 800); });
      }

      retryResults.push(retryRecord);
    }

    // Save full debug report
    _ckrbSaveDebugReport(questions, failedQs, retryResults);

    // Show summary
    var recovered = retryResults.filter(function(r) { return r.recovered; }).length;
    var stillFailed = retryResults.filter(function(r) { return !r.recovered; }).length;
    showOverlay('Retry complete: ' + recovered + ' recovered, ' + stillFailed + ' still failing');
    await new Promise(function(r) { setTimeout(r, 2000); });
    removeOverlay();

    _ckrbFinishScrape(questions);
  }

  // Save debug data as a JSON file via chrome.downloads so it can be analyzed later.
  function _ckrbSaveDebugReport(questions, failedQs, retryResults) {
    var report = {
      generatedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      totalQuestions: questions.length,
      totalFailed: failedQs.length,
      totalRecovered: retryResults.filter(function(r) { return r.recovered; }).length,
      totalStillFailing: retryResults.filter(function(r) { return !r.recovered; }).length,
      failedQuestions: failedQs.map(function(q) {
        return {
          qNum: (q.id || 0) + 1,
          failureReason: q.failureReason,
          debug: q.debug
        };
      }),
      retryResults: retryResults,
      allQuestionsSummary: questions.map(function(q) {
        return {
          qNum: (q.id || 0) + 1,
          scrapeFailed: !!q.scrapeFailed,
          failureReason: q.failureReason || null,
          isCorrect: q.isCorrect,
          hasExplanation: !!(q.explanation && q.explanation.length > 20),
          choiceCount: q.choices ? q.choices.length : 0,
          isImageBased: !!q.isImageBased,
          textLength: q.questionText ? q.questionText.length : 0
        };
      })
    };

    try {
      var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      chrome.runtime.sendMessage({
        type: 'CKRB_DOWNLOAD_DEBUG',
        url: url,
        filename: 'ckbuddy-scrape-debug-' + ts + '.json'
      });
    } catch(e) {
      try { console.warn('[CK Buddy] Failed to save debug report:', e); } catch(_) {}
    }
    // Also stash in storage for quick access
    try {
      chrome.storage.local.set({ ckrb_last_debug_report: report });
    } catch(_) {}
  }


  // v325: CSS for pulsing glow on wrong choice text
  (function() {
    var style = document.createElement('style');
    style.textContent = [
      '@keyframes ckrb-para-pulse {',
      '  0%, 100% { background: rgba(249,115,22,0.08); border-left-color: rgba(249,115,22,0.6); }',
      '  50% { background: rgba(249,115,22,0.18); border-left-color: rgba(249,115,22,1); }',
      '}',
      '.ckrb-wrong-para-hl {',
      '  background: rgba(249,115,22,0.12) !important;',
      '  border-left: 4px solid #f97316 !important;',
      '  border-radius: 6px !important;',
      '  padding: 8px 12px !important;',
      '  margin: 4px 0 !important;',
      '  animation: ckrb-para-pulse 2s ease-in-out infinite !important;',
      '  scroll-margin-top: 120px !important;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  })();

  // v366: Find wrong choice in explanation — 4 broad patterns + retry logic (matches popup.js)
  var _ckrbHlRetryIv = null;
  var _ckrbHlVisIv = null;
  function _ckrbHighlightWrongChoice(letter) {
    // Clear any previous retry loops
    if (_ckrbHlRetryIv) { clearInterval(_ckrbHlRetryIv); _ckrbHlRetryIv = null; }
    if (_ckrbHlVisIv) { clearInterval(_ckrbHlVisIv); _ckrbHlVisIv = null; }
    // Remove any previous highlights
    document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) {
      el.classList.remove('ckrb-wrong-para-hl');
    });

    function _doHL(ltr, att) {
      document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) { el.classList.remove('ckrb-wrong-para-hl'); });
      // v372: Find explanation section, search only within it
      var explanationRoot = null;
      var allEls = document.querySelectorAll('div, section, article, td, p, span, h1, h2, h3, h4, h5, h6, strong, b');
      for (var ei = 0; ei < allEls.length; ei++) {
        var elTxt = (allEls[ei].textContent || '').trim().substring(0, 50).toLowerCase();
        if (elTxt.indexOf('educational objective') === 0 || elTxt.indexOf('explanation') === 0 ||
            elTxt.indexOf('bottom line') === 0 || elTxt.indexOf('learning objective') === 0) {
          explanationRoot = allEls[ei].parentElement || allEls[ei];
          for (var _up = 0; _up < 3 && explanationRoot.parentElement && explanationRoot.parentElement !== document.body; _up++) {
            if ((explanationRoot.textContent||'').length > 500) break;
            explanationRoot = explanationRoot.parentElement;
          }
          break;
        }
      }
      var searchRoot = explanationRoot || document.body;
      // v428: Exact match first, grouped match as fallback
      var patterns = [
        new RegExp('\\(Choice\\s+' + ltr + '\\)', 'i'),           // "(Choice E)" exact
        new RegExp('\\(Choice\\s+' + ltr + '\\b', 'i'),           // "(Choice E ..." 
        new RegExp('\\(Choices\\s+[^)]*\\b' + ltr + '\\b[^)]*\\)', '') // case-sensitive grouped match
      ];
      // v430: Search element textContent — exclude sidebar, answer choices, question stem
      var bestBlock = null, bestScore = -999;
      var candidates = searchRoot.querySelectorAll('p, div, td, li, span, section');
      for (var _ci = 0; _ci < candidates.length; _ci++) {
        var _el = candidates[_ci];
        if (_el.offsetParent === null) continue;
        if (_el.closest && _el.closest('[id^="ckrb"]')) continue;
        // Skip sidebar, answer container, question stem, nav elements
        if (_el.closest && (_el.closest('.question-status') || _el.closest('[class*="sidebar"]') || _el.closest('[class*="questionStatus"]') || _el.closest('#answerContainer') || _el.closest('[class*="question-number"]'))) continue;
        // Skip very large containers (whole page divs)
        if ((_el.textContent || '').length > 2000) continue;
        var _elText = _el.textContent || '';
        for (var _pi = 0; _pi < patterns.length; _pi++) {
          if (patterns[_pi].test(_elText)) {
            var block = _el;
            var _dd = window.getComputedStyle(block).display;
            if (_dd !== 'block' && _dd !== 'list-item' && _dd !== 'table-cell' && _dd !== 'flex') {
              while (block && block !== document.body) {
                _dd = window.getComputedStyle(block).display;
                if (_dd === 'block' || _dd === 'list-item' || _dd === 'table-cell' || _dd === 'flex') break;
                block = block.parentElement;
              }
            }
            if (block && block !== document.body && block.offsetParent !== null) {
              var txt = (block.textContent || '').trim();
              var sc = (2 - _pi) * 3;
              if (txt.length > 80) sc += 5;
              else if (txt.length > 30) sc += 1;
              else sc -= 10;
              if (/^\s*[A-G][.)\s]/.test(txt) && txt.length < 100) sc -= 20;
              if (txt.length < 500) sc += 2; // prefer specific paragraphs
              if (sc > bestScore) { bestScore = sc; bestBlock = block; }
            }
            break;
          }
        }
      }
      if (!bestBlock) return false;
      bestBlock.classList.add('ckrb-wrong-para-hl');
      // v431: No auto-scroll — user clicks magnifying button instead
      console.log('[CK Buddy] Highlight: score=' + bestScore + ' len=' + (bestBlock.textContent||'').length + ' (att ' + att + ')');
      return true;
    }

    // Try immediately, then retry every 1.5s for up to 20 attempts
    window._ckrbHlKill = false;
    var _applied = _doHL(letter, 1);
    var _retries = 0;
    _ckrbHlRetryIv = setInterval(function() {
      if (window._ckrbHlKill) { clearInterval(_ckrbHlRetryIv); clearInterval(_ckrbHlVisIv); return; }
      _retries++;
      var _vis = document.querySelectorAll('.ckrb-wrong-para-hl');
      if (_vis.length === 0) _applied = false;
      if (!_applied) _applied = _doHL(letter, _retries + 1);
      if (_retries >= 60) clearInterval(_ckrbHlRetryIv);
    }, 3000);
    // Visibility watcher — clean up highlights in hidden panels
    _ckrbHlVisIv = setInterval(function() {
      if (window._ckrbHlKill) { clearInterval(_ckrbHlVisIv); return; }
      document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) {
        if (el.offsetParent === null) el.classList.remove('ckrb-wrong-para-hl');
      });
    }, 2000);
  }

  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    // v366: Clear highlights message from popup
    if (msg.type === 'CLEAR_WRONG_HIGHLIGHTS') {
      document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) { el.classList.remove('ckrb-wrong-para-hl'); });
      window._ckrbHlKill = true;
      if (_ckrbHlRetryIv) { clearInterval(_ckrbHlRetryIv); _ckrbHlRetryIv = null; }
      if (_ckrbHlVisIv) { clearInterval(_ckrbHlVisIv); _ckrbHlVisIv = null; }
      sendResponse({ ok: true });
      return;
    }
    // v325/v366: Highlight wrong choice letter in Q-bank explanation
    if (msg.type === 'HIGHLIGHT_WRONG_CHOICE' && msg.letter) {
      console.log('[CK Buddy] HIGHLIGHT_WRONG_CHOICE letter=' + msg.letter + ' frame=' + window.location.href.substring(0, 80));
      _ckrbHighlightWrongChoice(msg.letter);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'NAV_TO_QUESTION') {
      window._navStop = true;
      setTimeout(function() {
        window._navStop = false;
        var targetAbs = msg.questionNum;
        var getPos = function() {
          var el = document.getElementById('QuestionNumber');
          if (el) {
            var t = el.innerText || '';
            var mFL = t.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
            if (mFL) return (parseInt(mFL[1])-1)*50 + parseInt(mFL[2]);
            var mItem = t.match(/Item:\s*(\d+)/i);
            if (mItem) return parseInt(mItem[1]);
          }
          var mCMS = document.title.match(/question\s+(\d+)\s+of\s+(\d+)/i);
          if (mCMS) return parseInt(mCMS[1]);
          return null;
        };
        var step = function() {
          if (window._navStop) return;
          var cur = getPos();
          if (cur === null) { window._navStop = true; return; }
          if (cur === targetAbs) { window._navStop = true; return; }
          var btn = cur < targetAbs ? document.querySelector('button.Next') : document.querySelector('button.Previous');
          if (btn) { btn.click(); setTimeout(step, 1200); }
          else { window._navStop = true; }
        };
        step();
      }, 100);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'ABORT_SCRAPE') {
      _ckrbAbortScrape = true;
      console.log('[CK Buddy] ABORT_SCRAPE received');
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'SCRAPE_PAGE' || msg.type === 'SCRAPE_PAGE_N') {
      var limit = (msg.type === 'SCRAPE_PAGE_N' && msg.count) ? msg.count : 25;
      var skipGap = (msg.type === 'SCRAPE_PAGE_N');
      sendResponse({ ok: true, data: null, mode: 'page_reload' });
      runFullScrape(limit, skipGap).catch(function(e) { removeOverlay(); });
      return true;
    }
    if (msg.type === 'DUMP_PAGE') {
      var edf = getEDF();
      var q = scrapeCurrentQuestion(0);
      sendResponse({ ok: true, dump: { edfFound: !!edf, bodyLength: edf ? edf.body.innerText.length : 0, scrapedQ: q } });
      return true;
    }
    if (msg.type === 'TOGGLE_STRATEGY_CARDS') {
      // Only handle in top-most accessible frame to prevent multi-frame race
      // (one frame creates flipbook, another removes it immediately)
      try { if (window.parent && window.parent !== window && window.parent.document) { sendResponse({ ok: false, reason: 'child_frame' }); return true; } } catch(e) {}
      _ckrbToggleFlipbook();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'RESTORE_STRATEGY_CARDS' && msg.cards) {
      _ckrbSaveCards(msg.cards);
      sendResponse({ ok: true, count: msg.cards.length });
      return true;
    }
    // v289: popup routes TTS through content script's SDK to avoid REST 429s
    if (msg.type === 'TTS_SYNTH') {
      var _ttsText = msg.text || '';
      console.log('[CK Buddy TTS] TTS_SYNTH request from popup: "' + _ttsText.substring(0, 40) + '..."');
      chrome.storage.sync.get(['ckrb_azure_key', 'ckrb_azure_region'], function(r) {
        var k = r && r.ckrb_azure_key ? String(r.ckrb_azure_key).trim() : '';
        var reg = r && r.ckrb_azure_region ? String(r.ckrb_azure_region).trim().toLowerCase() : '';
        if (!k || !reg) { sendResponse({ ok: false, error: 'no key' }); return; }
        var SDK = null;
        try { SDK = SpeechSDK; } catch(_) {}
        if (!SDK) try { SDK = window.SpeechSDK; } catch(_) {}
        if (!SDK) try { SDK = globalThis.SpeechSDK; } catch(_) {}
        if (!SDK) {
          // No SDK — try REST as fallback
    var voice = 'en-US-JennyNeural';
          var ssml = "<speak version='1.0' xml:lang='en-US'><voice name='" + voice + "'><prosody rate='-5%'>" + _ckrbEscapeXml(_ttsText) + "</prosody></voice></speak>";
          fetch('https://' + reg + '.tts.speech.microsoft.com/cognitiveservices/v1', {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': k, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'ckrb' },
            body: ssml
          }).then(function(resp) {
            if (!resp.ok) throw new Error('REST ' + resp.status);
            return resp.arrayBuffer();
          }).then(function(buf) {
            // Convert ArrayBuffer to base64 for message passing
            var bytes = new Uint8Array(buf);
            var binary = '';
            for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            sendResponse({ ok: true, audioB64: btoa(binary) });
          }).catch(function(err) {
            sendResponse({ ok: false, error: err.message });
          });
          return;
        }
        // Use SDK
        var voice = 'en-US-JennyNeural';
        var ssml = "<speak version='1.0' xml:lang='en-US'><voice name='" + voice + "'><prosody rate='-5%'>" + _ckrbEscapeXml(_ttsText) + "</prosody></voice></speak>";
        try {
          var sc = SDK.SpeechConfig.fromSubscription(k, reg);
          sc.speechSynthesisVoiceName = voice;
          sc.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
          var synth = new SDK.SpeechSynthesizer(sc, null);
          synth.speakSsmlAsync(ssml, function(result) {
            try { synth.close(); } catch(_) {}
            if (result && result.audioData && result.audioData.byteLength) {
              var bytes = new Uint8Array(result.audioData);
              var binary = '';
              for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              console.log('[CK Buddy TTS] TTS_SYNTH SDK OK, ' + result.audioData.byteLength + ' bytes');
              sendResponse({ ok: true, audioB64: btoa(binary) });
            } else {
              console.warn('[CK Buddy TTS] TTS_SYNTH SDK returned empty, reason=' + (result && result.reason));
              sendResponse({ ok: false, error: 'SDK empty audio, reason=' + (result && result.reason) });
            }
          }, function(err) {
            try { synth.close(); } catch(_) {}
            sendResponse({ ok: false, error: 'SDK error: ' + (err && err.message || err) });
          });
        } catch(e) {
          sendResponse({ ok: false, error: 'SDK threw: ' + e.message });
        }
      });
      return true; // async sendResponse
    }
  });

  console.log('[CK Buddy v' + CKRB_VERSION + '] onMessage listener registered on', location.hostname);

  /* ── RIGHT-CLICK STRIKETHROUGH (all platforms) ── */
  function findAnswerRow(target) {
    var el = target;
    while (el && el !== document.body) {
      // UWorld
      if (el.tagName === 'TR' && el.classList.contains('answer-choice-background')) return el;
      // AMBOSS
      if (el.tagName === 'DIV' && el.getAttribute('data-e2e-test-id') && el.getAttribute('data-e2e-test-id').startsWith('answer-theme')) return el;
      // NBME — label wrapping a radio answer
      if (el.tagName === 'LABEL' && el.getAttribute('for') && el.innerText.length > 2 && el.innerText.length < 300) {
        // Verify it's actually an answer label (has a radio sibling)
        var radio = document.getElementById(el.getAttribute('for'));
        if (radio && radio.type === 'radio') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function toggleStrikethrough(row) {
    var isStruck = row.getAttribute('data-ckrb-struck') === 'true';
    if (isStruck) {
      row.style.textDecoration = '';
      row.setAttribute('data-ckrb-struck', 'false');
    } else {
      // v230: Match real NBME exam — simple line-through, nothing else
      row.style.textDecoration = 'line-through';
      row.setAttribute('data-ckrb-struck', 'true');
    }
  }

  document.addEventListener('contextmenu', function(e) {
    // If a right-drag yellow highlight just finished, swallow the context menu
    if (window._ckrbSuppressNextCtx) {
      window._ckrbSuppressNextCtx = false;
      e.preventDefault();
      return;
    }
    var row = findAnswerRow(e.target);
    if (!row) return;
    e.preventDefault();
    toggleStrikethrough(row);
  });

  /* ── RIGHT-CLICK-DRAG YELLOW HIGHLIGHTER ── */
  var _ckrbRightDragging = false;
  var _ckrbRightStartRange = null;
  var _ckrbRightStartX = 0;
  var _ckrbRightStartY = 0;
  var _ckrbRightMoved = false;

  function _ckrbCaretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      var r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.setEnd(pos.offsetNode, pos.offset);
      return r;
    }
    return null;
  }

  // v220: Yellow highlight uses OVERLAY divs — zero DOM modification.
  // No spans injected, no text reflow, no persistence issues.
  var _ckrbYellowOverlays = [];

  function _ckrbWrapSelectionYellow() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed || range.toString().trim().length < 1) return false;
    // Get all client rects (one per line of selected text)
    var rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;
    var sx = window.pageXOffset || 0;
    var sy = window.pageYOffset || 0;
    var _batchOvs = []; // v364: track this batch for auto-fade
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.width < 1 || r.height < 1) continue;
      var ov = document.createElement('div');
      ov.className = '__ckrb_ymark';
      // v225: mix-blend-mode:multiply keeps black text fully readable
      ov.style.cssText = 'position:absolute;pointer-events:none;' +
        'background:#fde047;mix-blend-mode:multiply;z-index:2147483640;' +
        'transition:opacity 1.5s ease;' +
        'left:' + (r.left + sx) + 'px;top:' + (r.top + sy) + 'px;' +
        'width:' + r.width + 'px;height:' + r.height + 'px;';
      document.body.appendChild(ov);
      _ckrbYellowOverlays.push(ov);
      _batchOvs.push(ov);
    }
    // v364: Auto-fade this batch of overlays after 45 seconds
    if (_batchOvs.length > 0) {
      setTimeout(function() {
        for (var fi = 0; fi < _batchOvs.length; fi++) {
          try { _batchOvs[fi].style.opacity = '0'; } catch(_) {}
        }
        // Remove from DOM + array after fade completes
        setTimeout(function() {
          for (var ri = 0; ri < _batchOvs.length; ri++) {
            try {
              _batchOvs[ri].remove();
              var idx = _ckrbYellowOverlays.indexOf(_batchOvs[ri]);
              if (idx >= 0) _ckrbYellowOverlays.splice(idx, 1);
            } catch(_) {}
          }
        }, 1600);
      }, 45000);
    }
    return true;
  }

  function _ckrbClearYellowOverlays() {
    for (var i = 0; i < _ckrbYellowOverlays.length; i++) {
      try { _ckrbYellowOverlays[i].remove(); } catch(_) {}
    }
    _ckrbYellowOverlays = [];
    // Also remove any legacy span-based marks
    var old = document.querySelectorAll('span.__ckrb_ymark');
    for (var j = 0; j < old.length; j++) {
      var m = old[j]; var p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      if (p.normalize) p.normalize();
    }
  }

  // Inline style element used to flip ::selection color BLUE while a right-drag
  // is in progress, so the user can visually tell "TTS mode" from the default
  // yellow "highlight mode". Removed on right-mouseup.
  function _ckrbEnableBlueSelectionOverride() {
    if (document.getElementById('__ckrb_sel_blue')) return;
    var s = document.createElement('style');
    s.id = '__ckrb_sel_blue';
    s.textContent = [
      '::selection      { background: #b3d4fc !important; color: inherit !important; }',
      '::-moz-selection { background: #b3d4fc !important; color: inherit !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }
  function _ckrbDisableBlueSelectionOverride() {
    var s = document.getElementById('__ckrb_sel_blue');
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 2) return;
    // Don't yellow-highlight answer choices during exam taking — let the
    // existing right-click strikethrough "RULED OUT" behavior handle them.
    if (findAnswerRow(e.target)) return;
    // v220: Yellow marks are overlays (pointer-events:none), no special handling needed.
    _ckrbRightStartX = e.clientX;
    _ckrbRightStartY = e.clientY;
    _ckrbRightMoved = false;
    _ckrbRightStartRange = _ckrbCaretRangeFromPoint(e.clientX, e.clientY);
    if (_ckrbRightStartRange) {
      _ckrbRightDragging = true;
      // Selection during right-drag paints BLUE (TTS mode), not yellow.
      _ckrbEnableBlueSelectionOverride();
    }
  }, true);

  document.addEventListener('mousemove', function(e) {
    if (!_ckrbRightDragging) return;
    var dx = e.clientX - _ckrbRightStartX;
    var dy = e.clientY - _ckrbRightStartY;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    _ckrbRightMoved = true;
    var endRange = _ckrbCaretRangeFromPoint(e.clientX, e.clientY);
    if (!endRange || !_ckrbRightStartRange) return;
    try {
      var combined = document.createRange();
      // Determine direction by comparing positions
      var startFirst = _ckrbRightStartRange.compareBoundaryPoints(Range.START_TO_START, endRange) <= 0;
      if (startFirst) {
        combined.setStart(_ckrbRightStartRange.startContainer, _ckrbRightStartRange.startOffset);
        combined.setEnd(endRange.startContainer, endRange.startOffset);
      } else {
        combined.setStart(endRange.startContainer, endRange.startOffset);
        combined.setEnd(_ckrbRightStartRange.startContainer, _ckrbRightStartRange.startOffset);
      }
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(combined);
    } catch(err) {}
  }, true);

  document.addEventListener('mouseup', function(e) {
    if (e.button !== 2) return;
    if (!_ckrbRightDragging) return;
    var wasDragged = _ckrbRightMoved;
    _ckrbRightDragging = false;
    _ckrbRightStartRange = null;
    _ckrbRightMoved = false;
    // Remove the blue ::selection override so left-drag highlights paint
    // yellow again. Defer one tick so the current selection finishes
    // painting blue before we swap back.
    setTimeout(_ckrbDisableBlueSelectionOverride, 0);
    if (!wasDragged) return;
    // Right-click-drag → show floating 🔊 Read / ⏸ Stop button anchored near
    // the selection. User requested: right-click-drag gets the start/stop
    // control rather than auto-speaking. Clicking the button begins TTS with
    // in-place word-by-word highlighting; clicking again stops it.
    try {
      var sel = window.getSelection();
      var txt = (sel && !sel.isCollapsed) ? (sel.toString() || '').trim() : '';
      if (!txt || txt.length < 2) return;
      var range = null;
      try { range = sel.getRangeAt(0).cloneRange(); } catch(_) {}
      // Suppress the native contextmenu that would follow this right-mouseup
      window._ckrbSuppressNextCtx = true;
      e.preventDefault();
      e.stopPropagation();
      // Anchor the button OUTSIDE the selection's bounding box so it never
      // obstructs the text being read. Prefer directly above the selection;
      // fall back to directly below if there isn't room up top; fall back to
      // the right edge of the viewport if neither fits.
      var bx, by;
      try {
        var selRect = range.getBoundingClientRect();
        var vw = window.innerWidth || 1200;
        var vh = window.innerHeight || 800;
        var BTN_W = 110, BTN_H = 34, PAD = 8;
        // Prefer horizontal alignment with the user's release point, but clamp
        var preferredX = Math.max(PAD, Math.min(vw - BTN_W - PAD, e.clientX - BTN_W / 2));
        if (selRect.top - BTN_H - PAD >= 0) {
          // Place above the selection
          bx = preferredX;
          by = selRect.top - BTN_H - PAD;
        } else if (selRect.bottom + BTN_H + PAD <= vh) {
          // Place below the selection
          bx = preferredX;
          by = selRect.bottom + PAD;
        } else {
          // No room above or below — pin to the right edge at the user's y,
          // but nudge horizontally so we don't sit on the selection
          bx = Math.min(vw - BTN_W - PAD, selRect.right + PAD);
          by = Math.max(PAD, Math.min(vh - BTN_H - PAD, e.clientY - BTN_H / 2));
          // If that still overlaps horizontally, push further right
          if (bx < selRect.right) bx = Math.max(PAD, vw - BTN_W - PAD);
        }
      } catch(_) {
        bx = Math.max(8, e.clientX + 8);
        by = Math.max(8, e.clientY - 38);
      }
      _ckrbShowTTSBtn(bx, by, txt, range);
      // Clear the native selection so the yellow ::selection color doesn't
      // linger after the right-drag, and so a follow-up left-click elsewhere
      // can't accidentally trigger the left-drag yellow-wrap handler on the
      // leftover right-drag range.
      try { window.getSelection().removeAllRanges(); } catch(_) {}
    } catch(err) { /* no-op */ }
  }, true);

  /* ── LEFT-CLICK-DRAG → PERSISTENT YELLOW HIGHLIGHT ──
     Rules the user settled on:
       • left-mousedown + drag + mouseup on plain text  → wrap yellow (persists)
       • left-click on an existing yellow highlight     → toggle it off (unhighlight)
       • right-click on an existing yellow highlight    → also toggle it off (handled elsewhere)
       • any mouseup that didn't start from a LEFT mousedown on plain text is ignored
         (prevents stale right-drag selections from getting wrapped later). */
  var _ckrbLeftDragActive = false;
  var _ckrbLeftDownX = 0, _ckrbLeftDownY = 0; // v364: track start pos for min drag distance
  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    _ckrbLeftDragActive = true;
    _ckrbLeftDownX = e.clientX;
    _ckrbLeftDownY = e.clientY;
  }, true);

  document.addEventListener('mouseup', function(e) {
    if (e.button !== 0) return;                       // left button only
    var wasLeftDrag = _ckrbLeftDragActive;
    _ckrbLeftDragActive = false;

    // (a) v276: Left-click removes yellow overlay at click position — ALWAYS,
    // even outside review mode, so overlays never get stuck on the page.
    // Overlays have pointer-events:none so we check by coordinates.
    if (_ckrbYellowOverlays.length && !wasLeftDrag) {
      var cx = e.clientX, cy = e.clientY;
      var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
      var px = cx + sx, py = cy + sy;
      for (var oi = _ckrbYellowOverlays.length - 1; oi >= 0; oi--) {
        var ov = _ckrbYellowOverlays[oi];
        var ol = parseFloat(ov.style.left) || 0;
        var ot = parseFloat(ov.style.top) || 0;
        var ow = parseFloat(ov.style.width) || 0;
        var oh = parseFloat(ov.style.height) || 0;
        if (px >= ol && px <= ol + ow && py >= ot && py <= ot + oh) {
          ov.remove();
          _ckrbYellowOverlays.splice(oi, 1);
          return; // consumed the click
        }
      }
    }

    if (!_ckrbHighlightTTSEnabled) return;
    // v211: Only yellow-wrap on qbank review pages, not random websites
    if (!_ckrbIsReviewMode()) return;
    var tgt = e.target;

    // Guard: only wrap if this mouseup is the end of a real LEFT drag
    if (!wasLeftDrag) return;

    // Don't try to wrap on clicks inside interactive UI
    if (tgt && tgt.closest) {
      if (tgt.closest('button, input, textarea, select, a, [data-ckrb-tts], [contenteditable="true"]')) return;
    }
    // Don't yellow-highlight answer-choice rows during exam taking
    if (typeof findAnswerRow === 'function' && findAnswerRow(tgt)) return;

    // v364: Require minimum 8px drag distance to prevent accidental highlights from scroll
    var _ldx = e.clientX - _ckrbLeftDownX, _ldy = e.clientY - _ckrbLeftDownY;
    if (Math.sqrt(_ldx * _ldx + _ldy * _ldy) < 8) return;

    // Defer one tick so the browser has finalized the selection
    setTimeout(function() {
      try {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        var txt = (sel.toString() || '').trim();
        // v364: Raised min length from 2 to 8 to prevent micro-selection highlights
        if (!txt || txt.length < 8) return;
        // Don't double-wrap an already-yellow span
        var r0 = sel.getRangeAt(0);
        var anc = r0.commonAncestorContainer;
        if (anc.nodeType === 3) anc = anc.parentNode;
        _ckrbWrapSelectionYellow();
        // v225: Clear selection immediately so user sees the final overlay color
        // without the ::selection style layered on top
        try { sel.removeAllRanges(); } catch(_) {}
      } catch(_) {}
    }, 0);
  }, false);

  // v218: Clear all yellow marks when question changes (prevents carry-over to next question)
  var _ckrbLastQuestionNum = null;
  try {
    var p = getProgress();
    if (p) _ckrbLastQuestionNum = p.current;
  } catch(_) {}
  setInterval(function() {
    try {
      var p = getProgress();
      if (p && p.current !== _ckrbLastQuestionNum) {
        _ckrbLastQuestionNum = p.current;
        _ckrbClearYellowOverlays();
      }
    } catch(_) {}
    // v422: Auto-detect wrong answers on review pages — recheck every 3s
    try { _ckrbAutoWrongAnswerUI(); } catch(_) {}
  }, 3000);

  // v420: Detect incorrectly answered questions and add UI directly from content script
  function _ckrbAutoWrongAnswerUI() {
    // Only on qbank review pages
    if (!_ckrbIsReviewMode()) { console.log('[AUTO_HL] Not review mode, skipping'); return; }
    console.log('[AUTO_HL] Review mode detected, checking for wrong answer...');
    // v423: Clear stale highlights from previous question before checking
    // Check if the question changed by comparing current question text
    var _curQText = '';
    try { var _qEl = document.querySelector('#questionPanel, [class*="questionContent"], [class*="stem"]'); if (_qEl) _curQText = _qEl.textContent.substring(0, 50); } catch(_) {}
    if (window._ckrbLastAutoQText && window._ckrbLastAutoQText !== _curQText) {
      // Question changed — clear old highlights and button
      document.querySelectorAll('.ckrb-wrong-para-hl').forEach(function(el) { el.classList.remove('ckrb-wrong-para-hl'); });
      var _oldBtn = document.getElementById('__ckrb_goto_hl_btn'); if (_oldBtn) _oldBtn.remove();
    }
    window._ckrbLastAutoQText = _curQText;
    // Find wrong answer row
    var rows = document.querySelectorAll('#answerContainer tr.answer-choice-background');
    var wrongRow = null;
    var wrongLetter = '';
    var letters = ['A','B','C','D','E','F','G','H'];
    for (var i = 0; i < rows.length; i++) {
      var hasTimes = !!rows[i].querySelector('.fa-times');
      var radio = rows[i].querySelector('mat-radio-button');
      var isSelected = radio && radio.classList.contains('mat-radio-checked');
      if (hasTimes && isSelected) { wrongRow = rows[i]; wrongLetter = letters[i] || ''; break; }
    }
    if (!wrongRow || !wrongLetter) { console.log('[AUTO_HL] No wrong answer row found'); return; }
    console.log('[AUTO_HL] Wrong answer: Choice ' + wrongLetter + ' (row found)');
    // v425: Re-apply highlight if missing
    var _hlExists = !!document.querySelector('.ckrb-wrong-para-hl');
    console.log('[AUTO_HL] Highlight exists=' + _hlExists + ' Button exists=' + !!document.getElementById('__ckrb_goto_hl_btn'));
    if (!_hlExists) {
      console.log('[AUTO_HL] Highlight MISSING — re-applying for Choice ' + wrongLetter);
      _ckrbHighlightWrongChoice(wrongLetter);
    }
    // Add 🔍 button next to wrong answer (only if not already there)
    var oldBtn = document.getElementById('__ckrb_goto_hl_btn');
    if (oldBtn) { console.log('[AUTO_HL] Button already exists, done'); return; }
    console.log('[AUTO_HL] Creating new 🔍 button for Choice ' + wrongLetter);
    var btn = document.createElement('button');
    btn.id = '__ckrb_goto_hl_btn';
    btn.type = 'button';
    btn.innerHTML = '\uD83D\uDD0D';
    btn.title = 'Scroll to explanation for Choice ' + wrongLetter;
    btn.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:8px;' +
      'font-size:16px;padding:5px 9px;line-height:1;' +
      'background:linear-gradient(180deg,#fb923c,#f97316);color:#fff;' +
      'border:2px solid #fdba74;border-bottom:4px solid #9a3412;border-radius:8px;' +
      'cursor:pointer;box-shadow:0 3px 0 #9a3412,0 4px 10px rgba(249,115,22,0.4);' +
      'transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);' +
      'text-shadow:0 1px 2px rgba(0,0,0,0.3);';
    btn.addEventListener('mouseenter', function() {
      btn.style.transform = 'translateY(-2px) scale(1.1)';
      btn.style.background = 'linear-gradient(180deg,#fdba74,#fb923c)';
      btn.style.borderColor = '#fed7aa';
      btn.style.boxShadow = '0 5px 0 #9a3412,0 6px 14px rgba(249,115,22,0.5)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.transform = '';
      btn.style.background = 'linear-gradient(180deg,#fb923c,#f97316)';
      btn.style.borderColor = '#fdba74';
      btn.style.boxShadow = '0 3px 0 #9a3412,0 4px 10px rgba(249,115,22,0.4)';
    });
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
      if (hl) { hl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else { btn.style.background='linear-gradient(180deg,#ef4444,#dc2626)'; setTimeout(function(){btn.style.background='linear-gradient(180deg,#fb923c,#f97316)';},2000); }
    });
    _ckrb3dBtn(btn); // v423: Wire up hover/click sounds
    var tds = wrongRow.querySelectorAll('td');
    (tds.length ? tds[tds.length - 1] : wrongRow).appendChild(btn);
    // Also re-apply highlight if missing
    if (!document.querySelector('.ckrb-wrong-para-hl')) _ckrbHighlightWrongChoice(wrongLetter);
    console.log('[CK Buddy] Auto-detected wrong answer: Choice ' + wrongLetter + ' — added button + highlight');
  }

  /* ── HIGHLIGHT-TO-SPEECH (all platforms + ccscases) ── */
  // Force-enable text selection (ccscases.com disables it via CSS)
  // v211: Only inject user-select unlock globally; yellow ::selection only on qbank sites
  try {
    var _ckrbSelStyle = document.createElement('style');
    _ckrbSelStyle.id = '__ckrb_sel_override';
    var _ckrbIsQbankSite = /uworld\.com|amboss\.com|starttest\.com|nbme\.org|ccscases\.com/i.test(location.hostname || '');
    var _selRules = [
      '*, *::before, *::after {',
      '  user-select: text !important;',
      '  -webkit-user-select: text !important;',
      '  -moz-user-select: text !important;',
      '  -ms-user-select: text !important;',
      '}'
    ];
    if (_ckrbIsQbankSite) {
      _selRules.push('::selection      { background: #fde047 !important; color: #000 !important; }');
      _selRules.push('::-moz-selection { background: #fde047 !important; color: #000 !important; }');
    }
    // v222: CCS Cases — remove dark backgrounds from grading page so text is readable
    if (/ccscases\.com/i.test(location.hostname || '')) {
      _selRules.push('.newGradingPageWrapper, .newGradingCaseSummaryContainer { background: transparent !important; }');
      _selRules.push('.newGradingPageWrapper *, .newGradingCaseSummaryContainer * { color: #1e293b !important; }');
    }
    _ckrbSelStyle.textContent = _selRules.join('\n');
    (document.head || document.documentElement).appendChild(_ckrbSelStyle);
  } catch(e) {}
  ['selectstart', 'dragstart'].forEach(function(evt) {
    document.addEventListener(evt, function(e) { e.stopPropagation(); }, true);
  });

  // Toggle state — read from storage, listen for changes
  var _ckrbHighlightTTSEnabled = true;
  try {
    chrome.storage.local.get(['ckrb_highlight_tts'], function(r) {
      if (r && typeof r.ckrb_highlight_tts === 'boolean') _ckrbHighlightTTSEnabled = r.ckrb_highlight_tts;
    });
    chrome.storage.onChanged.addListener(function(changes) {
      if (changes.ckrb_highlight_tts) _ckrbHighlightTTSEnabled = !!changes.ckrb_highlight_tts.newValue;
    });
  } catch(e) {}

  // Detect if user is actively TAKING an exam (vs. reviewing it).
  // In test mode there is no revealed explanation/correct-answer UI. We suppress
  // the highlight→TTS popover so the TTS button doesn't hijack highlighting
  // during real testing. Returns true ONLY when we're confident it's review mode.
  function _ckrbIsReviewMode() {
    try {
      // UWorld: explanation container is present and has real content in review
      var uwExpl = document.getElementById('explanation-container')
                || document.getElementById('explanation')
                || document.getElementById('first-explanation')
                || document.querySelector('.explanation-container');
      if (uwExpl && (uwExpl.innerText || '').trim().length > 80) return true;
      // UWorld review also shows fa-check/fa-times icons on answer rows
      if (document.querySelector('#answerContainer .fa-check, #answerContainer .fa-times')) return true;

      // AMBOSS: explanationContainer with correctAnswerExplanation class in review
      var amExpl = document.querySelector('div[class*="explanationContainer"][class*="correctAnswerExplanation"]');
      if (amExpl && (amExpl.innerText || '').trim().length > 80) return true;
      // AMBOSS review shows answer-theme divs with userFirstAttempt / answerOptionCorrect markers
      if (document.querySelector('[data-e2e-test-id*="userFirstAttempt"], [data-e2e-test-id*="answerOptionCorrect"]')) return true;

      // NBME: review shows the answer-key / "Correct Answer" marker
      var bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
      if (/Correct\s+Answer\s*:/i.test(bodyText) && /Explanation/i.test(bodyText)) return true;

      // CCS Cases: review page shows "Average Orders" + "Z-score" stats panels
      // (only rendered after a case is completed / when viewing review)
      try {
        var host = (location && location.hostname) || '';
        if (host.indexOf('ccscases.com') !== -1) {
          if (/Average\s+Orders/i.test(bodyText) && /Z[- ]?score/i.test(bodyText)) return true;
          // Also true if we see the feedback/rationale prose anchors
          if (/Your\s+Z[- ]?score/i.test(bodyText)) return true;
        }
      } catch(_) {}

      return false;
    } catch(e) { return false; }
  }

  var _ckrbTTSBtn = null;
  var _ckrbTTSSpeaking = false;

  function _ckrbTopDoc() {
    var w = window;
    try {
      while (w.parent && w.parent !== w) {
        var _probe = w.parent.document;
        if (!_probe) break;
        w = w.parent;
      }
    } catch(e) {}
    try { return w.document; } catch(e) { return document; }
  }

  function _ckrbRemoveTTSBtn() {
    if (_ckrbTTSBtn && _ckrbTTSBtn.parentNode) {
      _ckrbTTSBtn.parentNode.removeChild(_ckrbTTSBtn);
    }
    _ckrbTTSBtn = null;
    try {
      var topDoc = _ckrbTopDoc();
      var strays = topDoc.querySelectorAll('button[data-ckrb-tts="true"]');
      for (var i = 0; i < strays.length; i++) strays[i].parentNode && strays[i].parentNode.removeChild(strays[i]);
    } catch(e) {}
  }

  /* ── Q-BANK IN-PLACE WORD HIGHLIGHT ──
     Highlights the currently-spoken word directly on the page's own text,
     using the user's original selection Range to walk the real DOM nodes.
     We do NOT mutate UWorld/AMBOSS/NBME's DOM — we draw a floating overlay
     <div> positioned over each word's bounding rect, and move it on every
     onboundary event. */
  var _ckrbSentenceBadges = [];      // [{el, range}] for scroll repositioning
  var _ckrbWordRanges = [];         // [{range, text, charOffset}]
  var _ckrbHighlightOverlay = null; // the single moving highlight rectangle
  var _ckrbHighlightRange = null;   // range currently under the active overlay
  var _ckrbSpokenOverlays = [];     // [{el, range}] faded overlays for already-spoken words
  var _ckrbHighlightIdx = -1;
  var _ckrbScrollHandler = null;
  // v156: monotonic ID for in-flight speak() calls. Re-pressing the popup
  // "Read Explanation" button while the previous utterance is still queueing
  // used to race: the prior call's 60ms-deferred speak() would fire AFTER
  // the new call's cancel(), leaving the engine in a stuck state. Now every
  // call grabs its own seq and the deferred speak() bails if a newer call
  // has superseded it.
  var _ckrbSpeakSeq = 0;
  var _ckrbAzureDown = false; // v287: set true after Azure 429/fail — skips retries, uses local TTS
  // v156c: REMOVED the 10s pause()→resume() keep-alive — it was stalling
  // Brave's speech engine mid-utterance, causing silent playback. The
  // visibilitychange resume below is enough for tab-switching. No-op
  // stubs kept so existing call sites don't need to change.
  function _ckrbStartKeepAlive(_h) {}
  function _ckrbStopKeepAlive() {}
  // Re-resume on tab focus regain. Only attach once per page.
  if (!window._ckrbVisHooked) {
    window._ckrbVisHooked = true;
    try {
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
          try {
            var ss = (window.parent && window.parent.speechSynthesis) ? window.parent.speechSynthesis : window.speechSynthesis;
            if (ss && (ss.paused || ss.speaking)) ss.resume();
          } catch(_) {}
        }
      });
    } catch(_) {}
  }

  // v156d: PRIME the voice list. Brave loads voices asynchronously — on first
  // page load, speechSynthesis.getVoices() often returns [] until the
  // voiceschanged event fires. When our _ckrbSpeak runs before that, we end
  // up filtering from an empty list, never assign u.voice, and Brave
  // silently drops the utterance (no audio, no onstart, no onerror). Calling
  // getVoices() once eagerly + subscribing to voiceschanged guarantees the
  // list is populated by the time the user clicks 🔊 Read.
  if (!window._ckrbVoicesPrimed) {
    window._ckrbVoicesPrimed = true;
    try {
      var _primeSS = window.speechSynthesis;
      if (_primeSS) {
        try { _primeSS.getVoices(); } catch(_) {}
        try { _primeSS.addEventListener('voiceschanged', function(){ try { _primeSS.getVoices(); } catch(_) {} }); } catch(_) {}
        // Belt-and-suspenders: some builds don't fire voiceschanged at all,
        // so we also poll for up to 3s after load.
        var _vTries = 0;
        var _vIv = setInterval(function(){
          _vTries++;
          try { if (_primeSS.getVoices().length > 0 || _vTries > 30) clearInterval(_vIv); } catch(_) { clearInterval(_vIv); }
        }, 100);
      }
    } catch(_) {}
  }
  var _ckrbResizeHandler = null;
  var _ckrbCleanupTimer = null;

  // Aggressively purge any highlight DOM left over from a prior TTS session or
  // a previous extension version. Sweeps top doc, current doc, and any
  // same-origin iframes. Safe to call repeatedly.
  function _ckrbPurgeAllHighlightMarkers() {
    // v308: Aggressive purge — collect ALL reachable documents
    var docs = [document];
    try { if (window.top && window.top.document && docs.indexOf(window.top.document) === -1) docs.push(window.top.document); } catch(e) {}
    try {
      var allFrames = document.querySelectorAll('iframe');
      for (var f = 0; f < allFrames.length; f++) {
        try { var d2 = allFrames[f].contentDocument; if (d2 && docs.indexOf(d2) === -1) docs.push(d2); } catch(_) {}
      }
    } catch(e) {}
    // Also try top doc's iframes
    try {
      if (window.top && window.top.document) {
        var topFrames = window.top.document.querySelectorAll('iframe');
        for (var f2 = 0; f2 < topFrames.length; f2++) {
          try { var d3 = topFrames[f2].contentDocument; if (d3 && docs.indexOf(d3) === -1) docs.push(d3); } catch(_) {}
        }
      }
    } catch(e) {}
    for (var d = 0; d < docs.length; d++) {
      var doc = docs[d];
      if (!doc) continue;
      try {
        var strays = doc.querySelectorAll('[data-ckrb-hl="true"],[data-ckrb-hl-spoken="true"]');
        for (var i = 0; i < strays.length; i++) {
          try { strays[i].parentNode.removeChild(strays[i]); } catch(e) {}
        }
      } catch(e) {}
    }
    // v308: Also null out the JS reference so _ckrbEnsureOverlay creates fresh
    _ckrbHighlightOverlay = null;
    _ckrbHighlightRange = null;
  }

  function _ckrbDetachReflowListeners() {
    try {
      var hostWin = (_ckrbTopDoc().defaultView || window);
      if (_ckrbScrollHandler) hostWin.removeEventListener('scroll', _ckrbScrollHandler, true);
      if (_ckrbResizeHandler) hostWin.removeEventListener('resize', _ckrbResizeHandler, true);
    } catch(e) {}
    _ckrbScrollHandler = null;
    _ckrbResizeHandler = null;
  }

  function _ckrbAttachReflowListeners() {
    _ckrbDetachReflowListeners();
    try {
      var hostWin = (_ckrbTopDoc().defaultView || window);
      _ckrbScrollHandler = function() { _ckrbRepositionAllMarkers(); };
      _ckrbResizeHandler = function() { _ckrbRepositionAllMarkers(); };
      // Capture phase so we catch scrolls on inner scroll containers too
      hostWin.addEventListener('scroll', _ckrbScrollHandler, true);
      hostWin.addEventListener('resize', _ckrbResizeHandler, true);
    } catch(e) {}
  }

  function _ckrbRemoveInPlaceHighlight() {
    if (_ckrbCleanupTimer) { try { clearTimeout(_ckrbCleanupTimer); } catch(e) {} _ckrbCleanupTimer = null; }
    // v312: Do NOT remove badges here — runs from ALL frames and kills badges from TTS frame
    _ckrbPurgeAllHighlightMarkers();
    _ckrbDetachReflowListeners();
    _ckrbWordRanges = [];
    _ckrbHighlightOverlay = null;
    _ckrbHighlightRange = null;
    _ckrbSpokenOverlays = [];
    _ckrbHighlightIdx = -1;
  }

  // Re-query each tracked range's current bounding rect and reposition its
  // overlay element. Called on scroll/resize so markers follow the page.

  // v311: Inject superscript sentence number badges as absolutely-positioned overlays
  // Does NOT mutate the DOM text — uses getBoundingClientRect like the highlight system
  function _ckrbInjectSentenceNumbers(chunkJobs) {
    _ckrbRemoveSentenceNumbers(); // clean any prior badges
    _ckrbSentenceBadges = [];
    var colors = ['#818cf8','#f472b6','#34d399','#fbbf24','#38bdf8','#fb923c','#a78bfa','#f87171','#2dd4bf','#e879f9'];
    var topDoc = _ckrbTopDoc();
    var hostWin = topDoc.defaultView || window;
    var sx = hostWin.pageXOffset || 0;
    var sy = hostWin.pageYOffset || 0;
    var off = _ckrbFrameOffsetToTop();
    for (var i = 0; i < chunkJobs.length; i++) {
      var job = chunkJobs[i];
      if (job.domStart >= _ckrbWordRanges.length) continue;
      var wr = _ckrbWordRanges[job.domStart];
      if (!wr || !wr.range) continue;
      var rect = _ckrbGetRangeRect(wr.range);
      if (!rect) continue;
      try {
        var badge = topDoc.createElement('div');
        badge.className = 'ckrb-sentence-badge';
        badge.setAttribute('data-ckrb-snum', String(i + 1));
        var color = colors[i % colors.length];
        badge.style.cssText = 'position:absolute;z-index:2147483645;' +
          'left:' + (rect.left + sx + off.dx - 20) + 'px;' +
          'top:' + (rect.top + sy + off.dy - 6) + 'px;' +
          'width:18px;height:18px;border-radius:50%;' +
          'font-size:10px;font-weight:800;color:#fff;line-height:18px;text-align:center;' +
          'background:' + color + ';' +
          'box-shadow:0 2px 6px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;' +
          'pointer-events:none;user-select:none;' +
          'border:1.5px solid rgba(255,255,255,0.6);text-shadow:0 1px 1px rgba(0,0,0,0.4);';
        badge.textContent = String(i + 1);
        topDoc.body.appendChild(badge);
        _ckrbSentenceBadges.push({ el: badge, range: wr.range });
      } catch(e) { console.log('[CK Buddy] badge overlay error for sentence ' + (i+1) + ':', e); }
    }
  }

  function _ckrbRemoveSentenceNumbers() {
    _ckrbSentenceBadges = [];
    // v311: Badges are now in topDoc as absolute overlays
    try {
      var topDoc = _ckrbTopDoc();
      var badges = topDoc.querySelectorAll('.ckrb-sentence-badge');
      for (var i = 0; i < badges.length; i++) {
        try { badges[i].parentNode.removeChild(badges[i]); } catch(e) {}
      }
    } catch(e) {}
    try {
      // Also clean from current document in case of cross-frame
      var badges2 = document.querySelectorAll('.ckrb-sentence-badge');
      for (var j = 0; j < badges2.length; j++) {
        try { badges2[j].parentNode.removeChild(badges2[j]); } catch(e) {}
      }
      // Also check iframes
      var frames = document.querySelectorAll('iframe');
      for (var f = 0; f < frames.length; f++) {
        try {
          var fd = frames[f].contentDocument;
          if (fd) {
            var fb = fd.querySelectorAll('.ckrb-sentence-badge');
            for (var j = 0; j < fb.length; j++) {
              try { fb[j].parentNode.removeChild(fb[j]); } catch(e) {}
            }
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  function _ckrbRepositionAllMarkers() {
    try {
      var hostWin = (_ckrbTopDoc().defaultView || window);
      var sx = hostWin.pageXOffset || 0;
      var sy = hostWin.pageYOffset || 0;
      var off = _ckrbFrameOffsetToTop();
      if (_ckrbHighlightOverlay && _ckrbHighlightRange) {
        try {
          var rect = _ckrbHighlightRange.getBoundingClientRect();
          if (rect && (rect.width || rect.height)) {
            _ckrbHighlightOverlay.style.left = (rect.left + sx + off.dx - 2) + 'px';
            _ckrbHighlightOverlay.style.top = (rect.top + sy + off.dy - 2) + 'px';
            _ckrbHighlightOverlay.style.width = (rect.width + 4) + 'px';
            _ckrbHighlightOverlay.style.height = (rect.height + 4) + 'px';
          }
        } catch(e) {}
      }
      // v314: Reposition sentence number badges on scroll
      for (var bi = 0; bi < _ckrbSentenceBadges.length; bi++) {
        var badge = _ckrbSentenceBadges[bi];
        if (!badge || !badge.el || !badge.range) continue;
        try {
          var br = _ckrbGetRangeRect(badge.range);
          if (br && (br.width || br.height)) {
            badge.el.style.left = (br.left + sx + off.dx - 20) + 'px';
            badge.el.style.top = (br.top + sy + off.dy - 6) + 'px';
          }
        } catch(e) {}
      }
      for (var i = 0; i < _ckrbSpokenOverlays.length; i++) {
        var entry = _ckrbSpokenOverlays[i];
        if (!entry || !entry.el || !entry.range) continue;
        try {
          var r = entry.range.getBoundingClientRect();
          if (!r || (!r.width && !r.height)) continue;
          entry.el.style.left = (r.left + sx + off.dx - 1) + 'px';
          entry.el.style.top = (r.top + sy + off.dy - 1) + 'px';
          entry.el.style.width = (r.width + 2) + 'px';
          entry.el.style.height = (r.height + 2) + 'px';
        } catch(e) {}
      }
    } catch(e) {}
  }

  // Build word-level Range objects within the user's original selection so we
  // can ask each one for its bounding rect at highlight time. Walks the range's
  // text nodes (honoring start/end offsets) and tokenizes each into \S+ words.
  // Returns true if a text node is actually rendered to the user (not inside
  // display:none, visibility:hidden, opacity:0, aria-hidden, [hidden], etc.).
  // Matters because the TTS engine speaks only what's visible, while a naive
  // DOM walk happily collects invisible text nodes — causing a consistent
  // off-by-N drift between the spoken word and the highlighted word.
  function _ckrbIsTextNodeVisible(node) {
    try {
      var p = node.parentElement;
      if (!p) return false;

      // Walk up to check ALL ancestors, not just the immediate parent.
      // Screen-reader-only wrappers are often 2-3 levels up.
      var ancestor = p;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        var cs = null;
        try {
          cs = (node.ownerDocument && node.ownerDocument.defaultView)
            ? node.ownerDocument.defaultView.getComputedStyle(ancestor) : null;
        } catch(_) {}

        if (cs) {
          if (cs.display === 'none') return false;
          if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
          if (parseFloat(cs.opacity || '1') === 0) return false;

          // Screen-reader-only patterns: clip, clip-path, tiny dimensions + overflow
          var clip = cs.clip || cs.getPropertyValue('clip') || '';
          if (clip && clip !== 'auto' && /rect\s*\(\s*0/.test(clip)) return false;
          var clipPath = cs.clipPath || cs.getPropertyValue('clip-path') || '';
          if (clipPath && clipPath !== 'none' && /inset\s*\(\s*50%/.test(clipPath)) return false;

          // Tiny container with overflow:hidden = screen-reader trick
          var ow = parseFloat(cs.width) || 0;
          var oh = parseFloat(cs.height) || 0;
          var overflow = cs.overflow || '';
          if (ow <= 1 && oh <= 1 && /hidden|clip/.test(overflow)) return false;

          // Off-screen positioning
          var pos = cs.position || '';
          if (pos === 'absolute' || pos === 'fixed') {
            var left = parseFloat(cs.left) || 0;
            var top = parseFloat(cs.top) || 0;
            if (left < -500 || top < -500) return false;
          }
        }

        // Attribute-based hidden patterns
        if (ancestor.hasAttribute && ancestor.hasAttribute('hidden')) return false;
        if (ancestor.getAttribute && ancestor.getAttribute('aria-hidden') === 'true') return false;

        // Common screen-reader-only CSS class names
        var cls = (ancestor.className || '').toString().toLowerCase();
        if (/\b(sr-only|visually-hidden|screen-reader|a11y-hidden|offscreen|clip-hide)\b/.test(cls)) return false;

        ancestor = ancestor.parentElement;
      }

      // Cheapest check: getClientRects on the immediate parent
      if (typeof p.getClientRects === 'function') {
        var rects = p.getClientRects();
        if (!rects || rects.length === 0) return false;
      }

      // Check the text node's own bounding rect
      try {
        var r = node.ownerDocument.createRange();
        r.selectNodeContents(node);
        var rr = r.getBoundingClientRect();
        if (!rr || (rr.width === 0 && rr.height === 0)) return false;
        // Off-screen text nodes (negative coords far off viewport)
        if (rr.right < -100 || rr.bottom < -100) return false;
      } catch(_) {}

      return true;
    } catch(e) { return true; }
  }

  function _ckrbCollectWordRanges(range) {
    var words = [];
    if (!range) return words;
    var root = range.commonAncestorContainer;
    // If the commonAncestor itself is a text node, handle directly
    var textNodes = [];
    if (root.nodeType === 3) {
      if (_ckrbIsTextNodeVisible(root)) textNodes.push(root);
    } else {
      try {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: function(n) {
            try {
              if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
              if (!_ckrbIsTextNodeVisible(n)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            } catch(e) { return NodeFilter.FILTER_ACCEPT; }
          }
        });
        var n;
        while ((n = walker.nextNode())) textNodes.push(n);
      } catch(e) {}
    }
    var cumulative = 0;
    for (var ti = 0; ti < textNodes.length; ti++) {
      var node = textNodes[ti];
      var data = node.data || '';
      var startOffset = (node === range.startContainer) ? range.startOffset : 0;
      var endOffset = (node === range.endContainer) ? range.endOffset : data.length;
      if (endOffset <= startOffset) continue;
      var clipped = data.slice(startOffset, endOffset);
      var wRe = /[^\s\-]+/g;
      var wm;
      while ((wm = wRe.exec(clipped)) !== null) {
        if (!/[a-zA-Z0-9]/.test(wm[0])) continue; // skip pure punctuation
        try {
          var r = document.createRange();
          r.setStart(node, startOffset + wm.index);
          r.setEnd(node, startOffset + wm.index + wm[0].length);
          words.push({ range: r, text: wm[0], charOffset: cumulative + wm.index });
        } catch(e) {}
      }
      cumulative += clipped.length + 1; // +1 approximates the whitespace between nodes
    }
    return words;
  }

  function _ckrbEnsureOverlay() {
    var topDoc = _ckrbTopDoc();
    if (!_ckrbHighlightOverlay || !_ckrbHighlightOverlay.parentNode) {
      var o = topDoc.createElement('div');
      o.setAttribute('data-ckrb-hl', 'true');
      // position:absolute with document-relative coords so the overlay scrolls with the page
      // v156e: dropped the 90ms CSS transition. Brave fires onboundary after
      // audio has already started the word, so any animation delay just
      // compounds the perceived lag. Snap overlay instantly to target.
      o.style.cssText = 'position:absolute;pointer-events:none;background:rgba(249,115,22,0.55);border:2px solid #f97316;border-radius:4px;box-shadow:0 0 12px rgba(249,115,22,0.6);z-index:2147483646;';
      topDoc.body.appendChild(o);
      _ckrbHighlightOverlay = o;
      _ckrbAttachReflowListeners();
    }
    return _ckrbHighlightOverlay;
  }

  // v209: Get a usable bounding rect from a Range, with fallback to parent element
  function _ckrbGetRangeRect(range) {
    try {
      var rect = range.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) return rect;
      // Fallback: try getClientRects (sometimes works when getBoundingClientRect doesn't)
      var rects = range.getClientRects();
      if (rects && rects.length > 0 && (rects[0].width > 0 || rects[0].height > 0)) return rects[0];
      // Fallback: use parent element's rect
      var parent = range.startContainer.parentElement || range.startContainer.parentNode;
      if (parent && parent.getBoundingClientRect) {
        rect = parent.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) return rect;
      }
      return null;
    } catch(_) { return null; }
  }

  function _ckrbMoveOverlayToRange(range) {
    try {
      var rect = _ckrbGetRangeRect(range);
      if (!rect) return false;
      // Translate to top document coords if we're in a nested frame, and add
      // scroll offset so overlay lives in page/document space (scrolls with content)
      var off = _ckrbFrameOffsetToTop();
      var hostWin = (_ckrbTopDoc().defaultView || window);
      var sx = hostWin.pageXOffset || 0;
      var sy = hostWin.pageYOffset || 0;
      var overlay = _ckrbEnsureOverlay();
      overlay.style.left = (rect.left + sx + off.dx - 2) + 'px';
      overlay.style.top = (rect.top + sy + off.dy - 2) + 'px';
      overlay.style.width = (rect.width + 4) + 'px';
      overlay.style.height = (rect.height + 4) + 'px';
      _ckrbHighlightRange = range;
      // Keep word visible (gentle auto-scroll only if it leaves the viewport)
      var vh = hostWin.innerHeight || 800;
      if (rect.bottom + off.dy > vh - 40 || rect.top + off.dy < 60) {
        try { range.startContainer.parentElement && range.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) {}
      }
      return true;
    } catch(e) { return false; }
  }

  // DISABLED in v155: the grey "already-spoken" trail rectangles were messy
  // and persisted on the page after TTS, obstructing images that loaded
  // later. The active orange word-overlay is enough visual feedback. We keep
  // this function as a no-op so all existing call sites stay valid, and we
  // also defensively purge any pre-existing grey markers on every TTS start.
  function _ckrbDropSpokenMarker(range) { /* no-op — see comment above */ }

  function _ckrbHighlightWordByIndex(idx) {
    if (idx < 0 || idx >= _ckrbWordRanges.length) return;
    if (idx === _ckrbHighlightIdx) return;
    // Mark prior active word as "spoken"
    if (_ckrbHighlightIdx >= 0 && _ckrbHighlightIdx < _ckrbWordRanges.length) {
      _ckrbDropSpokenMarker(_ckrbWordRanges[_ckrbHighlightIdx].range);
    }
    _ckrbHighlightIdx = idx;
    _ckrbMoveOverlayToRange(_ckrbWordRanges[idx].range);
  }

  // Fallback timer-based highlighter for engines that don't fire onboundary
  // reliably (Safari, some Chromium builds in extension context). Estimates
  // per-word timing from utterance length and rate.
  var _ckrbBoundaryFired = false;
  var _ckrbFallbackTimer = null;
  function _ckrbStartFallbackHighlight(totalMs) {
    if (_ckrbFallbackTimer) { clearInterval(_ckrbFallbackTimer); _ckrbFallbackTimer = null; }
    var start = Date.now();
    _ckrbFallbackTimer = setInterval(function() {
      if (_ckrbBoundaryFired) { clearInterval(_ckrbFallbackTimer); _ckrbFallbackTimer = null; return; }
      var elapsed = Date.now() - start;
      var n = _ckrbWordRanges.length;
      if (!n || elapsed >= totalMs) { clearInterval(_ckrbFallbackTimer); _ckrbFallbackTimer = null; return; }
      var idx = Math.min(n - 1, Math.floor((elapsed / totalMs) * n));
      _ckrbHighlightWordByIndex(idx);
    }, 120);
  }
  function _ckrbStopFallbackHighlight() {
    if (_ckrbFallbackTimer) { clearInterval(_ckrbFallbackTimer); _ckrbFallbackTimer = null; }
  }

  // v156e: Azure Speech integration (precise word-sync TTS).
  // When the user has configured a key + region in settings, we synthesize the
  // explanation via Azure's REST endpoint, play the returned MP3 through an
  // <audio> element, and drive the word overlay off audio.currentTime with a
  // per-word start-time table calibrated against the audio's true duration.
  // This replaces the speechSynthesis onboundary callbacks that were firing on
  // the engine's internal clock (ignoring the audio pauses Brave inserts at
  // punctuation), which was why the highlight drifted further behind after
  // every comma / period / colon.
  var _ckrbAzureAudio = null;
  var _ckrbAzureRaf = 0;
  function _ckrbEscapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function _ckrbStopAzureAudio() {
    try { if (_ckrbAzureRaf) cancelAnimationFrame(_ckrbAzureRaf); } catch(_) {}
    _ckrbAzureRaf = 0;
    if (_ckrbAzureAudio) {
      try { _ckrbAzureAudio.pause(); } catch(_) {}
      try { if (_ckrbAzureAudio.src && _ckrbAzureAudio.src.indexOf('blob:') === 0) URL.revokeObjectURL(_ckrbAzureAudio.src); } catch(_) {}
      _ckrbAzureAudio = null;
    }
  }
  // Detect silent regions in a decoded audio buffer. These correspond to the
  // real pauses Azure inserts at punctuation — no heuristic required.
  function _ckrbDetectSilences(audioBuffer) {
    var sr = audioBuffer.sampleRate;
    var ch = audioBuffer.getChannelData(0);
    var frameMs = 20;
    var frameSize = Math.max(1, Math.floor(sr * frameMs / 1000));
    var numFrames = Math.floor(ch.length / frameSize);
    var rms = new Float32Array(numFrames);
    var maxRms = 0;
    for (var f = 0; f < numFrames; f++) {
      var s = 0;
      var base = f * frameSize;
      for (var k = 0; k < frameSize; k++) {
        var v = ch[base + k];
        s += v * v;
      }
      var r = Math.sqrt(s / frameSize);
      rms[f] = r;
      if (r > maxRms) maxRms = r;
    }
    // Threshold: frames below 8% of peak are considered silent.
    var thr = Math.max(0.004, maxRms * 0.08);
    // Collapse consecutive silent frames into regions.
    var minSilenceFrames = Math.max(3, Math.floor(70 / frameMs)); // >= 70ms
    var regions = [];
    var i = 0;
    while (i < numFrames) {
      if (rms[i] < thr) {
        var start = i;
        while (i < numFrames && rms[i] < thr) i++;
        var end = i;
        if (end - start >= minSilenceFrames) {
          regions.push({
            start: start * frameMs / 1000,
            end:   end   * frameMs / 1000,
            dur:   (end - start) * frameMs / 1000
          });
        }
      } else {
        i++;
      }
    }
    return regions;
  }

  // Build per-word start times using REAL pause locations detected in the decoded
  // audio. We split the text at every punctuation-terminated word, find that many
  // internal silences in the audio, and anchor each segment's boundary to the real
  // silence positions. Within each punctuation-free segment, words are distributed
  // by character count (accurate because there's no punctuation drift within).
  function _ckrbBuildWordTimesFromRealAudio(text, audioBuffer) {
    var totalSec = audioBuffer.duration;
    var wordRe = /\S+/g;
    var words = [];
    var m;
    while ((m = wordRe.exec(text)) !== null) {
      words.push({ text: m[0] });
    }
    if (!words.length) return [];
    var isAnchor = function(w) { return /[,.;:!?]$/.test(w); };
    var punctIdx = [];
    for (var k = 0; k < words.length; k++) {
      if (isAnchor(words[k].text)) punctIdx.push(k);
    }
    var silences = _ckrbDetectSilences(audioBuffer);
    // Leading silence (before first word) — shift segment 0 start to its end.
    var leadStart = 0;
    if (silences.length && silences[0].start < 0.04) {
      leadStart = silences[0].end;
      silences.shift();
    }
    // Trailing silence — ignore it so the last segment ends where speech ends.
    var tailEnd = totalSec;
    if (silences.length && silences[silences.length - 1].end >= totalSec - 0.05) {
      tailEnd = silences[silences.length - 1].start;
      silences.pop();
    }
    // Remaining silences are the "internal pauses". Pick the N longest where
    // N = # of punctuation marks we expect, and re-sort by time. This is robust
    // to spurious micro-silences inside long words.
    var expected = punctIdx.length;
    var pauses = silences;
    if (silences.length > expected) {
      var withIdx = silences.map(function(s, idx) { return { s: s, idx: idx }; });
      withIdx.sort(function(a, b) { return b.s.dur - a.s.dur; });
      pauses = withIdx.slice(0, expected).sort(function(a, b) { return a.idx - b.idx; }).map(function(x) { return x.s; });
    }
    // Build segments: each ends at a real pause (or at tailEnd for the last).
    var segments = [];
    var prevEnd = leadStart;
    var prevWord = 0;
    for (var p = 0; p < pauses.length; p++) {
      var lastWordInSeg = punctIdx[p];
      segments.push({
        fromWord: prevWord,
        toWord:   lastWordInSeg,
        startTime: prevEnd,
        endTime:   pauses[p].start
      });
      prevEnd = pauses[p].end;
      prevWord = lastWordInSeg + 1;
    }
    if (prevWord < words.length) {
      segments.push({
        fromWord: prevWord,
        toWord:   words.length - 1,
        startTime: prevEnd,
        endTime:   tailEnd
      });
    }
    // Distribute words within each segment by core char count.
    var starts = new Array(words.length);
    for (var sg = 0; sg < segments.length; sg++) {
      var seg = segments[sg];
      var segDur = Math.max(0.05, seg.endTime - seg.startTime);
      var totalChars = 0;
      for (var w = seg.fromWord; w <= seg.toWord; w++) {
        var core = words[w].text.replace(/[,.;:!?—\-]+$/, '');
        totalChars += Math.max(1, core.length);
      }
      var charsPerSec = totalChars / segDur;
      if (!isFinite(charsPerSec) || charsPerSec <= 0) charsPerSec = 14;
      var t = seg.startTime;
      for (var w2 = seg.fromWord; w2 <= seg.toWord; w2++) {
        starts[w2] = t;
        var core2 = words[w2].text.replace(/[,.;:!?—\-]+$/, '');
        t += Math.max(1, core2.length) / charsPerSec;
      }
    }
    return starts;
  }

  // Fallback: heuristic pause-tax model if audio decode fails.
  function _ckrbBuildWordTimesFromAudio(text, totalSec) {
    var wordRe = /\S+/g;
    var words = [];
    var m;
    while ((m = wordRe.exec(text)) !== null) {
      words.push({ text: m[0] });
    }
    if (!words.length) return [];
    function pauseAfter(w) {
      var tp = w.text.match(/[,.;:!?—\-]+$/);
      tp = tp ? tp[0] : '';
      var pause = 0;
      for (var i = 0; i < tp.length; i++) {
        var c = tp[i];
        if (c === '.' || c === '!' || c === '?' || c === ':') pause += 0.32;
        else if (c === ';') pause += 0.22;
        else if (c === ',') pause += 0.16;
        else if (c === '—' || c === '-') pause += 0.12;
      }
      return pause;
    }
    var totalChars = 0, totalPause = 0;
    for (var i = 0; i < words.length; i++) {
      var core = words[i].text.replace(/[,.;:!?—\-]+$/, '');
      totalChars += core.length;
      totalPause += pauseAfter(words[i]);
    }
    var spokenSec = Math.max(0.2, totalSec - totalPause);
    var charsPerSec = totalChars / spokenSec;
    if (!isFinite(charsPerSec) || charsPerSec <= 0) charsPerSec = 14;
    var t = 0;
    var starts = new Array(words.length);
    for (var j = 0; j < words.length; j++) {
      starts[j] = t;
      var core2 = words[j].text.replace(/[,.;:!?—\-]+$/, '');
      t += core2.length / charsPerSec;
      t += pauseAfter(words[j]);
    }
    return starts;
  }

  // ── Sentence-by-sentence Azure SDK synthesis ──
  // Split the text into sentences, synthesize each independently, and chain
  // playback. Word boundaries reset per sentence so drift can never accumulate
  // across a long passage.

  function _ckrbSplitSentences(text) {
    // Split at every . ; : ! ? — keep it simple.
    // Each piece becomes its own TTS + highlight job.
    var parts = text.split(/(?<=[.;:!?])\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p) out.push(p);
    }
    return out.length ? out : [text];
  }

  function _ckrbCountWords(str) {
    var m = str.match(/\S+/g);
    return m ? m.length : 0;
  }

  // ── Debug banner: shows which TTS path was taken ──
  function _ckrbShowDebugBanner(msg, color) {
    var old = document.getElementById('ckrb-debug-banner');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'ckrb-debug-banner';
    d.textContent = '[CK Buddy v' + CKRB_VERSION + '] ' + msg;
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;padding:8px 16px;' +
      'font-size:14px;font-weight:bold;font-family:monospace;text-align:center;color:#fff;' +
      'background:' + (color || '#3b82f6') + ';';
    document.body.appendChild(d);
    setTimeout(function() { try { d.remove(); } catch(_) {} }, 8000);
  }

  function _ckrbSpeakAzure(text, range, key, region) {
    _ckrbStopAzureAudio();
    // Kill any local speechSynthesis that might be playing (prevents double-voice)
    try { window.speechSynthesis.cancel(); } catch(_) {}
    _ckrbBoundaryFired = true;
    _ckrbHighlightIdx = -1;
    _ckrbStopFallbackHighlight();
    if (_ckrbCleanupTimer) { try { clearTimeout(_ckrbCleanupTimer); } catch(_) {} _ckrbCleanupTimer = null; }
    _ckrbRemoveInPlaceHighlight();
    // v308: Delayed second purge to catch any overlays that survived
    setTimeout(function() { try { _ckrbPurgeAllHighlightMarkers(); } catch(e) {} }, 200);
    _ckrbTTSSpeaking = true;
    var mySeq = ++_ckrbSpeakSeq;

    var SDK = null;
    try { SDK = SpeechSDK; } catch(e1) { console.log('[CK Buddy TTS] SpeechSDK bare:', e1.message); }
    if (!SDK) try { SDK = window.SpeechSDK; } catch(e2) { console.log('[CK Buddy TTS] window.SpeechSDK:', e2.message); }
    if (!SDK) try { SDK = globalThis.SpeechSDK; } catch(e3) { console.log('[CK Buddy TTS] globalThis.SpeechSDK:', e3.message); }
    if (!SDK) {
      // v214: Fall back to REST API instead of failing — works on CCS Cases and other sites
      console.log('[CK Buddy TTS] SDK not found — falling back to Azure REST API');
      _ckrbShowDebugBanner('PATH: Azure REST fallback (no SDK)', '#22c55e');
      _ckrbSpeakAzureRest(text, range, key, region, mySeq);
      return;
    }
    console.log('[CK Buddy TTS] SDK found OK, using AzureSDK chunk mode');
    _ckrbShowDebugBanner('PATH: AzureSDK — chunk mode ON', '#22c55e');

    // ── Collect DOM words, skip pure-punctuation tokens ──
    var rawWords = _ckrbCollectWordRanges(range);
    _ckrbWordRanges = [];
    for (var i = 0; i < rawWords.length; i++) {
      if (/[a-zA-Z0-9]/.test(rawWords[i].text)) _ckrbWordRanges.push(rawWords[i]);
    }

    // ── Split text into chunks at . ; : ! ? ──
    var chunks = _ckrbSplitSentences(text);

    // v217: Anchor each sentence to the DOM by finding its first word — no running word count.
    // The old approach used a running pointer (domPtr) that drifted every sentence.
    // New approach: find where each sentence's first word appears in the DOM,
    // then each sentence runs from its anchor to the next sentence's anchor.

    function _findDomAnchor(searchFrom, sentenceText) {
      // v313: Extract first 3 alphanumeric words for multi-word matching
      // Single-word matching caused false hits on common words like "The", "A", "In"
      var tokens = sentenceText.match(/[^\s\-]+/g) || [];
      var matchWords = [];
      for (var t = 0; t < tokens.length && matchWords.length < 3; t++) {
        if (/[a-zA-Z0-9]/.test(tokens[t])) {
          matchWords.push(tokens[t].replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
        }
      }
      if (!matchWords.length) return searchFrom;

      function _domWordAt(idx) {
        if (idx < 0 || idx >= _ckrbWordRanges.length) return '';
        return _ckrbWordRanges[idx].text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      }

      // Try matching all 3 words first (most precise), then fall back to 2, then 1
      for (var nMatch = matchWords.length; nMatch >= 1; nMatch--) {
        for (var i = searchFrom; i < _ckrbWordRanges.length; i++) {
          if (_domWordAt(i) !== matchWords[0]) continue;
          // Check subsequent words
          var allMatch = true;
          for (var w = 1; w < nMatch; w++) {
            if (_domWordAt(i + w) !== matchWords[w]) { allMatch = false; break; }
          }
          if (allMatch) return i;
        }
      }
      // Also check a few words before searchFrom
      var lo = Math.max(0, searchFrom - 5);
      for (var i2 = lo; i2 < searchFrom; i2++) {
        if (_domWordAt(i2) === matchWords[0]) return i2;
      }
      return searchFrom; // fallback
    }

    var chunkJobs = [];
    // Step 1: Find DOM anchor for each sentence
    var anchors = [];
    var searchFrom = 0;
    for (var ci = 0; ci < chunks.length; ci++) {
      var anchor = _findDomAnchor(searchFrom, chunks[ci]);
      anchors.push(anchor);
      searchFrom = anchor + 1; // next sentence must be after this one
    }
    // Step 2: Each sentence runs from its anchor to the next sentence's anchor
    for (var ci2 = 0; ci2 < chunks.length; ci2++) {
      var start = anchors[ci2];
      var end = (ci2 + 1 < anchors.length) ? anchors[ci2 + 1] : _ckrbWordRanges.length;
      chunkJobs.push({ text: chunks[ci2], domStart: start, domEnd: end });
    }

    console.log('[CK Buddy TTS] ' + chunkJobs.length + ' chunks, ' + _ckrbWordRanges.length + ' DOM words');
    for (var d = 0; d < chunkJobs.length; d++) {
      var j = chunkJobs[d];
      console.log('  chunk ' + d + ': words[' + j.domStart + '..' + j.domEnd + '] first="' +
        (j.domStart < _ckrbWordRanges.length ? _ckrbWordRanges[j.domStart].text : '?') +
        '" text="' + j.text.substring(0, 40) + '…"');
    }

    // v307: Inject superscript sentence numbers into DOM
    _ckrbInjectSentenceNumbers(chunkJobs);

    var voice = 'en-US-JennyNeural';
    var cache = {};

    function synth(idx, cb, _retryCount) {
      _retryCount = _retryCount || 0;
      console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') called, retry=' + _retryCount + ' azureDown=' + _ckrbAzureDown + ' seqMatch=' + (mySeq === _ckrbSpeakSeq));
      if (mySeq !== _ckrbSpeakSeq) { console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') ABORTED: seq mismatch'); return; }
      if (idx >= chunkJobs.length) { console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') DONE: past last chunk'); if (cb) cb(null); return; }
      if (cache[idx]) { console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') CACHED: returning cached data'); if (cb) cb(cache[idx]); return; }
      // v287: Azure known down — skip everything, return null immediately for local TTS fallback
      if (_ckrbAzureDown) {
        console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') AZURE DOWN — returning null for local TTS');
        cache[idx] = null; if (cb) cb(null); return;
      }
      var ssml = "<speak version='1.0' xml:lang='en-US'><voice name='" + voice + "'>" +
        "<prosody rate='-5%'>" + _ckrbEscapeXml(chunkJobs[idx].text) + "</prosody></voice></speak>";
      // v288: single REST attempt (no retries — saves quota)
      function _synthRestOnce() {
        console.log('[CK Buddy TTS DEBUG] chunk ' + idx + ' trying REST API (single attempt)');
        fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'ckrb'
          },
          body: ssml
        }).then(function(resp) {
          console.log('[CK Buddy TTS DEBUG] chunk ' + idx + ' REST status=' + resp.status);
          if (!resp.ok) {
            if (resp.status === 429) {
              console.warn('[CK Buddy TTS] chunk ' + idx + ' REST 429 — Azure rate limited, flagging down');
              _ckrbAzureDown = true;
              // Auto-reset after 60s so Azure can recover
              setTimeout(function() { _ckrbAzureDown = false; console.log('[CK Buddy TTS] Azure down flag reset after 60s cooldown'); }, 60000);
            }
            throw new Error('REST ' + resp.status);
          }
          return resp.arrayBuffer().then(function(buf) {
            if (mySeq !== _ckrbSpeakSeq) return;
            console.log('[CK Buddy TTS DEBUG] chunk ' + idx + ' REST OK, ' + buf.byteLength + ' bytes');
            cache[idx] = { audioData: buf, boundaries: [] };
            if (cb) cb(cache[idx]);
          });
        }).catch(function(err) {
          if (mySeq !== _ckrbSpeakSeq) return;
          console.warn('[CK Buddy TTS] chunk ' + idx + ' REST failed: ' + (err && err.message || err));
          _ckrbAzureDown = true;
          setTimeout(function() { _ckrbAzureDown = false; console.log('[CK Buddy TTS] Azure down flag reset after 60s cooldown'); }, 60000);
          cache[idx] = null;
          if (cb) cb(null);
        });
      }
      // v288: SDK try once → REST try once → flag down. No retries. Saves Azure quota.
      try {
        console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') creating SDK synthesizer, key=' + key.substring(0,4) + '*** region=' + region);
        var sc = SDK.SpeechConfig.fromSubscription(key, region);
        sc.speechSynthesisVoiceName = voice;
        sc.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
        var s = new SDK.SpeechSynthesizer(sc, null);

        // Capture Azure word boundary events for precise timing
        var boundaries = [];
        s.wordBoundary = function(sender, ev) {
          if (ev && typeof ev.audioOffset === 'number' && typeof ev.textOffset === 'number') {
            boundaries.push({
              audioOffsetMs: ev.audioOffset / 10000,
              textOffset: ev.textOffset,
              wordLength: ev.wordLength || 0,
              text: ev.text || ''
            });
          }
        };

        s.speakSsmlAsync(ssml, function(result) {
          try { s.close(); } catch(_) {}
          console.log('[CK Buddy TTS DEBUG] synth(' + idx + ') SDK callback — hasResult:', !!result, 'hasAudio:', !!(result && result.audioData && result.audioData.byteLength), 'reason:', result && result.reason, 'err:', result && result.errorDetails);
          if (mySeq !== _ckrbSpeakSeq) return;
          if (result && result.audioData && result.audioData.byteLength) {
            console.log('[CK Buddy TTS] chunk ' + idx + ' SDK OK: ' + boundaries.length + ' boundaries, ' + result.audioData.byteLength + ' bytes');
            cache[idx] = { audioData: result.audioData, boundaries: boundaries };
            if (cb) cb(cache[idx]);
          } else {
            console.warn('[CK Buddy TTS] chunk ' + idx + ' SDK empty — trying REST once');
            _synthRestOnce();
          }
        }, function(err) {
          try { s.close(); } catch(_) {}
          console.warn('[CK Buddy TTS] chunk ' + idx + ' SDK error: ' + (err && err.message || err) + ' — trying REST once');
          _synthRestOnce();
        });
      } catch(e) {
        console.warn('[CK Buddy TTS] chunk ' + idx + ' SDK threw: ' + e.message + ' — trying REST once');
        _synthRestOnce();
      }
    }

    // ── Custom DOM confirm dialog (window.confirm may be blocked on UWorld) ──
    // v204: nextJob passed so Reposition can scan nearby DOM words
    // v208: okLabel parameter lets pre-play dialog say "Play" instead of "Next Sentence"
    // v216: nextJobIdx so reposition can clear cached audio for re-synthesis
    function showChunkConfirm(msg, onOk, onCancel, nextJob, okLabel, nextJobIdx, onBack, onReplay, _sentenceJump) {
      var btnLabel = okLabel || '▶ Next';
      var btnStyle = 'border:none;border-bottom:3px solid rgba(0,0,0,0.3);padding:9px 16px;border-radius:10px;font-size:13px;cursor:pointer;font-weight:600;margin:0 3px;transition:all 0.15s;text-shadow:0 1px 1px rgba(0,0,0,0.2);box-shadow:0 2px 6px rgba(0,0,0,0.3);';
      var overlay = document.createElement('div');
      overlay.id = 'ckrb-chunk-confirm';
      overlay.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
        'z-index:999999;pointer-events:none;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1e293b;color:#e2e8f0;padding:16px 24px;border-radius:12px;' +
        'max-width:480px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.5);text-align:center;pointer-events:auto;cursor:grab;' +
        'border:2px solid #6366f1;user-select:none;';
      // v307: Sentence picker — numbered circles for jumping to any sentence
      var sentPicker = '';
      if (chunkJobs && chunkJobs.length > 1) {
        var colors = ['#818cf8','#f472b6','#34d399','#fbbf24','#38bdf8','#fb923c','#a78bfa','#f87171','#2dd4bf','#e879f9'];
        var currentIdx = (typeof nextJobIdx === 'number') ? nextJobIdx : -1;
        sentPicker = '<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:5px;margin-top:10px;margin-bottom:6px;">';
        for (var si = 0; si < chunkJobs.length; si++) {
          var sc = colors[si % colors.length];
          var isActive = (si === currentIdx);
          var isDone = (si < currentIdx);
          var opacity = isDone ? '0.5' : '1';
          var ring = isActive ? 'box-shadow:0 0 0 3px #fff,0 0 12px ' + sc + ';' : '';
          var check = isDone ? '✓' : String(si + 1);
          sentPicker += '<button class="ckrb-sent-jump" data-sidx="' + si + '" style="' +
            'width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,0.6);' +
            'background:' + sc + ';color:#fff;font-size:11px;font-weight:800;cursor:pointer;' +
            'display:flex;align-items:center;justify-content:center;padding:0;' +
            'opacity:' + opacity + ';transition:all 0.15s;' + ring +
            'text-shadow:0 1px 1px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;' +
            '">' + check + '</button>';
        }
        sentPicker += '</div>';
      }

      var btns = '<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:4px;margin-top:14px;">';
      if (onBack) btns += '<button id="ckrb-confirm-back" style="' + btnStyle + 'background:#6366f1;color:white;">◀ Back</button>';
      if (onReplay) btns += '<button id="ckrb-confirm-replay" style="' + btnStyle + 'background:#8b5cf6;color:white;">↻ Replay</button>';
      btns += '<button id="ckrb-confirm-ok" style="' + btnStyle + 'background:#3b82f6;color:white;">' + btnLabel + '</button>';
      btns += '<button id="ckrb-confirm-cancel" style="' + btnStyle + 'background:#ef4444;color:white;">■ Stop</button>';
      btns += '</div>';
      box.innerHTML = '<div style="margin-bottom:4px;color:#94a3b8;font-size:12px;">' + msg + '</div>' + sentPicker + btns;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // v305: 3D hover/click on confirm dialog buttons
      box.querySelectorAll('button').forEach(_ckrb3dBtn);

      // v307: Wire sentence jump buttons
      if (_sentenceJump) {
        var jumpBtns = box.querySelectorAll('.ckrb-sent-jump');
        jumpBtns.forEach(function(jb) {
          jb.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            var targetIdx = parseInt(jb.getAttribute('data-sidx'), 10);
            if (!isNaN(targetIdx)) {
              overlay.remove();
              _sentenceJump(targetIdx);
            }
          });
        });
      }

      // ── Drag-to-move ──
      var _dragOx = 0, _dragOy = 0, _dragging = false;
      box.addEventListener('mousedown', function(de) {
        if (de.target.tagName === 'BUTTON') return; // don't drag when clicking buttons
        _dragging = true;
        box.style.cursor = 'grabbing';
        var rect = overlay.getBoundingClientRect();
        _dragOx = de.clientX - rect.left;
        _dragOy = de.clientY - rect.top;
        de.preventDefault();
      });
      document.addEventListener('mousemove', function(me) {
        if (!_dragging) return;
        overlay.style.left = (me.clientX - _dragOx) + 'px';
        overlay.style.top = (me.clientY - _dragOy) + 'px';
        overlay.style.bottom = 'auto';
        overlay.style.transform = 'none';
      });
      document.addEventListener('mouseup', function() {
        if (_dragging) { _dragging = false; box.style.cursor = 'grab'; }
      });

      // Reposition: hide dialog, let user click a word, move highlight there
      var reposBtn = document.getElementById('ckrb-confirm-repos');
      if (reposBtn) reposBtn.addEventListener('click', function() {
        overlay.style.display = 'none';
        // Show instruction banner
        var banner = document.createElement('div');
        banner.id = 'ckrb-repos-banner';
        banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
          'background:#f59e0b;color:#1e293b;padding:12px 24px;border-radius:8px;font-family:system-ui,sans-serif;' +
          'font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.4);cursor:default;';
        banner.textContent = 'Hover to preview, click to set start word';
        document.body.appendChild(banner);

        // v206: Hover preview — show orange highlight on word under cursor
        // v209: Use _ckrbGetRangeRect fallback so bold/styled words are reachable
        function moveHandler(e) {
          var bestIdx = -1;
          var bestDist = Infinity;
          for (var wi = 0; wi < _ckrbWordRanges.length; wi++) {
            var wr = _ckrbGetRangeRect(_ckrbWordRanges[wi].range);
            if (!wr) continue;
            var cx = wr.left + wr.width / 2;
            var cy = wr.top + wr.height / 2;
            var dist = Math.abs(cx - e.clientX) + Math.abs(cy - e.clientY);
            if (dist < bestDist) { bestDist = dist; bestIdx = wi; }
          }
          if (bestIdx >= 0 && bestDist < 80) {
            _ckrbHighlightIdx = -1; // force update
            _ckrbHighlightWordByIndex(bestIdx);
          }
        }

        function clickHandler(e) {
          document.removeEventListener('click', clickHandler, true);
          document.removeEventListener('mousemove', moveHandler, true);
          var b = document.getElementById('ckrb-repos-banner');
          if (b) b.remove();
          e.preventDefault();
          e.stopPropagation();

          // v209: Use _ckrbGetRangeRect fallback for bold/styled words
          var bestIdx = nextJob ? nextJob.domStart : 0;
          var bestDist = Infinity;
          for (var wi = 0; wi < _ckrbWordRanges.length; wi++) {
            var wr = _ckrbGetRangeRect(_ckrbWordRanges[wi].range);
            if (!wr) continue;
            var cx = wr.left + wr.width / 2;
            var cy = wr.top + wr.height / 2;
            var dist = Math.abs(cx - e.clientX) + Math.abs(cy - e.clientY);
            if (dist < bestDist) { bestDist = dist; bestIdx = wi; }
          }

          console.log('[CK Buddy TTS] Repositioned to word index ' + bestIdx +
            ' "' + (_ckrbWordRanges[bestIdx] ? _ckrbWordRanges[bestIdx].text : '?') + '"');

          // v216: Reposition = rebuild sentence text from the DOM words at the new position.
          // This means the audio will actually READ from the repositioned word.
          if (nextJob) {
            var wordsToSkip = bestIdx - nextJob.domStart;
            if (wordsToSkip > 0) {
              // Trim the sentence text: drop the first N words
              var textWords = nextJob.text.match(/\S+/g) || [];
              // Find how many real words (with alphanumeric) to skip
              var realSkipped = 0;
              var trimIdx = 0;
              for (var tw = 0; tw < textWords.length && realSkipped < wordsToSkip; tw++) {
                if (/[a-zA-Z0-9]/.test(textWords[tw])) realSkipped++;
                trimIdx = tw + 1;
              }
              nextJob.text = textWords.slice(trimIdx).join(' ');
              console.log('[CK Buddy TTS] Repositioned: trimmed ' + wordsToSkip + ' words, new text: "' +
                nextJob.text.substring(0, 60) + '..."');
            } else if (wordsToSkip < 0) {
              // User repositioned backward — prepend words from DOM
              var prependWords = [];
              for (var pw = bestIdx; pw < nextJob.domStart && pw < _ckrbWordRanges.length; pw++) {
                prependWords.push(_ckrbWordRanges[pw].text);
              }
              if (prependWords.length) nextJob.text = prependWords.join(' ') + ' ' + nextJob.text;
            }
            nextJob.domStart = bestIdx;
            // domEnd stays where it was — numWords adjusts naturally
            nextJob._reposOffset = 0;
            // Clear cached audio so it re-synthesizes with the new text
            if (nextJobIdx != null) delete cache[nextJobIdx];
          }

          // Highlight the new first word
          _ckrbHighlightIdx = -1;
          _ckrbHighlightWordByIndex(bestIdx);

          // Show dialog again
          overlay.style.display = 'flex';
        }

        // Small delay so the click on "Reposition" doesn't immediately fire
        setTimeout(function() {
          document.addEventListener('mousemove', moveHandler, true);
          document.addEventListener('click', clickHandler, true);
        }, 100);
      });

      function wire(id, fn) { var b = document.getElementById(id); if (b && fn) b.addEventListener('click', function() { overlay.remove(); fn(); }); }
      wire('ckrb-confirm-back', onBack);
      wire('ckrb-confirm-replay', onReplay);
      wire('ckrb-confirm-ok', onOk);
      wire('ckrb-confirm-cancel', onCancel);
    }

    // ── Pause + ask user before proceeding to next chunk ──
    function pauseAndConfirm(finishedIdx) {
      var nextIdx = finishedIdx + 1;
      if (nextIdx >= chunkJobs.length) {
        // All done
        _ckrbRemoveSentenceNumbers();
        _ckrbTTSSpeaking = false;
        if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
        return;
      }
      var nextJob = chunkJobs[nextIdx];
      var nextNumWords = nextJob.domEnd - nextJob.domStart;
      var nextFirstWord = (nextJob.domStart < _ckrbWordRanges.length)
        ? _ckrbWordRanges[nextJob.domStart].text : '???';

      // Highlight first word of NEXT sentence NOW
      if (nextNumWords > 0) {
        console.log('[CK Buddy TTS] ★ pre-highlighting chunk ' + nextIdx + ' first word "' + nextFirstWord + '"');
        _ckrbHighlightWordByIndex(nextJob.domStart);
      }

      var msg = 'Sentence ' + (finishedIdx + 1) + ' / ' + chunkJobs.length;

      showChunkConfirm(msg,
        function() { // Next
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(nextIdx);
        },
        function() { // Stop
          console.log('[CK Buddy TTS] User stopped at chunk ' + nextIdx);
          _ckrbRemoveSentenceNumbers();
          _ckrbTTSSpeaking = false;
          if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
          _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
        },
        nextJob,
        null,
        nextIdx,
        finishedIdx > 0 ? function() { // Back
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(finishedIdx - 1);
        } : null,
        function() { // Replay
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(finishedIdx);
        },
        function(targetIdx) { // v307: Sentence jump
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(targetIdx);
        }
      );
    }

    // ── Process one chunk at a time — TEST MODE ──
    function doChunk(idx) {
      console.log('[CK Buddy TTS DEBUG] doChunk(' + idx + ') called, azureDown=' + _ckrbAzureDown);
      if (mySeq !== _ckrbSpeakSeq) return;
      if (idx >= chunkJobs.length) {
        _ckrbRemoveSentenceNumbers();
        _ckrbTTSSpeaking = false;
        if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
        return;
      }

      // Remove any lingering confirm overlay
      var old = document.getElementById('ckrb-chunk-confirm');
      if (old) old.remove();

      var job = chunkJobs[idx];
      var numWords = job.domEnd - job.domStart;
      // v312: Still play audio even with 0 DOM words (just no highlighting)
      // Old behavior skipped audio entirely, causing silent checkmarks

      // v207: Force-reset highlight index so the first word highlight always works.
      // Without this, a stale _ckrbHighlightIdx from hover preview or prior chunk
      // can cause _ckrbHighlightWordByIndex to silently skip.
      _ckrbHighlightIdx = -1;

      // ★ HIGHLIGHT FIRST WORD RIGHT NOW — before audio exists ★
      console.log('[CK Buddy TTS] ★ chunk ' + idx + ' → highlighting first word "' +
        (job.domStart < _ckrbWordRanges.length ? _ckrbWordRanges[job.domStart].text : '?') + '" BEFORE audio');
      _ckrbHighlightWordByIndex(job.domStart);

      // v288: prefetch DISABLED to conserve Azure quota (was doubling API calls)
      // if (idx + 1 < chunkJobs.length) synth(idx + 1, function() {});

      synth(idx, function(data) {
        if (mySeq !== _ckrbSpeakSeq) return;
        if (!data) {
          // v287: Azure completely down — fall back to browser speechSynthesis
          console.log('[CK Buddy TTS DEBUG] chunk ' + idx + ' data=null → entering local TTS fallback');
          try {
            var ss = window.speechSynthesis || (window.parent && window.parent.speechSynthesis);
            console.log('[CK Buddy TTS DEBUG] speechSynthesis available:', !!ss, 'window.speechSynthesis:', !!window.speechSynthesis, 'parent:', !!(window.parent && window.parent.speechSynthesis));
            if (ss) {
              ss.cancel();
              var chunkText = chunkJobs[idx].text;
              console.log('[CK Buddy TTS DEBUG] local TTS speaking: "' + chunkText.substring(0, 60) + '..."');
              var u = new SpeechSynthesisUtterance(chunkText);
              u.rate = 0.95;
              var voices = ss.getVoices();
              console.log('[CK Buddy TTS DEBUG] voices available:', voices.length);
              for (var vi = 0; vi < voices.length; vi++) {
                if (/female|zira|jenny|samantha/i.test(voices[vi].name) && /en/i.test(voices[vi].lang)) {
                  u.voice = voices[vi];
                  console.log('[CK Buddy TTS DEBUG] selected voice:', voices[vi].name);
                  break;
                }
              }
              // Highlight words on even-spread timing
              var localWords = numWords;
              var localStart = job.domStart;
              var localDone = false;
              u.onstart = function() { console.log('[CK Buddy TTS DEBUG] local TTS onstart fired for chunk ' + idx); };
              u.onend = function() {
                console.log('[CK Buddy TTS DEBUG] local TTS onend fired for chunk ' + idx);
                localDone = true;
                if (mySeq !== _ckrbSpeakSeq) return;
                pauseAndConfirm(idx);
              };
              u.onerror = function(ev) {
                console.warn('[CK Buddy TTS DEBUG] local TTS onerror for chunk ' + idx + ':', ev && ev.error);
                localDone = true;
                if (mySeq !== _ckrbSpeakSeq) return;
                pauseAndConfirm(idx);
              };
              // Simple word highlight using onboundary
              u.onboundary = function(ev) {
                if (localDone || mySeq !== _ckrbSpeakSeq) return;
                if (ev.name === 'word') {
                  var charPos = ev.charIndex;
                  var textSoFar = chunkJobs[idx].text.substring(0, charPos);
                  var wordsSoFar = textSoFar.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
                  var domIdx = Math.min(wordsSoFar, localWords - 1);
                  _ckrbHighlightWordByIndex(localStart + domIdx);
                }
              };
              ss.speak(u);
              _ckrbShowDebugBanner('Azure down — using local voice', '#f59e0b');
              return;
            }
          } catch(localErr) {
            console.warn('[CK Buddy TTS] local speechSynthesis fallback failed:', localErr);
          }
          pauseAndConfirm(idx);
          return;
        }

        var blob = new Blob([data.audioData], { type: 'audio/mpeg' });
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        _ckrbAzureAudio = audio;
        var done = false;

        // ── Build word timing from Azure boundaries (precise) or fall back to even-spread ──
        var boundaries = data.boundaries || [];
        // Filter boundaries to only real words (skip punctuation-only)
        var wordBoundaries = [];
        for (var bi = 0; bi < boundaries.length; bi++) {
          if (/[a-zA-Z0-9]/.test(boundaries[bi].text)) wordBoundaries.push(boundaries[bi]);
        }
        // Also split hyphenated boundary words to match DOM splitting
        var splitBoundaries = [];
        for (var bi2 = 0; bi2 < wordBoundaries.length; bi2++) {
          var wb = wordBoundaries[bi2];
          var subWords = wb.text.split('-').filter(function(s) { return s.length > 0; });
          if (subWords.length > 1) {
            // Divide the boundary's time evenly among sub-words
            var nextTime = (bi2 + 1 < wordBoundaries.length) ? wordBoundaries[bi2 + 1].audioOffsetMs : null;
            var span = nextTime !== null ? (nextTime - wb.audioOffsetMs) : 500;
            var subSpan = span / subWords.length;
            for (var si = 0; si < subWords.length; si++) {
              splitBoundaries.push({ audioOffsetMs: wb.audioOffsetMs + si * subSpan, text: subWords[si] });
            }
          } else {
            splitBoundaries.push(wb);
          }
        }

        var useAzureTiming = splitBoundaries.length > 0;
        console.log('[CK Buddy TTS] chunk ' + idx + ': ' + splitBoundaries.length + ' Azure word boundaries, ' + numWords + ' DOM words, using ' + (useAzureTiming ? 'Azure' : 'even-spread'));

        var lastWordIdx = 0;
        var rafId = 0;

        function rafTick() {
          if (done || mySeq !== _ckrbSpeakSeq) return;
          var ct = audio.currentTime * 1000; // current time in ms

          if (useAzureTiming) {
            // Find which Azure boundary word we're at based on audio time
            var azureIdx = 0;
            for (var k = 0; k < splitBoundaries.length; k++) {
              if (splitBoundaries[k].audioOffsetMs <= ct) azureIdx = k;
              else break;
            }
            // v215: Straight 1:1 mapping — Azure word 0 = first DOM word, no offset.
            // Reposition shifts domStart+domEnd together so no compensation needed.
            var targetWord = Math.min(azureIdx, numWords - 1);
            if (targetWord > lastWordIdx) {
              lastWordIdx = targetWord;
              _ckrbHighlightWordByIndex(job.domStart + targetWord);
            }
          } else {
            // Fallback: even-spread based on progress
            var dur = audio.duration;
            if (dur && isFinite(dur) && dur > 0) {
              var progress = audio.currentTime / dur;
              // v215: Straight 1:1 even-spread — no offset compensation
              var rawTarget = Math.floor(progress * numWords);
              var targetWord = Math.min(rawTarget, numWords - 1);
              if (targetWord > lastWordIdx) {
                lastWordIdx = targetWord;
                _ckrbHighlightWordByIndex(job.domStart + targetWord);
              }
            }
          }
          rafId = requestAnimationFrame(rafTick);
        }

        audio.addEventListener('playing', function() {
          console.log('[CK Buddy TTS] chunk ' + idx + ' playing: dur=' + (audio.duration || '?') + 's, ' + numWords + ' words');
          rafId = requestAnimationFrame(rafTick);
        });

        audio.addEventListener('ended', function() {
          if (mySeq !== _ckrbSpeakSeq) return;
          done = true;
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          try { URL.revokeObjectURL(url); } catch(_) {}
          if (_ckrbAzureAudio === audio) _ckrbAzureAudio = null;
          console.log('[CK Buddy TTS] chunk ' + idx + ' audio ended — showing confirm');
          pauseAndConfirm(idx);
        });

        audio.addEventListener('error', function(e) {
          console.log('[CK Buddy TTS] chunk ' + idx + ' audio ERROR', e);
          done = true;
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          if (_ckrbAzureAudio === audio) _ckrbAzureAudio = null;
          pauseAndConfirm(idx);
        });

        audio.play().then(function() {
          console.log('[CK Buddy TTS] chunk ' + idx + ' audio.play() started OK');
        }).catch(function(err) {
          console.error('[CK Buddy TTS] chunk ' + idx + ' audio.play() FAILED', err);
          _ckrbAzureAudio = null;
          done = true;
          _ckrbShowDebugBanner('Azure audio.play() failed — check key/region in settings', '#ef4444');
          _ckrbTTSSpeaking = false;
          if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        });
      });
    }

    // v208: Show pre-play confirm with Reposition option before first sentence
    var firstJob = chunkJobs[0];
    if (firstJob) {
      var firstNumWords = firstJob.domEnd - firstJob.domStart;
      var firstWord = (firstJob.domStart < _ckrbWordRanges.length)
        ? _ckrbWordRanges[firstJob.domStart].text : '???';

      // Highlight the first word immediately so user can see where it will start
      if (firstNumWords > 0) {
        _ckrbHighlightIdx = -1;
        _ckrbHighlightWordByIndex(firstJob.domStart);
      }

      var preMsg = 'Ready — ' + chunkJobs.length + ' sentence' + (chunkJobs.length > 1 ? 's' : '');

      showChunkConfirm(preMsg,
        function() { // Play
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(0);
        },
        function() { // Stop
          console.log('[CK Buddy TTS] User cancelled before first chunk');
          _ckrbRemoveSentenceNumbers();
          _ckrbTTSSpeaking = false;
          if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = 'ð Read';
          _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
        },
        firstJob, // pass so Reposition can adjust domStart
        '▶ Play', // v208: custom label for pre-play dialog
        0,         // v216: chunk index for cache invalidation
        null,      // no Back on pre-play
        null,      // no Replay on pre-play
        function(targetIdx) { // v307: Sentence jump from pre-play
          if (mySeq !== _ckrbSpeakSeq) return;
          doChunk(targetIdx);
        }
      );
    } else {
      doChunk(0);
    }
  }

  // Fallback path: plain REST synthesis + our silence/heuristic word timing.
  // Used only if the SDK global isn't present.
  function _ckrbSpeakAzureRest(text, range, key, region, mySeq, _429retry) {
    _429retry = _429retry || 0;
    // REST fallback doesn't have SDK word boundary events, so it uses the
    // full-range word collection (no per-sentence isolation). This is the
    // degraded path — it's less precise but still works.
    _ckrbWordRanges = _ckrbCollectWordRanges(range);
    var voice = 'en-US-JennyNeural';
    var ssml =
      "<speak version='1.0' xml:lang='en-US'>" +
      "<voice name='" + voice + "'>" +
      "<prosody rate='-5%'>" + _ckrbEscapeXml(text) + "</prosody>" +
      "</voice></speak>";
    fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ckrb'
      },
      body: ssml
    })
    .then(function(r) {
      if (r.status === 429) {
        console.warn('[CK Buddy TTS] AzureREST 429 — flagging Azure down, using local TTS');
        _ckrbAzureDown = true;
        // Fall back to local speechSynthesis
        try {
          var ss = window.speechSynthesis || (window.parent && window.parent.speechSynthesis);
          if (ss) {
            ss.cancel();
            var u = new SpeechSynthesisUtterance(text);
            u.rate = 0.95;
            u.onend = function() {
              if (mySeq !== _ckrbSpeakSeq) return;
              _ckrbTTSSpeaking = false;
              if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
              _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
            };
            ss.speak(u);
            _ckrbShowDebugBanner('Azure 429 — using local voice', '#f59e0b');
          }
        } catch(_) {}
        return null;
      }
      if (!r.ok) throw new Error('Azure ' + r.status);
      return r.arrayBuffer();
    })
    .then(function(buf) {
      if (!buf) return; // v286: null means 429 retry is handling it
      if (mySeq !== _ckrbSpeakSeq) return;
      var blob = new Blob([buf], { type: 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      _ckrbAzureAudio = audio;
      var bufCopy = buf.slice(0);
      var decodedWordStarts = null;
      var onDecoded = null;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          var ac = new AC();
          ac.decodeAudioData(bufCopy, function(audioBuffer) {
            try { decodedWordStarts = _ckrbBuildWordTimesFromRealAudio(text, audioBuffer); } catch(e) {}
            try { ac.close(); } catch(_) {}
            if (onDecoded) onDecoded();
          }, function() { try { ac.close(); } catch(_) {} if (onDecoded) onDecoded(); });
        }
      } catch(_) {}
      audio.addEventListener('loadedmetadata', function() {
        if (mySeq !== _ckrbSpeakSeq) return;
        var wordStarts = decodedWordStarts || _ckrbBuildWordTimesFromAudio(text, audio.duration);
        onDecoded = function() { if (decodedWordStarts) wordStarts = decodedWordStarts; };
        var lastIdx = -1;
        function tick() {
          if (mySeq !== _ckrbSpeakSeq) { _ckrbAzureRaf = 0; return; }
          if (!_ckrbAzureAudio || _ckrbAzureAudio !== audio) { _ckrbAzureRaf = 0; return; }
          var ct = audio.currentTime;
          var i = lastIdx >= 0 ? lastIdx : 0;
          while (i + 1 < wordStarts.length && wordStarts[i + 1] <= ct) i++;
          if (i !== lastIdx) {
            lastIdx = i;
            var domIdx = Math.min(i, _ckrbWordRanges.length - 1);
            if (domIdx >= 0) _ckrbHighlightWordByIndex(domIdx);
          }
          _ckrbAzureRaf = requestAnimationFrame(tick);
        }
        _ckrbAzureRaf = requestAnimationFrame(tick);
      });
      audio.addEventListener('ended', function() {
        if (mySeq !== _ckrbSpeakSeq) return;
        try { cancelAnimationFrame(_ckrbAzureRaf); } catch(_) {}
        _ckrbAzureRaf = 0;
        _ckrbTTSSpeaking = false;
        if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        _ckrbCleanupTimer = setTimeout(function() { _ckrbCleanupTimer = null; _ckrbRemoveInPlaceHighlight(); }, 900);
        try { URL.revokeObjectURL(audio.src); } catch(_) {}
        if (_ckrbAzureAudio === audio) _ckrbAzureAudio = null;
      });
      audio.addEventListener('error', function() {
        if (mySeq !== _ckrbSpeakSeq) return;
        _ckrbTTSSpeaking = false;
        if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        _ckrbRemoveInPlaceHighlight();
      });
      audio.play().catch(function(playErr) {
        console.error('[CK Buddy TTS] AzureREST audio.play() FAILED', playErr);
        _ckrbAzureAudio = null;
        _ckrbTTSSpeaking = false;
        if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
        _ckrbShowDebugBanner('Azure REST audio failed', '#ef4444');
      });
    })
    .catch(function(err) {
      if (mySeq !== _ckrbSpeakSeq) return;
      console.error('[CK Buddy TTS] AzureREST fetch FAILED:', err && err.message);
      _ckrbTTSSpeaking = false;
      if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read';
      _ckrbShowDebugBanner('Azure REST failed — check key/region', '#ef4444');
    });
  }

  function _ckrbSpeak(text, range) {
    // Azure SDK only — no local speechSynthesis fallback.
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['ckrb_azure_key', 'ckrb_azure_region'], function(r) {
          var k = r && r.ckrb_azure_key ? String(r.ckrb_azure_key).trim() : '';
          var region = r && r.ckrb_azure_region ? String(r.ckrb_azure_region).trim().toLowerCase() : '';
          if (k && region) {
            console.log('[CK Buddy TTS] _ckrbSpeak: key found, calling _ckrbSpeakAzure');
            _ckrbSpeakAzure(text, range, k, region);
          } else {
            console.log('[CK Buddy TTS] _ckrbSpeak: NO Azure key/region in storage');
            _ckrbShowDebugBanner('No Azure key — add it in extension settings', '#ef4444');
          }
        });
        return;
      }
    } catch(storageErr) {
      console.error('[CK Buddy TTS] _ckrbSpeak: chrome.storage.sync THREW — extension context invalidated. Refresh the tab.', storageErr);
    }
    _ckrbShowDebugBanner('Extension context lost — refresh the UWorld tab', '#ef4444');
  }

  // _ckrbSpeakLocal REMOVED in v196 — no more local speechSynthesis fallback.
  // All TTS goes through Azure SDK only. If SDK isn't available, we show an
  // error banner instead of falling back to the bad local voice.
  function _ckrbSpeakLocal() {
    // Dead function — kept as no-op so any stale call sites don't throw.
    console.error('[CK Buddy TTS] _ckrbSpeakLocal called but DISABLED in v196 — should not happen');
    _ckrbShowDebugBanner('Local TTS disabled — Azure SDK required', '#ef4444');
  }

  function _ckrbShowTTSBtn(x, y, text, range) {
    _ckrbRemoveTTSBtn();
    var hostDoc = _ckrbTopDoc();
    var hostWin = (hostDoc.defaultView || window);
    var btn = hostDoc.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '🔊 Read';
    btn.setAttribute('data-ckrb-tts', 'true');
    // v375: Add close ✕ button
    var closeX = hostDoc.createElement('button');
    closeX.type = 'button';
    closeX.textContent = '✕';
    closeX.style.cssText = 'margin-left:8px;font-size:12px;font-weight:800;cursor:pointer;' +
      'background:linear-gradient(180deg,#ef4444 0%,#dc2626 100%);color:#fff;' +
      'border:2px solid #fca5a5;border-bottom:3px solid #991b1b;border-radius:8px;' +
      'padding:2px 8px;text-shadow:0 1px 1px rgba(0,0,0,0.3);' +
      'box-shadow:0 2px 6px rgba(239,68,68,0.4);' +
      'transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);';
    closeX.addEventListener('mouseenter', function() {
      closeX.style.transform = 'translateY(-2px) scale(1.1)';
      closeX.style.boxShadow = '0 4px 10px rgba(239,68,68,0.5)';
      closeX.style.background = 'linear-gradient(180deg,#f87171 0%,#ef4444 100%)';
      closeX.style.borderColor = '#fecaca';
    });
    closeX.addEventListener('mouseleave', function() {
      closeX.style.transform = '';
      closeX.style.boxShadow = '0 2px 6px rgba(239,68,68,0.4)';
      closeX.style.background = 'linear-gradient(180deg,#ef4444 0%,#dc2626 100%)';
      closeX.style.borderColor = '#fca5a5';
    });
    closeX.addEventListener('mousedown', function() {
      closeX.style.transform = 'translateY(2px) scale(0.95)';
      closeX.style.boxShadow = '0 1px 2px rgba(239,68,68,0.3)';
      closeX.style.borderBottom = '1px solid #991b1b';
    });
    closeX.addEventListener('mouseup', function() {
      closeX.style.transform = 'translateY(-2px) scale(1.1)';
      closeX.style.borderBottom = '3px solid #991b1b';
    });
    closeX.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    closeX.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Stop TTS if speaking
      if (_ckrbTTSSpeaking) {
        try { (hostWin.speechSynthesis || window.speechSynthesis).cancel(); } catch(_) {}
        _ckrbTTSSpeaking = false;
        _ckrbRemoveSentenceNumbers();
        _ckrbRemoveInPlaceHighlight();
        setTimeout(function() { try { _ckrbPurgeAllHighlightMarkers(); } catch(_) {} }, 300);
      }
      // v376: Delay removal so button absorbs mouseup/pointerup — prevents click-through to flipbook
      setTimeout(function() { _ckrbRemoveTTSBtn(); }, 100);
    });
    closeX.addEventListener('mouseup', function(e) { e.stopPropagation(); e.stopImmediatePropagation(); });
    closeX.addEventListener('pointerup', function(e) { e.stopPropagation(); e.stopImmediatePropagation(); });
    _ckrb3dBtn(closeX); // v382: Wire up hover/click sounds
    btn.appendChild(closeX);
    var maxX = (hostWin.innerWidth || 1200) - 90;
    var maxY = (hostWin.innerHeight || 800) - 40;
    var px = Math.max(8, Math.min(maxX, x|0));
    var py = Math.max(8, Math.min(maxY, y|0));
    btn.style.cssText = 'position:fixed;left:' + px + 'px;top:' + py + 'px;z-index:2147483647;background:linear-gradient(180deg,#818cf8 0%,#6366f1 100%);color:#fff;border:2px solid #a5b4fc;border-bottom:4px solid #4338ca;border-radius:10px;padding:6px 14px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(99,102,241,0.5);user-select:none;text-shadow:0 1px 2px rgba(0,0,0,0.3);transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);';
    // Capture the range snapshot so we can walk the exact DOM nodes later
    var capturedRange = null;
    if (range && typeof range.cloneRange === 'function') {
      try { capturedRange = range.cloneRange(); } catch(_) {}
    }
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (_ckrbTTSSpeaking) {
        try { (hostWin.speechSynthesis || window.speechSynthesis).cancel(); } catch(err) {}
        _ckrbTTSSpeaking = false;
        btn.innerHTML = '🔊 Read';
        _ckrbRemoveSentenceNumbers();
        _ckrbRemoveInPlaceHighlight();
        // v308: Aggressive delayed purge to catch any stragglers
        setTimeout(function() { try { _ckrbPurgeAllHighlightMarkers(); } catch(e) {} }, 300);
      } else {
        btn.innerHTML = '⏸ Stop';
        _ckrbSpeak(text, capturedRange);
      }
    });
    _ckrb3dBtn(btn);
    (hostDoc.body || hostDoc.documentElement).appendChild(btn);
    _ckrbTTSBtn = btn;
  }

  function _ckrbGetSelectionText() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    return sel.toString().trim();
  }

  function _ckrbFrameOffsetToTop() {
    var dx = 0, dy = 0;
    try {
      var w = window;
      while (w.parent && w.parent !== w) {
        var fe = w.frameElement;
        if (!fe) break;
        var r = fe.getBoundingClientRect();
        dx += r.left;
        dy += r.top;
        w = w.parent;
      }
    } catch(e) {}
    return { dx: dx, dy: dy };
  }

  // Track selection synchronously during drag (UWorld/AMBOSS clear it ~instantly on mouseup).
  // We record last non-empty selection on selectionchange + mousemove and consume it on mouseup.
  var _ckrbLastSelText = '';
  var _ckrbLastSelRect = null;
  var _ckrbLastSelRange = null;   // cloned Range — used to highlight in-place on the original words
  function _ckrbGrabSelection() {
    try {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      var t = sel.toString();
      if (!t || !t.trim()) return;
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      _ckrbLastSelText = t.trim();
      _ckrbLastSelRect = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
      try { _ckrbLastSelRange = range.cloneRange(); } catch(_) { _ckrbLastSelRange = null; }
    } catch(err) {}
  }
  document.addEventListener('selectionchange', _ckrbGrabSelection, true);
  document.addEventListener('mousemove', function(e) {
    if (e.buttons) _ckrbGrabSelection();
  }, true);

  function _ckrbHandlePointerUp(e) {
    if (!_ckrbHighlightTTSEnabled) return;
    // Suppress during active test-taking — only enable in review mode
    if (!_ckrbIsReviewMode()) return;
    if (e.button !== 0 && e.pointerType !== 'mouse' && e.pointerType !== 'touch' && e.button !== undefined) return;
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-ckrb-tts')) return;
    // Sync grab first (before UWorld clears it)
    _ckrbGrabSelection();
    var syncText = '';
    try {
      var s = window.getSelection();
      if (s && !s.isCollapsed) syncText = (s.toString() || '').trim();
    } catch(_) {}
    var text = syncText || _ckrbLastSelText || '';
    var rect = _ckrbLastSelRect;
    if (!text || text.length < 2) {
      // Re-check after a beat — covers slower browsers / AMBOSS where selection stays.
      setTimeout(function() {
        var t2 = _ckrbGetSelectionText();
        if (t2 && t2.length >= 2) {
          var off2 = _ckrbFrameOffsetToTop();
          // Capture a fresh Range so in-place highlighting can find the words.
          var freshRange = null;
          try {
            var sel2 = window.getSelection();
            if (sel2 && sel2.rangeCount) freshRange = sel2.getRangeAt(0).cloneRange();
          } catch(_) {}
          // Fall back to the last grabbed range if getSelection has been wiped already
          if (!freshRange) { try { freshRange = _ckrbLastSelRange ? _ckrbLastSelRange.cloneRange() : null; } catch(_) {} }
          try {
            var r2 = freshRange ? freshRange.getBoundingClientRect() : (window.getSelection().getRangeAt(0).getBoundingClientRect());
            _ckrbShowTTSBtn((r2.right - 40) + off2.dx, (r2.top - 38) + off2.dy, t2, freshRange);
          } catch(e2) {
            _ckrbShowTTSBtn(e.clientX + off2.dx, (e.clientY - 38) + off2.dy, t2, freshRange);
          }
        } else if (_ckrbTTSBtn && e.target !== _ckrbTTSBtn) {
          _ckrbRemoveTTSBtn();
        }
      }, 15);
      return;
    }
    var off = _ckrbFrameOffsetToTop();
    var x, y;
    if (rect) {
      x = (rect.right - 40) + off.dx;
      y = (rect.top - 38) + off.dy;
    } else {
      x = (e.clientX || 100) + off.dx;
      y = ((e.clientY || 100) - 38) + off.dy;
    }
    // Pass the stashed Range to the button so the speak handler can use it for
    // in-place word-level highlighting on the original DOM.
    _ckrbShowTTSBtn(x, y, text, _ckrbLastSelRange);
    // Clear after use so stale selection doesn't re-trigger (range is copied inside _ckrbShowTTSBtn)
    _ckrbLastSelText = '';
    _ckrbLastSelRect = null;
    _ckrbLastSelRange = null;
  }
  // DISABLED in v149: left-click-drag no longer shows the floating 🔊 Read
  // button — that used to pop up on every text selection and interfere with
  // normal highlighting. TTS is now triggered exclusively by RIGHT-click-drag
  // (see the button-2 mouseup handler above) or the Ctrl+Shift+S shortcut.
  // document.addEventListener('mouseup',   _ckrbHandlePointerUp, true);
  // document.addEventListener('pointerup', _ckrbHandlePointerUp, true);

  // Keyboard shortcut: Ctrl+Shift+S to speak current selection
  document.addEventListener('keydown', function(e) {
    if (!_ckrbHighlightTTSEnabled) return;
    if (!_ckrbIsReviewMode()) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      var text = _ckrbGetSelectionText();
      if (text && text.length > 1) {
        e.preventDefault();
        _ckrbSpeak(text);
      }
    }
    // Escape stops TTS
    if (e.key === 'Escape' && _ckrbTTSSpeaking) {
      _ckrbSpeakSeq++;
      try { window.speechSynthesis.cancel(); } catch(err) {}
      _ckrbStopAzureAudio();
      _ckrbStopFallbackHighlight();
      _ckrbTTSSpeaking = false;
      _ckrbRemoveInPlaceHighlight();
      _ckrbRemoveTTSBtn();
    }
  }, true);

  // Hide on scroll
  document.addEventListener('scroll', function() {
    if (_ckrbTTSBtn && !_ckrbTTSSpeaking) _ckrbRemoveTTSBtn();
  }, true);

  // Purge any stale highlight markers left in the DOM by a prior TTS session or
  // a previous extension version. Safe even if nothing is there.
  try { _ckrbPurgeAllHighlightMarkers(); } catch(e) {}
  // Run once more after a tick in case markers are re-attached by late code
  try { setTimeout(function() { try { _ckrbPurgeAllHighlightMarkers(); } catch(e) {} }, 500); } catch(e) {}

  // v308: Periodic stale overlay cleanup — if TTS is not active, purge any orphaned highlight overlays
  setInterval(function() {
    if (_ckrbTTSSpeaking) return; // don't interfere while speaking
    try {
      var topDoc = _ckrbTopDoc();
      var strays = topDoc.querySelectorAll('[data-ckrb-hl="true"]');
      if (strays.length > 0) {
        console.log('[CK Buddy] Cleaning ' + strays.length + ' stale highlight overlay(s)');
        for (var i = 0; i < strays.length; i++) {
          try { strays[i].parentNode.removeChild(strays[i]); } catch(e) {}
        }
        _ckrbHighlightOverlay = null;
        _ckrbHighlightRange = null;
      }
    } catch(e) {}
  }, 3000);

  // -------- Find the explanation container on the current page -----------
  // Returns the element (not a range) so the caller can decide how to use it.
  function _ckrbFindExplanationElement() {
    // UWorld — prefer the inner content pane to avoid picking up the tab nav
    // ("Explanation" link), hidden metadata (User Id, etc.), and copyright text.
    // #first-explanation is the active tab pane with just the explanation prose.
    // #explanation is one level up (still no tab nav). #explanation-container is
    // the outermost wrapper that includes everything — only use as last resort.
    var el = document.getElementById('first-explanation')
          || document.querySelector('#explanation .tab-pane.active')
          || document.getElementById('explanation')
          || document.getElementById('explanation-container')
          || document.querySelector('.explanation-container');
    if (el && (el.innerText || '').trim().length > 40) return el;
    // AMBOSS review
    var am = document.querySelector('div[class*="explanationContainer"][class*="correctAnswerExplanation"]')
          || document.querySelector('div[class*="explanationContainer"]')
          || document.querySelector('[data-e2e-test-id*="explanation"]');
    if (am && (am.innerText || '').trim().length > 40) return am;
    // NBME: a div that contains "Explanation" heading followed by prose
    try {
      var hs = document.querySelectorAll('h1,h2,h3,h4,strong,b');
      for (var i = 0; i < hs.length; i++) {
        if (/^\s*explanation\s*$/i.test(hs[i].innerText || '')) {
          var sib = hs[i].nextElementSibling || hs[i].parentElement;
          if (sib && (sib.innerText || '').trim().length > 80) return sib;
        }
      }
    } catch(_) {}
    // CCS Cases: grab the longest <p> on the page that looks like feedback prose.
    try {
      if ((location.hostname || '').indexOf('ccscases.com') !== -1) {
        var ps = document.querySelectorAll('p');
        var best = null, bestLen = 0;
        for (var j = 0; j < ps.length; j++) {
          var t = (ps[j].innerText || '').trim();
          if (t.length > bestLen && t.length > 120 && t.length < 8000) { best = ps[j]; bestLen = t.length; }
        }
        if (best) return best;
      }
    } catch(_) {}
    return null;
  }

  // Message bridge: the popup (quiz screen) dispatches
  // {type:'ckrb-speak-explanation', text:<native explanation prose>} when the
  // 🔊 Read Explanation button is clicked. The Q-bank tab's content script
  // finds the live explanation element, builds a Range over it, and speaks
  // with in-place word-by-word highlighting on the actual page.
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
        try {
          if (!msg) return;
          if (msg.type === 'ckrb-stop-tts') {
            // v156: bump seq so any in-flight deferred speak() bails out.
            _ckrbSpeakSeq++;
            try { window.speechSynthesis.cancel(); } catch(_) {}
            _ckrbStopAzureAudio();
            _ckrbStopKeepAlive();
            _ckrbStopFallbackHighlight();
            _ckrbTTSSpeaking = false;
            _ckrbRemoveInPlaceHighlight();
            try { sendResponse({ ok: true }); } catch(_) {}
            return true;
          }
          if (msg.type !== 'ckrb-speak-explanation') return;
          // Only respond from the TOP frame — subframes don't have the SDK
          // and would fall back to local speechSynthesis, causing double-voice
          var _isTop = false;
          try { _isTop = (window === window.top); } catch(_) { _isTop = false; }
          if (!_isTop) { try { sendResponse({ ok: false, reason: 'subframe' }); } catch(_) {} return; }
          // Only respond from the frame that actually has an explanation
          var el = _ckrbFindExplanationElement();
          if (!el) { try { sendResponse({ ok: false, reason: 'no-explanation-element' }); } catch(_) {} return; }
          var range = document.createRange();
          try { range.selectNodeContents(el); } catch(_) {}
          // Prefer the text visible on the page so the highlight lines up 1:1
          // with what we're speaking. If the popup sent custom text, fall back
          // to it only when we can't read the on-page text.
          var onPageText = (el.innerText || '').trim();
          var textToSpeak = onPageText.length > 40 ? onPageText : (msg.text || '').trim();
          if (!textToSpeak) { try { sendResponse({ ok: false, reason: 'no-text' }); } catch(_) {} return; }
          try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch(_) {}
          _ckrbSpeak(textToSpeak, range);
          try { sendResponse({ ok: true, chars: textToSpeak.length }); } catch(_) {}
        } catch(err) {
          try { sendResponse({ ok: false, error: String(err) }); } catch(_) {}
        }
        return true; // keep channel open for async sendResponse
      });
    }
  } catch(_) {}
  /* ── STRATEGY CARDS FLIPBOOK ── */
  var _CKRB_STRAT_KEY = 'ckrb_strategy_cards';
  var _CKRB_STRAT_POS_KEY = 'ckrb_flipbook_pos';
  var _ckrbDefaultCards = [
    {id:'d1',  text:'Do not touch your neck'},
    {id:'d2',  text:'Do not talk'},
    {id:'d3',  text:'Do not spend too much time on one question'},
    {id:'d4',  text:'Be happy to SKIP difficult questions'},
    {id:'d5',  text:'If you know the answer is wrong you can’t choose it (close isn’t good enough)'},
    {id:'d6',  text:'QUICKLY recognize when you do not know the answer'},
    {id:'d7',  text:'You do not have to know the answer to get the question right'},
    {id:'d8',  text:'If you have a spot diagnosis check text to confirm it'},
    {id:'d9',  text:'If you are scoring badly it is normal to feel that way — keep going hard'},
    {id:'d10', text:'Always race against the clock (even if way ahead)'},
    {id:'d11', text:'Breathe deeply during the exam'},
    {id:'d12', text:'If there is a weird answer choice and you can’t justify it don’t choose it'},
    {id:'d13', text:'You are not supposed to read long things'},
    {id:'d14', text:'Find out what is going on — Quick scan → then decide what to read'},
    {id:'d15', text:'If you hate all answer choices, re-read question sentence (then unhighlighted text)'},
    {id:'d16', text:'Extraneous thoughts should be actively avoided (clear mind and find interest in exam)'},
    {id:'d17', text:'MARK Questions and come back to them, do not linger/dwell, just mark and think about it later on. If you have time it makes you feel better about skipping & more likely to skip.'},
    {id:'d18', text:'Drink water / check before block list / bathroom!'},
    {id:'d19', text:'Go to the bathroom!'},
    {id:'d20', text:'Avoid perfection — it is the enemy of good enough for time'},
    {id:'d21', text:'Greet the exam with a breath of fire'}
  ];

  function _ckrbLoadCards(cb) {
    try {
      chrome.storage.local.get([_CKRB_STRAT_KEY], function(r) {
        if (chrome.runtime.lastError) {
          // Storage read failed — use defaults in-memory, NEVER save
          cb(_ckrbDefaultCards.map(function(c) { return {id:c.id, text:c.text, imageDataUrl:null}; }));
          return;
        }
        var cards = r && r[_CKRB_STRAT_KEY];
        if (cards && cards.length) {
          cb(cards);
          return;
        }
        // Storage is truly empty — try to restore from bundled backup JSON
        // (safe here because chrome.runtime is valid — lastError path handles reload flickers)
        try {
          fetch(chrome.runtime.getURL('ckrb_cards_backup.json'))
            .then(function(resp) { return resp.json(); })
            .then(function(backup) {
              if (backup && backup.length) {
                var o = {}; o[_CKRB_STRAT_KEY] = backup;
                chrome.storage.local.set(o);
                cb(backup);
              } else {
                cb(_ckrbDefaultCards.map(function(c) { return {id:c.id, text:c.text, imageDataUrl:null}; }));
              }
            })
            .catch(function() {
              cb(_ckrbDefaultCards.map(function(c) { return {id:c.id, text:c.text, imageDataUrl:null}; }));
            });
        } catch(e2) {
          cb(_ckrbDefaultCards.map(function(c) { return {id:c.id, text:c.text, imageDataUrl:null}; }));
        }
      });
    } catch(e) {
      // Extension context invalid — use defaults in-memory, NEVER save
      cb(_ckrbDefaultCards.map(function(c) { return {id:c.id, text:c.text, imageDataUrl:null}; }));
    }
  }

  function _ckrbSaveCards(cards) {
    try { var o = {}; o[_CKRB_STRAT_KEY] = cards; chrome.storage.local.set(o); } catch(e) {}
  }

  // v353: One-time append of new cards to existing stored set
  var _CKRB_V353_KEY = 'ckrb_cards_v353_done';
  try {
    chrome.storage.local.get([_CKRB_STRAT_KEY, _CKRB_V353_KEY], function(r) {
      if (r[_CKRB_V353_KEY]) return;
      var cards = r[_CKRB_STRAT_KEY] || [];
      var newCards = [
        {id:'d15', text:'If you hate all answer choices, re-read question sentence (then unhighlighted text)', imageDataUrl:null},
        {id:'d16', text:'Extraneous thoughts should be actively avoided (clear mind and find interest in exam)', imageDataUrl:null},
        {id:'d17', text:'MARK Questions and come back to them, do not linger/dwell, just mark and think about it later on. If you have time it makes you feel better about skipping & more likely to skip.', imageDataUrl:null},
        {id:'d18', text:'Drink water / check before block list / bathroom!', imageDataUrl:null},
        {id:'d19', text:'Go to the bathroom!', imageDataUrl:null},
        {id:'d20', text:'Avoid perfection \u2014 it is the enemy of good enough for time', imageDataUrl:null},
        {id:'d21', text:'Greet the exam with a breath of fire', imageDataUrl:null}
      ];
      newCards.forEach(function(nc) { cards.push(nc); });
      _ckrbSaveCards(cards);
      var mo = {}; mo[_CKRB_V353_KEY] = true;
      chrome.storage.local.set(mo);
      console.log('[CK Buddy] Appended 7 new strategy cards to existing ' + (cards.length - 7) + ' cards');
    });
  } catch(e) {}

  function _ckrbToggleFlipbook() {
    var existing = document.getElementById('__ckrb_flipbook');
    if (existing) { existing.remove(); return; }
    _ckrbShowFlipbook();
  }

  function _ckrbShowFlipbook() {
    if (document.getElementById('__ckrb_flipbook')) return;
    _ckrbLoadCards(function(cards) {
      _ckrbBuildFlipbook(document, cards);
    });
  }

  // ── REVIEW STRATEGIES FLIPBOOK (v284) ──
  var _CKRB_REVIEW_KEY = 'ckrb_review_cards';
  var _CKRB_REVIEW_POS_KEY = 'ckrb_review_pos';

  function _ckrbSaveReviewCards(cards) {
    try { var o = {}; o[_CKRB_REVIEW_KEY] = cards; chrome.storage.local.set(o); } catch(e) {}
  }

  function _ckrbLoadReviewCards(cb) {
    try {
      chrome.storage.local.get([_CKRB_REVIEW_KEY], function(r) {
        if (chrome.runtime.lastError) { cb([]); return; }
        var cards = r && r[_CKRB_REVIEW_KEY];
        cb(cards && cards.length ? cards : []);
      });
    } catch(e) { cb([]); }
  }

  function _ckrbToggleReviewFlipbook() {
    var existing = document.getElementById('__ckrb_review_flipbook');
    if (existing) { existing.remove(); return; }
    _ckrbShowReviewFlipbook();
  }

  function _ckrbShowReviewFlipbook() {
    if (document.getElementById('__ckrb_review_flipbook')) return;
    _ckrbLoadReviewCards(function(cards) {
      _ckrbBuildFlipbook(document, cards, {
        id: '__ckrb_review_flipbook',
        title: '📋 Review Strategies',
        borderColor: '#10b981',
        accentLight: '#34d399',
        headerBg: '#064e3b',
        headerTextColor: '#a7f3d0',
        posKey: _CKRB_REVIEW_POS_KEY,
        saveFn: _ckrbSaveReviewCards,
        newLabel: '✨ New Review Note',
        editLabel: '✏️ Edit Review Note'
      });
    });
  }

  function _ckrbBuildFlipbook(hostDoc, cards, cfg) {
    cfg = cfg || {};
    var fbId = cfg.id || '__ckrb_flipbook';
    var fbTitle = cfg.title || '🃏 Strategy Cards';
    var fbBorderColor = cfg.borderColor || '#6366f1';
    var fbAccentLight = cfg.accentLight || '#818cf8';
    var fbHeaderBg = cfg.headerBg || '#1e1b4b';
    var fbHeaderText = cfg.headerTextColor || '#c7d2fe';
    var fbPosKey = cfg.posKey || _CKRB_STRAT_POS_KEY;
    var fbSaveFn = cfg.saveFn || _ckrbSaveCards;
    var fbNewLabel = cfg.newLabel || '✨ New Strategy Card';
    var fbEditLabel = cfg.editLabel || '✏️ Edit Strategy Card';
    var idx = 0;
    var root = hostDoc.createElement('div');
    root.id = fbId;
    root.setAttribute('data-ckrb-tts', 'true');
    root.style.cssText = 'position:fixed;top:40px;right:20px;z-index:2147483647;width:360px;' +
      'height:calc(100vh - 80px);display:flex;flex-direction:column;overflow:hidden;' +
      'background:#1e293b;color:#e2e8f0;border:2px solid ' + fbBorderColor + ';border-radius:12px;' +
      'font-family:system-ui,-apple-system,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.6);user-select:none;';

    // Restore saved position
    try {
      chrome.storage.local.get([fbPosKey], function(r) {
        if (r && r[fbPosKey]) {
          root.style.left = r[fbPosKey].left;
          root.style.top = r[fbPosKey].top;
          root.style.right = 'auto';
        }
      });
    } catch(e) {}

    // Header (drag handle)
    var header = hostDoc.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;' +
      'cursor:grab;border-bottom:1px solid #334155;border-radius:12px 12px 0 0;background:' + fbHeaderBg + ';flex-shrink:0;';
    header.innerHTML = '<span style="font-weight:700;font-size:14px;color:' + fbHeaderText + ';">' + fbTitle + '</span>';
    var closeBtn = hostDoc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:linear-gradient(180deg,#64748b 0%,#475569 100%);border:none;border-bottom:3px solid #334155;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;padding:4px 10px;font-weight:700;text-shadow:0 1px 1px rgba(0,0,0,0.3);outline:none;';
    closeBtn.addEventListener('click', function() { _fbStopSpeak(); root.remove(); });
    _ckrb3dBtn(closeBtn);
    header.appendChild(closeBtn);
    root.appendChild(header);

    // Card display
    var cardArea = hostDoc.createElement('div');
    cardArea.style.cssText = 'padding:12px 18px;text-align:center;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;min-height:0;';
    var cardText = hostDoc.createElement('div');
    cardText.style.cssText = 'font-size:18px;font-weight:600;line-height:1.5;color:#f1f5f9;flex-shrink:0;';
    cardArea.appendChild(cardText);
    var cardImg = hostDoc.createElement('img');
    cardImg.style.cssText = 'max-width:100%;flex:1;min-height:0;object-fit:contain;border-radius:8px;margin-top:8px;display:none;';
    cardArea.appendChild(cardImg);
    root.appendChild(cardArea);

    // Nav controls
    var nav = hostDoc.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:18px;padding:8px 14px;flex-shrink:0;';
    var btnS = 'background:linear-gradient(180deg,#818cf8 0%,#6366f1 100%);color:#fff;border:none;border-bottom:4px solid #4338ca;border-radius:12px;padding:10px 18px;cursor:pointer;font-size:16px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.3);outline:none;';
    var prevBtn = hostDoc.createElement('button'); prevBtn.type='button'; prevBtn.textContent='◀'; prevBtn.style.cssText=btnS;
    var counter = hostDoc.createElement('span'); counter.style.cssText='color:#94a3b8;font-size:15px;font-weight:600;min-width:70px;text-align:center;letter-spacing:1px;';
    var nextBtn = hostDoc.createElement('button'); nextBtn.type='button'; nextBtn.textContent='▶'; nextBtn.style.cssText=btnS;
    _ckrb3dBtn(prevBtn); _ckrb3dBtn(nextBtn);
    nav.appendChild(prevBtn); nav.appendChild(counter); nav.appendChild(nextBtn);
    root.appendChild(nav);

    // Action buttons
    var actions = hostDoc.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px 12px;flex-wrap:wrap;flex-shrink:0;';
    var actS = 'background:linear-gradient(180deg,#475569 0%,#334155 100%);color:#e2e8f0;border:none;border-bottom:3px solid #1e293b;border-radius:10px;padding:8px 14px;cursor:pointer;font-size:12px;font-weight:700;text-shadow:0 1px 1px rgba(0,0,0,0.3);outline:none;';
    var addBtn = hostDoc.createElement('button'); addBtn.type='button'; addBtn.textContent='+ Add'; addBtn.style.cssText=actS;
    var imgBtn = hostDoc.createElement('button'); imgBtn.type='button'; imgBtn.textContent='🖼 Image'; imgBtn.style.cssText=actS;
    var delBtn = hostDoc.createElement('button'); delBtn.type='button'; delBtn.textContent='🗑 Delete'; delBtn.style.cssText=actS+'background:linear-gradient(180deg,#f87171 0%,#ef4444 100%);color:#fff;border-bottom-color:#b91c1c;';
    var editBtn = hostDoc.createElement('button'); editBtn.type='button'; editBtn.textContent='✏️ Edit'; editBtn.style.cssText=actS+'background:linear-gradient(180deg,#fbbf24 0%,#f59e0b 100%);color:#fff;border-bottom-color:#d97706;';
    var ttsBtn = hostDoc.createElement('button'); ttsBtn.type='button'; ttsBtn.textContent='🔊 Repeat'; ttsBtn.style.cssText=actS+'background:linear-gradient(180deg,#38bdf8 0%,#0ea5e9 100%);color:#fff;border-bottom-color:#0369a1;';
    [ttsBtn, addBtn, editBtn, imgBtn, delBtn].forEach(_ckrb3dBtn);
    actions.appendChild(ttsBtn); actions.appendChild(addBtn); actions.appendChild(editBtn); actions.appendChild(imgBtn); actions.appendChild(delBtn);
    root.appendChild(actions);

    // Hidden file input for image upload
    var fileIn = hostDoc.createElement('input');
    fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.style.display = 'none';
    root.appendChild(fileIn);

    // ── TTS: read strategy text aloud ──
    var _fbSpeaking = false;
    var _fbUtterance = null;
    function _fbGetSynth() {
      try {
        var w = window;
        while (w.parent && w.parent !== w) { var _p = w.parent.speechSynthesis; if (!_p) break; w = w.parent; }
        return w;
      } catch(e) { return window; }
    }
    function _fbSpeak(text) {
      _fbStopSpeak();
      var host = _fbGetSynth();
      if (!('speechSynthesis' in host)) return;
      var UCtor = host.SpeechSynthesisUtterance || SpeechSynthesisUtterance;
      var u = new UCtor(text);
      u.rate = 0.95; u.pitch = 1.0;
      var voices = host.speechSynthesis.getVoices();
      var eng = voices.find(function(v) { return v.lang && v.lang.startsWith('en-US'); }) || voices.find(function(v) { return v.lang && v.lang.startsWith('en'); });
      if (eng) u.voice = eng;
      u.onend = function() { _fbSpeaking = false; };
      u.onerror = function() { _fbSpeaking = false; };
      _fbUtterance = u;
      _fbSpeaking = true;
      host.speechSynthesis.speak(u);
    }
    function _fbStopSpeak() {
      _fbSpeaking = false;
      try { _fbGetSynth().speechSynthesis.cancel(); } catch(e) {}
    }

    // ── Button hover/click effects ──
    var _fbAudioCtx = null;
    try { _fbAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    // Unlock audio on first user interaction anywhere on the page
    function _fbUnlockAudio() {
      if (_fbAudioCtx && _fbAudioCtx.state === 'suspended') _fbAudioCtx.resume();
      hostDoc.removeEventListener('pointerdown', _fbUnlockAudio, true);
      hostDoc.removeEventListener('keydown', _fbUnlockAudio, true);
    }
    hostDoc.addEventListener('pointerdown', _fbUnlockAudio, true);
    hostDoc.addEventListener('keydown', _fbUnlockAudio, true);
    function _fbBeep(freq, vol, dur) {
      try {
        if (!_fbAudioCtx) _fbAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_fbAudioCtx.state === 'suspended') _fbAudioCtx.resume();
        var osc = _fbAudioCtx.createOscillator(); var gain = _fbAudioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.value = vol;
        osc.connect(gain); gain.connect(_fbAudioCtx.destination);
        osc.start(); osc.stop(_fbAudioCtx.currentTime + dur);
      } catch(e) {}
    }
    function _fbAddEffects(btn) {
      var origBorderBottom = btn.style.borderBottom || '';
      var origTransform = '';
      btn.style.transition = 'transform 0.08s ease, border-bottom 0.08s ease, box-shadow 0.12s ease';
      btn.addEventListener('mouseenter', function() {
        btn.style.transform = 'scale(1.08)';
        btn.style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)';
        _fbBeep(600, 0.06, 0.05);
      });
      btn.addEventListener('mouseleave', function() {
        btn.style.transform = origTransform;
        btn.style.boxShadow = '';
        btn.style.borderBottom = origBorderBottom;
      });
      btn.addEventListener('mousedown', function() {
        btn.style.transform = 'translateY(3px) scale(1.02)';
        btn.style.borderBottom = '1px solid transparent';
        btn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
        _fbBeep(800, 0.08, 0.04);
      });
      btn.addEventListener('mouseup', function() {
        btn.style.transform = 'scale(1.08)';
        btn.style.borderBottom = origBorderBottom;
        btn.style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)';
      });
    }
    [prevBtn, nextBtn, ttsBtn, addBtn, editBtn, imgBtn, delBtn, closeBtn].forEach(_fbAddEffects);

    // Render current card
    function render() {
      if (!cards.length) { cardText.textContent = 'No cards yet — add one!'; cardImg.style.display='none'; counter.textContent='0/0'; return; }
      if (idx < 0) idx = 0;
      if (idx >= cards.length) idx = cards.length - 1;
      cardText.textContent = cards[idx].text;
      if (cards[idx].imageDataUrl) { cardImg.src = cards[idx].imageDataUrl; cardImg.style.display = 'block'; }
      else { cardImg.style.display = 'none'; cardImg.src = ''; }
      counter.textContent = (idx + 1) + ' / ' + cards.length;
      if (!_fbSilent) _fbSpeak(cards[idx].text);
    }
    var _fbSilent = true;
    render();
    _fbSilent = false;
    // Speak first card — retry if voices aren't loaded yet
    function _fbSpeakFirst() {
      if (!cards.length || !cards[idx]) return; // v286: no cards = nothing to speak
      var host = _fbGetSynth();
      if (!('speechSynthesis' in host)) return;
      var voices = host.speechSynthesis.getVoices();
      if (voices.length > 0) { _fbSpeak(cards[idx].text); return; }
      // Voices not loaded — wait for them
      host.speechSynthesis.addEventListener('voiceschanged', function vc() {
        host.speechSynthesis.removeEventListener('voiceschanged', vc);
        if (cards[idx]) _fbSpeak(cards[idx].text);
      });
      // Fallback timeout in case voiceschanged never fires
      setTimeout(function() { if (cards[idx]) _fbSpeak(cards[idx].text); }, 1500);
    }
    setTimeout(_fbSpeakFirst, 300);

    // Navigation
    prevBtn.addEventListener('click', function(e) { e.stopPropagation(); if (idx > 0) { idx--; render(); } });
    nextBtn.addEventListener('click', function(e) { e.stopPropagation(); if (idx < cards.length - 1) { idx++; render(); } });

    // Keyboard nav when flipbook is visible
    function keyNav(e) {
      if (!hostDoc.getElementById(fbId)) { hostDoc.removeEventListener('keydown', keyNav, true); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (idx > 0) { idx--; render(); } }
      if (e.key === 'ArrowRight') { e.preventDefault(); if (idx < cards.length - 1) { idx++; render(); } }
      if (e.key === 'Escape') { _fbStopSpeak(); root.remove(); }
    }
    hostDoc.addEventListener('keydown', keyNav, true);

    // Add card
    addBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _fbStopSpeak();
      // Hide current card content, show clean "New Card" form
      var prevDisplay = { text: cardText.style.display, img: cardImg.style.display };
      cardText.style.display = 'none';
      cardImg.style.display = 'none';
      nav.style.display = 'none';
      actions.style.display = 'none';
      var formWrap = hostDoc.createElement('div');
      formWrap.style.cssText = 'padding:4px 0;display:flex;flex-direction:column;align-items:center;gap:10px;flex:1;justify-content:center;';
      var formTitle = hostDoc.createElement('div');
      formTitle.textContent = fbNewLabel;
      formTitle.style.cssText = 'font-size:16px;font-weight:700;color:#c7d2fe;';
      var inp = hostDoc.createElement('textarea');
      inp.placeholder = 'Type your strategy...';
      inp.style.cssText = 'width:90%;padding:12px;border-radius:10px;border:2px solid #6366f1;background:#0f172a;color:#e2e8f0;font-family:inherit;font-size:15px;resize:vertical;min-height:80px;outline:none;';
      var btnRow = hostDoc.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';
      var okBtn = hostDoc.createElement('button'); okBtn.type='button'; okBtn.textContent='Save';
      okBtn.style.cssText = 'background:linear-gradient(180deg,#4ade80 0%,#22c55e 100%);color:#fff;border:none;border-bottom:3px solid #15803d;border-radius:10px;padding:10px 24px;cursor:pointer;font-weight:700;font-size:13px;outline:none;text-shadow:0 1px 1px rgba(0,0,0,0.2);';
      var cancelBtn = hostDoc.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel';
      cancelBtn.style.cssText = 'background:linear-gradient(180deg,#94a3b8 0%,#64748b 100%);color:#fff;border:none;border-bottom:3px solid #475569;border-radius:10px;padding:10px 24px;cursor:pointer;font-weight:700;font-size:13px;outline:none;text-shadow:0 1px 1px rgba(0,0,0,0.2);';
      _ckrb3dBtn(okBtn); _ckrb3dBtn(cancelBtn);
      btnRow.appendChild(okBtn); btnRow.appendChild(cancelBtn);
      formWrap.appendChild(formTitle); formWrap.appendChild(inp); formWrap.appendChild(btnRow);
      cardArea.appendChild(formWrap);
      inp.focus();
      function closeForm() {
        formWrap.remove();
        cardText.style.display = prevDisplay.text;
        nav.style.display = '';
        actions.style.display = '';
        render();
      }
      okBtn.addEventListener('click', function() {
        var txt = inp.value.trim();
        if (txt) { cards.push({id:'u_'+Date.now(), text:txt, imageDataUrl:null}); fbSaveFn(cards); idx = cards.length - 1; }
        closeForm();
      });
      cancelBtn.addEventListener('click', closeForm);
    });

    // Edit card text
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!cards.length) return;
      _fbStopSpeak();
      var prevDisplay = { text: cardText.style.display, img: cardImg.style.display };
      cardText.style.display = 'none';
      cardImg.style.display = 'none';
      nav.style.display = 'none';
      actions.style.display = 'none';
      var formWrap = hostDoc.createElement('div');
      formWrap.style.cssText = 'padding:4px 0;display:flex;flex-direction:column;align-items:center;gap:10px;flex:1;justify-content:center;';
      var formTitle = hostDoc.createElement('div');
      formTitle.textContent = fbEditLabel;
      formTitle.style.cssText = 'font-size:16px;font-weight:700;color:#fde68a;';
      var inp = hostDoc.createElement('textarea');
      inp.value = cards[idx].text;
      inp.style.cssText = 'width:90%;padding:12px;border-radius:10px;border:2px solid #f59e0b;background:#0f172a;color:#e2e8f0;font-family:inherit;font-size:15px;resize:vertical;min-height:80px;outline:none;';
      var btnRow = hostDoc.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';
      var okBtn = hostDoc.createElement('button'); okBtn.type='button'; okBtn.textContent='Save';
      okBtn.style.cssText = 'background:linear-gradient(180deg,#4ade80 0%,#22c55e 100%);color:#fff;border:none;border-bottom:3px solid #15803d;border-radius:10px;padding:10px 24px;cursor:pointer;font-weight:700;font-size:13px;outline:none;text-shadow:0 1px 1px rgba(0,0,0,0.2);';
      var cancelBtn = hostDoc.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel';
      cancelBtn.style.cssText = 'background:linear-gradient(180deg,#94a3b8 0%,#64748b 100%);color:#fff;border:none;border-bottom:3px solid #475569;border-radius:10px;padding:10px 24px;cursor:pointer;font-weight:700;font-size:13px;outline:none;text-shadow:0 1px 1px rgba(0,0,0,0.2);';
      _ckrb3dBtn(okBtn); _ckrb3dBtn(cancelBtn);
      btnRow.appendChild(okBtn); btnRow.appendChild(cancelBtn);
      formWrap.appendChild(formTitle); formWrap.appendChild(inp); formWrap.appendChild(btnRow);
      cardArea.appendChild(formWrap);
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      function closeForm() {
        formWrap.remove();
        cardText.style.display = prevDisplay.text;
        nav.style.display = '';
        actions.style.display = '';
        render();
      }
      okBtn.addEventListener('click', function() {
        var txt = inp.value.trim();
        if (txt) { cards[idx].text = txt; fbSaveFn(cards); }
        closeForm();
      });
      cancelBtn.addEventListener('click', closeForm);
    });

    // Delete card
    delBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!cards.length) return;
      _fbStopSpeak();
      cards.splice(idx, 1);
      fbSaveFn(cards);
      if (idx >= cards.length) idx = cards.length - 1;
      render();
    });

    // Image upload
    ttsBtn.addEventListener('click', function(e) { e.stopPropagation(); if (cards.length) _fbSpeak(cards[idx].text); });
    imgBtn.addEventListener('click', function(e) { e.stopPropagation(); fileIn.click(); });
    fileIn.addEventListener('change', function() {
      if (!fileIn.files || !fileIn.files[0] || !cards.length) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        // Resize to max 400px wide for storage
        var img = new Image();
        img.onload = function() {
          var maxW = 400;
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var canvas = hostDoc.createElement('canvas'); canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          cards[idx].imageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          fbSaveFn(cards);
          render();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(fileIn.files[0]);
      fileIn.value = '';
    });

    // Paste image support
    root.addEventListener('paste', function(e) {
      if (!cards.length) return;
      var items = (e.clipboardData || e.originalEvent.clipboardData || {}).items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          var blob = items[i].getAsFile();
          var reader = new FileReader();
          reader.onload = function(ev) {
            var img = new Image();
            img.onload = function() {
              var maxW = 400, w = img.width, h = img.height;
              if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
              var canvas = hostDoc.createElement('canvas'); canvas.width = w; canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              cards[idx].imageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
              fbSaveFn(cards);
              render();
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });

    // Drag-and-drop image onto card
    cardArea.addEventListener('dragover', function(e) {
      e.preventDefault(); e.stopPropagation();
      cardArea.style.outline = '2px dashed #818cf8';
      cardArea.style.outlineOffset = '-4px';
    });
    cardArea.addEventListener('dragleave', function(e) {
      e.preventDefault(); e.stopPropagation();
      cardArea.style.outline = 'none';
    });
    cardArea.addEventListener('drop', function(e) {
      e.preventDefault(); e.stopPropagation();
      cardArea.style.outline = 'none';
      if (!cards.length) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var file = null;
      for (var fi = 0; fi < files.length; fi++) {
        if (files[fi].type && files[fi].type.indexOf('image') !== -1) { file = files[fi]; break; }
      }
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() {
          var maxW = 400, w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var canvas = hostDoc.createElement('canvas'); canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          cards[idx].imageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          fbSaveFn(cards);
          render();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Drag panel
    var _fbDrag = false, _fbOx = 0, _fbOy = 0;
    header.addEventListener('mousedown', function(de) {
      if (de.target === closeBtn) return;
      _fbDrag = true; header.style.cursor = 'grabbing';
      var rect = root.getBoundingClientRect();
      _fbOx = de.clientX - rect.left; _fbOy = de.clientY - rect.top;
      de.preventDefault();
    });
    hostDoc.addEventListener('mousemove', function(me) {
      if (!_fbDrag) return;
      root.style.left = (me.clientX - _fbOx) + 'px';
      root.style.top = (me.clientY - _fbOy) + 'px';
      root.style.right = 'auto';
    });
    hostDoc.addEventListener('mouseup', function() {
      if (_fbDrag) {
        _fbDrag = false; header.style.cursor = 'grab';
        try {
          var pos = { left: root.style.left, top: root.style.top };
          var o = {}; o[fbPosKey] = pos;
          chrome.storage.local.set(o);
        } catch(e) {}
      }
    });

    (hostDoc.body || hostDoc.documentElement).appendChild(root);
  }

  // ── Floating toggle button on qbank sites ──
  // v283: append to CURRENT document, not topDoc — top frame may be invisible wrapper
  function _ckrbCreateFlipbookToggle() {
    if (document.getElementById('__ckrb_flipbook_toggle')) return;
    var host = '';
    try { host = location.hostname; } catch(e) {}
    if (!/uworld\.com|amboss\.com|starttest\.com|nbme\.org|ccscases\.com/i.test(host)) return;
    if (!document.body) return; // body not ready yet
    var btn = document.createElement('button');
    btn.id = '__ckrb_flipbook_toggle';
    btn.type = 'button';
    btn.innerHTML = '🃏';
    btn.title = 'Strategy Cards';
    btn.setAttribute('data-ckrb-tts', 'true');
    btn.style.cssText = 'position:fixed;bottom:70px;right:20px;z-index:2147483647;width:48px;height:48px;' +
      'border-radius:50%;background:linear-gradient(180deg,#818cf8 0%,#6366f1 100%);color:#fff;border:2px solid #a5b4fc;border-bottom:4px solid #4338ca;font-size:22px;cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(99,102,241,0.5);display:flex;align-items:center;justify-content:center;transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);';
    btn.addEventListener('mouseenter', function() { btn.style.transform='translateY(-2px) scale(1.1)'; btn.style.boxShadow='0 6px 18px rgba(99,102,241,0.6)'; });
    btn.addEventListener('mouseleave', function() { btn.style.transform=''; btn.style.boxShadow='0 4px 12px rgba(99,102,241,0.5)'; });
    btn.addEventListener('mousedown', function() { btn.style.transform='translateY(2px) scale(0.95)'; btn.style.borderBottomWidth='1px'; });
    btn.addEventListener('mouseup', function() { btn.style.transform=''; btn.style.borderBottomWidth='4px'; });
    btn.addEventListener('click', function() {
      try { _ckrbToggleFlipbook(); } catch(e) { console.error('[CK Buddy] Flipbook toggle error:', e); }
    });
    _ckrb3dBtn(btn);
    document.body.appendChild(btn);
    console.log('[CK Buddy] Flipbook toggle button created on', host, 'frame:', window === window.top ? 'TOP' : 'CHILD');
  }
  setTimeout(_ckrbCreateFlipbookToggle, 2000);
  setInterval(_ckrbCreateFlipbookToggle, 5000);

  // ── Second floating button: Review Strategies ──
  // v284: same flipbook, second entry point for reviewing
  function _ckrbCreateReviewToggle() {
    if (document.getElementById('__ckrb_review_toggle')) return;
    var host = '';
    try { host = location.hostname; } catch(e) {}
    if (!/uworld\.com|amboss\.com|starttest\.com|nbme\.org|ccscases\.com/i.test(host)) return;
    if (!document.body) return;
    var btn = document.createElement('button');
    btn.id = '__ckrb_review_toggle';
    btn.type = 'button';
    btn.innerHTML = '📋';
    btn.title = 'Review Strategies';
    btn.setAttribute('data-ckrb-tts', 'true');
    btn.style.cssText = 'position:fixed;bottom:126px;right:20px;z-index:2147483647;width:48px;height:48px;' +
      'border-radius:50%;background:linear-gradient(180deg,#34d399 0%,#10b981 100%);color:#fff;border:2px solid #6ee7b7;border-bottom:4px solid #059669;font-size:22px;cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(16,185,129,0.5);display:flex;align-items:center;justify-content:center;transition:all 0.15s cubic-bezier(0.34,1.56,0.64,1);';
    btn.addEventListener('mouseenter', function() { btn.style.transform='translateY(-2px) scale(1.1)'; btn.style.boxShadow='0 6px 18px rgba(16,185,129,0.6)'; });
    btn.addEventListener('mouseleave', function() { btn.style.transform=''; btn.style.boxShadow='0 4px 12px rgba(16,185,129,0.5)'; });
    btn.addEventListener('mousedown', function() { btn.style.transform='translateY(2px) scale(0.95)'; btn.style.borderBottomWidth='1px'; });
    btn.addEventListener('mouseup', function() { btn.style.transform=''; btn.style.borderBottomWidth='4px'; });
    btn.addEventListener('click', function() {
      try { _ckrbToggleReviewFlipbook(); } catch(e) { console.error('[CK Buddy] Review toggle error:', e); }
    });
    _ckrb3dBtn(btn);
    document.body.appendChild(btn);
    console.log('[CK Buddy] Review toggle button created on', host);
  }
  setTimeout(_ckrbCreateReviewToggle, 2000);
  setInterval(_ckrbCreateReviewToggle, 5000);

  // ── Auto-show on UWorld Create Test page ──
  var _ckrbFlipbookAutoShown = false;
  setInterval(function() {
    if (_ckrbFlipbookAutoShown) return;
    try { if (window.parent && window.parent !== window && window.parent.document) return; } catch(e) {}
    var href = '';
    try { href = location.href; } catch(e) {}
    if (/\/createtest|\/customsession/i.test(href)) {
      _ckrbFlipbookAutoShown = true;
      _ckrbShowFlipbook();
    }
  }, 2000);

  // === EXPORT CARDS TO DOM (for external access) ===
  document.addEventListener('ckrb-export-cards', function() {
    try {
      chrome.storage.local.get([_CKRB_STRAT_KEY], function(r) {
        var cards = r && r[_CKRB_STRAT_KEY];
        var el = document.getElementById('__ckrb_export_data');
        if (!el) {
          el = document.createElement('div');
          el.id = '__ckrb_export_data';
          el.style.display = 'none';
          document.body.appendChild(el);
        }
        el.textContent = JSON.stringify(cards || []);
        el.setAttribute('data-ready', 'true');
      });
    } catch(e) {
      var el = document.getElementById('__ckrb_export_data');
      if (!el) {
        el = document.createElement('div');
        el.id = '__ckrb_export_data';
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify({error: e.message});
      el.setAttribute('data-ready', 'true');
    }
  });


})();
