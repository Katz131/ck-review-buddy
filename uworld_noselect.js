// CK Buddy — Runs in MAIN world to block UWorld from selecting answers on right-click.
// Content scripts run in an isolated world and can't stopImmediatePropagation on page listeners.
(function() {
  if (window.__ckrb_ptr_block) return;
  window.__ckrb_ptr_block = true;

  function blockRightClick(e) {
    if (e.button !== 2) return;
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'TR' && el.classList.contains('answer-choice-background')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      el = el.parentElement;
    }
  }

  document.addEventListener('pointerdown', blockRightClick, true);
  document.addEventListener('mousedown', blockRightClick, true);
})();
