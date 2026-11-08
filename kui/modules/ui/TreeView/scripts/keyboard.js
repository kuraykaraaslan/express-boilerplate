<%
  // keyboard.js — WAI-ARIA Tree keyboard handling (M1 subset).
  //
  // Depends on `tree-state.js` having attached `root.__treeApi`. Loaded as a
  // sibling `<script>` block by `TreeView.ejs` immediately after tree-state.
  //
  // Pixel-parity contract with `modules/ui/TreeView/hooks/useKeyboardNav.ts`.
  // TODO M2: extend with drag/drop keyboard initiators (Space+ArrowUp etc.).
%>
<script>
(function () {
  var root = document.getElementById(<%- include('../../_script-json', { value: String(_id) }) %>);
  if (!root || root.dataset.treeKbInit === '1') return;
  root.dataset.treeKbInit = '1';

  var api = root.__treeApi;
  if (!api) return;

  // Type-ahead buffer.
  var typeBuffer = '';
  var typeLastAt = 0;
  var TYPE_RESET_MS = 500;

  function visibleIndexOf(item) {
    var v = api.visibleItems();
    return v.indexOf(item);
  }

  function focusAt(index) {
    var v = api.visibleItems();
    if (!v.length) return;
    var i = Math.max(0, Math.min(v.length - 1, index));
    api.setFocus(v[i]);
  }

  function jumpTypeAhead(ch) {
    var now = Date.now();
    if (now - typeLastAt > TYPE_RESET_MS) typeBuffer = '';
    typeBuffer += ch;
    typeLastAt = now;

    var v = api.visibleItems();
    if (!v.length) return;
    var current = root.querySelector(':scope [data-tree-row][tabindex="0"]');
    var currentItem = current && current.closest('[role="treeitem"]');
    var startIdx = currentItem ? v.indexOf(currentItem) : 0;
    if (startIdx === -1) startIdx = 0;
    var offset = typeBuffer.length === 1 ? 1 : 0;
    var needle = typeBuffer.toLowerCase();
    for (var i = 0; i < v.length; i++) {
      var probe = v[(startIdx + offset + i) % v.length];
      var label = (probe.querySelector(':scope > [data-tree-row] > span:last-child')
        || probe.querySelector(':scope > [data-tree-row] span')) ;
      var text = (label ? label.textContent : '').trim().toLowerCase();
      if (text.indexOf(needle) === 0) {
        api.setFocus(probe);
        return;
      }
    }
  }

  root.addEventListener('keydown', function (e) {
    var row = e.target.closest('[data-tree-row]');
    if (!row || !root.contains(row)) return;
    var item = row.closest('[role="treeitem"]');
    if (!item) return;

    var hasChildren = item.getAttribute('data-has-children') === 'true';
    var expanded = item.getAttribute('aria-expanded') === 'true';
    var idx = visibleIndexOf(item);

    // Type-ahead for printable characters (no modifiers).
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      jumpTypeAhead(e.key);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(idx + 1);
        if (e.shiftKey) {
          var v1 = api.visibleItems();
          var target = v1[Math.min(v1.length - 1, idx + 1)];
          if (target) api.selectRange(target);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(idx - 1);
        if (e.shiftKey) {
          var v2 = api.visibleItems();
          var target2 = v2[Math.max(0, idx - 1)];
          if (target2) api.selectRange(target2);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (hasChildren && !expanded) {
          api.toggleItem(item, true);
        } else if (hasChildren && expanded) {
          var firstChild = item.querySelector(':scope > ul[role="group"] > [role="treeitem"]');
          if (firstChild) api.setFocus(firstChild);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (hasChildren && expanded) {
          api.toggleItem(item, false);
        } else {
          var parentItem = item.parentElement && item.parentElement.closest('[role="treeitem"]');
          if (parentItem) api.setFocus(parentItem);
        }
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(api.visibleItems().length - 1);
        break;
      case ' ':
        e.preventDefault();
        if (e.shiftKey) {
          api.selectRange(item);
        } else if (api.selectionMode === 'multi' || e.ctrlKey || e.metaKey) {
          api.toggleMulti(item);
        } else {
          api.selectSingle(item);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (item.getAttribute('aria-selected') !== 'true') api.selectSingle(item);
        api.setAnchor(item.getAttribute('data-tree-node-id'));
        root.dispatchEvent(new CustomEvent('treeview:activate', {
          detail: { id: item.getAttribute('data-tree-node-id') },
          bubbles: true,
        }));
        break;
      case '*':
        e.preventDefault();
        // Expand all siblings of focused node.
        var siblings = item.parentElement ? item.parentElement.children : [];
        for (var s = 0; s < siblings.length; s++) {
          var sib = siblings[s];
          if (sib.getAttribute && sib.getAttribute('role') === 'treeitem' && sib.getAttribute('data-has-children') === 'true') {
            api.toggleItem(sib, true);
          }
        }
        break;
      default:
        // Ctrl/Cmd+A → select all visible (multi mode only).
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          if (api.selectionMode !== 'multi') return;
          e.preventDefault();
          var first = api.visibleItems()[0];
          var last = api.visibleItems()[api.visibleItems().length - 1];
          if (first && last) {
            api.setAnchor(first.getAttribute('data-tree-node-id'));
            api.selectRange(last);
          }
        }
    }
  });
})();
</script>
