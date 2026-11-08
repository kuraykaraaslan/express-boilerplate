/* ── KanbanBoard HTML5 native drag-and-drop (M1) ─────────────────────── */

function bindAll() {
  // Cards
  Array.prototype.forEach.call(root.querySelectorAll('[data-card-id]'), bindCard);
  // Columns
  Array.prototype.forEach.call(root.querySelectorAll('[data-kanban-column="1"]'), bindColumn);
}

function bindCard(el) {
  el.addEventListener('dragstart', function (e) {
    var payload = {
      cardId: el.getAttribute('data-card-id'),
      fromColumnId: el.getAttribute('data-from-column-id')
    };
    try {
      e.dataTransfer.setData(MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.cardId);
    } catch (err) { /* sandboxed contexts */ }
    e.dataTransfer.effectAllowed = 'move';
    draggingId = payload.cardId;
    el.classList.add('opacity-50');
    el.setAttribute('aria-grabbed', 'true');
    // aria-dropeffect on all columns while drag is in flight.
    Array.prototype.forEach.call(root.querySelectorAll('[data-kanban-column="1"]'), function (col) {
      col.setAttribute('aria-dropeffect', 'move');
    });
  });
  el.addEventListener('dragend', function () {
    el.classList.remove('opacity-50');
    el.removeAttribute('aria-grabbed');
    draggingId = null;
    clearDropTarget();
    Array.prototype.forEach.call(root.querySelectorAll('[data-kanban-column="1"]'), function (col) {
      col.removeAttribute('aria-dropeffect');
      col.classList.remove('bg-primary-subtle', 'border-primary/40');
    });
  });
}

function bindColumn(col) {
  col.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    col.classList.add('bg-primary-subtle', 'border-primary/40');
    var idx = computeIndex(col, e.clientY);
    setDropTarget(col.getAttribute('data-column-id'), idx);
  });
  col.addEventListener('dragleave', function (e) {
    // Only clear if leaving the column boundary entirely.
    if (e.relatedTarget && col.contains(e.relatedTarget)) return;
    col.classList.remove('bg-primary-subtle', 'border-primary/40');
    if (dropTarget && dropTarget.columnId === col.getAttribute('data-column-id')) {
      clearDropTarget();
    }
  });
  col.addEventListener('drop', function (e) {
    e.preventDefault();
    col.classList.remove('bg-primary-subtle', 'border-primary/40');
    var raw = '';
    try { raw = e.dataTransfer.getData(MIME) || e.dataTransfer.getData('text/plain') || ''; } catch (err) { raw = ''; }
    if (!raw) { clearDropTarget(); return; }
    var payload;
    if (raw.charAt(0) === '{') {
      try { payload = JSON.parse(raw); } catch (err) { payload = null; }
    } else {
      var found = cards.filter(function (c) { return c.id === raw; })[0];
      if (found) payload = { cardId: found.id, fromColumnId: found.columnId };
    }
    var toId   = col.getAttribute('data-column-id');
    var idx    = (dropTarget && dropTarget.columnId === toId) ? dropTarget.index : 0;
    clearDropTarget();
    if (!payload) return;
    performMove(payload.cardId, payload.fromColumnId, toId, idx);
  });
}

