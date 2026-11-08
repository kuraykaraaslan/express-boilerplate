<script>
/*
 * Outside-click + Escape dismissal helper (capture phase).
 * Only the topmost active overlay dismisses on Escape (delegated to
 * __overlayFocusTrap.isTop). An Escape whose defaultPrevented is set was
 * handled by a control inside the overlay (an open dropdown) and is ignored.
 */
(function () {
  if (window.__overlayDismiss) return;

  function onEscape(id, callback) {
    function handler(e) {
      if (e.key !== 'Escape') return;
      // An inner control (an open ComboBox / Select list) already handled it.
      if (e.defaultPrevented) return;
      var ft = window.__overlayFocusTrap;
      if (ft && !ft.isTop(id)) return;
      callback();
    }
    document.addEventListener('keydown', handler);
    return function () {
      document.removeEventListener('keydown', handler);
    };
  }

  function onOutsidePointer(root, callback) {
    function handler(e) {
      if (!root || !root.contains(e.target)) callback();
    }
    document.addEventListener('pointerdown', handler, true);
    return function () {
      document.removeEventListener('pointerdown', handler, true);
    };
  }

  window.__overlayDismiss = {
    onEscape: onEscape,
    onOutsidePointer: onOutsidePointer,
  };
})();
</script>
