/*
 * modules/ui/Table/scripts/data-table.js
 *
 * Browser runtime of the DataTable partial (modules/ui/Table/partials/paginated.ejs): client-side search,
 * sort, per-column filters and paging (static / paginated modes), fetching (server mode) or reporting the
 * query to the host (manual mode), row selection keyed by row id, expandable rows, keyboard rows, the
 * filter panel and its active-filter chips, and the card layout. Behaviour mirrors kui-react
 * modules/ui/Table/DataTable.tsx; the pure parts are in table-logic.js (window.KuiDataTableLogic).
 *
 * window.KuiDataTable.init(config) starts one table; config is written by the partial.
 */
(function () {
  'use strict';
  var L = window.KuiDataTableLogic;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function fire(el, type, detail) { el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: detail })); }
  function call(name, arg) { if (name && typeof window[name] === 'function') window[name](arg); }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  /** Controls whose own click and keys a row must leave alone (kui-react parts/BodyRow.tsx). */
  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="menuitem"],[role="checkbox"],[contenteditable="true"]';
  var CHIP_CLASS = 'inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-raised py-0.5 pl-2.5 pr-1 text-xs text-text-primary';
  var CHIP_BUTTON_CLASS = 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var ROW_CLASS = 'hover:bg-surface-overlay transition-[background-color,opacity] duration-500';
  var ROW_FOCUS_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus';
  var CHECKBOX_CLASS = 'h-4 w-4 rounded border-border text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed';

  /** innerHTML does not run scripts; recreate them so inserted atoms start. */
  function runScripts(container) {
    Array.prototype.slice.call(container.querySelectorAll('script')).forEach(function (old) {
      if (old.type && old.type !== 'text/javascript' && old.type !== 'module') return;
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      s.text = old.text;
      old.parentNode.replaceChild(s, old);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Filter-panel controls: read and write a field's value through the atom inside its cell.
  // ---------------------------------------------------------------------------------------------

  function readField(cell, def, customValues) {
    switch (def.type) {
      case 'text': { var t = cell.querySelector('input'); return t ? t.value : ''; }
      case 'number': {
        var n = cell.querySelector('input');
        return !n || n.value === '' ? null : Number(n.value);
      }
      case 'numberrange': {
        var lo = cell.querySelector('input[id$="-min"]');
        var hi = cell.querySelector('input[id$="-max"]');
        return {
          min: !lo || lo.value === '' ? null : Number(lo.value),
          max: !hi || hi.value === '' ? null : Number(hi.value)
        };
      }
      case 'select': {
        var sel = cell.querySelector('select') || cell.querySelector('[data-combobox-value]');
        return sel ? sel.value : '';
      }
      case 'multiselect': {
        var ms = cell.querySelector('[data-multiselect-root]');
        if (ms && ms.kuiMultiSelect) return ms.kuiMultiSelect.getValue();
        return Array.prototype.slice.call(cell.querySelectorAll('[data-multiselect-option][aria-selected="true"]'))
          .map(function (o) { return o.getAttribute('data-value'); });
      }
      case 'checkboxes':
        return Array.prototype.slice.call(cell.querySelectorAll('input[type="checkbox"]'))
          .filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
      case 'radio': {
        var r = cell.querySelector('input[type="radio"]:checked');
        return r ? r.value : '';
      }
      case 'checkbox': { var c = cell.querySelector('input[type="checkbox"]'); return !!(c && c.checked); }
      case 'date': {
        var d = cell.querySelector('[data-kui-input]');
        return d && d.value ? d.value : null;
      }
      case 'daterange': {
        var a = cell.querySelector('[data-kui-input="start"]');
        var b = cell.querySelector('[data-kui-input="end"]');
        return { from: a && a.value ? a.value : null, to: b && b.value ? b.value : null };
      }
      case 'range': {
        var rlo = cell.querySelector('[data-rangeslider-handle="min"]');
        var rhi = cell.querySelector('[data-rangeslider-handle="max"]');
        return [rlo ? Number(rlo.value) : def.min, rhi ? Number(rhi.value) : def.max];
      }
      default:
        return customValues[def.id];
    }
  }

  /** Writes a value into the atom; native controls get the events the atoms repaint on. */
  function writeField(cell, def, value) {
    function set(input, prop, v, type) {
      if (!input || input[prop] === v) return;
      input[prop] = v;
      input.dispatchEvent(new Event(type || 'change', { bubbles: true }));
    }
    switch (def.type) {
      case 'text': set(cell.querySelector('input'), 'value', typeof value === 'string' ? value : '', 'input'); break;
      case 'number': set(cell.querySelector('input'), 'value', typeof value === 'number' ? String(value) : '', 'input'); break;
      case 'numberrange': {
        var nr = value && typeof value === 'object' ? value : {};
        set(cell.querySelector('input[id$="-min"]'), 'value', typeof nr.min === 'number' ? String(nr.min) : '', 'input');
        set(cell.querySelector('input[id$="-max"]'), 'value', typeof nr.max === 'number' ? String(nr.max) : '', 'input');
        break;
      }
      case 'select': {
        var sel = cell.querySelector('select');
        if (sel) set(sel, 'value', typeof value === 'string' ? value : '');
        break;
      }
      case 'multiselect': {
        var ms = cell.querySelector('[data-multiselect-root]');
        if (ms && ms.kuiMultiSelect) ms.kuiMultiSelect.setValue(Array.isArray(value) ? value : []);
        break;
      }
      case 'checkboxes': {
        var list = Array.isArray(value) ? value : [];
        cell.querySelectorAll('input[type="checkbox"]').forEach(function (i) { set(i, 'checked', list.indexOf(i.value) !== -1); });
        break;
      }
      case 'radio': {
        var want = typeof value === 'string' ? value : '';
        cell.querySelectorAll('input[type="radio"]').forEach(function (i) { if (i.value === want) set(i, 'checked', true); });
        break;
      }
      case 'checkbox': set(cell.querySelector('input[type="checkbox"]'), 'checked', value === true); break;
      case 'date':
      case 'daterange': {
        var dp = cell.querySelector('[data-kui-datepicker-root]');
        if (dp && dp.kuiDatePicker) {
          dp.kuiDatePicker.setValue(def.type === 'date'
            ? (typeof value === 'string' ? value : null)
            : { start: value && value.from ? value.from : null, end: value && value.to ? value.to : null });
        }
        break;
      }
      case 'range': {
        var v = Array.isArray(value) ? value : [def.min, def.max];
        // The max handle first when raising, so the min handle is never clamped by the old max.
        var lo = cell.querySelector('[data-rangeslider-handle="min"]');
        var hi = cell.querySelector('[data-rangeslider-handle="max"]');
        set(hi, 'value', String(v[1]), 'input');
        set(lo, 'value', String(v[0]), 'input');
        set(hi, 'value', String(v[1]), 'input');
        break;
      }
      default:
        cell.dispatchEvent(new CustomEvent('kui:dt-filter-set', { detail: { value: value === undefined ? null : value } }));
    }
  }

  /** The date-range presets of a cell follow its value (kui-react: variant primary + aria-pressed). */
  function paintPresets(cell, value) {
    var box = cell.querySelector('[data-part="date-presets"]');
    if (!box) return;
    var on = box.getAttribute('data-dt-preset-on') || '';
    var off = box.getAttribute('data-dt-preset-off') || '';
    box.querySelectorAll('[data-dt-preset-from]').forEach(function (b) {
      var from = b.getAttribute('data-dt-preset-from') || null;
      var to = b.getAttribute('data-dt-preset-to') || null;
      var pressed = !!value && value.from === from && value.to === to;
      b.className = pressed ? on : off;
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------------------------

  function init(cfg) {
    var root = document.getElementById(cfg.id);
    if (!root || root.__kuiDataTable) return;
    var M = cfg.msgs;
    var mode = cfg.mode;
    var isServer = mode === 'server';
    var isManual = mode === 'manual';
    var isStatic = mode === 'static';
    var COLS = cfg.cols;
    var cards = !!cfg.cards;
    var mappers = L.sortMappers(COLS);
    var fmt = L.formatMessage;

    var bodyEl    = root.querySelector('[data-dt-body]');
    var scrollEl  = root.querySelector('[data-dt-scroll]');
    var headEl    = cards ? null : scrollEl.querySelector(':scope > table > thead');
    var footEl    = cards ? null : scrollEl.querySelector(':scope > table > tfoot');
    var statusEl  = root.querySelector('[data-dt-status]');
    var pagerEl   = root.querySelector('[data-dt-pagination]');
    var searchEl  = document.getElementById(cfg.id + '-search');
    var pageSizeEl = root.querySelector('[data-dt-pagesize]');
    var sortByEl  = root.querySelector('[data-dt-sort-by]');
    var selectAll = root.querySelector('[data-dt-select-all]');
    var summary   = root.querySelector('[data-dt-selection-summary]');
    var countEl   = root.querySelector('[data-dt-selected-count]');
    var toggleBtn = root.querySelector('[data-dt-filter-toggle]');
    var panel     = root.querySelector('[data-dt-filter-panel]');
    var chipsEl   = root.querySelector('[data-dt-chips]');
    var controlsEl = root.querySelector('[data-dt-controls]');
    var cardsWrap = root.querySelector('[data-dt-cards-wrap]');

    // The table's own query; manual mode overlays the controlled fields (`query`) the host feeds back.
    var state = {
      search: cfg.search || '',
      page: cfg.page || 1,
      pageSize: cfg.pageSize,
      sort: clone(cfg.sort || []),
      filters: clone(cfg.filters || {})
    };
    var ctl = {};
    if (isManual && cfg.controlledQuery) {
      cfg.controlledQuery.forEach(function (k) { if (has(state, k)) ctl[k] = clone(state[k]); });
    }
    function q() { return Object.assign({}, state, ctl); }

    var selected = (cfg.selected || []).slice();
    var expanded = {};                // row-id key -> true
    var rowEls = [];                  // client modes: every row, by index in `rows`; else the page shown
    var shownIds = [];                // ids of the rows shown, in order
    var shownRows = [];               // the rows shown
    var shownStart = 1;               // number of the first row shown (1-based, in the whole result)
    var focusKey = null;              // keyboard rows: the row that keeps the tab stop
    var userSorted = false;           // priority numbers show only once the user sorts (kui-react 11.16)
    var serverTotal = cfg.ssrTotal === null || cfg.ssrTotal === undefined ? 0 : cfg.ssrTotal;
    var everLoaded = cfg.ssrTotal !== null && cfg.ssrTotal !== undefined;
    var reqSeq = 0;
    var controller = null;
    var reloadKey = cfg.reloadKey;
    var manual = { total: cfg.total, loading: !!cfg.loading, error: cfg.error };
    var overridden = !!(cfg.stateOverride && cfg.stateOverride !== 'ready');

    // Filter panel state (declared before the first render reads it).
    var filtersOn = !!cfg.filtersEnabled;
    var fields = [];
    var applied = clone(cfg.applied || {});
    var draft = clone(applied);
    var customValues = {};
    var syncing = false;
    var grid = panel ? panel.querySelector('[data-dt-filter-grid]') : null;

    // --- rows ------------------------------------------------------------------------------------

    function scanRows() {
      rowEls = Array.prototype.slice.call(bodyEl.querySelectorAll(':scope > [data-dt-row]'));
      // Column chooser: rows a host drew (Rows.ejs without columnChooser) get data-dt-col too, in column order after
      // the selection and expand cells, so the rule that hides a column hides its cells.
      if (cfg.columnChooser) {
        rowEls.forEach(function (tr) {
          var cells = Array.prototype.filter.call(tr.children, function (td) {
            var part = td.getAttribute('data-part');
            return part !== 'select' && part !== 'expand';
          });
          COLS.forEach(function (col, i) {
            if (cells[i] && !cells[i].hasAttribute('data-dt-col')) cells[i].setAttribute('data-dt-col', String(col.key));
          });
        });
      }
      // The selection and expand cells keep their clicks from a row click handler (kui-react
      // RowExtras stops propagation). The table's own handlers listen on the body in the capture phase.
      bodyEl.querySelectorAll('td[data-part="select"], td[data-part="expand"]').forEach(function (td) {
        if (td.__kuiDtStop) return;
        td.__kuiDtStop = true;
        td.addEventListener('click', function (e) { e.stopPropagation(); });
      });
    }
    function isLockedEl(el) { return !!el && el.hasAttribute('data-dt-locked'); }
    /** Ids of every locked row in the DOM (all rows in client modes, the page otherwise). */
    function lockedKeys() {
      return Array.prototype.slice.call(bodyEl.querySelectorAll(':scope > [data-dt-locked]')).map(function (el) { return L.keyOf(rowIdOf(el)); });
    }
    /** The selection without locked rows: what is counted and handed to bulk actions. */
    function countedSelection() {
      var locked = lockedKeys();
      return selected.filter(function (id) { return locked.indexOf(L.keyOf(id)) === -1; });
    }
    function rowIdOf(el) {
      try { return JSON.parse(el.getAttribute('data-dt-row-id')); } catch (e) { return el.getAttribute('data-dt-row-id'); }
    }
    function detailOf(tr) {
      var btn = tr.querySelector('[data-dt-expand]');
      return btn ? document.getElementById(btn.getAttribute('data-dt-expand')) : null;
    }
    /** The state rows (table) or blocks (card layout) next to the rows. */
    function stateEls() {
      var box = cards ? scrollEl : bodyEl;
      return Array.prototype.slice.call(box.querySelectorAll(':scope > [data-dt-empty], :scope > [data-dt-state-row]'));
    }
    function clearStateRows() {
      stateEls().forEach(function (r) { r.parentNode.removeChild(r); });
      if (cards) bodyEl.classList.remove('hidden');
    }
    /** Loading / empty / error (kui-react parts/EmptyState.tsx StateRow and StateBlock). */
    function showState(kind, message) {
      clearStateRows();
      var retry = kind === 'error' && cfg.retry ? cfg.retryHtml : '';
      var loadingHtml = '<span class="inline-flex items-center gap-2">' + (cfg.spinnerHtml || '') + esc(message) + '</span>';
      if (cards) {
        var div = document.createElement('div');
        if (kind === 'error') div.setAttribute('role', 'alert');
        div.className = 'rounded-lg border border-border px-4 py-10 text-center text-sm '
          + (kind === 'error' ? 'text-error-fg bg-error-subtle' : 'text-text-secondary');
        div.setAttribute('data-part', 'state');
        div.setAttribute(kind === 'empty' ? 'data-dt-empty' : 'data-dt-state-row', '');
        div.innerHTML = '<span class="inline-flex flex-col items-center gap-2">'
          + (kind === 'loading' ? loadingHtml : '<span>' + esc(message) + '</span>') + retry + '</span>';
        scrollEl.insertBefore(div, bodyEl);
        bodyEl.classList.add('hidden');
        return;
      }
      var tr = document.createElement('tr');
      tr.setAttribute(kind === 'empty' ? 'data-dt-empty' : 'data-dt-state-row', '');
      var td = document.createElement('td');
      td.colSpan = cfg.colCount;
      td.className = kind === 'error'
        ? 'px-4 py-10 text-center text-sm text-error-fg bg-error-subtle'
        : 'px-4 py-10 text-center text-sm text-text-secondary';
      if (kind === 'loading') td.innerHTML = loadingHtml;
      else if (kind === 'error') {
        td.setAttribute('role', 'alert');
        td.innerHTML = '<span class="inline-flex flex-col items-center gap-2"><span>' + esc(message) + '</span>' + retry + '</span>';
      } else td.textContent = message;
      tr.appendChild(td);
      bodyEl.appendChild(tr);
    }

    /** A later load is running: the rows stay on screen under a spinner overlay. */
    function setBusy(on) {
      var el = scrollEl.querySelector(':scope > [data-part="busy"]');
      var show = !!on && shownRows.length > 0 && stateEls().length === 0;
      if (show && !el && cfg.busyHtml) scrollEl.insertAdjacentHTML('afterbegin', cfg.busyHtml);
      if (!show && el) el.parentNode.removeChild(el);
      if (show) scrollEl.setAttribute('aria-busy', 'true'); else scrollEl.removeAttribute('aria-busy');
    }

    /** Selection marks, the "Select row N" labels and the open detail rows of the rows shown. */
    function paintRows(shown, startNumber) {
      // Group rows: the rows of one group together, groups in the order they first appear (kui-react groupShown).
      if (cfg.groups) {
        shown = L.groupItems(shown, function (el) { return el.getAttribute('data-dt-group') || ''; },
          shown.map(function (el) { return el.getAttribute('data-dt-group') || ''; }));
      }
      shownRows = shown;
      shownStart = startNumber;
      shownIds = shown.map(rowIdOf);
      var keys = selected.map(L.keyOf);
      shown.forEach(function (el, i) {
        var id = shownIds[i];
        var isSel = cfg.selectable && (isLockedEl(el) || keys.indexOf(L.keyOf(id)) !== -1);
        if (isSel) el.setAttribute('data-selected', 'true'); else el.removeAttribute('data-selected');
        if (cards) return;
        el.classList.toggle('bg-primary-subtle', isSel || el.getAttribute('data-state') === 'new');
        if (isSel) el.setAttribute('aria-selected', 'true'); else el.removeAttribute('aria-selected');
        var cb = el.querySelector('[data-dt-select]');
        if (cb) {
          cb.checked = isSel;
          if (!cb.hasAttribute('data-dt-own-label')) cb.setAttribute('aria-label', M.selectRow + ' ' + (startNumber + i));
        }
        var btn = el.querySelector('[data-dt-expand]');
        var detail = detailOf(el);
        var open = !!(btn && expanded[L.keyOf(id)]);
        if (btn) {
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          btn.setAttribute('aria-label', open ? M.collapseRow : M.expandRow);
          if (open) btn.setAttribute('aria-controls', btn.getAttribute('data-dt-expand'));
          else btn.removeAttribute('aria-controls');
          var icon = btn.querySelector('[data-dt-expand-icon]');
          if (icon) {
            icon.classList.toggle('fa-chevron-down', open);
            icon.classList.toggle('fa-chevron-right', !open);
          }
        }
        if (detail) {
          detail.classList.toggle('hidden', !open);
          detail.style.display = '';
        }
      });
      layoutBody(shown);
      paintKeyboard();
      paintHeader();
    }

    /**
     * Rows that are not shown (and closed detail rows) go first, then each shown row with its open
     * detail row: the last row on screen stays the body's last child, so `divide-y` draws no border
     * under it, as in kui-react where hidden rows are not in the DOM at all.
     */
    function groupHeaderEl(el, first) {
      var label = el.getAttribute('data-dt-group-label') || esc(el.getAttribute('data-dt-group') || '');
      if (cards) {
        // A heading item across the grid: -mb-1 / mt-1 give kui-react's 0.5rem under the heading and 1rem between
        // groups over the grid's 0.75rem gap.
        var li = document.createElement('li');
        li.className = 'col-span-full -mb-1' + (first ? '' : ' mt-1');
        li.setAttribute('data-dt-group-header', '');
        li.innerHTML = '<h4 class="text-xs font-semibold uppercase tracking-wider text-text-secondary" data-part="group-header">' + label + '</h4>';
        return li;
      }
      var tr = document.createElement('tr');
      tr.setAttribute('data-part', 'group-header');
      tr.setAttribute('data-dt-group-header', '');
      if (!cfg.unstyled) tr.className = 'bg-surface-raised';
      var th = document.createElement('th');
      th.setAttribute('scope', 'rowgroup');
      th.colSpan = cfg.colCount;
      if (cfg.groupHeadClass) th.className = cfg.groupHeadClass;
      th.innerHTML = label;
      tr.appendChild(th);
      return tr;
    }

    function layoutBody(shown) {
      Array.prototype.slice.call(bodyEl.querySelectorAll(':scope > [data-dt-group-header]')).forEach(function (h) { h.parentNode.removeChild(h); });
      var frag = document.createDocumentFragment();
      rowEls.forEach(function (tr) {
        if (shown.indexOf(tr) !== -1) return;
        tr.style.display = 'none';
        frag.appendChild(tr);
        var d = detailOf(tr);
        if (d) { d.style.display = 'none'; frag.appendChild(d); }
      });
      shown.forEach(function (tr) {
        var d = detailOf(tr);
        if (d && d.classList.contains('hidden')) frag.appendChild(d);
      });
      var lastGroup = null;
      shown.forEach(function (tr, i) {
        if (cfg.groups) {
          var g = tr.getAttribute('data-dt-group') || '';
          if (i === 0 || g !== lastGroup) frag.appendChild(groupHeaderEl(tr, i === 0));
          lastGroup = g;
        }
        tr.style.display = '';
        frag.appendChild(tr);
        var d = detailOf(tr);
        if (d && !d.classList.contains('hidden')) frag.appendChild(d);
      });
      bodyEl.insertBefore(frag, bodyEl.firstChild);
    }

    /** Keyboard rows: the focused row while it is shown, else the first, is the one in the tab order. */
    function paintKeyboard() {
      if (!cfg.keyboard || cards) return;
      var keys = shownRows.map(function (tr) { return tr.getAttribute('data-row-key'); });
      var tabKey = focusKey !== null && keys.indexOf(focusKey) !== -1 ? focusKey : (keys[0] === undefined ? null : keys[0]);
      rowEls.forEach(function (tr) {
        var on = shownRows.indexOf(tr) !== -1 && tr.getAttribute('data-row-key') === tabKey;
        tr.setAttribute('tabindex', on ? '0' : '-1');
      });
    }
    function focusRow(index) {
      if (shownRows.length === 0) return;
      var tr = shownRows[Math.max(0, Math.min(shownRows.length - 1, index))];
      focusKey = tr.getAttribute('data-row-key');
      paintKeyboard();
      tr.focus();
    }

    /** Ids of the rows shown whose checkbox is enabled (`isRowSelectable`). */
    function selectableShownIds() {
      return shownRows.filter(function (el) {
        var cb = el.querySelector('[data-dt-select]');
        return !!cb && !cb.disabled;
      }).map(rowIdOf);
    }

    function paintHeader() {
      if (selectAll) {
        var h = L.headerState(selected, selectableShownIds());
        selectAll.checked = h.checked;
        selectAll.indeterminate = h.indeterminate;
        selectAll.disabled = h.disabled;
      }
      if (summary) {
        var counted = countedSelection().length;
        summary.classList.toggle('hidden', counted === 0);
        if (countEl) countEl.textContent = L.fillCount(M.selectedCount, counted);
      }
      paintControls();
    }

    /** The footer row shows only beside rows (kui-react: status "ready"). */
    function paintFooter() {
      if (footEl) footEl.classList.toggle('hidden', !(shownRows.length > 0 && stateEls().length === 0));
    }

    /** Card variant: the padded controls block hides while all of its parts are hidden. */
    function paintControls() {
      if (!controlsEl) return;
      var any = Array.prototype.some.call(controlsEl.children, function (c) {
        return c.tagName !== 'SCRIPT' && !c.classList.contains('hidden');
      });
      controlsEl.classList.toggle('hidden', !any);
      if (cardsWrap) cardsWrap.classList.toggle('pt-4', !any);
    }

    function emptyText(search) {
      return search ? fmt(M.noResultsFor, { search: search }) : cfg.emptyMessage;
    }

    function rangeText(start, end, total) {
      return total === 0 ? M.noResults : fmt(M.showingRange, { start: start, end: end, total: total });
    }

    // --- client modes: filter, sort, page ------------------------------------------------------

    function filteredIndices() {
      var cur = q();
      var query = (cur.search || '').trim().toLowerCase();
      var keys = Object.keys(cur.filters);
      var active = filtersOn ? L.activeFilterValues(fields, applied) : {};
      var useActive = Object.keys(active).length > 0;
      var matchers = {};
      fields.forEach(function (f) { if (f.match && typeof window[f.match] === 'function') matchers[f.id] = window[f.match]; });
      var out = [];
      for (var i = 0; i < cfg.rowsData.length; i++) {
        // Every searchable column and searchText, drawn into one text per row (kui-react applySearch).
        var matchSearch = !query || String(cfg.rowsData[i].__s || '').indexOf(query) !== -1;
        if (!matchSearch) continue;
        var matchFilters = true;
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var col = colOf(key);
          var fv = (cur.filters[key] || '').toLowerCase();
          if (!fv) continue;
          var raw = cfg.rowsData[i][key];
          var target = String(raw === undefined || raw === null ? '' : raw).toLowerCase();
          if (col && col.filter && col.filter.kind === 'select') {
            if (target !== fv) { matchFilters = false; break; }
          } else if (target.indexOf(fv) === -1) { matchFilters = false; break; }
        }
        if (!matchFilters) continue;
        if (useActive && !L.matchRow(fields, active, cfg.filterData[i], matchers)) continue;
        out.push(i);
      }
      return out;
    }

    function sortedIndices(indices) {
      // kui-react applySort: numbers by value, empty cells last in both directions.
      var out = L.sortIndices(indices, cfg.rowsData, q().sort);
      if (!cfg.groups) return out;
      // Groups in the order they first appear in `rows`, the sort applied within each (kui-react applyGrouping).
      var order = cfg.rowsData.map(function (r) { return r.__g || ''; });
      return L.groupItems(out, function (i) { return cfg.rowsData[i].__g || ''; }, order);
    }

    function renderClient() {
      if (overridden) { renderSortIcons(); paintChips(); return; }
      var cur = q();
      var idx = sortedIndices(filteredIndices());
      var totalFiltered = idx.length;
      var pageSize = isStatic ? Math.max(totalFiltered, 1) : cur.pageSize;
      var totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
      if (state.page > totalPages) state.page = totalPages;
      var page = isStatic ? 1 : state.page;
      var start = totalFiltered === 0 ? 0 : (page - 1) * pageSize;
      var end = Math.min(start + pageSize, totalFiltered);
      var pageIndices = idx.slice(start, end);

      clearStateRows();
      var shown = [];
      pageIndices.forEach(function (rowIdx) { if (rowEls[rowIdx]) shown.push(rowEls[rowIdx]); });
      paintRows(shown, start + 1);
      if (shown.length === 0) showState('empty', emptyText(totalFiltered === 0 ? cur.search : ''));
      paintFooter();

      if (statusEl) {
        statusEl.textContent = rangeText(start + 1, end, totalFiltered)
          + (cur.search && totalFiltered > 0 && totalFiltered !== cfg.rowsCount ? ' ' + fmt(M.filteredFrom, { total: cfg.rowsCount }) : '');
      }
      if (cfg.paginated) renderPager(page, totalPages);
      renderSortIcons();
      paintChips();
    }

    // --- server mode -------------------------------------------------------------------------------

    function plainRowsHtml(rows, offset) {
      if (cards) return ''; // a card is drawn by renderCard on the server: answer with { html }
      var trailing = cfg.colCount - (cfg.selectable ? 1 : 0) - (cfg.expandable ? 1 : 0) - COLS.length;
      return rows.map(function (row, i) {
        var own = row && row.id;
        var id = (typeof own === 'string' || typeof own === 'number') ? own : offset + i;
        var cells = '';
        if (cfg.selectable) {
          cells += '<td class="w-10 px-4 py-3" data-part="select">'
            + '<input type="checkbox" aria-label="' + esc(M.selectRow + ' ' + (offset + i + 1)) + '" data-dt-select class="' + CHECKBOX_CLASS + '"></td>';
        }
        if (cfg.expandable) cells += '<td class="w-10 px-4 py-3" data-part="expand"></td>';
        COLS.forEach(function (col) {
          var v = row[col.key];
          cells += '<td class="' + esc(col.cellClass) + '" data-dt-key="' + esc(col.key) + '"'
            + (cfg.columnChooser ? ' data-dt-col="' + esc(col.key) + '"' : '') + '>' + esc(v === undefined || v === null ? '' : v) + '</td>';
        });
        if (trailing > 0) cells += '<td class="w-12 px-2 py-2 text-right"></td>'; // plain rows carry no actions
        var cls = (cfg.unstyled ? '' : ROW_CLASS) + (cfg.rowClick || cfg.rowDoubleClick ? ' cursor-pointer' : '') + (cfg.keyboard ? ' ' + ROW_FOCUS_CLASS : '');
        return '<tr class="' + cls + '" data-dt-row="' + i + '" data-dt-row-id="' + esc(JSON.stringify(id)) + '" data-row-key="' + esc(String(id)) + '"'
          + (cfg.keyboard ? ' tabindex="-1"' : '') + '>' + cells + '</tr>';
      }).join('');
    }

    function wireArgs() {
      var cur = q();
      return {
        page: cur.page,
        pageSize: cur.pageSize,
        sort: mappers.toWire(cur.sort),
        search: cur.search,
        filters: clone(cur.filters),
        filterValues: filtersOn ? L.activeFilterValues(fields, applied) : {}
      };
    }

    function load() {
      if (controller) controller.abort();
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      controller = ctrl;
      var id = ++reqSeq;
      var args = wireArgs();
      fire(root, 'kui:dt-request', { args: args });
      if (!overridden) {
        // Only the very first load shows the loading row; later ones keep the rows under a spinner.
        if (everLoaded && shownRows.length > 0 && stateEls().length === 0) setBusy(true);
        else {
          bodyEl.innerHTML = '';
          rowEls = [];
          paintRows([], 1);
          showState('loading', cfg.loadingMessage);
          paintFooter();
        }
      }
      var p;
      try {
        if (cfg.fetchPage) {
          var fn = window[cfg.fetchPage];
          var withSignal = clone(args);
          if (ctrl) withSignal.signal = ctrl.signal;
          p = typeof fn === 'function' ? Promise.resolve(fn(withSignal)) : Promise.reject(new Error('fetchPage "' + cfg.fetchPage + '" is not a function'));
        } else {
          var url = cfg.fetchUrl + (cfg.fetchUrl.indexOf('?') === -1 ? '?' : '&') + L.fetchQuery(args);
          var init = { headers: { Accept: 'application/json' }, credentials: 'same-origin' };
          if (ctrl) init.signal = ctrl.signal;
          p = fetch(url, init).then(function (r) {
            if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
            return r.json();
          });
        }
      } catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        if (id !== reqSeq || (ctrl && ctrl.signal.aborted)) return;
        res = res || {};
        serverTotal = Number(res.total) || 0;
        everLoaded = true;
        call(cfg.onLoaded, res);
        fire(root, 'kui:dt-loaded', { total: serverTotal });
        // The last page can empty out (rows deleted elsewhere): step back to the new last page.
        var totalPages = Math.max(1, Math.ceil(serverTotal / state.pageSize));
        if (state.page > totalPages) { state.page = totalPages; load(); return; }
        if (overridden) return;
        var offset = (state.page - 1) * state.pageSize;
        var html = typeof res.html === 'string' ? res.html : plainRowsHtml(Array.isArray(res.rows) ? res.rows : [], offset);
        setBusy(false);
        bodyEl.innerHTML = html;
        runScripts(bodyEl);
        scanRows();
        clearStateRows();
        paintRows(rowEls, offset + 1);
        if (rowEls.length === 0) showState('empty', emptyText(state.search));
        paintFooter();
        renderServerFooter();
      }, function (err) {
        if (id !== reqSeq || (ctrl && ctrl.signal.aborted)) return;
        if (overridden) return;
        setBusy(false);
        bodyEl.innerHTML = '';
        rowEls = [];
        paintRows([], 1);
        showState('error', cfg.errorMessage || (err && err.message) || M.error);
        paintFooter();
      });
      renderSortIcons();
      paintChips();
    }

    function renderServerFooter() {
      var totalPages = Math.max(1, Math.ceil(serverTotal / state.pageSize));
      var start = serverTotal === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
      var end = Math.min(state.page * state.pageSize, serverTotal);
      if (statusEl) statusEl.textContent = rangeText(start, end, serverTotal);
      renderPager(state.page, totalPages);
    }

    // --- manual mode: the host owns the rows -------------------------------------------------------

    var reported = null;
    /** Reports the query (kui-react onQueryChange), never the same one twice in a row. */
    function emitQuery(next, force) {
      var cur = Object.assign(q(), next || {});
      var out = {
        page: cur.page,
        pageSize: cur.pageSize,
        sort: mappers.toWire(cur.sort),
        search: cur.search,
        filters: clone(cur.filters),
        filterValues: filtersOn ? L.activeFilterValues(fields, applied) : {}
      };
      var key = JSON.stringify(out);
      if (key === reported && !force) return;
      reported = key;
      fire(root, 'kui:dt-query-change', { query: clone(out) });
      call(cfg.onQueryChange, clone(out));
    }

    function renderManual() {
      var cur = q();
      var offset = cfg.paginated ? (cur.page - 1) * cur.pageSize : 0;
      if (!overridden) {
        clearStateRows();
        if (manual.error) {
          paintRows([], 1);
          showState('error', manual.error);
        } else if (rowEls.length === 0) {
          paintRows([], 1);
          showState(manual.loading ? 'loading' : 'empty', manual.loading ? cfg.loadingMessage : emptyText(cur.search));
        } else {
          paintRows(rowEls, offset + 1);
        }
        setBusy(manual.loading);
        paintFooter();
      }
      if (cfg.paginated) {
        var total = Number(manual.total) || 0;
        var totalPages = Math.max(1, Math.ceil(total / cur.pageSize));
        var start = total === 0 ? 0 : offset + 1;
        if (statusEl) statusEl.textContent = rangeText(start, Math.min(cur.page * cur.pageSize, total), total);
        renderPager(cur.page, totalPages);
      }
      if (searchEl && document.activeElement !== searchEl && searchEl.value !== cur.search) searchEl.value = cur.search;
      if (pageSizeEl && String(pageSizeEl.value) !== String(cur.pageSize)) pageSizeEl.value = String(cur.pageSize);
      renderSortIcons();
      paintChips();
    }

    /** Every query change goes through here. */
    function change(next) {
      Object.assign(state, next);
      if (isManual) { emitQuery(next); renderManual(); }
      else refresh();
    }

    function refresh() {
      if (isServer) load();
      else if (isManual) { emitQuery(); renderManual(); }
      else renderClient();
    }

    function retry() {
      if (isServer) { load(); return; }
      fire(root, 'kui:dt-retry', {});
      call(cfg.onRetry);
    }

    // --- pager, sort icons, column filters, chips ---------------------------------------------------

    function renderPager(page, totalPages) {
      if (!pagerEl) return;
      pagerEl.innerHTML = '';
      if (totalPages <= 1) return;
      var navBtn = 'rounded-md font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus px-3 py-1.5 text-sm';
      var enabled = ' border-border text-text-secondary hover:bg-surface-overlay hover:text-text-primary';
      var disabledCls = ' border-border text-text-disabled cursor-not-allowed opacity-50';
      function go(target) { change({ page: target }); }
      function btn(label, target, isDisabled, aria) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', aria);
        b.className = navBtn + (isDisabled ? disabledCls : enabled);
        b.textContent = label;
        if (isDisabled) b.disabled = true;
        else b.addEventListener('click', function () { go(target); });
        return b;
      }
      pagerEl.appendChild(btn('‹', page - 1, page <= 1, M.previousPage));
      var visible = [];
      for (var p = 1; p <= totalPages; p++) if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) visible.push(p);
      var prevP = null;
      visible.forEach(function (item) {
        if (prevP !== null && item - prevP > 1) {
          var s = document.createElement('span');
          s.className = 'text-text-disabled px-3 py-1.5 text-sm';
          s.textContent = '…';
          pagerEl.appendChild(s);
        }
        prevP = item;
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', fmt(M.pageNumber, { page: item }));
        if (item === page) b.setAttribute('aria-current', 'page');
        b.className = 'rounded-md font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus w-9 h-9 text-sm '
          + (item === page ? 'bg-primary text-primary-fg border-primary' : 'border-border text-text-secondary hover:bg-surface-overlay hover:text-text-primary');
        b.textContent = item;
        b.addEventListener('click', function () { go(item); });
        pagerEl.appendChild(b);
      });
      pagerEl.appendChild(btn('›', page + 1, page >= totalPages, M.nextPage));
    }

    function headerCells() {
      return headEl ? Array.prototype.slice.call(headEl.querySelectorAll('th[data-dt-sort-key]')) : [];
    }

    function renderSortIcons() {
      var sort = q().sort;
      headerCells().forEach(function (th) {
        var key = th.getAttribute('data-dt-sort-key');
        var iconWrap = th.querySelector('[data-dt-sort-icon]');
        var orderBadge = th.querySelector('[data-dt-sort-order]');
        var button = th.querySelector('[data-part="sort"]');
        var idx = -1;
        var dir = null;
        for (var i = 0; i < sort.length; i++) {
          if (sort[i].key === key) { idx = i; dir = sort[i].dir; break; }
        }
        th.setAttribute('aria-sort', dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (button) button.classList.toggle('text-text-primary', !!dir);
        if (iconWrap) {
          var iconCls = 'fa-solid ' + (dir ? (dir === 'asc' ? 'fa-chevron-up' : 'fa-chevron-down') : 'fa-sort') + ' w-2.5 h-2.5' + (dir ? '' : ' opacity-50');
          // unstyled: the marker is the icon itself (kui-react draws it straight in the button).
          if (iconWrap.tagName === 'I') iconWrap.setAttribute('class', iconCls);
          else iconWrap.innerHTML = '<i class="' + iconCls + '"></i>';
        }
        if (orderBadge) {
          var many = userSorted && idx >= 0 && sort.length > 1;
          orderBadge.textContent = many ? String(idx + 1) : '';
          orderBadge.classList.toggle('hidden', !many);
          orderBadge.classList.toggle('inline-flex', many);
        }
      });
      if (sortByEl) sortByEl.value = sort[0] ? sort[0].key + ':' + sort[0].dir : '';
      paintColumnFilters();
    }

    /** A set header filter turns its button primary and names it "Edit filter on …". */
    function paintColumnFilters() {
      var filters = q().filters;
      root.querySelectorAll('[data-dt-filter-trigger]').forEach(function (b) {
        if (headEl && !headEl.contains(b)) return;
        var key = b.getAttribute('data-dt-filter-trigger');
        var col = colOf(key);
        var active = !!filters[key];
        b.classList.toggle('text-primary', active);
        b.classList.toggle('hover:text-primary-hover', active);
        b.classList.toggle('text-text-disabled', !active);
        b.classList.toggle('hover:text-text-primary', !active);
        b.setAttribute('aria-label', fmt(active ? M.editColumnFilter : M.columnFilter, { column: col ? col.header : key }));
      });
    }

    var chipsKey = null;
    /** The applied filters as removable chips (kui-react parts/FilterChips.tsx), panel and header alike. */
    function paintChips() {
      if (!chipsEl) return;
      var cur = q();
      var chips = [];
      if (filtersOn) {
        var active = L.activeFilterValues(fields, applied);
        fields.forEach(function (f) {
          if (!has(active, f.id) || !chipField(f)) return;
          var format = f.formatChip && typeof window[f.formatChip] === 'function' ? window[f.formatChip] : undefined;
          chips.push({ id: 'field:' + f.id, text: L.filterChipText(f, active[f.id], format) });
        });
      }
      COLS.forEach(function (c) {
        var raw = c.filter ? cur.filters[c.key] : '';
        if (!raw) return;
        var label = raw;
        (c.filter.options || []).forEach(function (o) { if (o.value === raw) label = o.label; });
        chips.push({ id: 'column:' + c.key, text: c.header + ': ' + label });
      });
      var key = JSON.stringify(chips);
      if (key !== chipsKey) {
        chipsKey = key;
        chipsEl.innerHTML = chips.map(function (chip) {
          return '<span class="' + CHIP_CLASS + '" data-part="filter-chip"><span class="truncate">' + esc(chip.text) + '</span>'
            + '<button type="button" aria-label="' + esc(fmt(M.removeFilter, { filter: chip.text })) + '" class="' + CHIP_BUTTON_CLASS + '" data-dt-chip-remove="' + esc(chip.id) + '">'
            + '<i class="fa-solid fa-xmark w-2.5 h-2.5" aria-hidden="true"></i></button></span>';
        }).join('') + (chips.length > 1 ? cfg.clearAllHtml : '');
      }
      chipsEl.classList.toggle('hidden', chips.length === 0);
      paintControls();
    }

    function colOf(key) {
      for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key) return COLS[i];
      return null;
    }

    function setColumnFilter(key, value) {
      var next = clone(q().filters);
      if (value) next[key] = value; else delete next[key];
      change({ filters: next, page: 1 });
    }

    // --- selection ---------------------------------------------------------------------------------

    function commitSelection(next) {
      if (!cfg.controlledSelection) {
        selected = next;
        paintRows(shownRows, shownStart);
      }
      fire(root, 'kui:dt-selection-change', { ids: next.slice() });
      call(cfg.onSelectionChange, next.slice());
      if (cfg.legacyAdvanced) fire(root, 'adt:selection', { count: next.length, ids: next.slice() });
    }

    bodyEl.addEventListener('change', function (e) {
      var cb = e.target.closest && e.target.closest('[data-dt-select]');
      if (!cb) return;
      var tr = cb.closest('tr[data-dt-row]');
      if (!tr) return;
      // A controlled table keeps showing the host's selection until it calls setSelectedRowIds.
      var next = L.toggleId(selected, rowIdOf(tr));
      if (cfg.controlledSelection) cb.checked = !cb.checked;
      commitSelection(next);
    });
    if (selectAll) {
      if (selectAll.getAttribute('data-indeterminate') === 'true') selectAll.indeterminate = true;
      selectAll.addEventListener('change', function () {
        var next = L.toggleShown(selected, selectableShownIds());
        if (cfg.controlledSelection) paintHeader();
        commitSelection(next);
      });
    }
    if (summary) {
      var clearBtn = summary.querySelector('button');
      if (clearBtn) clearBtn.addEventListener('click', function () { commitSelection([]); });
    }

    // --- rows: expand, click, keyboard, card selection ------------------------------------------

    bodyEl.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-dt-expand]');
      if (!btn) return;
      var tr = btn.closest('tr[data-dt-row]');
      if (!tr) return;
      var key = L.keyOf(rowIdOf(tr));
      if (expanded[key]) delete expanded[key]; else expanded[key] = true;
      paintRows(shownRows, shownStart);
    }, true); // capture: the cell stops the click's bubbling so a row click handler never sees it

    function rowClick(tr) {
      var id = rowIdOf(tr);
      fire(root, 'kui:dt-row-click', { id: id });
      call(cfg.onRowClick, id);
    }
    if (cfg.rowClick && !cards) {
      bodyEl.addEventListener('click', function (e) {
        var tr = e.target.closest && e.target.closest('tr[data-dt-row]');
        if (!tr || tr.parentNode !== bodyEl) return;
        // A click on a control inside the row belongs to that control.
        var control = e.target.closest(INTERACTIVE);
        if (control && tr.contains(control)) return;
        rowClick(tr);
      });
    }
    function rowDoubleClick(tr) {
      var id = rowIdOf(tr);
      fire(root, 'kui:dt-row-dblclick', { id: id });
      call(cfg.onRowDoubleClick, id);
    }
    if (cfg.rowDoubleClick && !cards) {
      bodyEl.addEventListener('dblclick', function (e) {
        var tr = e.target.closest && e.target.closest('tr[data-dt-row]');
        if (!tr || tr.parentNode !== bodyEl) return;
        var control = e.target.closest(INTERACTIVE);
        if (control && tr.contains(control)) return;
        rowDoubleClick(tr);
      });
    }
    if (cfg.keyboard && !cards) {
      bodyEl.addEventListener('focusin', function (e) {
        var tr = e.target;
        if (!tr.matches || !tr.matches('tr[data-dt-row]') || tr.parentNode !== bodyEl) return;
        focusKey = tr.getAttribute('data-row-key');
        paintKeyboard();
      });
      bodyEl.addEventListener('keydown', function (e) {
        var tr = e.target;
        // A control inside the row handles its own keys.
        if (!tr.matches || !tr.matches('tr[data-dt-row]') || tr.parentNode !== bodyEl) return;
        var index = shownRows.indexOf(tr);
        if (index < 0) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          focusRow(e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 0 : shownRows.length - 1);
        } else if ((e.key === 'Enter' || e.key === ' ') && cfg.rowClick) {
          e.preventDefault();
          rowClick(tr);
        } else if ((e.key === 'Enter' || e.key === ' ') && cfg.rowDoubleClick) {
          // A row whose only action is a double click still runs it from the keyboard.
          e.preventDefault();
          rowDoubleClick(tr);
        }
      });
    }
    if (cards && cfg.selectable) {
      bodyEl.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('[data-dt-card-select]');
        if (!t) return;
        var li = t.closest('[data-dt-row]');
        if (!li || li.parentNode !== bodyEl || isLockedEl(li)) return;
        commitSelection(L.toggleId(selected, rowIdOf(li)));
      });
    }
    root.addEventListener('click', function (e) {
      var r = e.target.closest && e.target.closest('[data-part="retry"]');
      if (r && scrollEl.contains(r)) retry();
    });

    // --- filter panel ------------------------------------------------------------------------------

    function readDefs() {
      try { fields = grid ? JSON.parse(grid.getAttribute('data-dt-filter-defs') || '[]') : []; } catch (e) { fields = []; }
    }
    function defOf(id) {
      for (var i = 0; i < fields.length; i++) if (fields[i].id === id) return fields[i];
      return null;
    }
    function cellOf(id) {
      var cells = grid ? grid.querySelectorAll('[data-dt-filter-field]') : [];
      for (var i = 0; i < cells.length; i++) if (cells[i].getAttribute('data-dt-filter-field') === id) return cells[i];
      return null;
    }
    function writeAll(values) {
      syncing = true;
      try {
        fields.forEach(function (f) {
          var cell = cellOf(f.id);
          if (!cell) return;
          if (f.type === 'daterange') paintPresets(cell, values[f.id]);
          if (f.type !== 'custom' && same(readField(cell, f, customValues), values[f.id] === undefined ? emptyOf(f) : values[f.id])) return;
          if (f.type === 'custom') customValues[f.id] = values[f.id];
          writeField(cell, f, values[f.id]);
        });
      } finally { syncing = false; }
    }
    function emptyOf(f) {
      switch (f.type) {
        case 'number': case 'date': return null;
        case 'multiselect': case 'checkboxes': return [];
        case 'checkbox': return false;
        case 'daterange': return { from: null, to: null };
        case 'numberrange': return { min: null, max: null };
        case 'range': return [f.min, f.max];
        default: return '';
      }
    }
    /** Fields with a chip and a count: not a required choice, not drawn in the toolbar. */
    function chipField(f) { return !L.isRequiredChoice(f) && !L.inToolbar(f); }
    function panelFields() { return fields.filter(function (f) { return !L.inToolbar(f); }); }
    function activeCount() {
      var active = L.activeFilterValues(fields, applied);
      return fields.filter(function (f) { return chipField(f) && has(active, f.id); }).length;
    }
    function paintToggle(open) {
      if (!toggleBtn) return;
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && panel) toggleBtn.setAttribute('aria-controls', panel.id);
      else toggleBtn.removeAttribute('aria-controls');
      toggleBtn.classList.toggle('bg-surface-overlay', open);
      var icon = toggleBtn.querySelector('span[aria-hidden="true"]');
      var n = activeCount();
      toggleBtn.innerHTML = (icon ? icon.outerHTML : '') + esc(M.filters)
        + (n > 0 ? cfg.badgeHtml.split('{count}').join(String(n)) : '');
    }
    function setOpen(open) {
      if (!panel) return;
      if (open) {
        draft = clone(applied);
        writeAll(draft);
      }
      panel.classList.toggle('hidden', !open);
      paintToggle(open);
      paintControls();
    }
    function isOpen() { return !!panel && !panel.classList.contains('hidden'); }

    /** Apply / Reset / a live edit / a removed chip: the new applied values. */
    function apply(values) {
      if (!cfg.controlledFilters) setApplied(values, true);
      fire(root, 'kui:dt-filter-values-change', { values: clone(values) });
      call(cfg.onFilterValuesChange, clone(values));
    }
    /** The applied values change; the draft follows them. Nothing is fetched or reported here. */
    function commitApplied(values) {
      var changedValue = !same(values, applied);
      applied = clone(values || {});
      if (changedValue) {
        draft = clone(applied);
        writeAll(draft);
      }
      paintToggle(isOpen());
      if (typeof paintToolbarFields === 'function') paintToolbarFields();
    }
    function setApplied(values, backToFirstPage) {
      var before = JSON.stringify(L.activeFilterValues(fields, applied));
      commitApplied(values);
      if (backToFirstPage) { change({ page: 1 }); return; }
      if (JSON.stringify(L.activeFilterValues(fields, applied)) !== before) refresh();
    }
    /** "Clear all": the panel values and the column filters, back to page 1, reported once. */
    function clearAll() {
      if (filtersOn) {
        // Required panel choices return to their default; toolbar fields keep their value (kui-react clear()).
        var kept = L.requiredFilterDefaults(panelFields());
        fields.forEach(function (f) { if (L.inToolbar(f) && has(applied, f.id)) kept[f.id] = applied[f.id]; });
        if (!cfg.controlledFilters) commitApplied(kept);
        fire(root, 'kui:dt-filter-values-change', { values: clone(kept) });
        call(cfg.onFilterValuesChange, clone(kept));
      }
      change({ filters: {}, page: 1 });
    }

    function setDraftValue(def, value) {
      draft = Object.assign({}, draft);
      draft[def.id] = value;
      var cell = cellOf(def.id);
      if (cell && def.type === 'daterange') paintPresets(cell, value);
      if (cfg.filtersLive) apply(clone(draft));
    }

    if (panel && grid) {
      readDefs();
      var onEdit = function (e) {
        if (syncing) return;
        var cell = e.target.closest && e.target.closest('[data-dt-filter-field]');
        if (!cell || !grid.contains(cell)) return;
        var def = defOf(cell.getAttribute('data-dt-filter-field'));
        if (!def) return;
        if (def.type === 'custom') {
          if (e.type !== 'kui:dt-filter-input') return;
          customValues[def.id] = e.detail ? e.detail.value : null;
        }
        var value = readField(cell, def, customValues);
        if (same(value, draft[def.id]) && def.id in draft) return;
        setDraftValue(def, value);
      };
      ['input', 'change', 'kui:multiselect-change', 'kui:datepicker-change', 'kui:dt-filter-input'].forEach(function (t) {
        panel.addEventListener(t, onEdit);
      });
      // Date-range presets fill the field.
      panel.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-dt-preset-from]');
        if (!b || !grid.contains(b)) return;
        var cell = b.closest('[data-dt-filter-field]');
        var def = cell ? defOf(cell.getAttribute('data-dt-filter-field')) : null;
        if (!def) return;
        var value = { from: b.getAttribute('data-dt-preset-from') || null, to: b.getAttribute('data-dt-preset-to') || null };
        syncing = true;
        try { writeField(cell, def, value); } finally { syncing = false; }
        setDraftValue(def, value);
      });
      panel.addEventListener('submit', function (e) { e.preventDefault(); apply(clone(draft)); });
      var actions = panel.querySelector('[data-dt-filter-actions]');
      var resetBtn = actions ? actions.querySelector('button[type="button"]') : null;
      // Reset goes back to each field's defaultValue, not to nothing.
      // Toolbar fields keep their value.
      if (resetBtn) resetBtn.addEventListener('click', function () {
        var next = L.defaultFilterValues(panelFields());
        fields.forEach(function (f) { if (L.inToolbar(f) && has(applied, f.id)) next[f.id] = applied[f.id]; });
        apply(next);
      });
    }
    if (toggleBtn) toggleBtn.addEventListener('click', function () { setOpen(!isOpen()); });

    // Toolbar fields (`placement: 'toolbar'`): applied at once (kui-react ToolbarFilterControl).
    var TB_ON = ['bg-surface-overlay', 'font-semibold'];
    var TB_OFF = ['bg-surface-base', 'hover:bg-surface-overlay'];
    function toolbarFieldEls() { return Array.prototype.slice.call(root.querySelectorAll('[data-dt-toolbar-field]')); }
    function paintToolbarFields() {
      toolbarFieldEls().forEach(function (box) {
        var id = box.getAttribute('data-dt-toolbar-field');
        var v = typeof applied[id] === 'string' ? applied[id] : '';
        if (box.getAttribute('data-dt-filter-type') === 'radio') {
          var values = [];
          try { values = JSON.parse(box.getAttribute('data-dt-values') || '[]'); } catch (e) { values = []; }
          box.querySelectorAll('button').forEach(function (b, i) {
            var on = values[i] === v;
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            TB_ON.forEach(function (c) { b.classList.toggle(c, on); });
            TB_OFF.forEach(function (c) { b.classList.toggle(c, !on); });
          });
        } else {
          var sel = box.querySelector('select');
          if (sel && sel.value !== v) sel.value = v;
        }
      });
    }
    toolbarFieldEls().forEach(function (box) {
      var id = box.getAttribute('data-dt-toolbar-field');
      function set(v) {
        var next = clone(applied);
        next[id] = v;
        apply(next);
        paintToolbarFields();
      }
      if (box.getAttribute('data-dt-filter-type') === 'radio') {
        box.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('button');
          if (!b || !box.contains(b)) return;
          var values = [];
          try { values = JSON.parse(box.getAttribute('data-dt-values') || '[]'); } catch (err) { values = []; }
          var at = Array.prototype.indexOf.call(box.querySelectorAll('button'), b);
          if (at >= 0) set(values[at]);
        });
      } else {
        box.addEventListener('change', function (e) {
          if (e.target && e.target.tagName === 'SELECT') set(e.target.value);
        });
      }
    });

    function setFilterFields(html) {
      if (!panel || !grid) return;
      var holder = document.createElement('div');
      holder.innerHTML = html;
      var next = holder.querySelector('[data-dt-filter-grid]');
      if (!next) return;
      var before = JSON.stringify(L.activeFilterValues(fields, applied));
      grid.parentNode.replaceChild(next, grid);
      grid = next;
      runScripts(grid);
      if (window.KUI_DATEPICKER && window.KUI_DATEPICKER.autoInit) window.KUI_DATEPICKER.autoInit();
      readDefs();
      writeAll(draft);
      paintToggle(isOpen());
      if (JSON.stringify(L.activeFilterValues(fields, applied)) !== before) refresh();
      else paintChips();
    }

    if (chipsEl) {
      chipsEl.addEventListener('click', function (e) {
        var rm = e.target.closest && e.target.closest('[data-dt-chip-remove]');
        if (rm) {
          var id = rm.getAttribute('data-dt-chip-remove');
          if (id.indexOf('field:') === 0) {
            var next = clone(applied);
            delete next[id.slice(6)];
            apply(next);
          } else if (id.indexOf('column:') === 0) {
            setColumnFilter(id.slice(7), '');
          }
          return;
        }
        if (e.target.closest && e.target.closest('[data-part="clear-filters"]')) clearAll();
      });
    }

    // --- toolbar, header -------------------------------------------------------------------------

    if (searchEl) {
      var searchTimer = null;
      searchEl.addEventListener('input', function (e) {
        var v = e.target.value || '';
        if (searchTimer) clearTimeout(searchTimer);
        // Clearing the box applies at once; typing waits for a pause (server and manual modes).
        if (cfg.searchDebounceMs <= 0 || v === '') change({ search: v, page: 1 });
        else searchTimer = setTimeout(function () { change({ search: v, page: 1 }); }, cfg.searchDebounceMs);
      });
    }
    if (pageSizeEl) {
      pageSizeEl.addEventListener('change', function (e) {
        change({ pageSize: Number(e.target.value) || 10, page: 1 });
      });
    }
    if (sortByEl) {
      sortByEl.addEventListener('change', function () {
        var v = sortByEl.value;
        if (!v) { change({ sort: [], page: 1 }); return; }
        var parts = v.split(':');
        change({ sort: [{ key: parts[0], dir: parts[1] === 'desc' ? 'desc' : 'asc' }], page: 1 });
      });
    }
    headerCells().forEach(function (th) {
      var button = th.querySelector('[data-part="sort"]') || th;
      button.addEventListener('click', function (e) {
        var key = th.getAttribute('data-dt-sort-key');
        userSorted = true;
        change({ sort: L.nextSortState(q().sort, key, cfg.multiSort !== false && !!e.shiftKey), page: 1 });
      });
    });

    // Per-column filter popovers (text + select).
    function buildFilterPopover(triggerBtn) {
      var key = triggerBtn.getAttribute('data-dt-filter-trigger');
      var kind = triggerBtn.getAttribute('data-dt-filter-kind') || 'text';
      var existing = document.getElementById(cfg.id + '-filter-' + key);
      if (existing) {
        existing.parentNode.removeChild(existing);
        triggerBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      root.querySelectorAll('[data-dt-filter-pop]').forEach(function (p) { p.parentNode.removeChild(p); });
      root.querySelectorAll('[data-dt-filter-trigger]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });

      var col = colOf(key);
      var current = q().filters[key] || '';
      var pop = document.createElement('div');
      pop.id = cfg.id + '-filter-' + key;
      pop.setAttribute('data-dt-filter-pop', '');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', fmt(M.columnFilter, { column: col ? col.header : key }));
      pop.className = 'absolute top-full left-0 mt-1 z-[70] min-w-[12rem] rounded-lg border border-border bg-surface-raised shadow-xl p-3';
      pop.addEventListener('click', function (e) { e.stopPropagation(); });
      var inputCls = 'w-full rounded-md border border-border bg-surface-base px-2 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
      var inputEl;
      var applyBtn = document.createElement('button');
      if (kind === 'select' && col && col.filter && col.filter.options) {
        inputEl = document.createElement('select');
        inputEl.className = inputCls;
        var opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = M.columnFilterAll;
        inputEl.appendChild(opt0);
        col.filter.options.forEach(function (o) {
          var op = document.createElement('option'); op.value = o.value; op.textContent = o.label;
          inputEl.appendChild(op);
        });
        inputEl.value = current;
      } else {
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = (col && col.filter && col.filter.placeholder) || M.columnFilterContains;
        inputEl.value = current;
        inputEl.className = inputCls;
        inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyBtn.click(); });
      }
      pop.appendChild(inputEl);

      var actions = document.createElement('div');
      actions.className = 'mt-2 flex items-center justify-end gap-2';
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = M.clearFilter;
      clearBtn.className = 'rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
      applyBtn.type = 'button';
      applyBtn.textContent = M.apply;
      applyBtn.className = 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
      clearBtn.addEventListener('click', function () { close(); setColumnFilter(key, ''); });
      applyBtn.addEventListener('click', function () {
        var v = (inputEl.value || '').trim();
        close();
        setColumnFilter(key, v);
      });
      actions.appendChild(clearBtn);
      actions.appendChild(applyBtn);
      pop.appendChild(actions);

      triggerBtn.parentNode.appendChild(pop);
      triggerBtn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { inputEl.focus(); }, 0);

      function close() { if (pop.parentNode) pop.parentNode.removeChild(pop); triggerBtn.setAttribute('aria-expanded', 'false'); }
      document.addEventListener('mousedown', function onOutside(e) {
        if (!pop.contains(e.target) && e.target !== triggerBtn) {
          document.removeEventListener('mousedown', onOutside);
          close();
        }
      });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onEsc);
          close();
        }
      });
    }
    root.querySelectorAll('[data-dt-filter-trigger]').forEach(function (b) {
      if (headEl && !headEl.contains(b)) return;
      b.addEventListener('click', function (e) { e.stopPropagation(); buildFilterPopover(b); });
    });

    // --- column chooser (kui-react parts/ColumnChooser.tsx, core/columnVisibility.ts) -------------------
    // The viewer's own choices (column key -> shown) are kept in localStorage under the table's tableId; the
    // hidden columns' cells (data-dt-col) are hidden by a CSS rule, so every repaint of the rows keeps them hidden.

    var chooser = cfg.columnChooser;
    var chooserEl = chooser ? root.querySelector('[data-dt-column-chooser]') : null;
    var colBase = {};
    // The table started (the first render or load ran): a sort change goes through change() from then on.
    var booted = false;
    var sortDroppedAtBoot = false;
    if (chooser && chooserEl) {
      var colStyle = chooserEl.querySelector('[data-dt-col-style]');
      var colToggle = chooserEl.querySelector('[data-dt-columns-toggle]');
      var colPanel = chooserEl.querySelector('[data-dt-columns-panel]');
      var colCount = chooserEl.querySelector('[data-dt-columns-count]');
      var colReset = chooserEl.querySelector('[data-part="column-chooser-reset"]');
      var colChoices = Array.prototype.slice.call(chooserEl.querySelectorAll('[data-dt-column-choice]'));
      // Kept beside the stored copy, so the chooser still works where storage is blocked. Once a write went through,
      // the stored copy rules: a Reset in another table or tab with this tableId brings back the defaults here too.
      var choiceMemory = {};
      var choiceSaved = false;

      var readChoices = function () {
        if (chooser.storageKey) {
          try {
            var raw = window.localStorage.getItem(chooser.storageKey);
            if (raw !== null || choiceSaved) return L.parseColumnChoices(raw);
          } catch (e) { /* storage blocked */ }
        }
        return choiceMemory;
      };
      // A column the viewer hides leaves the sort, so the rows are never ordered by a column nobody sees (a
      // multi-sort keeps the rest in order); a stored choice that hides the default sort's column drops it at boot.
      var dropHiddenSort = function (hidden) {
        var sort = q().sort || [];
        var kept = sort.filter(function (s) { return hidden.indexOf(s.key) === -1; });
        if (kept.length === sort.length) return;
        if (booted) { change({ sort: kept, page: 1 }); return; }
        state.sort = kept;
        if (has(ctl, 'sort')) ctl.sort = clone(kept);
        sortDroppedAtBoot = true;
      };
      var paintColumns = function () {
        var choices = readChoices();
        var resolved = L.resolveColumns(chooser.cols, choices);
        var hidden = resolved.hidden;
        colBase = resolved.base;
        colStyle.textContent = L.columnHideRule(cfg.id, hidden);
        colChoices.forEach(function (el) {
          var input = el.querySelector('input');
          var label = el.querySelector('label');
          var key = el.getAttribute('data-dt-column-choice');
          var shown = hidden.indexOf(key) === -1;
          // The table keeps one column on every screen: that last one is locked.
          var locked = resolved.locked.indexOf(key) !== -1;
          input.checked = shown;
          input.disabled = locked;
          if (label) {
            label.classList.toggle('text-text-disabled', locked);
            label.classList.toggle('text-text-primary', !locked);
          }
        });
        colCount.textContent = String(hidden.length);
        colCount.classList.toggle('hidden', hidden.length === 0);
        colCount.setAttribute('aria-label', fmt(M.hiddenColumns, { count: hidden.length }));
        colReset.disabled = Object.keys(choices).length === 0;
        dropHiddenSort(hidden);
      };
      var saveChoices = function (next) {
        choiceMemory = next;
        if (chooser.storageKey) {
          try {
            if (Object.keys(next).length === 0) window.localStorage.removeItem(chooser.storageKey);
            else window.localStorage.setItem(chooser.storageKey, JSON.stringify(next));
            choiceSaved = true;
          } catch (e) { /* storage blocked: the choice lasts until the page reloads */ choiceSaved = false; }
        }
        paintColumns();
        // Other tables on the page with the same tableId follow.
        fire(root, 'kui:dt-columns-change', { storageKey: chooser.storageKey });
      };
      var setColumnsOpen = function (open) {
        colPanel.classList.toggle('hidden', !open);
        colToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) colToggle.setAttribute('aria-controls', colPanel.id);
        else colToggle.removeAttribute('aria-controls');
        colToggle.classList.toggle('bg-surface-overlay', open);
      };
      var columnsOpen = function () { return !colPanel.classList.contains('hidden'); };

      colToggle.addEventListener('click', function () { setColumnsOpen(!columnsOpen()); });
      colChoices.forEach(function (el) {
        var key = el.getAttribute('data-dt-column-choice');
        el.querySelector('input').addEventListener('change', function (e) {
          // From the choice in effect: a stored one that is ignored gives way to the defaults.
          var next = Object.assign({}, colBase);
          next[key] = e.target.checked;
          saveChoices(next);
        });
      });
      colReset.addEventListener('click', function () { saveChoices({}); });
      document.addEventListener('mousedown', function (e) {
        if (columnsOpen() && !chooserEl.contains(e.target)) setColumnsOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !columnsOpen()) return;
        setColumnsOpen(false);
        colToggle.focus();
      });
      document.addEventListener('kui:dt-columns-change', function (e) {
        if (e.target !== root && chooser.storageKey && e.detail && e.detail.storageKey === chooser.storageKey) paintColumns();
      });
      window.addEventListener('storage', function (e) {
        if (chooser.storageKey && e.key === chooser.storageKey) paintColumns();
      });
      paintColumns();
    }

    // --- handle ------------------------------------------------------------------------------------

    root.__kuiDataTable = true;
    root.kuiDataTable = {
      getSelectedRowIds: function () { return countedSelection(); },
      setSelectedRowIds: function (ids) {
        selected = Array.isArray(ids) ? ids.slice() : [];
        paintRows(shownRows, shownStart);
      },
      clearSelection: function () { commitSelection([]); },
      getFilterValues: function () { return clone(applied); },
      setFilterValues: function (values) { setApplied(values || {}, true); },
      setFilterFields: setFilterFields,
      /** Server mode: refetch the current page. Manual mode: report the current query again. */
      reload: function () {
        if (isManual) { emitQuery(null, true); return; }
        refresh();
      },
      /** Server mode: a different key refetches the current page (kui-react reloadKey). */
      setReloadKey: function (key) {
        if (same(key, reloadKey)) return;
        reloadKey = key;
        if (isServer) load();
      },
      /** The query as manual mode reports it (outward sort keys). */
      getQuery: function () {
        var a = wireArgs();
        return clone(a);
      },
      /** Manual mode: the controlled query fields, fed back by the host. Nothing is reported. */
      setQuery: function (next) {
        if (!isManual || !next) return;
        Object.keys(next).forEach(function (k) {
          if (!has(state, k)) return;
          ctl[k] = k === 'sort' ? mappers.fromWire(next.sort || []) : clone(next[k]);
        });
        renderManual();
      },
      /** Manual mode: a new page of rows ({ html } from modules/ui/Table/Rows, or plain { rows }) and total. */
      setRows: function (result) {
        if (!isManual) return;
        result = result || {};
        if (typeof result.total === 'number') manual.total = result.total;
        var cur = q();
        var offset = cfg.paginated ? (cur.page - 1) * cur.pageSize : 0;
        var html = typeof result.html === 'string' ? result.html : plainRowsHtml(Array.isArray(result.rows) ? result.rows : [], offset);
        manual.loading = false;
        manual.error = null;
        clearStateRows();
        setBusy(false);
        bodyEl.innerHTML = html;
        runScripts(bodyEl);
        scanRows();
        renderManual();
      },
      setLoading: function (on) {
        if (!isManual) return;
        manual.loading = !!on;
        renderManual();
      },
      setError: function (message) {
        if (!isManual) return;
        manual.error = message ? String(message) : null;
        renderManual();
      }
    };

    scanRows();
    if (isServer) {
      if (!everLoaded || sortDroppedAtBoot) load();
      else {
        var ssrOffset = (state.page - 1) * state.pageSize;
        paintRows(rowEls, ssrOffset + 1);
        paintFooter();
        renderServerFooter();
        renderSortIcons();
        paintChips();
      }
    } else if (isManual) {
      renderManual();
      // The first query goes out once the page has loaded, so scripts after the table hear it too.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { emitQuery(); });
      else emitQuery();
    } else {
      renderClient();
    }
    booted = true;
  }

  window.KuiDataTable = { init: init, readField: readField, writeField: writeField };
})();
