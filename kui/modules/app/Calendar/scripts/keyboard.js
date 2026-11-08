/* ─── Calendar keyboard nav — parallel of hooks/useKeyboardNav.ts ──────────── */
(function () {
  if (window.__KuiCalendarKbdBound) return;
  window.__KuiCalendarKbdBound = true;

  document.addEventListener('keydown', function (e) {
    var root = e.target && e.target.closest && e.target.closest('[data-kui-calendar]');
    if (!root) return;
    // Don't hijack typing into inputs / contentEditable elements.
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

    if (e.key === 'PageUp') { e.preventDefault(); window.__KuiCalendar.step(root, 'prev'); }
    else if (e.key === 'PageDown') { e.preventDefault(); window.__KuiCalendar.step(root, 'next'); }
    else if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      window.__KuiCalendar.step(root, 'today');
    }
    // M6: arrow keys step the anchor date — Left/Right = ±1 day, Up/Down = ±7 days.
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && (
      e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
    )) {
      var delta = e.key === 'ArrowLeft' ? -1
                : e.key === 'ArrowRight' ? 1
                : e.key === 'ArrowUp' ? -7 : 7;
      e.preventDefault();
      window.__KuiCalendar.stepDays(root, delta);
    }
  });
})();
