// amboss_qbank.js — CK Buddy AMBOSS Qbank Scraper
// Scrapes AMBOSS question sessions (review mode) just like content.js does for NBME

(function() {
  if (window.__ckrb_amboss_qbank_loaded) return;
  window.__ckrb_amboss_qbank_loaded = true;

  /* ── OVERLAY ── */
  var overlay = null;
  function showOverlay(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__ckrb_amboss_ol';
      overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e293b;color:#e2e8f0;border:2px solid #8b5cf6;border-radius:10px;padding:12px 18px;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 24px rgba(0,0,0,0.7);display:flex;align-items:center;gap:10px;min-width:260px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<span style="font-size:18px">📚</span><span>' + text + '</span>';
  }
  function removeOverlay() { var e = document.getElementById('__ckrb_amboss_ol'); if(e) e.remove(); overlay = null; }

  /* ── HELPERS ── */
  function getQuestionCount() {
    var el = document.querySelector('[data-e2e-test-id="sessionQuestionCount"]');
    if (!el) return null;
    var m = el.innerText.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { current: parseInt(m[1]), total: parseInt(m[2]) } : null;
  }

  function getCurrentQuestionNumber() {
    // Extract from URL: /us/review/{sessionId}/{num}
    var m = location.pathname.match(/\/review\/[^/]+\/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function waitForQuestionLoad(prevStemText, timeout) {
    timeout = timeout || 8000;
    return new Promise(function(resolve) {
      var start = Date.now();
      var iv = setInterval(function() {
        var stemEl = document.querySelector('[class*="questionContent"]');
        var curText = stemEl ? stemEl.innerText.substring(0, 200) : '';
        if ((curText.length > 50 && curText !== prevStemText) || Date.now() - start > timeout) {
          clearInterval(iv);
          setTimeout(resolve, 600); // settle time
        }
      }, 300);
    });
  }

  /* ── SCRAPE SINGLE QUESTION ── */
  function scrapeCurrentQuestion(index) {
    // 1. Question stem
    var stemEl = document.querySelector('[class*="questionContent"]');
    var questionText = stemEl ? stemEl.innerText.trim() : '';
    if (questionText.length < 30) questionText = '[Image-based question]';

    // 2. Answer choices + user answer + correct answer
    var answerDivs = document.querySelectorAll('div[data-e2e-test-id^="answer-theme"]');
    var choices = [];
    var userAnswer = '';
    var correctAnswer = '';
    var isCorrect = null;

    answerDivs.forEach(function(el) {
      var theme = el.getAttribute('data-e2e-test-id') || '';
      var lines = el.innerText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

      // lines format: ["Option a:", "A", "Choice text", "Answer rate", "23%", ...]
      var letter = lines[1] || '';
      var choiceText = lines[2] || '';

      // Skip if this doesn't look like an answer option
      if (!letter || letter.length > 2) return;

      choices.push(letter + '. ' + choiceText);

      if (theme.includes('userFirstAttemptCorrect')) {
        userAnswer = letter + '. ' + choiceText;
        correctAnswer = letter + '. ' + choiceText;
        isCorrect = true;
      } else if (theme.includes('userFirstAttemptIncorrect')) {
        userAnswer = letter + '. ' + choiceText;
        isCorrect = false;
      } else if (theme.includes('answerOptionCorrect')) {
        correctAnswer = letter + '. ' + choiceText;
      }
    });

    // 3. Explanation (from the correct answer's explanation container)
    var explEl = document.querySelector('div[class*="explanationContainer"][class*="correctAnswerExplanation"]');
    var explanation = explEl ? explEl.innerText.trim() : '';
    // Clean up explanation — remove "GIVE FEEDBACK" and linked article buttons
    explanation = explanation.replace(/GIVE FEEDBACK/g, '').replace(/Statistical analysis of data/g, '').trim();

    // 4. Check if image-based
    var isImageBased = !questionText || questionText.length < 30 || questionText === '[Image-based question]';

    return {
      id: index,
      source: 'amboss_qbank',
      questionText: questionText,
      choices: choices,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      isCorrect: isCorrect,
      explanation: explanation,
      isImageBased: isImageBased
    };
  }

  /* ── NAVIGATE TO SPECIFIC QUESTION ── */
  function navigateToQuestion(num) {
    var btn = document.querySelector('[data-e2e-test-id="question-' + num + '"]');
    if (btn) btn.click();
  }

  /* ── FULL SCRAPE — navigate through all questions via sidebar ── */
  async function runFullScrape(limit) {
    limit = limit || 999;
    var questions = [];
    var qCount = getQuestionCount();
    var total = qCount ? qCount.total : '?';
    var numTotal = typeof total === 'number' ? total : 40;

    // Start from whichever question is currently displayed
    var startingQuestion = getCurrentQuestionNumber() || 1;
    var endQuestion = Math.min(startingQuestion + limit - 1, numTotal);

    showOverlay('Starting AMBOSS scrape from Q' + startingQuestion + '… 0/' + limit);
    await new Promise(function(r) { setTimeout(r, 1000); });

    for (var i = startingQuestion; i <= endQuestion; i++) {
      var scraped = questions.length;
      var target = endQuestion - startingQuestion + 1;
      showOverlay('Navigating to Q' + i + ' (' + scraped + '/' + target + ')…');

      // Click sidebar question number
      var sidebarBtn = document.querySelector('[data-e2e-test-id="question-' + i + '"]');
      if (!sidebarBtn) {
        showOverlay('Q' + i + ': sidebar item not found, skipping');
        await new Promise(function(r) { setTimeout(r, 500); });
        continue;
      }

      // Get current stem to detect page change
      var prevStemEl = document.querySelector('[class*="questionContent"]');
      var prevStem = prevStemEl ? prevStemEl.innerText.substring(0, 200) : '';

      sidebarBtn.click();
      await waitForQuestionLoad(prevStem, 6000);

      // Verify we're on the right question
      var curNum = getCurrentQuestionNumber();
      if (curNum && curNum !== i) {
        showOverlay('Q' + i + ': navigation mismatch (got Q' + curNum + '), retrying…');
        await new Promise(function(r) { setTimeout(r, 1000); });
        sidebarBtn.click();
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

      // Small delay between questions
      await new Promise(function(r) { setTimeout(r, 300); });
    }

    // Navigate back to starting question
    showOverlay('Returning to Q' + startingQuestion + '…');
    var prevStemBeforeReturn = (document.querySelector('[class*="questionContent"]') || {}).innerText || '';
    prevStemBeforeReturn = prevStemBeforeReturn.substring(0, 200);
    navigateToQuestion(startingQuestion);
    await waitForQuestionLoad(prevStemBeforeReturn, 6000);
    // Verify we actually returned
    var returnedNum = getCurrentQuestionNumber();
    if (returnedNum !== startingQuestion) {
      // Retry once
      navigateToQuestion(startingQuestion);
      await new Promise(function(r) { setTimeout(r, 2000); });
    }
    showOverlay('Back on Q' + (getCurrentQuestionNumber() || startingQuestion) + ' ✓');

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

  /* ── VERIFIED NAVIGATION — click, check, retry ── */
  async function verifiedNavigate(targetQ) {
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      var prevStemEl = document.querySelector('[class*="questionContent"]');
      var prevStem = prevStemEl ? prevStemEl.innerText.substring(0, 200) : '';

      navigateToQuestion(targetQ);
      await waitForQuestionLoad(prevStem, 5000);

      var landed = getCurrentQuestionNumber();
      console.log('[CK Buddy] Nav attempt ' + attempt + ': target Q' + targetQ + ', landed Q' + landed);
      if (landed === targetQ) {
        return { ok: true, landed: landed };
      }

      // Retry: wait a beat then click again
      await new Promise(function(r) { setTimeout(r, 500); });
    }

    // Final fallback: direct URL navigation
    var urlMatch = location.pathname.match(/(\/[^/]+\/review\/[^/]+\/)\d+/);
    if (urlMatch) {
      var newUrl = location.origin + urlMatch[1] + targetQ;
      console.log('[CK Buddy] Sidebar clicks failed, trying URL nav:', newUrl);
      location.href = newUrl;
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    var finalQ = getCurrentQuestionNumber();
    return { ok: finalQ === targetQ, landed: finalQ };
  }

  /* ── MESSAGE LISTENER ── */
  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    if (msg.type === 'NAV_TO_QUESTION') {
      // Quiz auto-nav: navigate to specific question with verification
      var targetQ = msg.questionNum;
      console.log('[CK Buddy] NAV_TO_QUESTION received: Q' + targetQ);
      verifiedNavigate(targetQ).then(function(result) {
        console.log('[CK Buddy] Nav result:', JSON.stringify(result));
        sendResponse(result);
      });
      return true; // async sendResponse
    }
    if (msg.type === 'AMBOSS_QBANK_SCRAPE') {
      var limit = msg.count || 999;
      sendResponse({ ok: true, mode: 'page_reload' });
      runFullScrape(limit).catch(function(e) {
        console.error('[CK Buddy] AMBOSS Qbank scrape error:', e);
        removeOverlay();
      });
      return true;
    }
    if (msg.type === 'AMBOSS_QBANK_SCRAPE_SINGLE') {
      var q = scrapeCurrentQuestion(0);
      sendResponse({ ok: true, data: q });
      return true;
    }
    if (msg.type === 'AMBOSS_QBANK_DUMP') {
      var stemEl = document.querySelector('[class*="questionContent"]');
      var q2 = scrapeCurrentQuestion(0);
      sendResponse({
        ok: true,
        dump: {
          url: location.href,
          stemFound: !!stemEl,
          stemLength: stemEl ? stemEl.innerText.length : 0,
          scrapedQ: q2,
          questionCount: getQuestionCount()
        }
      });
      return true;
    }
  });

  /* ── RIGHT-CLICK STRIKETHROUGH (AMBOSS answers) ── */
  if (!window.__ckrb_strikethrough_loaded) {
    window.__ckrb_strikethrough_loaded = true;
    document.addEventListener('contextmenu', function(e) {
      var el = e.target;
      var row = null;
      while (el && el !== document.body) {
        if (el.tagName === 'DIV' && el.getAttribute('data-e2e-test-id') && el.getAttribute('data-e2e-test-id').startsWith('answer-theme')) { row = el; break; }
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

  console.log('[CK Buddy] AMBOSS Qbank scraper ready:', location.href);
})();
