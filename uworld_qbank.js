// uworld_qbank.js — CK Buddy UWorld Qbank Scraper
// Scrapes UWorld question sessions (tutor/review mode) for the CK Buddy pipeline

(function() {
  if (window.__ckrb_uworld_qbank_loaded) return;
  window.__ckrb_uworld_qbank_loaded = true;

  /* ── OVERLAY ── */
  var overlay = null;
  var _scrapeLog = [];
  function showOverlay(text, logEntry) {
    if (logEntry) _scrapeLog.push(logEntry);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__ckrb_uworld_ol';
      overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e293b;color:#e2e8f0;border:2px solid #f97316;border-radius:10px;padding:14px 18px;font-family:system-ui,sans-serif;font-size:13px;font-weight:700;box-shadow:0 4px 24px rgba(0,0,0,0.7);min-width:300px;max-width:420px;max-height:60vh;overflow-y:auto;';
      document.body.appendChild(overlay);
    }
    var logHtml = '';
    if (_scrapeLog.length > 0) {
      // Show last 15 entries
      var show = _scrapeLog.slice(-15);
      logHtml = '<div style="margin-top:8px;font-size:12px;font-weight:400;color:#94a3b8;border-top:1px solid #334155;padding-top:6px;line-height:1.6;">';
      for (var li = 0; li < show.length; li++) {
        logHtml += show[li] + '<br>';
      }
      logHtml += '</div>';
    }
    overlay.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:14px;">' +
      '<span style="font-size:18px">📘</span><span>' + text + '</span></div>' + logHtml;
    // Auto-scroll to bottom
    overlay.scrollTop = overlay.scrollHeight;
  }
  function removeOverlay() { var e = document.getElementById('__ckrb_uworld_ol'); if(e) e.remove(); overlay = null; }

  /* ── ABORT FLAG ── */
  var _ckrbAbortScrape = false;

  /* ── HELPERS ── */
  function getItemInfo() {
    var m = document.body.innerText.match(/Item[:\s]+(\d+)\s+of\s+(\d+)/);
    return m ? { current: parseInt(m[1]), total: parseInt(m[2]) } : null;
  }

  function getQuestionId() {
    var m = document.body.innerText.match(/Question\s*Id:\s*(\d+)/);
    return m ? m[1] : null;
  }

  function getCurrentItemNumber() {
    var info = getItemInfo();
    return info ? info.current : null;
  }

  function waitForQuestionLoad(prevStemText, timeout) {
    timeout = timeout || 8000;
    return new Promise(function(resolve) {
      var start = Date.now();
      var iv = setInterval(function() {
        var stemEl = document.getElementById('questionText');
        var curText = stemEl ? stemEl.innerText.substring(0, 200) : '';
        if ((curText.length > 50 && curText !== prevStemText) || Date.now() - start > timeout) {
          clearInterval(iv);
          setTimeout(resolve, 600); // settle time
        }
      }, 300);
    });
  }

  /* ── NAVIGATE TO QUESTION BY SIDEBAR CLICK ── */
  function navigateToQuestion(num) {
    // Strategy 1: tr.mat-row with .questionindex span (known UWorld layout)
    var rows = document.querySelectorAll('tr.mat-row');
    for (var r = 0; r < rows.length; r++) {
      var idx = rows[r].querySelector('.questionindex');
      if (idx && parseInt(idx.innerText.trim()) === num) {
        console.log('[CK Buddy] navigateToQuestion(' + num + '): sidebar row click (strategy 1)');
        rows[r].click();
        return true;
      }
    }
    // Strategy 2: Look for sidebar cells in mat-table context only
    var sidebarCells = document.querySelectorAll('tr td[class*="question"], tr td[class*="index"]');
    for (var c = 0; c < sidebarCells.length; c++) {
      var cellNum = parseInt((sidebarCells[c].innerText || '').trim());
      if (cellNum === num) {
        var row = sidebarCells[c].closest('tr');
        if (row) {
          console.log('[CK Buddy] navigateToQuestion(' + num + '): fallback cell click (strategy 2)');
          row.click();
          return true;
        }
      }
    }
    // Strategy 3: nth sidebar row (0-indexed) — if sidebar rows exist but
    // their text labels are question IDs instead of position numbers
    if (rows.length > 0 && num >= 1 && num <= rows.length) {
      console.log('[CK Buddy] navigateToQuestion(' + num + '): nth-row click (strategy 3, row index ' + (num - 1) + ')');
      rows[num - 1].click();
      return true;
    }
    console.warn('[CK Buddy] navigateToQuestion(' + num + '): no sidebar row found');
    return false;
  }

  /* ── SCRAPE SINGLE QUESTION ── */
  function scrapeCurrentQuestion(index) {
    // 1. Question stem
    var stemEl = document.getElementById('questionText');
    var questionText = stemEl ? stemEl.innerText.trim() : '';
    // Strip non-clinical metadata that UWorld interleaves (item counter, Q ID,
    // toolbar labels) so neither Claude nor the renderer can pick it as a quote.
    questionText = questionText
      .replace(/^\s*Item\s+\d+\s+of\s+\d+\s*$/gmi, '')
      .replace(/^\s*Question\s+(Id|ID|#)?\s*:?\s*\d+\s*$/gmi, '')
      .replace(/^\s*Q\s*#?\s*\d+\s*$/gmi, '')
      .replace(/^\s*(Mark|Marked|Unmark|Previous|Next|Full Screen|Tutorial|Lab Values|Calculator|Notes|Flag|ABC)\s*$/gmi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (questionText.length < 30) questionText = '[Image-based question]';

    // 2. Answer choices + user answer + correct answer
    var answerRows = document.querySelectorAll('#answerContainer tr.answer-choice-background');
    var choices = [];
    var userAnswer = '';
    var correctAnswer = '';
    var isCorrect = null;
    var letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    answerRows.forEach(function(tr, i) {
      var letter = letters[i] || String.fromCharCode(65 + i);
      var ansSpan = tr.querySelector('[id^="answerhighlight"]');
      var choiceText = ansSpan ? ansSpan.innerText.trim() : '';

      choices.push(letter + '. ' + choiceText);

      // Check for correct (fa-check) and incorrect (fa-times) icons
      var hasCheck = !!tr.querySelector('.fa-check');
      var hasTimes = !!tr.querySelector('.fa-times');

      // Check if this was user's selection
      var radio = tr.querySelector('mat-radio-button');
      var isSelected = radio && radio.classList.contains('mat-radio-checked');

      if (hasCheck && isSelected) {
        // User selected this AND it's correct
        userAnswer = letter + '. ' + choiceText;
        correctAnswer = letter + '. ' + choiceText;
        isCorrect = true;
      } else if (hasTimes && isSelected) {
        // User selected this but it's wrong
        userAnswer = letter + '. ' + choiceText;
        isCorrect = false;
      } else if (hasCheck && !isSelected) {
        // This is the correct answer but user didn't pick it
        correctAnswer = letter + '. ' + choiceText;
      }
    });

    // 3. Explanation — multiple candidate locations, pick the one with REAL text.
    //    (Bug: `.right-content` sometimes exists as an empty wrapper, so a pure
    //    `||` chain on element presence falls through silently. Instead, collect
    //    candidates and choose the longest non-trivial innerText.)
    var explCandidates = [
      document.getElementById('explanation-container'),
      document.getElementById('explanation'),
      document.getElementById('first-explanation'),
      document.querySelector('.explanation-container'),
      document.querySelector('#explanation .tab-pane.active'),
      document.querySelector('.right-content'),
      document.querySelector('[class*="explanation"]:not(.explanation-placeholder)'),
      document.querySelector('[id*="explanation"]')
    ];
    var explanation = '';
    for (var ei = 0; ei < explCandidates.length; ei++) {
      var c = explCandidates[ei];
      if (!c) continue;
      var t = (c.innerText || '').trim();
      if (t.length > explanation.length) explanation = t;
    }
    // Strip any leading "Explanation" heading the container might carry
    explanation = explanation.replace(/^\s*Explanation\s*\n+/i, '').trim();
    // Clean up: remove copyright, references, subject/system/topic metadata
    explanation = explanation.replace(/Copyright © UWorld[\s\S]*/i, '').trim();
    explanation = explanation.replace(/Medical Library[\s\S]*$/i, '').trim();

    // 4. Question ID
    var questionId = getQuestionId();

    // 5. Check if image-based
    var isImageBased = !questionText || questionText.length < 30 || questionText === '[Image-based question]';

    // 6. Marked/flagged state: UWorld sets aria-label="Unmark Question" on the
    //    bookmark link when a question IS currently marked, and "Mark Question"
    //    when it is not. Fallback: look for the filled bookmark icon state.
    var isMarked = false;
    try {
      var markLink = document.querySelector('a.bookmark-question, a[aria-label*="mark" i][aria-label*="uestion" i]');
      if (markLink) {
        var aria = (markLink.getAttribute('aria-label') || '').toLowerCase();
        if (aria.indexOf('unmark') >= 0) isMarked = true;
        // Some UWorld builds also toggle an 'active'/'marked' class
        var cls = (markLink.className || '').toString().toLowerCase();
        if (cls.indexOf('active') >= 0 || cls.indexOf('marked') >= 0) isMarked = true;
      }
    } catch(e) {}

    return {
      id: index,
      source: 'uworld_qbank',
      questionText: questionText,
      choices: choices,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      isCorrect: isCorrect,
      isMarked: isMarked,
      explanation: explanation,
      isImageBased: isImageBased,
      uworldQId: questionId
    };
  }

  /* ── FULL SCRAPE — navigate through questions via sidebar ── */
  async function runFullScrape(limit, preCapStart) {
    limit = limit || 999;
    _ckrbAbortScrape = false; // Reset abort flag at start of new scrape
    var questions = [];
    var info = getItemInfo();
    var total = info ? info.total : 0;

    // Use the pre-captured start if available (captured in the message handler
    // BEFORE the popup refocuses the tab, which can shift UWorld's view).
    // Only fall back to live detection if preCapStart wasn't provided.
    var startingQuestion = preCapStart || null;
    console.log('[CK Buddy] preCapStart=' + preCapStart + ', getItemInfo()=', getItemInfo());
    if (!startingQuestion) {
      for (var retry = 0; retry < 5; retry++) {
        startingQuestion = getCurrentItemNumber();
        console.log('[CK Buddy] getCurrentItemNumber() retry ' + retry + ' = ' + startingQuestion);
        if (startingQuestion) break;
        await new Promise(function(r) { setTimeout(r, 500); });
      }
    }
    if (!startingQuestion) {
      showOverlay('Could not detect current question number');
      console.error('[CK Buddy] runFullScrape: getCurrentItemNumber() returned null after 5 retries');
      await new Promise(function(r) { setTimeout(r, 2000); });
      removeOverlay();
      return [];
    }
    if (!total) {
      // Retry getItemInfo if total was 0
      for (var ri = 0; ri < 3; ri++) {
        info = getItemInfo();
        if (info && info.total) { total = info.total; break; }
        await new Promise(function(r) { setTimeout(r, 500); });
      }
      if (!total) total = startingQuestion + limit; // fallback: at least cover the requested range
    }
    var endQuestion = Math.min(startingQuestion + limit - 1, total);

    _scrapeLog = []; // Reset log for new scrape
    console.log('[CK Buddy] runFullScrape: startingQuestion=' + startingQuestion +
      ', endQuestion=' + endQuestion + ', total=' + total + ', limit=' + limit);
    showOverlay('Starting UWorld scrape from Q' + startingQuestion + ' to Q' + endQuestion + ' (of ' + total + ' total)',
      'Start: Q' + startingQuestion + ' -> Q' + endQuestion + ' (' + total + ' total)');
    await new Promise(function(r) { setTimeout(r, 1000); });

    for (var i = startingQuestion; i <= endQuestion; i++) {
      var scraped = questions.length;
      var target = endQuestion - startingQuestion + 1;

      // Check abort flag
      if (_ckrbAbortScrape) {
        console.log('[CK Buddy] Scrape aborted by user at Q' + i);
        showOverlay('Scrape aborted.');
        await new Promise(function(r) { setTimeout(r, 1500); });
        removeOverlay();
        _ckrbAbortScrape = false;
        // Send whatever we have so far
        if (questions.length > 0) {
          chrome.runtime.sendMessage({
            type: 'PR_SCRAPE_COMPLETE',
            data: { url: location.href, title: document.title, scrapedAt: Date.now(), questions: questions }
          });
        }
        return questions;
      }

      // v203: HARD POSITION CHECK — verify we're on the right question
      // before every single scrape, not just after navigation
      var actualNow = getCurrentItemNumber();
      console.log('[CK Buddy] Loop i=' + i + ' actualCurrentItem=' + actualNow +
        ' startingQuestion=' + startingQuestion + ' scraped=' + scraped + '/' + target);

      if (actualNow && actualNow !== i) {
        // We're on the wrong question — force navigate
        console.warn('[CK Buddy] Position drift! Want Q' + i + ' but on Q' + actualNow + '. Forcing nav.');
        showOverlay('Position drift: on Q' + actualNow + ', navigating to Q' + i + '…');
        var prevStemDrift = (document.getElementById('questionText') || {}).innerText || '';
        prevStemDrift = prevStemDrift.substring(0, 200);
        navigateToQuestion(i);
        await waitForQuestionLoad(prevStemDrift, 6000);
        // Verify again after nav
        var afterForce = getCurrentItemNumber();
        if (afterForce && afterForce !== i) {
          console.warn('[CK Buddy] Still wrong after force-nav! Wanted Q' + i + ' got Q' + afterForce + '. Trying once more.');
          await new Promise(function(r) { setTimeout(r, 500); });
          navigateToQuestion(i);
          await waitForQuestionLoad('', 6000);
          afterForce = getCurrentItemNumber();
          console.log('[CK Buddy] Third attempt: Q' + afterForce);
        }
      }

      if (i === startingQuestion && actualNow === i) {
        showOverlay('Scraping current Q' + i + ' (1/' + target + ')...', 'Scraping Q' + i + ' (current page)');
        await new Promise(function(r) { setTimeout(r, 400); });
      } else if (actualNow !== i) {
        // Already navigated above via position drift handler
        showOverlay('Scraping Q' + i + ' (' + scraped + '/' + target + ')…');
        await new Promise(function(r) { setTimeout(r, 400); });
      } else {
        showOverlay('Navigating to Q' + i + ' (' + scraped + '/' + target + ')...');

        var prevStemEl = document.getElementById('questionText');
        var prevStem = prevStemEl ? prevStemEl.innerText.substring(0, 200) : '';

        // Try sidebar click first
        var clicked = navigateToQuestion(i);
        if (!clicked) {
          // Sidebar row not found — try Next button as fallback
          var nextBtn = document.querySelector(
            'a[aria-label="Navigate to Next Question"], ' +
            '[aria-label="Navigate to Next Question"], ' +
            'a[aria-label="Next"], [aria-label="Next"]'
          );
          if (nextBtn) {
            nextBtn.click();
            await waitForQuestionLoad(prevStem, 6000);
          } else {
            showOverlay('Q' + i + ': not found, skipping');
            await new Promise(function(r) { setTimeout(r, 500); });
            continue;
          }
        } else {
          await waitForQuestionLoad(prevStem, 6000);
        }

        // Verify we're on the right question after nav
        var curNum = getCurrentItemNumber();
        console.log('[CK Buddy] After nav to Q' + i + ': getCurrentItemNumber()=' + curNum);
        if (curNum && curNum !== i) {
          console.warn('[CK Buddy] Nav mismatch! Wanted Q' + i + ' but on Q' + curNum + '. Retrying...');
          showOverlay('Q' + i + ': navigation mismatch (got Q' + curNum + '), retrying…');
          await new Promise(function(r) { setTimeout(r, 1000); });
          navigateToQuestion(i);
          await waitForQuestionLoad('', 6000);
          var afterRetry = getCurrentItemNumber();
          console.log('[CK Buddy] After retry nav to Q' + i + ': getCurrentItemNumber()=' + afterRetry);
        }

        showOverlay('Scraping Q' + i + ' (' + scraped + '/' + target + ')…');
        await new Promise(function(r) { setTimeout(r, 400); });
      }

      // v203: Final position check right before scraping
      var finalCheck = getCurrentItemNumber();
      if (finalCheck && finalCheck !== i) {
        console.error('[CK Buddy] FINAL CHECK FAILED: wanted Q' + i + ' but on Q' + finalCheck + '. Logging mismatch.');
        showOverlay('Warning: scraping Q' + finalCheck + ' (expected Q' + i + ')',
          '<span style="color:#f97316;">! Q' + i + ' -> actually Q' + finalCheck + '</span>');
      }

      var q = scrapeCurrentQuestion(questions.length);
      if (q && q.choices.length > 0) {
        q.id = questions.length;
        // v203: Use ACTUAL detected position, not loop variable, for accuracy
        var realPos = getCurrentItemNumber();
        q.absoluteId = realPos || i;
        var s = q.isCorrect === true ? '\u2713' : q.isCorrect === false ? '\u2717' : '?';
        var qPreview = (q.questionText || '').substring(0, 50).replace(/</g, '&lt;');
        var logLine = '<span style="color:' + (q.isCorrect ? '#10b981' : '#ef4444') + ';">' + s + '</span> Q' + i +
          (q.uworldQId ? ' (ID:' + q.uworldQId + ')' : '') +
          ' <span style="color:#64748b;font-style:italic;">' + qPreview + '...</span>';
        showOverlay('Scraping Q' + i + ' [' + s + '] - ' + (questions.length + 1) + '/' + target, logLine);
        questions.push(q);
      } else {
        showOverlay('Q' + i + ': no content detected', '<span style="color:#f97316;">? Q' + i + ': no content</span>');
      }

      await new Promise(function(r) { setTimeout(r, 300); });
    }

    // Navigate back to starting question
    showOverlay('Returning to Q' + startingQuestion + '…');
    var prevStemBeforeReturn = (document.getElementById('questionText') || {}).innerText || '';
    prevStemBeforeReturn = prevStemBeforeReturn.substring(0, 200);
    navigateToQuestion(startingQuestion);
    await waitForQuestionLoad(prevStemBeforeReturn, 6000);
    // Verify we actually returned
    var returnedNum = getCurrentItemNumber();
    if (returnedNum !== startingQuestion) {
      navigateToQuestion(startingQuestion);
      await new Promise(function(r) { setTimeout(r, 2000); });
    }
    showOverlay('Back on Q' + (getCurrentItemNumber() || startingQuestion) + ' ✓');

    removeOverlay();

    // Send to background for processing
    chrome.runtime.sendMessage({
      type: 'PR_SCRAPE_COMPLETE',
      data: {
        url: location.href,
        title: document.title,
        scrapedAt: Date.now(),
        questions: questions
      }
    });

    return questions;
  }

  /* ── FRAME GUARD ──
     uworld_qbank.js loads in ALL frames (all_frames:true in manifest).
     Only the frame that actually contains UWorld question content should
     respond to scrape messages — otherwise multiple frames race each other,
     causing chaotic navigation and wrong question numbers. */
  function isContentFrame() {
    return !!(document.getElementById('questionText')
           || document.getElementById('answerContainer')
           || document.querySelector('tr.mat-row .questionindex'));
  }

  /* ── MESSAGE LISTENER ── */
  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    // Scrape-related messages: only respond from the frame with actual content
    if (msg.type === 'NAV_TO_QUESTION' || msg.type === 'UWORLD_QBANK_SCRAPE'
        || msg.type === 'UWORLD_QBANK_SCRAPE_SINGLE' || msg.type === 'UWORLD_QBANK_DUMP') {
      if (!isContentFrame()) {
        console.log('[CK Buddy] Ignoring', msg.type, 'in non-content frame:', location.href);
        return false; // don't send response — let the real frame handle it
      }
    }

    if (msg.type === 'ABORT_SCRAPE') {
      _ckrbAbortScrape = true;
      console.log('[CK Buddy] ABORT_SCRAPE received');
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'NAV_TO_QUESTION') {
      var targetQ = msg.questionNum;
      navigateToQuestion(targetQ);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'UWORLD_QBANK_SCRAPE') {
      var limit = msg.count || 999;
      // Use pre-captured start from popup (captured BEFORE abortAll/re-injection
      // which can cause UWorld to jump questions). Fall back to local detection.
      var capturedStart = msg.preCapStart || getCurrentItemNumber();
      var info = getItemInfo();
      console.log('[CK Buddy] SCRAPE start — frame:', location.href,
        'preCapStart (from popup):', msg.preCapStart, 'local getCurrentItemNumber():', getCurrentItemNumber(),
        'using:', capturedStart, 'itemInfo:', JSON.stringify(info), 'limit:', limit);
      sendResponse({ ok: true, mode: 'page_reload' });
      // Navigate to the correct starting question before scraping
      // (in case UWorld shifted during popup operations)
      if (capturedStart && getCurrentItemNumber() !== capturedStart) {
        console.log('[CK Buddy] UWorld shifted! Navigating back to Q' + capturedStart + ' before scraping');
        navigateToQuestion(capturedStart);
      }
      runFullScrape(limit, capturedStart).catch(function(e) {
        console.error('[CK Buddy] UWorld Qbank scrape error:', e);
        removeOverlay();
      });
      return true;
    }
    if (msg.type === 'UWORLD_QBANK_SCRAPE_SINGLE') {
      var q = scrapeCurrentQuestion(0);
      sendResponse({ ok: true, data: q });
      return true;
    }
    if (msg.type === 'UWORLD_QBANK_DUMP') {
      var stemEl = document.getElementById('questionText');
      var q2 = scrapeCurrentQuestion(0);
      sendResponse({
        ok: true,
        dump: {
          url: location.href,
          stemFound: !!stemEl,
          stemLength: stemEl ? stemEl.innerText.length : 0,
          scrapedQ: q2,
          itemInfo: getItemInfo()
        }
      });
      return true;
    }
  });

  /* ── RIGHT-CLICK STRIKETHROUGH (UWorld answers) ── */
  if (!window.__ckrb_strikethrough_loaded) {
    window.__ckrb_strikethrough_loaded = true;

    // v236: pointerdown/mousedown blockers now in uworld_noselect.js (MAIN world via manifest)

    // --- Helpers for persistent strikethrough ---
    // Scope strikes to the current test session so they don't bleed into future exams.
    // URL pattern: .../launchtest/<userId>/<testId>/...
    function _getTestSessionId() {
      var m = location.pathname.match(/launchtest\/\d+\/(\d+)/);
      return m ? m[1] : 'unknown';
    }
    var _testSessionId = _getTestSessionId();

    function _getQuestionId() {
      var m = (document.body.innerText || '').match(/Question\s*Id[:\s]*(\d+)/i);
      return m ? m[1] : null;
    }

    function _getAnswerLetter(row) {
      var td = row.querySelector('td');
      return td ? td.textContent.trim().charAt(0) : null;
    }

    function _storageKey(qid) { return 'ckrb_strike_' + _testSessionId + '_' + qid; }

    function _saveStrikes() {
      var qid = _getQuestionId();
      if (!qid) return;
      var rows = document.querySelectorAll('tr.answer-choice-background');
      var struck = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-ckrb-struck') === 'true') {
          var letter = _getAnswerLetter(rows[i]);
          if (letter) struck.push(letter);
        }
      }
      var obj = {};
      obj[_storageKey(qid)] = struck;
      try {
        chrome.storage.local.set(obj);
      } catch(ex) { /* ignore */ }
    }

    function _restoreStrikes() {
      var qid = _getQuestionId();
      if (!qid) return;
      try {
        chrome.storage.local.get(_storageKey(qid), function(data) {
          var struck = data[_storageKey(qid)];
          if (!struck || !struck.length) return;
          // Poll for answer rows (Angular may not have rendered them yet)
          var attempts = 0;
          function tryRestore() {
            var rows = document.querySelectorAll('tr.answer-choice-background');
            if (!rows.length && attempts < 10) {
              attempts++;
              setTimeout(tryRestore, 200);
              return;
            }
            for (var i = 0; i < rows.length; i++) {
              var letter = _getAnswerLetter(rows[i]);
              if (letter && struck.indexOf(letter) !== -1) {
                rows[i].style.textDecoration = 'line-through';
                rows[i].setAttribute('data-ckrb-struck', 'true');
              }
            }
          }
          tryRestore();
        });
      } catch(ex) { /* ignore */ }
    }

    // Capture phase contextmenu handler for the actual strikethrough toggle
    document.addEventListener('contextmenu', function(e) {
      var el = e.target;
      var row = null;
      while (el && el !== document.body) {
        if (el.tagName === 'TR' && el.classList.contains('answer-choice-background')) { row = el; break; }
        el = el.parentElement;
      }
      if (!row) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var isStruck = row.getAttribute('data-ckrb-struck') === 'true';
      if (isStruck) {
        row.style.textDecoration = '';
        row.setAttribute('data-ckrb-struck', 'false');
      } else {
        row.style.textDecoration = 'line-through';
        row.setAttribute('data-ckrb-struck', 'true');
      }
      _saveStrikes();
    }, true);

    // Restore on load and watch for question changes (UWorld SPA re-renders)
    _restoreStrikes();
    var _lastQid = _getQuestionId();
    var _strikeDebounce = null;
    var _strikeObserver = new MutationObserver(function() {
      var qid = _getQuestionId();
      if (qid && qid !== _lastQid) {
        _lastQid = qid;
        clearTimeout(_strikeDebounce);
        _strikeDebounce = setTimeout(_restoreStrikes, 300);
      }
    });
    _strikeObserver.observe(document.body, { childList: true, subtree: true });
  }

  console.log('[CK Buddy] UWorld Qbank scraper ready:', location.href);
})();
