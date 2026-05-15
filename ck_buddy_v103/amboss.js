// amboss.js — CK Buddy AMBOSS scraper (next.amboss.com only)

(function() {
  if (window.__ckrb_amboss_loaded) return;
  window.__ckrb_amboss_loaded = true;

  function scrapeAmboss() {
    var main = document.querySelector('main');
    if (!main) return null;

    var title = document.querySelector('h1, [class*="title"]');
    var articleTitle = title ? title.innerText.trim() : document.title;

    // Grab all h2/h3 headings and the text that follows each
    var headings = Array.from(main.querySelectorAll('h2, h3'));
    var sections = [];

    headings.forEach(function(h, i) {
      var sectionTitle = h.innerText.trim();
      if (!sectionTitle || sectionTitle.length < 3) return;

      // Collect text nodes between this heading and the next
      var text = '';
      var node = h.nextElementSibling;
      var nextH = headings[i + 1];
      while (node && node !== nextH) {
        var t = node.innerText ? node.innerText.trim() : '';
        // Strip reference numbers like [1] [2]
        t = t.replace(/\[\d+\]/g, '').trim();
        if (t.length > 10) text += t + '\n';
        node = node.nextElementSibling;
      }
      if (text.trim().length > 20) {
        sections.push({ heading: sectionTitle, body: text.trim().slice(0, 1500) });
      }
    });

    if (sections.length === 0) {
      // Fallback: just grab all of main
      var fallback = main.innerText.replace(/\[\d+\]/g, '').trim().slice(0, 6000);
      sections.push({ heading: 'Full Article', body: fallback });
    }

    return {
      url: location.href,
      title: articleTitle,
      scrapedAt: Date.now(),
      sections: sections
    };
  }

  chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    if (msg.type === 'AMBOSS_SCRAPE') {
      var data = scrapeAmboss();
      sendResponse({ ok: !!data, data: data });
      return true;
    }
  });

  console.log('[CK Buddy] AMBOSS scraper ready:', location.href);
})();
