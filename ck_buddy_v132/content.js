// CK Buddy v78 — exact selectors verified via DevTools

(function () {

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

  /* ── EXPLANATION HIGHLIGHT + COPY UNLOCK ── */
  function enableEDFHighlight() {
    var edf = getEDF();
    if (!edf || edf.__ckrb_hl) return;
    edf.__ckrb_hl = true;
    var s = edf.createElement('style');
    s.textContent = [
      '* { user-select: text !important; -webkit-user-select: text !important; }',
      '::selection { background: #ffe066 !important; color: #000 !important; }',
      '::-moz-selection { background: #ffe066 !important; color: #000 !important; }'
    ].join('\n');
    (edf.head || edf.documentElement).appendChild(s);
    edf.addEventListener('selectstart', function(e) { e.stopImmediatePropagation(); }, true);
    edf.addEventListener('contextmenu', function(e) { e.stopImmediatePropagation(); }, true);
    edf.addEventListener('copy',        function(e) { e.stopImmediatePropagation(); }, true);
    edf.addEventListener('mouseup', function() {
      var sel = edf.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      var parent = range.commonAncestorContainer;
      if (parent.nodeType === 3) parent = parent.parentNode;
      if (parent.classList && parent.classList.contains('__ckrb_mark')) return;
      try {
        var mark = edf.createElement('span');
        mark.className = '__ckrb_mark';
        mark.style.cssText = 'background:#ffb347;color:#000;border-radius:2px;';
        range.surroundContents(mark);
        sel.removeAllRanges();
      } catch(e) {}
    }, false);
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
    return null;
  }

  function nextBtn() { return document.querySelector('button#Next') || document.querySelector('button.Next'); }

  function scrapeCurrentQuestion(index) {
    var edf = getEDF();
    if (!edf) return null;
    var fullText = edf.body.innerText || '';
    if (fullText.length < 100) return null;

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
    // Try several NBME / NBME-FL / CMS explanation block formats, in order
    // of specificity. This keeps the native-only Read-Explanation path viable.
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
    // Last-ditch: if the page has a recognizable "Correct Answer: X" anywhere,
    // take everything after it up to the end of the EDF text.
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
    var questions = [];
    var seenNums = new Set();
    var retries = 0;
    await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.initial); });

    for (var i = 0; i < limit * 2; i++) {
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
      if (q) {
        q.id = currentNum - 1;
        var sectionNum = progress2 && progress2.section ? progress2.section : 1;
        q.absoluteId = (sectionNum - 1) * 50 + currentNum;
        seenNums.add(currentNum);
        questions.push(q);
        var s = q.isCorrect === true ? '\u2713' : q.isCorrect === false ? '\u2717' : '?';
        showOverlay('Q' + currentNum + ' scraped [' + s + '] \u2014 ' + questions.length + '/' + total);
      } else {
        seenNums.add(currentNum);
        showOverlay('Q' + currentNum + ': no content');
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

    var missing = [];
    if (missing.length > 0) {
      showOverlay('Gap check: missing Q' + missing.slice(0,5).join(',') + (missing.length > 5 ? '…' : '') + ' — backfilling\u2026');
      for (var mi = 0; mi < missing.length; mi++) {
        var targetQ = missing[mi];
        var nav = document.getElementById('leftnav') || document.getElementById('collapsedNav');
        var navClicked = false;
        if (nav) {
          var items = Array.from(nav.querySelectorAll('a, span, div, li'));
          for (var ni = 0; ni < items.length; ni++) {
            if ((items[ni].innerText || '').trim() === String(targetQ)) {
              items[ni].click(); navClicked = true; break;
            }
          }
        }
        await new Promise(function(r) { setTimeout(r, 2500); });
        var p2 = getProgress();
        if (p2 && p2.current === targetQ) {
          var bq = scrapeCurrentQuestion(questions.length);
          if (bq) {
            bq.id = targetQ - 1;
            questions.push(bq);
            var bs = bq.isCorrect === true ? '\u2713' : bq.isCorrect === false ? '\u2717' : '?';
            showOverlay('Backfilled Q' + targetQ + ' [' + bs + ']');
          }
        }
      }
      questions.sort(function(a, b) { return a.id - b.id; });
    }

    removeOverlay();
    chrome.runtime.sendMessage({ type: 'PR_SCRAPE_COMPLETE', data: { url: location.href, title: document.title, scrapedAt: Date.now(), questions: questions } });
  }

  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
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
  });

  console.log('[CK Buddy v30]', location.hostname);

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
      row.style.opacity = '';
      var badge = row.querySelector('.ckrb-ruleout');
      if (badge) badge.remove();
      row.setAttribute('data-ckrb-struck', 'false');
    } else {
      row.style.textDecoration = 'line-through';
      row.style.opacity = '0.4';
      row.style.position = 'relative';
      var badge = document.createElement('span');
      badge.className = 'ckrb-ruleout';
      badge.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:#ef4444;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.05em;pointer-events:none;z-index:10;';
      badge.textContent = 'RULED OUT';
      row.appendChild(badge);
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
    // If right-clicking on an existing yellow highlight, remove it (toggle off)
    var mark = e.target && e.target.closest && e.target.closest('.__ckrb_ymark');
    if (mark) {
      e.preventDefault();
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize && parent.normalize();
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

  function _ckrbWrapSelectionYellow() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed || range.toString().trim().length < 1) return false;
    try {
      var mark = document.createElement('span');
      mark.className = '__ckrb_ymark';
      mark.style.cssText = 'background-color:#fde047 !important;color:#000 !important;border-radius:2px;padding:0 1px;';
      range.surroundContents(mark);
      sel.removeAllRanges();
      return true;
    } catch(err) {
      // Range crosses element boundaries — use extractContents fallback
      try {
        var mark2 = document.createElement('span');
        mark2.className = '__ckrb_ymark';
        mark2.style.cssText = 'background-color:#fde047 !important;color:#000 !important;border-radius:2px;padding:0 1px;';
        mark2.appendChild(range.extractContents());
        range.insertNode(mark2);
        sel.removeAllRanges();
        return true;
      } catch(err2) {
        return false;
      }
    }
  }

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 2) return;
    // Don't yellow-highlight answer choices during exam taking — let the
    // existing right-click strikethrough "RULED OUT" behavior handle them.
    if (findAnswerRow(e.target)) return;
    _ckrbRightStartX = e.clientX;
    _ckrbRightStartY = e.clientY;
    _ckrbRightMoved = false;
    _ckrbRightStartRange = _ckrbCaretRangeFromPoint(e.clientX, e.clientY);
    if (_ckrbRightStartRange) {
      _ckrbRightDragging = true;
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
    if (wasDragged) {
      // Paint the current selection yellow and suppress the contextmenu
      var ok = _ckrbWrapSelectionYellow();
      if (ok) {
        window._ckrbSuppressNextCtx = true;
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  /* ── HIGHLIGHT-TO-SPEECH (all platforms + ccscases) ── */
  // Force-enable text selection (ccscases.com disables it via CSS)
  try {
    var _ckrbSelStyle = document.createElement('style');
    _ckrbSelStyle.id = '__ckrb_sel_override';
    _ckrbSelStyle.textContent = [
      '*, *::before, *::after {',
      '  user-select: text !important;',
      '  -webkit-user-select: text !important;',
      '  -moz-user-select: text !important;',
      '  -ms-user-select: text !important;',
      '}',
      '::selection { background: #fde047 !important; color: #000 !important; }',
      '::-moz-selection { background: #fde047 !important; color: #000 !important; }'
    ].join('\n');
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

  var _ckrbTTSBtn = null;
  var _ckrbTTSSpeaking = false;

  // Return the topmost accessible document (walks up same-origin parents).
  // This matters for UWorld Step 3 where the test interface runs inside a
  // nested iframe — we want the Read button to render in the visible top
  // window, not get stranded inside a clipped subframe.
  function _ckrbTopDoc() {
    var w = window;
    try {
      while (w.parent && w.parent !== w) {
        // touch .document to trigger SecurityError if cross-origin
        var _probe = w.parent.document;
        if (!_probe) break;
        w = w.parent;
      }
    } catch(e) { /* cross-origin — stop walking */ }
    try { return w.document; } catch(e) { return document; }
  }

  function _ckrbRemoveTTSBtn() {
    // Remove from wherever it currently lives (top doc or local doc).
    if (_ckrbTTSBtn && _ckrbTTSBtn.parentNode) {
      _ckrbTTSBtn.parentNode.removeChild(_ckrbTTSBtn);
    }
    _ckrbTTSBtn = null;
    // Also sweep any stragglers from prior runs/frames.
    try {
      var topDoc = _ckrbTopDoc();
      var strays = topDoc.querySelectorAll('button[data-ckrb-tts="true"]');
      for (var i = 0; i < strays.length; i++) strays[i].parentNode && strays[i].parentNode.removeChild(strays[i]);
    } catch(e) {}
  }

  function _ckrbSpeak(text) {
    // Always speak via the top window’s speechSynthesis — some qbank popups
    // (UWorld Step 3, NBME secure browser) load the exam in a nested frame
    // that may suspend speech on navigation. The top window is stable.
    var synthHost = window;
    try {
      var w = window;
      while (w.parent && w.parent !== w) { var _p = w.parent.speechSynthesis; if (!_p) break; w = w.parent; }
      synthHost = w;
    } catch(e) { synthHost = window; }
    if (!('speechSynthesis' in synthHost)) synthHost = window;
    if (!('speechSynthesis' in synthHost)) return;
    try { synthHost.speechSynthesis.cancel(); } catch(e) {}
    var UCtor = synthHost.SpeechSynthesisUtterance || SpeechSynthesisUtterance;
    var u = new UCtor(text);
    u.rate = 0.95;
    u.pitch = 1.0;
    var voices = synthHost.speechSynthesis.getVoices();
    var eng = voices.find(function(v) { return v.lang && v.lang.startsWith('en-US'); }) || voices.find(function(v) { return v.lang && v.lang.startsWith('en'); });
    if (eng) u.voice = eng;
    u.onend = function() { _ckrbTTSSpeaking = false; if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read'; };
    u.onerror = function() { _ckrbTTSSpeaking = false; if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read'; };
    _ckrbTTSSpeaking = true;
    synthHost.speechSynthesis.speak(u);
  }

  function _ckrbShowTTSBtn(x, y, text) {
    _ckrbRemoveTTSBtn();
    // Render into the topmost accessible document so the button is never
    // stranded inside a hidden/clipped iframe (UWorld Step 3 testinterface,
    // NBME EDF, AMBOSS review overlays all nest content in subframes).
    var hostDoc = _ckrbTopDoc();
    var hostWin = (hostDoc.defaultView || window);
    var btn = hostDoc.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '🔊 Read';
    btn.setAttribute('data-ckrb-tts', 'true');
    // Clamp to host window viewport (selection rect is in local frame coords
    // but button is position:fixed in host window — clamp conservatively).
    var maxX = (hostWin.innerWidth || 1200) - 90;
    var maxY = (hostWin.innerHeight || 800) - 40;
    var px = Math.max(8, Math.min(maxX, x|0));
    var py = Math.max(8, Math.min(maxY, y|0));
    btn.style.cssText = 'position:fixed;left:' + px + 'px;top:' + py + 'px;z-index:2147483647;background:#6366f1;color:#fff;border:2px solid #818cf8;border-radius:8px;padding:6px 12px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);user-select:none;';
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (_ckrbTTSSpeaking) {
        try { (hostWin.speechSynthesis || window.speechSynthesis).cancel(); } catch(err) {}
        _ckrbTTSSpeaking = false;
        btn.innerHTML = '🔊 Read';
      } else {
        btn.innerHTML = '⏸ Stop';
        _ckrbSpeak(text);
      }
    });
    (hostDoc.body || hostDoc.documentElement).appendChild(btn);
    _ckrbTTSBtn = btn;
  }

  function _ckrbGetSelectionText() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    return sel.toString().trim();
  }

  // Compute the offset from this frame's viewport to the top window's
  // viewport by summing frameElement.getBoundingClientRect() up the chain.
  // Required so selection rects inside UWorld Step 3's nested testinterface
  // iframe map correctly onto the top-window-positioned Read button.
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
    } catch(e) { /* cross-origin — offsets stop accumulating */ }
    return { dx: dx, dy: dy };
  }

  document.addEventListener('mouseup', function(e) {
    if (!_ckrbHighlightTTSEnabled) return;
    // Ignore clicks on our button
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-ckrb-tts')) return;
    setTimeout(function() {
      var text = _ckrbGetSelectionText();
      if (!text || text.length < 2) {
        // If clicking outside a selection and not on our button, remove it
        if (_ckrbTTSBtn && e.target !== _ckrbTTSBtn) _ckrbRemoveTTSBtn();
        return;
      }
      // Get bounding rect of selection, then translate into top-window coords
      var off = _ckrbFrameOffsetToTop();
      try {
        var sel = window.getSelection();
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        var x = (rect.right - 40) + off.dx;
        var y = (rect.top - 38) + off.dy;
        _ckrbShowTTSBtn(x, y, text);
      } catch(err) {
        _ckrbShowTTSBtn(e.clientX + off.dx, (e.clientY - 38) + off.dy, text);
      }
    }, 10);
  }, true);

  // Keyboard shortcut: Ctrl+Shift+S to speak current selection
  document.addEventListener('keydown', function(e) {
    if (!_ckrbHighlightTTSEnabled) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      var text = _ckrbGetSelectionText();
      if (text && text.length > 1) {
        e.preventDefault();
        _ckrbSpeak(text);
      }
    }
    // Escape stops TTS
    if (e.key === 'Escape' && _ckrbTTSSpeaking) {
      try { window.speechSynthesis.cancel(); } catch(err) {}
      _ckrbTTSSpeaking = false;
      _ckrbRemoveTTSBtn();
    }
  }, true);

  // Hide on scroll (only if not actively in a TTS session)
  document.addEventListener('scroll', function() {
    if (_ckrbTTSBtn && !_ckrbTTSSpeaking) _ckrbRemoveTTSBtn();
  }, true);
})();
