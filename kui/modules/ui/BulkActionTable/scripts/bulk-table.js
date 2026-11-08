/*
 * modules/ui/BulkActionTable/scripts/bulk-table.js
 *
 * Behaviour of BulkActionTable: the select-all and row checkboxes, the bulk-action bar (count, "select all N
 * matching", the actions, clear) and the column sort. Needs bulk-logic.js (window.KuiBulkLogic) first.
 *
 * Idempotent: window.KuiBulkTable.autoInit() mounts every [data-ba-root] once. The table is drawn by the server;
 * this file only changes it. Events on the root element (all bubble):
 *   kui:bulk-change                { selected }         the selection changed by a click
 *   kui:bulk-action                { key, ids }         an action button was used
 *   kui:bulk-select-all-matching   { count }            "select all N matching" was used
 * The selection is by row id, never by position, so sorting does not move it.
 */
(function (global) {
  'use strict';
  if (global.KuiBulkTable) return;
  var L = global.KuiBulkLogic;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mount(root) {
    var cfg;
    try { cfg = JSON.parse(root.getAttribute('data-ba-config') || '{}'); } catch (e) { cfg = {}; }
    var labels = cfg.labels || {};
    var actions = cfg.actions || [];
    var selected = (cfg.selected || []).map(L.keyOf);
    var sort = { key: '', dir: null };
    var bar = root.querySelector('[data-ba-bar]');

    function ids(keys) { return keys.map(function (k) { return JSON.parse(k); }); }
    function checks() { return Array.prototype.slice.call(root.querySelectorAll('[data-ba-check]')); }
    function selectableKeys() {
      return checks().filter(function (c) { return !c.disabled; }).map(function (c) { return c.getAttribute('data-ba-id'); });
    }
    function emit(name, detail) {
      root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    }

    function buildBar() {
      var b = el('div', L.CLASSES.bar);
      b.setAttribute('role', 'region');
      b.setAttribute('aria-label', 'Bulk actions');
      b.setAttribute('data-ba-bar', '');
      var count = el('span', L.CLASSES.count);
      count.setAttribute('data-ba-count', '');
      b.appendChild(count);
      if (cfg.matching) {
        var m = el('button', L.CLASSES.matching, L.fill(labels.selectAllMatching, cfg.totalMatching));
        m.type = 'button';
        m.setAttribute('data-ba-matching', '');
        b.appendChild(m);
      }
      var group = el('div', L.CLASSES.actions);
      actions.forEach(function (a) {
        var btn = el('button', L.CLASSES.actionBase + ' ' + (a.destructive ? L.CLASSES.actionDestructive : L.CLASSES.actionPrimary));
        btn.type = 'button';
        btn.setAttribute('data-ba-action', a.key);
        if (a.icon) {
          var i = el('i', a.icon);
          i.setAttribute('aria-hidden', 'true');
          btn.appendChild(i);
        }
        btn.appendChild(document.createTextNode(a.label));
        group.appendChild(btn);
      });
      var clear = el('button', L.CLASSES.clear, labels.clear);
      clear.type = 'button';
      clear.setAttribute('data-ba-clear', '');
      group.appendChild(clear);
      b.appendChild(group);
      return b;
    }

    function sync() {
      var keys = selectableKeys();
      var st = L.state(selected, keys);
      checks().forEach(function (c) { c.checked = selected.indexOf(c.getAttribute('data-ba-id')) !== -1; });
      var all = root.querySelector('[data-ba-all]');
      if (all) {
        all.checked = st.all;
        // `indeterminate` is a DOM property, not an attribute; without it a partial selection looks like none.
        all.indeterminate = st.some;
        all.disabled = keys.length === 0;
      }
      if (selected.length === 0) {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        bar = null;
        return;
      }
      if (!bar) {
        bar = buildBar();
        root.insertBefore(bar, root.firstChild);
      }
      var count = bar.querySelector('[data-ba-count]');
      if (count) count.textContent = L.fill(labels.selectedCount, selected.length);
      Array.prototype.forEach.call(bar.querySelectorAll('[data-ba-action]'), function (btn) {
        var key = btn.getAttribute('data-ba-action');
        var a = actions.filter(function (x) { return x.key === key; })[0];
        if (!a) return;
        var s = L.actionState(a, selected.length);
        btn.disabled = s.disabled;
        if (s.reason) btn.setAttribute('title', s.reason); else btn.removeAttribute('title');
      });
    }

    function change(next) {
      selected = next;
      sync();
      emit('kui:bulk-change', { selected: ids(selected) });
    }

    root.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.hasAttribute('data-ba-all')) change(L.toggleAllVisible(selected, selectableKeys()));
      else if (t.hasAttribute('data-ba-check')) change(L.toggleRow(selected, t.getAttribute('data-ba-id')));
    });

    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var btn = t.closest('[data-ba-action], [data-ba-clear], [data-ba-matching]');
      if (btn && root.contains(btn) && !btn.disabled) {
        if (btn.hasAttribute('data-ba-clear')) { change([]); return; }
        if (btn.hasAttribute('data-ba-matching')) { emit('kui:bulk-select-all-matching', { count: cfg.totalMatching }); return; }
        emit('kui:bulk-action', { key: btn.getAttribute('data-ba-action'), ids: ids(selected) });
        return;
      }
      var th = t.closest('[data-ba-sort]');
      if (th && root.contains(th)) {
        sort = L.nextSort(sort, th.getAttribute('data-ba-sort'));
        applySort();
      }
    });

    function applySort() {
      var body = root.querySelector('[data-ba-body]');
      if (!body) return;
      var rows = Array.prototype.slice.call(body.querySelectorAll('[data-ba-row]'));
      var entries = rows.map(function (tr, n) {
        var cell = sort.key ? tr.querySelector('[data-ba-cell="' + sort.key.replace(/(["\\])/g, '\\$1') + '"]') : null;
        return { index: Number(tr.getAttribute('data-ba-index')), value: cell ? cell.getAttribute('data-ba-value') : '', row: tr, n: n };
      });
      var order = L.sortedOrder(entries, sort);
      order.forEach(function (index) {
        var e = entries.filter(function (x) { return x.index === index; })[0];
        body.appendChild(e.row);
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-ba-sort]'), function (th) {
        var on = sort.key === th.getAttribute('data-ba-sort') && sort.dir;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var icon = th.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-sort', 'fa-chevron-up', 'fa-chevron-down');
          icon.classList.add(on ? (sort.dir === 'asc' ? 'fa-chevron-up' : 'fa-chevron-down') : 'fa-sort');
        }
      });
    }

    sync();
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-ba-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiBulkMounted) continue;
      nodes[i].__kuiBulkMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiBulkTable = { autoInit: autoInit, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