/* ── Index computation: which slot is the pointer over? ──────────────── */
function computeIndex(col, clientY) {
  var list = col.querySelector('[data-kanban-list]');
  if (!list) return 0;
  var items = list.querySelectorAll('[data-card-id]');
  for (var i = 0; i < items.length; i++) {
    var r = items[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return items.length;
}

function setDropTarget(columnId, index) {
  if (dropTarget && dropTarget.columnId === columnId && dropTarget.index === index) return;
  dropTarget = { columnId: columnId, index: index };
  paintIndicators();
}

function clearDropTarget() {
  dropTarget = null;
  paintIndicators();
}

function paintIndicators() {
  Array.prototype.forEach.call(root.querySelectorAll('.kb-drop-indicator'), function (el) {
    el.classList.remove('bg-primary');
    el.classList.add('bg-transparent');
  });
  if (!dropTarget) return;
  var col = root.querySelector('[data-column-id="' + dropTarget.columnId + '"]');
  if (!col) return;
  var slots = col.querySelectorAll('.kb-drop-indicator');
  var node = slots[dropTarget.index];
  if (node) {
    node.classList.remove('bg-transparent');
    node.classList.add('bg-primary');
  }
}

/* ── Move + optimistic UI rewind ─────────────────────────────────────── */
function performMove(cardId, fromColumnId, toColumnId, destIndex) {
  var card = cards.filter(function (c) { return c.id === cardId; })[0];
  if (!card) return;
  // canMove validation (window-level hook).
  var api = window.KuiKanban && window.KuiKanban[KB_ID];
  if (api && typeof api._canMove === 'function' && !api._canMove(card, fromColumnId, toColumnId)) return;

  snapshot = cards.slice();
  // Remove + reinsert at destIndex within target column.
  var without = cards.filter(function (c) { return c.id !== cardId; });
  var targetSlice = without.filter(function (c) { return c.columnId === toColumnId; });
  var clamped = Math.max(0, Math.min(destIndex, targetSlice.length));
  var insertAt = without.length;
  var seen = 0;
  for (var i = 0; i < without.length; i++) {
    if (without[i].columnId === toColumnId) {
      if (seen === clamped) { insertAt = i; break; }
      seen++;
    }
  }
  var moved = Object.assign({}, card, { columnId: toColumnId });
  cards = without.slice(0, insertAt).concat([moved]).concat(without.slice(insertAt));
  rerender();

  // Async mover hook — throw to revert.
  var mover = api && api._mover;
  if (typeof mover !== 'function') return;
  Promise.resolve(mover(moved, fromColumnId, toColumnId, clamped)).then(
    function () { snapshot = null; },
    function () { cards = snapshot || cards; snapshot = null; rerender(); }
  );
}

/* ── Re-render the whole board after a move (M1: trivial DOM rebuild) ── */
function rerender() {
  // Group by column and re-attach card nodes; keep nodes alive to preserve
  // CSS transitions + focus. We move existing <li> elements between lists.
  var lists = {};
  Array.prototype.forEach.call(root.querySelectorAll('[data-kanban-list]'), function (ul) {
    lists[ul.getAttribute('data-kanban-list')] = ul;
  });
  // Detach all card nodes.
  var nodesById = {};
  Array.prototype.forEach.call(root.querySelectorAll('[data-card-id]'), function (li) {
    nodesById[li.getAttribute('data-card-id')] = li;
    if (li.parentNode) li.parentNode.removeChild(li);
  });
  // Clear empty-state placeholders + indicators (rebuilt below).
  Object.keys(lists).forEach(function (cid) {
    var ul = lists[cid];
    Array.prototype.forEach.call(ul.querySelectorAll('.kb-col-empty,.kb-drop-indicator'), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  });
  // Re-insert in new order + rebuild indicators + count badges.
  Object.keys(lists).forEach(function (cid) {
    var ul = lists[cid];
    var colCards = cards.filter(function (c) { return c.columnId === cid; });
    ul.appendChild(makeIndicator(0));
    colCards.forEach(function (c, i) {
      var node = nodesById[c.id];
      if (node) {
        node.setAttribute('data-from-column-id', cid);
        ul.appendChild(node);
      }
      ul.appendChild(makeIndicator(i + 1));
    });
    if (colCards.length === 0) {
      var empty = document.createElement('li');
      empty.setAttribute('aria-hidden', 'true');
      empty.className = 'kb-col-empty text-xs text-text-disabled italic text-center py-6 border border-dashed border-border rounded-md';
      empty.textContent = 'Drop cards here';
      ul.appendChild(empty);
    }
    // Update count badge.
    var section = ul.closest('[data-kanban-column="1"]');
    if (section) {
      var badge = section.querySelector('.kb-col-count');
      if (badge) {
        badge.textContent = String(colCards.length);
        badge.setAttribute('aria-label', colCards.length + ' cards');
      }
    }
  });
}

function makeIndicator(idx) {
  var d = document.createElement('div');
  d.setAttribute('aria-hidden', 'true');
  d.setAttribute('data-slot-index', String(idx));
  d.className = 'kb-drop-indicator mx-1 my-0.5 h-0.5 rounded-full transition-colors bg-transparent';
  return d;
}
