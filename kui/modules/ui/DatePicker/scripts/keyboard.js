// modules/ui/DatePicker/scripts/keyboard.js
// Keyboard map (W3C WAI-ARIA APG Date Picker dialog pattern). Mirrors the
// NextJS `useKeyboardNav.ts` 1:1 so the two ecosystems share the same UX.
//
// Exports KUI_DATEPICKER_KEYBOARD.applyKey(current, ev, opts) → result.
//
// TODO M5: announce nav in an aria-live region.
(function () {
  if (typeof window === 'undefined') return;
  function H() {
    // calendar.js owns the helper bag — look it up lazily so script order
    // doesn't matter.
    return window.KUI_DATEPICKER_HELPERS;
  }

  function applyKey(current, ev, opts) {
    var helpers = H();
    if (!helpers) return null;
    var next = null;
    var shouldSelect = false;
    var shouldClose = false;
    var weekStartsOn = opts.weekStartsOn || 0;

    switch (ev.key) {
      case 'ArrowLeft':  next = helpers.addDays(current, -1); break;
      case 'ArrowRight': next = helpers.addDays(current,  1); break;
      case 'ArrowUp':    next = helpers.addDays(current, -7); break;
      case 'ArrowDown':  next = helpers.addDays(current,  7); break;
      case 'PageUp':     next = ev.shiftKey ? helpers.addYears(current, -1) : helpers.addMonths(current, -1); break;
      case 'PageDown':   next = ev.shiftKey ? helpers.addYears(current,  1) : helpers.addMonths(current,  1); break;
      case 'Home': {
        var dow = current.getDay();
        var off = (dow - weekStartsOn + 7) % 7;
        next = helpers.addDays(current, -off);
        break;
      }
      case 'End': {
        var dow2 = current.getDay();
        var off2 = 6 - ((dow2 - weekStartsOn + 7) % 7);
        next = helpers.addDays(current, off2);
        break;
      }
      case 'Enter':
      case ' ':
      case 'Spacebar':
        next = current;
        shouldSelect = !helpers.isDisabled(current, opts.disabledDates, opts.min, opts.max);
        break;
      case 'Escape':
      case 'Esc':
        next = current;
        shouldClose = true;
        break;
      default:
        return null;
    }
    if (ev.preventDefault) ev.preventDefault();
    var clamped = helpers.clampToBounds(next, opts.min, opts.max);
    return {
      focus: clamped,
      monthChanged:
        clamped.getMonth() !== current.getMonth() ||
        clamped.getFullYear() !== current.getFullYear(),
      shouldSelect: shouldSelect,
      shouldClose: shouldClose
    };
  }

  window.KUI_DATEPICKER_KEYBOARD = { applyKey: applyKey };
})();
