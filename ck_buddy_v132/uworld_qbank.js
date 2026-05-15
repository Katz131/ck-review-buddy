// uworld_qbank.js — CK Buddy UWorld Qbank Scraper
// Scrapes UWorld question sessions (tutor/review mode) for the CK Buddy pipeline

(function() {
  if (window.__ckrb_uworld_qbank_loaded) return;
  window.__ckrb_uworld_qbank_loaded = true;

  /* ── OVERLAY ── */
  var overlay = null;
  function showOverlay(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__ckrb_uworld_ol';
      overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e293b;color:#e2e8f0;border:2px solid #f97316;border-radius:10px;padding:12px 18px;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 24px rgba(0,0,0,0.7);display:flex;align-items:center;gap:10px;min-width:260px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<span style="font-size:18px">📘</span><span>' + text + '</span>';
  }
  function removeOverlay() { var e = document.getElementById('__ckrb_uworld_ol'); if(e) e.remove(); overlay = null; }

  /* ── HELPERS ── */
  function getItemInfo() {
    var m = document.body.innerText.match(/Item\s+(\d+)\s+of\s+(\d+)/);
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
    // Sidebar rows are tr.mat-row, each contains a td with .questionindex span
    var rows = document.querySelectorAll('tr.mat-row');
    for (var r = 0; r < rows.length; r++) {
      var idx = rows[r].querySelector('.questionindex');
      if (idx && parseInt(idx.innerText.trim()) === num) {
        rows[r].click();
        return true;
      }
    }
    return false;
  }

  /* ── SCRAPE SINGLE QUESTION ── */
  function scrapeCurrentQuestion(index) {
    // 1. Question stem
    var stemEl = document.getElementById('questionText');
    var questionText = stemEl ? stemEl.innerText.trim() : '';
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

    // 3. Explanation
    // UWorld Step 2/Step 3 both render the explanation in .right-content, but
    // Step 3 occasionally wraps it in .explanation-container or #explanation.
    var rightContent = document.querySelector('.right-content')
      || document.querySelector('.explanation-container')
      || document.getElementById('explanation')
      || document.querySelector('[class*="explanation"]');
    var explanation = rightContent ? rightContent.innerText.trim() : '';
    // Clean up: remove copyright, references, subject/system/topic metadata
    explanation = explanation.replace(/Copyright © UWorld[\s\S]*/i, '').trim();
    explanation = explanation.replace(/Medical Library[\s\S]*$/i, '').trim();

    // 4. Question ID
    var questionId = getQuestionId();

    // 5. Check if image-based
    var isImageBased = !questionText || questionText.length < 30 || questionText === '[Image-based question]';

    return {
      id: index,
      source: 'uworld_qbank',
      questionText: questionText,
      choices: choices,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      isCorrect: isCorrect,
      explanation: explanation,
      isImageBased: isImageBased,
      uworldQId: questionId
    };
  }

  /* ── FULL SCRAPE — navigate through questions via sidebar ── */
  async function runFullScrape(limit) {
    limit = limit || 999;
    var questions = [];
    var info = getItemInfo();
    var total = info ? info.total : 20;

    // Start from whichever question is currently displayed
    var startingQuestion = getCurrentItemNumber() || 1;
    var endQuestion = Math.min(startingQuestion + limit - 1, total);

    showOverlay('Starting UWorld scrape from Q' + startingQuestion + '… 0/' + limit);
    await new Promise(function(r) { setTimeout(r, 1000); });

    for (var i = startingQuestion; i <= endQuestion; i++) {
      var scraped = questions.length;
      var target = endQuestion - startingQuestion + 1;
      showOverlay('Navigating to Q' + i + ' (' + scraped + '/' + target + ')…');

      // Get current stem to detect page change
      var prevStemEl = document.getElementById('questionText');
      var prevStem = prevStemEl ? prevStemEl.innerText.substring(0, 200) : '';

      // Click sidebar row
      var clicked = navigateToQuestion(i);
      if (!clicked) {
        showOverlay('Q' + i + ': sidebar item not found, skipping');
        await new Promise(function(r) { setTimeout(r, 500); });
        continue;
      }

      await waitForQuestionLoad(prevStem, 6000);

      // Verify we're on the right question
      var curNum = getCurrentItemNumber();
      if (curNum && curNum !== i) {
        showOverlay('Q' + i + ': navigation mismatch (got Q' + curNum + '), retrying…');
        await new Promise(function(r) { setTimeout(r, 1000); });
        navigateToQuestion(i);
        await waitForQuestionLoad('', 6000);
      }

      showOverlay('Scraping Q' + i + ' (' + scraped + '/' + target + ')…');
      await new Promise(function(r) { setTimeout(r, 400); });

      var q = scrapeCurrentQuestion(questions.length);
      if (q && q.choices.length > 0) {
        q.id = questions.length;
        q.absoluteId = i;
        var s = q.isCorrect === true ? '\u2713' : q.isCorrect === false ? '\u2717' : '?';
        showOverlay('Q' + i + ' [' + s + '] — ' + (questions.length + 1) + '/' + target);
        questions.push(q);
      } else {
        showOverlay('Q' + i + ': no content detected');
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

  /* ── MESSAGE LISTENER ── */
  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    if (msg.type === 'NAV_TO_QUESTION') {
      var targetQ = msg.questionNum;
      navigateToQuestion(targetQ);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'UWORLD_QBANK_SCRAPE') {
      var limit = msg.count || 999;
      sendResponse({ ok: true, mode: 'page_reload' });
      runFullScrape(limit).catch(function(e) {
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
    document.addEventListener('contextmenu', function(e) {
      var el = e.target;
      var row = null;
      while (el && el !== document.body) {
        if (el.tagName === 'TR' && el.classList.contains('answer-choice-background')) { row = el; break; }
        el = el.parentElement;
      }
      if (!row) return;
      e.preventDefault();
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
    });
  }

  console.log('[CK Buddy] UWorld Qbank scraper ready:', location.href);
})();
