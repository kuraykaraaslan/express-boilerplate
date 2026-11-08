/*
 * modules/ui/InlineEditList/scripts/inline-edit-list.js
 *
 * Behaviour of InlineEditList: the editor, the saving / error / saved states and every change to the rows. The
 * server draws the list as it reads when nothing is edited (InlineEditList.ejs); this file keeps the state of
 * kui-react's component in the browser and redraws the rows from it with the same markup and classes.
 *
 * Keys on a row: ArrowUp / ArrowDown / Home / End move, Enter or F2 edits, Delete removes, Alt + ArrowUp / Alt +
 * ArrowDown reorders. In the editor: Enter saves, Escape cancels.
 *
 * Events on the root (they bubble; see InlineEditList.ejs for the contract):
 *   kui:inline-edit-validate { draft, mode, items, respond }   respond(message | null | Promise) refuses or accepts
 *   kui:inline-edit-change   { next, change, respond }         respond(Promise) shows "saving"; reject = the row's error
 * The list changes only after the change is accepted. root.kuiInlineEditList.items() is a copy of the list and
 * .render() redraws it.
 *
 * A row that was drawn by the server keeps its server-drawn content node (an itemPartial survives a move or a
 * removal of another row); a row added or edited in the browser shows its `text`. Idempotent:
 * window.KuiInlineEditList.autoInit() mounts every [data-iel-root] once.
 */
