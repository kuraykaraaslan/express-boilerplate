/* ─── Calendar legend — parallel of parts/CalendarLegend.tsx + the hidden-id
 * filter in modules/app/Calendar/index.tsx.
 *
 * Each chip in [data-cal-legend] is a role="switch" with `data-cal-toggle="<id>"`.
 * Clicking flips visibility for every event button carrying
 * `data-event-calendar-id="<id>"` inside the same calendar root. Fires
 * a CustomEvent so callers can sync external state:
 *   document.querySelector('#my-cal').addEventListener(
 *     'kui-calendar:calendar-toggle',
 *     function (ev) { console.log(ev.detail); } // { calendarId, visible }
 *   );
 */
(function () {
  if (window.__KuiCalendarLegend) return;
  window.__KuiCalendarLegend = true;

  function applyVisibility(root, id, visible) {
    var btns = root.querySelectorAll('[data-event-calendar-id="' + id + '"]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].style.display = visible ? '' : 'none';
    }
  }

  function onClick(ev) {
    var chip = ev.target.closest && ev.target.closest('[data-cal-toggle]');
    if (!chip) return;
    var root = chip.closest('[data-kui-calendar]');
    if (!root) return;
    ev.preventDefault();

    var id = chip.getAttribute('data-cal-toggle');
    var wasChecked = chip.getAttribute('aria-checked') === 'true';
    var nowVisible = !wasChecked;
    chip.setAttribute('aria-checked', String(nowVisible));

    if (nowVisible) {
      chip.classList.remove('bg-surface-raised', 'text-text-disabled', 'line-through');
      chip.classList.add('bg-surface-base', 'text-text-primary');
      var dot = chip.querySelector('span[class*="rounded-full"]');
      if (dot) dot.classList.remove('opacity-30');
    } else {
      chip.classList.remove('bg-surface-base', 'text-text-primary');
      chip.classList.add('bg-surface-raised', 'text-text-disabled', 'line-through');
      var dot2 = chip.querySelector('span[class*="rounded-full"]');
      if (dot2) dot2.classList.add('opacity-30');
    }

    applyVisibility(root, id, nowVisible);
    root.dispatchEvent(new CustomEvent('kui-calendar:calendar-toggle', {
      detail: { calendarId: id, visible: nowVisible },
      bubbles: true
    }));
  }

  document.addEventListener('click', onClick);
})();
