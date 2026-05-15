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

  /* ── EXPLANATION HIGHLIGHT UNLOCK ── */
  function enableEDFHighlight() {
    var edf = getEDF();
    if (!edf || edf.__ckrb_hl) return;
    edf.__ckrb_hl = true;

    // Allow selection + style it yellow while dragging
    var s = edf.createElement('style');
    s.textContent = [
      '* { user-select: text !important; -webkit-user-select: text !important; }',
      '::selection { background: #ffe066 !important; color: #000 !important; }',
      '::-moz-selection { background: #ffe066 !important; color: #000 !important; }',
      'span.__ckrb_mark { background: #ffe066; color: #000; border-radius: 2px; }'
    ].join('\n');
    (edf.head || edf.documentElement).appendChild(s);

    // Kill block listeners
    edf.addEventListener('selectstart', function(e) { e.stopImmediatePropagation(); }, true);
    edf.addEventListener('mousedown',   function(e) { e.stopImmediatePropagation(); }, true);

    // Persist the highlight on mouseup by wrapping selection in a span
    edf.addEventListener('mouseup', function() {
      var sel = edf.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      // Don't double-wrap an existing highlight
      var container = range.commonAncestorContainer;
      var parent = container.nodeType === 3 ? container.parentNode : container;
      if (parent && parent.classList && parent.classList.contains('__ckrb_mark')) return;
      try {
        var mark = edf.createElement('span');
        mark.className = '__ckrb_mark';
        range.surroundContents(mark);
        sel.removeAllRanges();
      } catch(e) {
        // surroundContents fails on cross-element ranges — skip silently
      }
    }, false);
  }
  setInterval(enableEDFHighlight, 1500);
  /* ─────────────────────────────────── */

  function getEDF() {
    try {
      var f = document.querySelector('#ElementDisplayFrame');
      if (f && f.contentDocument && f.contentDocument.body) return f.contentDocument;
    } catch(e) {}
    return null;
  }

  function getProgress() {
    // Try title first (CMS forms)
    var m = document.title.match(/question\s+(\d+)\s+of\s+(\d+)/i);
    if (m) return { current: +m[1], total: +m[2] };
    // Try QuestionNumber element (full NBME exams)
    var el = document.getElementById('QuestionNumber');
    if (el) {
      var t = el.innerText || '';
      // Check section-based pattern FIRST
      var m3 = t.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
      if (m3) return { current: +m3[2], total: 50, section: +m3[1] };
      // Fallback: no section
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

    // Strip "Question X. This is a read only..." header
    var qText = fullText;
    // Text format: "Question X.\nThis is read only...\nN choices.\n<STEM>\nA .\n<choice>\nB .\n..."
    // Extract just the stem — everything after "N choices.\n" up to the first "\nA ."
    var choicesMatch = fullText.match(/\d+ choices\.\n([\s\S]+?)(?:\nA\s*\.\n|\nA\s*\n)/i);
    if (choicesMatch) {
      qText = choicesMatch[1].trim();
    } else {
      // Fallback: after "N choices.\n", take up to 1500 chars
      var fallbackMatch = fullText.match(/\d+ choices\.\n([\s\S]{50,1500})/i);
      if (fallbackMatch) qText = fallbackMatch[1].trim();
    }

    // Get choices via radio + label
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

    // Correct answer
    var correctAnswer = '';
    var cM = fullText.match(/Correct Answer:\s*([A-F])/i);
    if (cM) correctAnswer = cM[1].trim();

    var isCorrect = null;
    if (correctAnswer && userAnswer) {
      isCorrect = userAnswer[0].toUpperCase() === correctAnswer[0].toUpperCase();
    }

    var explanation = '';
    // NBME format: "Rationale:\n\nCorrect Answer: X.\n\n\nExplanation text..."
    var ratM = fullText.match(/Correct Answer:\s*[A-F]\.?\s*\n+([\s\S]{20,1500})/i);
    if (ratM) explanation = ratM[1].trim().slice(0, 1200);
    // Fallback: anything after "Rationale:"
    if (!explanation) {
      var ratM2 = fullText.match(/Rationale:\s*([\s\S]{20,1500})/i);
      if (ratM2) explanation = ratM2[1].replace(/^Correct Answer:\s*[A-F]\.?\s*\n+/i, '').trim().slice(0, 1200);
    }

    if (!qText || qText.length < 30) return null;
    return { id: index, source: 'nbme', questionText: qText.trim(), choices: choices, userAnswer: userAnswer, correctAnswer: correctAnswer, isCorrect: isCorrect, explanation: explanation };
  }

  function waitForChange(prevText, timeout) {
    timeout = timeout || CKRB_DELAYS.change;
    return new Promise(function(resolve) {
      var start = Date.now();
      var iv = setInterval(function() {
        var edf = getEDF();
        // Snapshot from 600-1000 chars in — past the "read only" header, into the actual vignette
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
      // Pass 1: read question number
      var progress = getProgress();
      var total = progress ? progress.total : '?';
      var currentNum = progress ? progress.current : (i + 1);

      // Skip if we've already scraped this question number
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

      // Pass 2: re-read number to confirm page is stable, then scrape
      var progress2 = getProgress();
      var confirmedNum = progress2 ? progress2.current : currentNum;

      if (confirmedNum !== currentNum) {
        // Page changed between pass 1 and 2 — retry up to 3 times
        retries = (retries || 0) + 1;
        if (retries < 3) {
          await new Promise(function(r) { setTimeout(r, CKRB_DELAYS.retry); });
          i--;
        } else {
          // Give up — click Next and move on
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

      // Click Next and verify we actually moved — retry up to 3 times
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
      if (!moved) break; // stuck — stop scraping
    }

    // ── GAP CHECK: backfill any skipped questions ──
    // Gap check disabled for 10-question mode
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
      // Stop any existing navigation
      window._navStop = true;
      setTimeout(function() {
        window._navStop = false;
        var targetAbs = msg.questionNum;
        var getPos = function() {
          // FL mode: Section X Item Y → absolute position
          var el = document.getElementById('QuestionNumber');
          if (el) {
            var t = el.innerText || '';
            var mFL = t.match(/Section\s+(\d+)\s+Item:\s*(\d+)/i);
            if (mFL) return (parseInt(mFL[1])-1)*50 + parseInt(mFL[2]);
            var mItem = t.match(/Item:\s*(\d+)/i);
            if (mItem) return parseInt(mItem[1]);
          }
          // CMS mode: "Question X of Y" in title
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
})();
