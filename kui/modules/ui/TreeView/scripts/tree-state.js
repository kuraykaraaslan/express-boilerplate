<%
  // tree-state.js — selection + expand/collapse + toolbar wiring.
  //
  // Loaded as a `<script>` block at the bottom of `TreeView.ejs`. The script is
  // self-initialising and idempotent (guarded with `data-tree-init`). It pairs
  // with `keyboard.js` which adds the WAI-ARIA Tree key handling.
  //
  // Pixel-parity contract with `modules/ui/TreeView/hooks/useTreeState.ts`.
  // TODO M2: extend with drag/drop state.
%>
<script>
(function () {
  var root = document.getElementById(<%- include('../../_script-json', { value: String(_id) }) %>);
  if (!root || root.dataset.treeInit === '1') return;
  root.dataset.treeInit = '1';

  var selectionMode = root.dataset.selectionMode === 'multi' ? 'multi' : 'single';
  var anchorId = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function items() {
    return Array.from(root.querySelectorAll('[role="treeitem"]'));
  }

  function visibleItems() {
    return items().filter(function (it) {
      // An item is visible if every ancestor `ul[role="group"]` is not hidden.
      var p = it.parentElement;
      while (p && p !== root) {
        if (p.matches('ul[role="group"]') && p.hidden) return false;
        p = p.parentElement;
      }
      return true;
    });
  }

  function rowOf(item) { return item.querySelector(':scope > [data-tree-row]'); }

  function setSelectedStyle(item, on) {
    item.setAttribute('aria-selected', on ? 'true' : 'false');
    var row = rowOf(item);
    if (!row) return;
    row.classList.toggle('bg-primary-subtle', on);
    row.classList.toggle('text-primary', on);
    row.classList.toggle('font-medium', on);
  }

  function setFocus(item) {
    items().forEach(function (it) {
      var row = rowOf(it);
      if (row) row.setAttribute('tabindex', it === item ? '0' : '-1');
    });
    var row = rowOf(item);
    if (row) row.focus();
  }

  function toggleItem(item, force) {
    var expanded = item.getAttribute('aria-expanded') === 'true';
    var next = (typeof force === 'boolean') ? force : !expanded;
    item.setAttribute('aria-expanded', next ? 'true' : 'false');
    var group = item.querySelector(':scope > ul[role="group"]');
    if (group) group.hidden = !next;
    var chev = item.querySelector(':scope > [data-tree-row] > [data-tree-chevron] > i');
    if (chev) {
      chev.classList.toggle('fa-chevron-down', next);
      chev.classList.toggle('fa-chevron-right', !next);
    }
    root.dispatchEvent(new CustomEvent('treeview:expand', {
      detail: { id: item.getAttribute('data-tree-node-id'), expanded: next },
      bubbles: true,
    }));
  }

  function clearSelection() {
    items().forEach(function (it) { setSelectedStyle(it, false); });
  }

  function selectSingle(item) {
    clearSelection();
    setSelectedStyle(item, true);
    var id = item.getAttribute('data-tree-node-id');
    root.dataset.selectedId = id;
    anchorId = id;
    root.dispatchEvent(new CustomEvent('treeview:select', { detail: { id: id, ids: [id] }, bubbles: true }));
  }

  function toggleMulti(item) {
    var on = item.getAttribute('aria-selected') !== 'true';
    setSelectedStyle(item, on);
    anchorId = item.getAttribute('data-tree-node-id');
    var ids = items()
      .filter(function (it) { return it.getAttribute('aria-selected') === 'true'; })
      .map(function (it) { return it.getAttribute('data-tree-node-id'); });
    root.dataset.selectedId = ids[ids.length - 1] || '';
    root.dispatchEvent(new CustomEvent('treeview:select', { detail: { id: ids[ids.length - 1] || null, ids: ids }, bubbles: true }));
  }

  function selectRange(targetItem) {
    var order = visibleItems();
    var targetId = targetItem.getAttribute('data-tree-node-id');
    var anchor = anchorId || (order[0] && order[0].getAttribute('data-tree-node-id'));
    var a = order.findIndex(function (it) { return it.getAttribute('data-tree-node-id') === anchor; });
    var b = order.findIndex(function (it) { return it.getAttribute('data-tree-node-id') === targetId; });
    if (a === -1 || b === -1) { selectSingle(targetItem); return; }
    var lo = Math.min(a, b), hi = Math.max(a, b);
    clearSelection();
    for (var i = lo; i <= hi; i++) setSelectedStyle(order[i], true);
    var ids = [];
    for (var j = lo; j <= hi; j++) ids.push(order[j].getAttribute('data-tree-node-id'));
    root.dataset.selectedId = targetId;
    root.dispatchEvent(new CustomEvent('treeview:select', { detail: { id: targetId, ids: ids }, bubbles: true }));
  }

  // ─── Toolbar wiring ───────────────────────────────────────────────────────
  root.querySelectorAll('[data-tree-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var action = btn.getAttribute('data-tree-action');
      if (action === 'expand-all') {
        items().forEach(function (it) {
          if (it.getAttribute('data-has-children') === 'true') toggleItem(it, true);
        });
      } else if (action === 'collapse-all') {
        items().forEach(function (it) {
          if (it.getAttribute('data-has-children') === 'true') toggleItem(it, false);
        });
      }
    });
  });

  // ─── Click handling ───────────────────────────────────────────────────────
  root.addEventListener('click', function (e) {
    // Chevron clicks only toggle expansion, never select.
    var chev = e.target.closest('[data-tree-chevron]');
    if (chev && root.contains(chev)) {
      var chevItem = chev.closest('[role="treeitem"]');
      if (chevItem) {
        setFocus(chevItem);
        toggleItem(chevItem);
      }
      return;
    }

    var row = e.target.closest('[data-tree-row]');
    if (!row || !root.contains(row)) return;
    var item = row.closest('[role="treeitem"]');
    if (!item) return;

    setFocus(item);

    if (e.shiftKey) {
      selectRange(item);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (selectionMode === 'multi') { toggleMulti(item); return; }
      selectSingle(item); return;
    }

    if (item.getAttribute('data-has-children') === 'true') {
      toggleItem(item);
      // Legacy parity: clicking a parent also selects it (single mode).
      if (selectionMode === 'single') selectSingle(item);
      else if (item.getAttribute('aria-selected') !== 'true') toggleMulti(item);
    } else {
      selectSingle(item);
    }
  });

  // ─── Expose imperative helpers for keyboard.js ────────────────────────────
  root.__treeApi = {
    items: items,
    visibleItems: visibleItems,
    rowOf: rowOf,
    setFocus: setFocus,
    toggleItem: toggleItem,
    selectSingle: selectSingle,
    toggleMulti: toggleMulti,
    selectRange: selectRange,
    selectionMode: selectionMode,
    setAnchor: function (id) { anchorId = id; },
    getAnchor: function () { return anchorId; },
  };
})();
</script>
