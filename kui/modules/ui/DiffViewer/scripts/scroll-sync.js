// modules/ui/DiffViewer/scripts/scroll-sync.js
//
// Bidirectional scroll sync for the EJS DiffViewer split mode. Mirrors
// /home/kuray/01_NextJS_Components/modules/ui/DiffViewer/hooks/useScrollSync.ts.
//
// Usage:
//   window.KuiDiffScrollSync.attach(leftEl, rightEl)
// Returns a detach() function for cleanup.

(function () {
  if (window.KuiDiffScrollSync) return;

  function attach(left, right) {
    if (!left || !right) return function () {};
    var suppress = false;

    function makeHandler(source, target) {
      return function () {
        if (suppress) return;
        suppress = true;
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
        requestAnimationFrame(function () { suppress = false; });
      };
    }

    var onLeft = makeHandler(left, right);
    var onRight = makeHandler(right, left);
    left.addEventListener('scroll', onLeft, { passive: true });
    right.addEventListener('scroll', onRight, { passive: true });

    return function detach() {
      left.removeEventListener('scroll', onLeft);
      right.removeEventListener('scroll', onRight);
    };
  }

  window.KuiDiffScrollSync = { attach: attach };
})();
