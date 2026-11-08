/* ─── Calendar drag — parallel of hooks/useDragMove + useResize + useDragCreate ──
 * Pointer-driven move / resize / create on the timed grid columns.
 * Updates DOM in real time (no React, no rerender), then fires CustomEvents
 * on commit:
 *   kui-calendar:event-update  { eventId, start, end }
 *   kui-calendar:event-create  { start, end, dayIndex }
 * Caller wires those to its backend.
 */
(function () {
  if (window.__KuiCalendarDrag) return;
  window.__KuiCalendarDrag = true;

  var HOUR = 48;        // mirror HOUR_HEIGHT
  var MIN_H = 18;       // mirror MIN_EVENT_HEIGHT
  var MOVE_THRESHOLD = 4;

  function snap(min, step) { return Math.floor(min / step) * step; }
  function yToMin(y, h) { return Math.round((Math.max(0, Math.min(h, y)) / HOUR) * 60); }
  function fmt(min) {
    var h = String(Math.floor(min / 60)).padStart(2, '0');
    var m = String(min % 60).padStart(2, '0');
    return h + ':' + m;
  }
  function makeDate(dayIso, min) {
    var d = new Date(dayIso);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(Math.max(0, Math.min(24 * 60 - 1, min)));
    return d;
  }
  function hitDayCol(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest('[data-cal-day-index]');
  }
  function ghostEl(col) {
    var g = col.querySelector('[data-cal-ghost]');
    if (g) return g;
    g = document.createElement('div');
    g.setAttribute('data-cal-ghost', '');
    g.setAttribute('aria-hidden', 'true');
    g.style.cssText = 'position:absolute;left:4px;right:4px;border-radius:6px;border:2px dashed var(--primary);background:rgba(59,130,246,0.15);padding:4px 8px;font-size:11px;color:var(--primary);font-weight:500;pointer-events:none;';
    var slot = col.querySelector('[data-cal-day-slots]') || col;
    slot.appendChild(g);
    return g;
  }
  function clearGhosts(root) {
    var gs = root.querySelectorAll('[data-cal-ghost]');
    for (var i = 0; i < gs.length; i++) gs[i].parentNode.removeChild(gs[i]);
  }

  // ── DRAG-MOVE / RESIZE on existing event buttons ────────────────────────
  function startMoveOrResize(ev, root, evBtn) {
    if (ev.button !== 0) return;
    var slotMin = Number(root.getAttribute('data-slot-minutes')) || 30;
    var sourceCol = evBtn.closest('[data-cal-day-index]');
    if (!sourceCol) return;
    var isResize = !!ev.target.closest('[data-resize-handle]');
    var startMs  = Number(evBtn.getAttribute('data-event-start'));
    var endMs    = Number(evBtn.getAttribute('data-event-end'));
    if (!startMs || !endMs) return;
    var duration = endMs - startMs;

    var startRect = evBtn.getBoundingClientRect();
    var pointerOffsetY = ev.clientY - startRect.top;
    var moved = false;

    function onMove(mv) {
      if (!moved && Math.abs(mv.clientY - ev.clientY) < MOVE_THRESHOLD && Math.abs(mv.clientX - ev.clientX) < MOVE_THRESHOLD) return;
      if (!moved) {
        moved = true;
        window.__KuiCalendarDragActive = true;
        evBtn.style.opacity = '0.6';
      }
      if (isResize) {
        var colRect = sourceCol.getBoundingClientRect();
        var endMin = Math.max(
          minutesIntoDate(new Date(startMs)) + slotMin,
          Math.min(24 * 60, snap(yToMin(mv.clientY - colRect.top, colRect.height), slotMin) + slotMin)
        );
        var newH = Math.max(MIN_H, ((endMin - minutesIntoDate(new Date(startMs))) / 60) * HOUR);
        evBtn.style.height = newH + 'px';
        evBtn.setAttribute('data-event-end-pending', String(makeDate(new Date(startMs).toISOString(), endMin).getTime()));
      } else {
        var hit = hitDayCol(mv.clientX, mv.clientY) || sourceCol;
        var hitRect = hit.getBoundingClientRect();
        var rawMin = yToMin(mv.clientY - pointerOffsetY - hitRect.top + (hitRect.top - hitRect.top), hitRect.height) +
                     (minutesIntoDate(new Date(startMs)) - yToMin(pointerOffsetY, Infinity));
        var startMin = Math.max(0, Math.min(24 * 60 - 1, snap(rawMin, slotMin)));
        var newTop = (startMin / 60) * HOUR;
        if (hit !== sourceCol) {
          // move element to new column
          var slot = hit.querySelector('[data-cal-day-slots]') || hit;
          slot.appendChild(evBtn);
        }
        evBtn.style.top = newTop + 'px';
        var newStart = makeDate(hit.getAttribute('data-cal-day-iso') || new Date().toISOString(), startMin);
        evBtn.setAttribute('data-event-start-pending', String(newStart.getTime()));
        evBtn.setAttribute('data-event-end-pending',   String(newStart.getTime() + duration));
      }
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.__KuiCalendarDragActive = false;
      evBtn.style.opacity = '';
      if (!moved) return; // treat as click → popover handler picks it up
      var newStart = Number(evBtn.getAttribute('data-event-start-pending') || startMs);
      var newEnd   = Number(evBtn.getAttribute('data-event-end-pending')   || endMs);
      evBtn.removeAttribute('data-event-start-pending');
      evBtn.removeAttribute('data-event-end-pending');
      evBtn.setAttribute('data-event-start', String(newStart));
      evBtn.setAttribute('data-event-end',   String(newEnd));
      root.dispatchEvent(new CustomEvent('kui-calendar:event-update', {
        detail: { eventId: evBtn.getAttribute('data-event-id'), start: new Date(newStart), end: new Date(newEnd) },
        bubbles: true
      }));
    }

    function onKey(kev) {
      if (kev.key !== 'Escape') return;
      kev.preventDefault();
      // Snap back via the up-handler with moved=false.
      moved = false;
      onUp();
    }

    ev.preventDefault();
    ev.stopPropagation();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  function minutesIntoDate(d) { return d.getHours() * 60 + d.getMinutes(); }

  // ── DRAG-CREATE on empty time-grid space ────────────────────────────────
  function startCreate(ev, root, col) {
    if (ev.button !== 0) return;
    if (ev.target.closest('[data-event-id]') || ev.target.closest('[data-resize-handle]')) return;
    var slotMin = Number(root.getAttribute('data-slot-minutes')) || 30;
    var rect = col.getBoundingClientRect();
    var startMin = snap(yToMin(ev.clientY - rect.top, rect.height), slotMin);
    var dayIso = col.getAttribute('data-cal-day-iso') || new Date().toISOString();
    var dayIndex = Number(col.getAttribute('data-cal-day-index')) || 0;
    var ghost = ghostEl(col);
    ghost.style.top = (startMin / 60) * HOUR + 'px';
    ghost.style.height = (slotMin / 60) * HOUR + 'px';
    ghost.textContent = fmt(startMin) + ' – ' + fmt(startMin + slotMin);
    window.__KuiCalendarDragActive = true;

    function onMove(mv) {
      var r = col.getBoundingClientRect();
      var rawEnd = snap(yToMin(mv.clientY - r.top, r.height), slotMin) + slotMin;
      var endMin = Math.max(startMin + slotMin, Math.min(24 * 60, rawEnd));
      ghost.style.height = ((endMin - startMin) / 60) * HOUR + 'px';
      ghost.textContent = fmt(startMin) + ' – ' + fmt(endMin);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.__KuiCalendarDragActive = false;
      var endMin = Math.round(parseFloat(ghost.style.height) / HOUR * 60) + startMin;
      clearGhosts(root);
      if (endMin - startMin < slotMin) return;
      var s = makeDate(dayIso, startMin), e = makeDate(dayIso, endMin);
      root.dispatchEvent(new CustomEvent('kui-calendar:event-create', {
        detail: { start: s, end: e, dayIndex: dayIndex },
        bubbles: true
      }));
    }
    function onKey(kev) {
      if (kev.key !== 'Escape') return;
      kev.preventDefault();
      clearGhosts(root);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.__KuiCalendarDragActive = false;
    }

    ev.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  document.addEventListener('pointerdown', function (ev) {
    var root = ev.target.closest && ev.target.closest('[data-kui-calendar]');
    if (!root) return;
    var evBtn = ev.target.closest('[data-event-id]');
    if (evBtn) { startMoveOrResize(ev, root, evBtn); return; }
    var col = ev.target.closest('[data-cal-day-slots]');
    if (col) { startCreate(ev, root, col.closest('[data-cal-day-index]')); }
  });
})();
