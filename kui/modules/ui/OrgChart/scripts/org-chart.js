/*
 * modules/ui/OrgChart/scripts/org-chart.js
 *
 * Behaviour of OrgChart (kui-react modules/ui/OrgChart.tsx): the server draws every branch, collapsed groups hidden;
 * this file opens and closes them, zooms, runs the keyboard tree and the node click.
 *
 * Keyboard on a focused card (role="treeitem"): Arrow Up → parent, Arrow Down → first child (opening it), Arrow Left /
 * Right → previous / next sibling, `*` → open the node and every child, Enter / Space → the node click. One card is
 * in the tab order at a time (roving tabindex).
 *
 * Idempotent: window.KuiOrgChart.autoInit() mounts every [data-org-root] once.
 * API: KuiOrgChart.setHighlight(root, ids | function (treeitem, id) → boolean) marks matches and opens their path;
 *      KuiOrgChart.setExpanded(root, id, open) opens or closes one node.
 * Event on the root (bubbles): kui:org-node-click { id }. The root's data-org-click names a global function that is
 * called with the id too (React: onNodeClick).
 */
(function (global) {
  'use strict';
  if (global.KuiOrgChart) return;

  var MATCH = ['ring-2', 'ring-primary/40'];
  var INTERACTIVE = 'button,a,input,select,textarea';

  function esc(id) { return global.CSS && global.CSS.escape ? global.CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'); }
  function item(root, id) { return id ? root.querySelector('[role="treeitem"][data-node-id="' + esc(id) + '"]') : null; }
  function branchOf(el) { return el ? el.closest('[data-part="org-branch"]') : null; }
  function childList(branch) {
    for (var c = branch && branch.firstElementChild; c; c = c.nextElementSibling) if (c.getAttribute('data-part') === 'org-children') return c;
    return null;
  }
  function toggleOf(branch) {
    for (var c = branch && branch.firstElementChild; c; c = c.nextElementSibling) if (c.getAttribute('data-part') === 'org-toggle') return c;
    return null;
  }
  function ownItem(branch) {
    for (var c = branch && branch.firstElementChild; c; c = c.nextElementSibling) if (c.getAttribute('role') === 'treeitem') return c;
    return null;
  }
  function childBranches(list) {
    var out = [];
    for (var c = list && list.firstElementChild; c; c = c.nextElementSibling) if (c.getAttribute('data-part') === 'org-branch') out.push(c);
    return out;
  }
  function parentItem(treeitem) {
    var branch = branchOf(treeitem);
    var up = branch && branch.parentElement ? branchOf(branch.parentElement) : null;
    return up ? ownItem(up) : null;
  }

  function setOpen(root, treeitem, open) {
    var branch = branchOf(treeitem);
    var list = childList(branch);
    var button = toggleOf(branch);
    if (!list || !button) return;
    if (open) list.removeAttribute('hidden'); else list.setAttribute('hidden', '');
    treeitem.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', root.getAttribute(open ? 'data-org-collapse' : 'data-org-expand') || '');
    var icon = button.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-chevron-up', open);
      icon.classList.toggle('fa-chevron-down', !open);
    }
    var count = button.querySelector('span');
    if (open && count) count.parentNode.removeChild(count);
    if (!open && !count) {
      count = document.createElement('span');
      count.textContent = (root.getAttribute('data-org-more') || '{count}').replace('{count}', String(childBranches(list).length));
      button.appendChild(count);
    }
  }

  function setExpanded(root, id, open) {
    var el = item(root, id);
    if (el) setOpen(root, el, open);
  }

  function focusItem(root, el) {
    if (!el) return;
    var items = root.querySelectorAll('[role="treeitem"]');
    for (var i = 0; i < items.length; i++) items[i].setAttribute('tabindex', items[i] === el ? '0' : '-1');
    el.focus();
  }

  function siblingsOf(root, treeitem) {
    var branch = branchOf(treeitem);
    return childBranches(branch && branch.parentElement).map(ownItem);
  }

  function click(root, treeitem) {
    var id = treeitem.getAttribute('data-node-id');
    var name = root.getAttribute('data-org-click');
    if (name && typeof global[name] === 'function') global[name](id);
    root.dispatchEvent(new CustomEvent('kui:org-node-click', { bubbles: true, detail: { id: id } }));
  }

  function clickable(root) { return root.hasAttribute('data-org-clickable'); }

  function onKeyDown(root, e) {
    var t = e.target;
    if (!t || t.getAttribute('role') !== 'treeitem' || !root.contains(t)) return;
    var sibs = siblingsOf(root, t);
    var at = sibs.indexOf(t);
    var list = childList(branchOf(t));
    var kids = childBranches(list).map(ownItem);
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        focusItem(root, parentItem(t));
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (kids.length) {
          setOpen(root, t, true);
          focusItem(root, kids[0]);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusItem(root, sibs[at - 1]);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusItem(root, sibs[at + 1]);
        break;
      case '*':
        e.preventDefault();
        setOpen(root, t, true);
        kids.forEach(function (k) { setOpen(root, k, true); });
        break;
      case 'Enter':
      case ' ':
        if (clickable(root)) {
          e.preventDefault();
          click(root, t);
        }
        break;
      default:
    }
  }

  function zoom(root, how) {
    var tree = root.querySelector('[role="tree"]');
    var z = parseFloat(root.getAttribute('data-org-scale') || '1');
    if (how === 'out') z = Math.max(0.4, +(z - 0.1).toFixed(2));
    else if (how === 'in') z = Math.min(1.6, +(z + 0.1).toFixed(2));
    else z = 1;
    root.setAttribute('data-org-scale', String(z));
    if (tree) tree.style.transform = z !== 1 ? 'scale(' + z + ')' : '';
  }

  function setHighlight(root, match) {
    var items = root.querySelectorAll('[role="treeitem"]');
    var ids = [];
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var id = el.getAttribute('data-node-id');
      var on = typeof match === 'function' ? Boolean(match(el, id)) : Array.isArray(match) && match.indexOf(id) !== -1;
      if (on) {
        ids.push(id);
        el.setAttribute('aria-selected', 'true');
        el.setAttribute('data-highlighted', 'true');
        MATCH.forEach(function (c) { el.classList.add(c); });
      } else {
        el.removeAttribute('aria-selected');
        el.removeAttribute('data-highlighted');
        MATCH.forEach(function (c) { el.classList.remove(c); });
      }
    }
    // Like React: a new set of matches opens every ancestor; clearing the matches closes nothing.
    var key = ids.join('|');
    if (key && key !== root.__kuiOrgOpenedFor) {
      root.__kuiOrgOpenedFor = key;
      ids.forEach(function (id) {
        for (var p = parentItem(item(root, id)); p; p = parentItem(p)) setOpen(root, p, true);
      });
    }
    return ids;
  }

  function mount(root) {
    root.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var zoomButton = target.closest('[data-org-zoom]');
      if (zoomButton && root.contains(zoomButton)) { zoom(root, zoomButton.getAttribute('data-org-zoom')); return; }
      var toggle = target.closest('[data-part="org-toggle"]');
      if (toggle && root.contains(toggle)) {
        var own = ownItem(branchOf(toggle));
        if (own) setOpen(root, own, own.getAttribute('aria-expanded') !== 'true');
        return;
      }
      var treeitem = target.closest('[role="treeitem"]');
      if (!treeitem || !root.contains(treeitem) || !clickable(root)) return;
      var inner = target.closest(INTERACTIVE);
      if (inner && treeitem.contains(inner)) return;
      click(root, treeitem);
    });
    root.addEventListener('keydown', function (e) { onKeyDown(root, e); });
    root.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('role') === 'treeitem' && t.getAttribute('tabindex') !== '0') {
        var items = root.querySelectorAll('[role="treeitem"]');
        for (var i = 0; i < items.length; i++) items[i].setAttribute('tabindex', items[i] === t ? '0' : '-1');
      }
    });
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-org-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiOrgMounted) continue;
      nodes[i].__kuiOrgMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiOrgChart = { autoInit: autoInit, mount: mount, setHighlight: setHighlight, setExpanded: setExpanded };
})(typeof window !== 'undefined' ? window : globalThis);
