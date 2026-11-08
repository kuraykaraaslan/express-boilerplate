/* ── Drag-and-drop reorder ──────────────────────────────────────────── */
var dragFrom = null;
var dragOver = null;

function dndStart(i) { dragFrom = i; markDrag(); }
function dndOver(i)  { if (i !== dragFrom) { dragOver = i; markDrag(); } }
function dndLeave()  { dragOver = null; markDrag(); }
function dndDrop(dropIdx) {
  if (dragFrom === null || dragFrom === dropIdx) { dndEnd(); return; }
  var moved = images.splice(dragFrom, 1)[0];
  images.splice(dropIdx, 0, moved);
  dndEnd();
  renderGrid();
}
function dndEnd() { dragFrom = null; dragOver = null; }

function markDrag() {
  var items = document.querySelectorAll('#' + G_ID + '-grid [data-idx]');
  items.forEach(function (el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    el.classList.toggle('opacity-40',          idx === dragFrom);
    el.classList.toggle('scale-95',            idx === dragFrom);
    el.classList.toggle('ring-2',              idx === dragFrom || idx === dragOver);
    el.classList.toggle('ring-inset',          idx === dragFrom);
    el.classList.toggle('ring-[var(--primary)]', idx === dragFrom || idx === dragOver);
    el.classList.toggle('shadow-lg',           idx === dragOver && idx !== dragFrom);
    el.classList.toggle('scale-[1.02]',        idx === dragOver && idx !== dragFrom);
  });
}
