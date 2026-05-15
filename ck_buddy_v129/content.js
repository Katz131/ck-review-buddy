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
    var ratM = fullText.match(/Correct Answer:\s*[A-F]\.?\s*\n+([\s\S]{20,})/i);
    if (ratM) explanation = ratM[1].trim();
    if (!explanation) {
      var ratM2 = fullText.match(/Rationale:\s*([\s\S]{20,})/i);
      if (ratM2) explanation = ratM2[1].replace(/^Correct Answer:\s*[A-F]\.?\s*\n+/i, '').trim();
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
    var row = findAnswerRow(e.target);
    if (!row) return;
    e.preventDefault();
    toggleStrikethrough(row);
  });

  /* ── HIGHLIGHT-TO-SPEECH (all platforms + ccscases) ── */
  var _ckrbTTSBtn = null;
  var _ckrbTTSSpeaking = false;

  function _ckrbRemoveTTSBtn() {
    if (_ckrbTTSBtn && _ckrbTTSBtn.parentNode) {
      _ckrbTTSBtn.parentNode.removeChild(_ckrbTTSBtn);
    }
    _ckrbTTSBtn = null;
  }

  function _ckrbSpeak(text) {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch(e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.0;
    var voices = window.speechSynthesis.getVoices();
    var eng = voices.find(function(v) { return v.lang && v.lang.startsWith('en-US'); }) || voices.find(function(v) { return v.lang && v.lang.startsWith('en'); });
    if (eng) u.voice = eng;
    u.onend = function() { _ckrbTTSSpeaking = false; if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read'; };
    u.onerror = function() { _ckrbTTSSpeaking = false; if (_ckrbTTSBtn) _ckrbTTSBtn.innerHTML = '🔊 Read'; };
    _ckrbTTSSpeaking = true;
    window.speechSynthesis.speak(u);
  }

  function _ckrbShowTTSBtn(x, y, text) {
    _ckrbRemoveTTSBtn();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '🔊 Read';
    btn.setAttribute('data-ckrb-tts', 'true');
    btn.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:2147483647;background:#6366f1;color:#fff;border:2px solid #818cf8;border-radius:8px;padding:6px 12px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);user-select:none;';
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (_ckrbTTSSpeaking) {
        try { window.speechSynthesis.cancel(); } catch(err) {}
        _ckrbTTSSpeaking = false;
        btn.innerHTML = '🔊 Read';
      } else {
        btn.innerHTML = '⏸ Stop';
        _ckrbSpeak(text);
      }
    });
    document.body.appendChild(btn);
    _ckrbTTSBtn = btn;
  }

  function _ckrbGetSelectionText() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    return sel.toString().trim();
  }

  document.addEventListener('mouseup', function(e) {
    // Ignore clicks on our button
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-ckrb-tts')) return;
    setTimeout(function() {
      var text = _ckrbGetSelectionText();
      if (!text || text.length < 2) {
        // If clicking outside a selection and not on our button, remove it
        if (_ckrbTTSBtn && e.target !== _ckrbTTSBtn) _ckrbRemoveTTSBtn();
        return;
      }
      // Get bounding rect of selection
      try {
        var sel = window.getSelection();
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        var x = Math.max(8, Math.min(window.innerWidth - 90, rect.right - 40));
        var y = Math.max(8, rect.top - 38);
        _ckrbShowTTSBtn(x, y, text);
      } catch(err) {
        // Fallback: position near mouse
        _ckrbShowTTSBtn(e.clientX, Math.max(8, e.clientY - 38), text);
      }
    }, 10);
  }, true);

  // Keyboard shortcut: Ctrl+Shift+S to speak current selection
  document.addEventListener('keydown', function(e) {
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

  // Hide on scroll
  document.addEventListener('scroll', function() {
    if (_ckrbTTSBtn && !_ckrbTTSSpeaking) _ckrbRemoveTTSBtn();
  }, true);
})();