(function (global) {
  'use strict';
  if (global.KuiInlineEditList) return;

  var BTN = 'inline-flex items-center rounded border border-border bg-surface-base px-2.5 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var SAVE_BTN = 'inline-flex items-center rounded border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus border-primary bg-primary text-primary-fg hover:bg-primary-hover';
  var ICON_BTN = 'flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var ROW_TAIL = ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var INPUT = 'w-full rounded-md border bg-surface-base px-2.5 py-1.5 text-sm text-text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(cls) { return el('i', { 'class': cls, 'aria-hidden': 'true' }); }
  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole;
    });
  }
  function errorMessage(e, fallback) { return e && e.message ? e.message : fallback; }
  function isThenable(v) { return v && typeof v.then === 'function'; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function mount(root) {
    if (root.kuiInlineEditList) return;
    var cfg;
    try { cfg = JSON.parse(root.getAttribute('data-iel-config') || '{}'); } catch (e) { cfg = {}; }
    var msg = cfg.messages || {};
    var ul = root.querySelector('ul');
    var statusEl = root.querySelector('[role="status"]');
    if (!ul || !statusEl) return;

    var state = {
      items: (cfg.items || []).slice(),
      rows: {},
      editing: null,
      activeId: cfg.items && cfg.items.length ? cfg.items[0].id : null,
      announce: '',
      counter: 0,
      focus: null
    };
    var contents = {};
    Array.prototype.forEach.call(ul.querySelectorAll('li[data-row-id]'), function (li) {
      var c = li.querySelector('[data-iel-content]');
      if (c) contents[li.getAttribute('data-row-id')] = c;
    });

    function nameOf(item) {
      var v = item[cfg.nameKey || 'text'];
      return (v != null ? String(v) : '') || msg.newItem;
    }
    function contentOf(item) {
      if (!contents[item.id]) contents[item.id] = el('div', { 'class': 'min-w-0 flex-1 break-words text-text-primary', 'data-iel-content': '' }, [item.text != null ? String(item.text) : '']);
      return contents[item.id];
    }
    function flags() {
      var quiet = !cfg.readOnly && !cfg.disabled;
      return {
        edit: cfg.editable && quiet,
        remove: cfg.removable && quiet,
        reorder: cfg.reorderable && quiet && state.items.length > 1,
        add: quiet && state.editing === null && (cfg.maxItems == null || state.items.length < cfg.maxItems)
      };
    }
    function activeId() {
      var id = state.activeId;
      for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return id;
      return state.items.length ? state.items[0].id : null;
    }
    function find(id) {
      for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return i;
      return -1;
    }
    function setRow(id, value) {
      if (value) state.rows[id] = value; else delete state.rows[id];
    }

    // ── Drawing ───────────────────────────────────────────────────────────────────────────────
    function iconBtn(act, ico, label, title, tab, disabled) {
      return el('button', { type: 'button', 'aria-label': label, title: title, tabindex: tab ? '0' : '-1', disabled: disabled, 'data-iel-act': act, 'class': ICON_BTN }, [icon('fa-solid ' + ico + ' h-3 w-3')]);
    }

    function editorRow(item, ed) {
      var inputId = cfg.idPrefix + '-input-' + ed.id;
      var errId = cfg.idPrefix + '-err-' + ed.id;
      var st = state.rows[ed.id];
      var saveError = st && st.status === 'error' ? st.message : undefined;
      var shown = ed.error != null ? ed.error : (saveError != null ? saveError : null);
      var input = el('input', {
        id: inputId,
        'aria-invalid': ed.error !== null ? 'true' : 'false',
        'aria-describedby': shown ? errId : null,
        'aria-label': item ? fill(msg.editAria, { name: nameOf(item) }) : msg.editorLabel,
        disabled: ed.saving,
        type: 'text',
        'class': INPUT + ' ' + (ed.error ? 'border-error' : 'border-border'),
        'data-iel-input': ''
      });
      input.value = ed.draft.text != null ? ed.draft.text : '';
      input.setAttribute('value', input.value);
      var save = el('button', { type: 'button', disabled: ed.saving, 'data-iel-act': 'save', 'class': SAVE_BTN }, [
        icon('fa-solid ' + (ed.saving ? 'fa-spinner' : 'fa-check') + ' me-1.5 h-3 w-3' + (ed.saving ? ' animate-spin motion-reduce:animate-none' : '')),
        ed.saving ? msg.saving : msg.save
      ]);
      var cancel = el('button', { type: 'button', disabled: ed.saving, 'data-iel-act': 'cancel', 'class': BTN }, [icon('fa-solid fa-xmark me-1.5 h-3 w-3'), msg.cancel]);
      var kids = [el('div', { 'class': 'flex flex-wrap items-start gap-2' }, [el('div', { 'class': 'min-w-48 flex-1' }, [input]), save, cancel])];
      if (shown) kids.push(el('p', { id: errId, role: 'alert', 'class': 'text-xs text-error-fg' }, [shown]));
      return el('div', { 'class': 'flex flex-col gap-1.5', 'data-iel-editor': '' }, kids);
    }

    function row(item, index, f, aId) {
      var ed = state.editing && state.editing.mode === 'edit' && state.editing.id === item.id ? state.editing : null;
      var st = state.rows[item.id];
      var name = nameOf(item);
      var isActive = aId === item.id;
      var saving = !!st && st.status === 'saving';
      var attrs = {
        'data-row-id': item.id,
        'data-state': st ? st.status : null,
        tabindex: ed ? '-1' : isActive ? '0' : '-1',
        'aria-busy': saving ? 'true' : null,
        'aria-label': ed ? null : name,
        'class': 'rounded-md border bg-surface-raised px-3 py-2 text-sm ' + (st && st.status === 'error' ? 'border-error' : 'border-border') + ROW_TAIL
      };
      var kids = [];
      if (ed) {
        kids.push(editorRow(item, ed));
      } else {
        var body = [contentOf(item)];
        if (saving) body.push(el('span', { 'class': 'inline-flex items-center gap-1 text-xs text-text-secondary' }, [icon('fa-solid fa-spinner h-3 w-3 animate-spin motion-reduce:animate-none'), msg.saving]));
        if (st && st.status === 'saved') body.push(el('span', { 'class': 'inline-flex items-center gap-1 text-xs text-success-fg' }, [icon('fa-solid fa-check h-3 w-3'), msg.saved]));
        var actions = [];
        if (f.reorder) {
          actions.push(iconBtn('up', 'fa-arrow-up', fill(msg.moveUpAria, { name: name }), msg.moveUp, isActive, index === 0 || saving));
          actions.push(iconBtn('down', 'fa-arrow-down', fill(msg.moveDownAria, { name: name }), msg.moveDown, isActive, index === state.items.length - 1 || saving));
        }
        if (f.edit) actions.push(iconBtn('edit', 'fa-pen', fill(msg.editAria, { name: name }), msg.edit, isActive, state.editing !== null || saving));
        if (f.remove) actions.push(iconBtn('remove', 'fa-trash', fill(msg.removeAria, { name: name }), msg.remove, isActive, saving));
        body.push(el('div', { 'class': 'flex shrink-0 items-center gap-1' }, actions));
        kids.push(el('div', { 'class': 'flex items-center gap-2' }, body));
      }
      if (!ed && st && st.status === 'error') kids.push(el('p', { role: 'alert', 'class': 'mt-1 text-xs text-error-fg' }, [st.message]));
      return el('li', attrs, kids);
    }

    function captureFocus() {
      var a = document.activeElement;
      if (!a || !root.contains(a)) return null;
      if (a.hasAttribute('data-iel-input')) return { input: true, start: a.selectionStart, end: a.selectionEnd };
      var li = a.closest('li[data-row-id]');
      var id = li ? li.getAttribute('data-row-id') : null;
      if (a === li) return { row: id };
      if (a.hasAttribute('data-iel-act')) return { row: id, act: a.getAttribute('data-iel-act') };
      return null;
    }
    function rowEl(id) {
      var lis = ul.querySelectorAll('li[data-row-id]');
      for (var i = 0; i < lis.length; i++) if (lis[i].getAttribute('data-row-id') === id) return lis[i];
      return null;
    }
    function applyFocus(f) {
      if (!f) return;
      if (f.input) {
        var input = root.querySelector('[data-iel-input]');
        if (!input) return;
        input.focus();
        var end = input.value.length;
        try { input.setSelectionRange(f.start != null ? f.start : end, f.end != null ? f.end : end); } catch (e) { /* not selectable */ }
        return;
      }
      var li = f.row != null ? rowEl(f.row) : null;
      if (!li) return;
      if (f.act) { var b = li.querySelector('[data-iel-act="' + f.act + '"]'); if (b && !b.disabled) { b.focus(); return; } }
      li.focus();
    }

    function render() {
      var captured = captureFocus();
      var f = flags();
      var aId = activeId();
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      state.items.forEach(function (item, i) { ul.appendChild(row(item, i, f, aId)); });
      var adding = state.editing && state.editing.mode === 'add' ? state.editing : null;
      if (adding) {
        ul.appendChild(el('li', { 'data-row-id': adding.id, 'data-new': 'true', 'aria-label': msg.newItem, 'class': 'rounded-md border border-primary bg-surface-raised px-3 py-2 text-sm' }, [editorRow(null, adding)]));
      }
      Array.prototype.slice.call(root.children).forEach(function (c) { if (c !== ul && c !== statusEl) root.removeChild(c); });
      if (state.items.length === 0 && !adding) root.insertBefore(el('p', { 'class': 'text-sm text-text-secondary' }, [msg.empty]), statusEl);
      if (!cfg.readOnly) {
        var foot = [el('button', { type: 'button', disabled: !f.add, 'data-iel-act': 'add', 'class': BTN }, [icon('fa-solid fa-plus me-1.5 h-3 w-3'), msg.add])];
        if (cfg.maxItems != null && state.items.length >= cfg.maxItems) foot.push(el('span', { 'class': 'text-xs text-text-secondary' }, [fill(msg.maxReached, { max: cfg.maxItems })]));
        root.insertBefore(el('div', { 'class': 'flex items-center gap-3' }, foot), statusEl);
      }
      statusEl.textContent = state.announce;
      var want = state.focus || captured;
      state.focus = null;
      applyFocus(want);
    }

    function syncTabindex() {
      var aId = activeId();
      Array.prototype.forEach.call(ul.querySelectorAll('li[data-row-id]:not([data-new])'), function (li) {
        var isActive = li.getAttribute('data-row-id') === aId && !li.querySelector('[data-iel-editor]');
        li.setAttribute('tabindex', isActive ? '0' : '-1');
        Array.prototype.forEach.call(li.querySelectorAll('[data-iel-act]'), function (b) {
          if (['up', 'down', 'edit', 'remove'].indexOf(b.getAttribute('data-iel-act')) !== -1) b.setAttribute('tabindex', isActive ? '0' : '-1');
        });
      });
    }

    function focusRow(id) {
      state.activeId = id;
      state.focus = { row: id };
      render();
    }

    // ── Events out ────────────────────────────────────────────────────────────────────────────
    // Fires the change event; resolves true when the host accepts it (no response, or a promise that resolves).
    function run(id, change, next, failMessage) {
      var response;
      var detail = { next: copy(next), change: copy(change), respond: function (r) { response = r; } };
      root.dispatchEvent(new CustomEvent('kui:inline-edit-change', { bubbles: true, detail: detail }));
      if (!isThenable(response)) return Promise.resolve(true);
      setRow(id, { status: 'saving' });
      render();
      return response.then(function () { return true; }, function (e) {
        setRow(id, { status: 'error', message: errorMessage(e, failMessage) });
        return false;
      });
    }
    function validate(draft, mode) {
      var response;
      var undecided = true;
      var detail = { draft: copy(draft), mode: mode, items: copy(state.items), respond: function (r) { response = r; undecided = false; } };
      root.dispatchEvent(new CustomEvent('kui:inline-edit-validate', { bubbles: true, detail: detail }));
      if (undecided) return Promise.resolve(draft.text && String(draft.text).trim() ? null : msg.required);
      return Promise.resolve(response).then(function (v) { return v; }, function (e) { return errorMessage(e, msg.saveFailed); });
    }

    // ── Editing ───────────────────────────────────────────────────────────────────────────────
    function startEdit(item) {
      if (!flags().edit || state.editing) return;
      setRow(item.id, null);
      state.editing = { id: item.id, mode: 'edit', draft: Object.assign({}, item), error: null, saving: false };
      state.focus = { input: true };
      render();
    }
    function startAdd() {
      if (!flags().add) return;
      var blank = Object.assign({ text: '' }, cfg.newItem || {}, { id: cfg.idPrefix + '-new-' + (++state.counter) });
      state.activeId = blank.id;
      state.editing = { id: blank.id, mode: 'add', draft: blank, error: null, saving: false };
      state.focus = { input: true };
      render();
    }
    function cancelEdit() {
      var ed = state.editing;
      if (!ed) return;
      state.editing = null;
      if (ed.mode === 'edit') focusRow(ed.id);
      else if (state.items.length) focusRow(state.items[state.items.length - 1].id);
      else render();
    }
    function flashSaved(id) {
      setRow(id, { status: 'saved' });
      setTimeout(function () {
        if (state.rows[id] && state.rows[id].status === 'saved') { delete state.rows[id]; render(); }
      }, 2000);
    }
    function commit() {
      var ed = state.editing;
      if (!ed || ed.saving) return Promise.resolve();
      var draft = ed.draft, mode = ed.mode, id = ed.id;
      return validate(draft, mode).then(function (problem) {
        if (state.editing !== ed) return;
        if (problem) { ed.error = problem; render(); return; }
        var next = mode === 'add' ? state.items.concat([draft]) : state.items.map(function (it) { return it.id === id ? draft : it; });
        ed.error = null;
        ed.saving = true;
        setRow(id, null);
        render();
        return run(id, { type: mode, id: id, item: draft }, next, msg.saveFailed).then(function (ok) {
          if (ok) {
            state.items = next;
            delete contents[id];
            state.editing = null;
            setRow(id, null);
            flashSaved(id);
            state.announce = mode === 'add' ? fill(msg.addedAnnounce, { name: nameOf(draft) }) : msg.saved;
            focusRow(id);
          } else {
            ed.saving = false;
            ed.error = null;
            state.focus = { input: true }; // a disabled input loses focus: give it back so the user can retry
            render();
          }
        });
      });
    }

    // ── Remove and reorder ────────────────────────────────────────────────────────────────────
    function isSaving(id) { return !!state.rows[id] && state.rows[id].status === 'saving'; }
    function remove(item) {
      if (!flags().remove || isSaving(item.id)) return;
      var index = find(item.id);
      var before = state.items;
      run(item.id, { type: 'remove', id: item.id, item: item }, before.filter(function (i) { return i.id !== item.id; }), msg.removeFailed).then(function (ok) {
        if (!ok) { render(); return; }
        state.items = before.filter(function (i) { return i.id !== item.id; });
        delete contents[item.id];
        setRow(item.id, null);
        state.announce = fill(msg.removedAnnounce, { name: nameOf(item) });
        var neighbour = before[index + 1] || before[index - 1];
        if (neighbour) focusRow(neighbour.id); else render();
      });
    }
    function move(item, delta) {
      if (!flags().reorder || isSaving(item.id)) return;
      var from = find(item.id);
      var to = from + delta;
      if (from < 0 || to < 0 || to >= state.items.length) return;
      var next = state.items.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      run(item.id, { type: 'reorder', id: item.id, item: item, from: from, to: to }, next, msg.reorderFailed).then(function (ok) {
        if (!ok) { render(); return; }
        state.items = next;
        setRow(item.id, null);
        state.announce = fill(msg.movedAnnounce, { name: nameOf(item), position: to + 1, total: next.length });
        focusRow(item.id);
      });
    }

    // ── Keys and clicks (delegated: the rows are redrawn) ─────────────────────────────────────
    function rowOf(target) {
      var li = target.closest ? target.closest('li[data-row-id]') : null;
      if (!li || li.hasAttribute('data-new')) return null;
      var i = find(li.getAttribute('data-row-id'));
      return i === -1 ? null : { item: state.items[i], index: i, li: li };
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-iel-act]') : null;
      if (!b || !root.contains(b) || b.disabled) return;
      var act = b.getAttribute('data-iel-act');
      var r = rowOf(b);
      if (act === 'add') startAdd();
      else if (act === 'save') commit();
      else if (act === 'cancel') cancelEdit();
      else if (act === 'edit' && r) startEdit(r.item);
      else if (act === 'remove' && r) remove(r.item);
      else if (act === 'up' && r) move(r.item, -1);
      else if (act === 'down' && r) move(r.item, 1);
    });

    root.addEventListener('keydown', function (e) {
      var editor = e.target.closest ? e.target.closest('[data-iel-editor]') : null;
      if (editor) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
        else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); commit(); }
        return;
      }
      var r = rowOf(e.target);
      if (!r || e.target !== r.li) return; // keys inside a button belong to it
      var go = function (i) { var t = state.items[Math.min(Math.max(i, 0), state.items.length - 1)]; if (t) focusRow(t.id); };
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { move(r.item, e.key === 'ArrowUp' ? -1 : 1); e.preventDefault(); return; }
      switch (e.key) {
        case 'ArrowDown': go(r.index + 1); break;
        case 'ArrowUp': go(r.index - 1); break;
        case 'Home': go(0); break;
        case 'End': go(state.items.length - 1); break;
        case 'Enter':
        case 'F2': startEdit(r.item); break;
        case 'Delete': remove(r.item); break;
        default: return;
      }
      e.preventDefault();
    });

    root.addEventListener('input', function (e) {
      if (!e.target.hasAttribute || !e.target.hasAttribute('data-iel-input') || !state.editing) return;
      var ed = state.editing;
      ed.draft = Object.assign({}, ed.draft, { text: e.target.value });
      if (ed.error !== null) { ed.error = null; render(); }
    });

    root.addEventListener('focusin', function (e) {
      var li = e.target.closest ? e.target.closest('li[data-row-id]:not([data-new])') : null;
      if (li && e.target === li && state.activeId !== li.getAttribute('data-row-id')) {
        state.activeId = li.getAttribute('data-row-id');
        syncTabindex();
      }
    });

    root.kuiInlineEditList = { items: function () { return copy(state.items); }, render: render };
  }

  function autoInit() {
    var roots = document.querySelectorAll('[data-iel-root]');
    for (var i = 0; i < roots.length; i++) mount(roots[i]);
  }

  global.KuiInlineEditList = { autoInit: autoInit, mount: mount };
})(window);
