<script>
/*
 * Shared focus trap for Modal / Drawer / Popover (EJS parity).
 *
 * - Tab / Shift+Tab loop inside the panel.
 * - Layer stack: only the topmost active overlay reacts to Tab/Escape,
 *   so stacked modals do not all close on Escape.
 * - Saves the previously focused element and restores it on close.
 * - Tab with focus in another dialog layered over the overlay (one not on
 *   this stack, e.g. a host's confirm appended to <body>) is that dialog's
 *   to move: the trap does not pull focus back.
 *
 * Exposed on window so each overlay's inline script can use it without
 * having to redeclare the same logic per component.
 */
(function () {
  if (window.__overlayFocusTrap) return;

  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var layerStack = [];
  var previousFocus = Object.create(null);

  function isTop(id) {
    return layerStack[layerStack.length - 1] === id;
  }

  function getFocusable(panel) {
    var nodes = Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE));
    return nodes.filter(function (el) {
      return el.getAttribute('data-focus-guard') !== 'true';
    });
  }

  function activate(id, panel) {
    if (!panel) return;
    if (layerStack.indexOf(id) === -1) layerStack.push(id);
    previousFocus[id] = document.activeElement;
    var focusable = getFocusable(panel);
    var first = focusable[0];
    if (first) first.focus(); else panel.focus();
  }

  function deactivate(id) {
    var idx = layerStack.lastIndexOf(id);
    if (idx !== -1) layerStack.splice(idx, 1);
    var prev = previousFocus[id];
    delete previousFocus[id];
    if (prev && typeof prev.focus === 'function') prev.focus();
  }

  function handleKey(id, panel, e) {
    if (!isTop(id)) return;
    if (e.key !== 'Tab') return;
    // Focus in a dialog layered over this one (not on the stack, so it is not the top layer here) is that dialog's to move.
    var current = document.activeElement;
    var layer = current && current.closest ? current.closest('[role="dialog"], [role="alertdialog"]') : null;
    if (layer && !layer.contains(panel) && !panel.contains(current)) return;
    var focusable = getFocusable(panel);
    if (focusable.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !panel.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  window.__overlayFocusTrap = {
    activate: activate,
    deactivate: deactivate,
    handleKey: handleKey,
    isTop: isTop,
    FOCUSABLE: FOCUSABLE,
  };
})();
</script>
