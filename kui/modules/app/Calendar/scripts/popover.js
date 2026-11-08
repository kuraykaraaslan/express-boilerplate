/* ─── Calendar event popover — parallel of parts/EventPopover.tsx ──────────────
 * Click any [data-event-id] inside a [data-kui-calendar] → opens an anchored
 * popover with title, time, description, Edit/Delete actions. ESC and
 * outside-click close. Edit + Delete fire CustomEvents on the calendar root
 * so the caller can listen via:
 *   document.querySelector('#my-cal').addEventListener('kui-calendar:event-edit',   fn);
 *   document.querySelector('#my-cal').addEventListener('kui-calendar:event-delete', fn);
 */
(function () {
  if (window.__KuiCalendarPopover) return;
  window.__KuiCalendarPopover = true;

  var POP_W = 280, POP_GAP = 8;
  var current = null; // { root, eventId, el, confirming }

  function close() {
    if (!current) return;
    if (current.el && current.el.parentNode) current.el.parentNode.removeChild(current.el);
    current = null;
  }

  function place(el, anchorRect) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var h = el.getBoundingClientRect().height;
    var spaceBelow = vh - anchorRect.bottom;
    var top = (spaceBelow >= h + POP_GAP)
      ? anchorRect.bottom + POP_GAP
      : Math.max(POP_GAP, anchorRect.top - h - POP_GAP);
    var left = anchorRect.left + anchorRect.width / 2 - POP_W / 2;
    left = Math.max(POP_GAP, Math.min(left, vw - POP_W - POP_GAP));
    el.style.top  = top  + 'px';
    el.style.left = left + 'px';
    el.style.visibility = 'visible';
  }

  function fmt(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function build(root, btn) {
    var eventId = btn.getAttribute('data-event-id');
    var title   = btn.getAttribute('data-event-title')      || btn.querySelector('.font-semibold') && btn.querySelector('.font-semibold').textContent || 'Event';
    var startMs = Number(btn.getAttribute('data-event-start')) || 0;
    var endMs   = Number(btn.getAttribute('data-event-end'))   || 0;
    var allDay  = btn.getAttribute('data-event-all-day') === '1';
    var desc    = btn.getAttribute('data-event-description') || '';
    var color   = btn.getAttribute('data-event-color') || 'primary';

    var msg = {
      edit:          root.getAttribute('data-msg-edit')           || 'Edit',
      del:           root.getAttribute('data-msg-delete')         || 'Delete',
      confirmDelete: root.getAttribute('data-msg-confirm-delete') || 'Confirm delete?',
      close:         root.getAttribute('data-msg-close')          || 'Close',
      allDay:        root.getAttribute('data-msg-all-day')        || 'All-day'
    };

    var DOT = {
      primary:'bg-primary', success:'bg-success', warning:'bg-warning',
      error:'bg-error', info:'bg-info', secondary:'bg-secondary', neutral:'bg-text-secondary'
    };

    var el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', title);
    el.style.cssText = 'position:fixed;width:' + POP_W + 'px;visibility:hidden;z-index:60;';
    el.className = 'rounded-lg border border-border bg-surface-base shadow-lg p-3 flex flex-col gap-2';
    var timeLabel = allDay ? msg.allDay : (startMs && endMs ? fmt(new Date(startMs)) + ' – ' + fmt(new Date(endMs)) : '');
    el.innerHTML =
      '<div class="flex items-start gap-2">' +
        '<span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ' + (DOT[color] || DOT.primary) + '" aria-hidden="true"></span>' +
        '<div class="flex-1 min-w-0">' +
          '<h3 class="text-sm font-semibold text-text-primary truncate"></h3>' +
          '<p class="text-xs text-text-secondary tabular-nums"></p>' +
        '</div>' +
        '<button type="button" data-pop-close aria-label="' + msg.close + '" class="inline-flex items-center justify-center w-6 h-6 rounded text-text-secondary hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">' +
          '<i class="fa-solid fa-xmark w-3 h-3" aria-hidden="true"></i>' +
        '</button>' +
      '</div>' +
      (desc ? '<p class="text-xs text-text-secondary whitespace-pre-wrap" data-pop-desc></p>' : '') +
      '<div class="flex items-center justify-end gap-1.5 pt-1">' +
        '<button type="button" data-pop-edit class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-surface-base text-text-primary hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">' +
          '<i class="fa-solid fa-pen-to-square w-3 h-3" aria-hidden="true"></i>' +
          '<span>' + msg.edit + '</span>' +
        '</button>' +
        '<button type="button" data-pop-delete class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border text-error hover:bg-error-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">' +
          '<i class="fa-solid fa-trash w-3 h-3" aria-hidden="true"></i>' +
          '<span>' + msg.del + '</span>' +
        '</button>' +
      '</div>';
    el.querySelector('h3').textContent = title;
    el.querySelector('p').textContent = timeLabel;
    if (desc) el.querySelector('[data-pop-desc]').textContent = desc;

    el.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-pop-close')) { close(); return; }
      if (t.hasAttribute('data-pop-edit')) {
        root.dispatchEvent(new CustomEvent('kui-calendar:event-edit',   { detail: { eventId: eventId }, bubbles: true }));
        close();
        return;
      }
      if (t.hasAttribute('data-pop-delete')) {
        if (!current.confirming) {
          current.confirming = true;
          t.classList.remove('text-error', 'border-border');
          t.classList.add('bg-error', 'text-primary-fg');
          t.querySelector('span').textContent = msg.confirmDelete;
          return;
        }
        root.dispatchEvent(new CustomEvent('kui-calendar:event-delete', { detail: { eventId: eventId }, bubbles: true }));
        close();
        return;
      }
    });

    return { el: el, eventId: eventId };
  }

  function onDocClick(ev) {
    // Click on an event button → open popover (skip during drag).
    if (window.__KuiCalendarDragActive) return;
    var btn = ev.target.closest && ev.target.closest('[data-event-id]');
    if (btn) {
      var root = btn.closest('[data-kui-calendar]');
      if (!root) return;
      ev.preventDefault();
      close();
      var rect = btn.getBoundingClientRect();
      var built = build(root, btn);
      current = { root: root, eventId: built.eventId, el: built.el, confirming: false };
      document.body.appendChild(built.el);
      place(built.el, rect);
      return;
    }
    // Click outside an open popover closes it.
    if (current && current.el && !current.el.contains(ev.target)) close();
  }

  function onKey(ev) {
    if (!current || ev.key !== 'Escape') return;
    ev.stopPropagation();
    close();
  }

  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey, true);
})();
