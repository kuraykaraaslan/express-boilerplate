// The list engine of the admin pages: the browser half of NB's `<DataTable mode="server" {...useListFetcher(url)}>`.
// It speaks the phase-43 list contract (common/ui/data-table.hooks.ts toListParams): page, pageSize, search, sort=key:dir,
// a list filter joins with commas, a date range is <id>From / <id>To, a number range <id>Min / <id>Max, rows under data|items|rows.
//
//   var list = KuiList.mount(document.getElementById('list'), {
//     endpoint: '/api/webhooks', pageBase: 0, caption: 'Webhooks',
//     columns: [{ key, header, sortable, hide: 'sm|md|lg', align: 'right', render: function (row) { return html; } }],
//     filters: [{ id, label, type: 'radio|select|multiselect|daterange|text', options: [{ value, label }] }],
//     search: { placeholder }, sort: { key, dir }, rowId: fn, onRowClick: fn, rowActions: [{ id, label, icon, destructive, visible, onClick }],
//     empty, emptySearch, rows(body), total(body), params, pageSizes
//   });   list.reload(); list.setParams({ ... });
(function () {
  var K = window.Kui, api = K.api;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var TONE = { success: 'bg-success-subtle text-success-fg', error: 'bg-error-subtle text-error-fg', warning: 'bg-warning-subtle text-warning-fg', info: 'bg-info-subtle text-info-fg', neutral: 'bg-surface-sunken text-text-secondary', primary: 'bg-primary-subtle text-primary' };
  var DOT = { success: 'bg-success', error: 'bg-error', warning: 'bg-warning', info: 'bg-info', neutral: 'bg-text-disabled', primary: 'bg-primary' };
  function badge(variant, text, o) {
    o = o || {};
    return '<span class="inline-flex items-center gap-1 rounded-full font-medium ' + (TONE[variant] || TONE.neutral) + ' ' + (o.sm ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs') + '">'
      + (o.dot ? '<span class="h-1.5 w-1.5 rounded-full shrink-0 ' + (DOT[variant] || DOT.neutral) + '" aria-hidden="true"></span>' : '') + esc(text) + '</span>';
  }
  function when(iso) { return iso ? new Date(iso).toLocaleString() : ''; }
  function shortId(id) { return id ? String(id).slice(0, 8) : '—'; }
  var HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };
  var INPUT = 'rounded-md border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

  function defaultRows(body) { var l = body && (body.data || body.items || body.rows); return Array.isArray(l) ? l : []; }
  function defaultTotal(body, rows) { var n = Number(body && (body.total != null ? body.total : body.count)); return isFinite(n) ? n : rows.length; }

  function filterParams(f, v) {
    var out = {};
    if (v == null || v === '' || v === false) return out;
    if (f.type === 'daterange') { if (v.from) out[f.id + 'From'] = v.from; if (v.to) out[f.id + 'To'] = v.to; }
    else if (Array.isArray(v)) { if (v.length) out[f.id] = v.join(','); }
    else out[f.id] = v;
    return out;
  }

  function mount(root, cfg) {
    var state = { page: 1, pageSize: (cfg.pageSizes || [10, 20, 50, 100])[1] || 20, search: '', sort: cfg.sort || null, filters: {}, params: cfg.params || {} };
    var rows = [], total = 0, loading = false, error = '', ctl = null, searchTimer = null;
    var sizes = cfg.pageSizes || [10, 20, 50, 100];
    var filters = cfg.filters || [];
    var actions = cfg.rowActions || [];

    root.innerHTML = '<div data-dl-toolbar class="flex flex-wrap items-end gap-3 mb-3"></div><div data-dl-error class="hidden mb-3" role="alert"></div>'
      + '<div data-dl-table></div><div data-dl-pager class="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-text-secondary"></div>';
    var bar = root.querySelector('[data-dl-toolbar]'), errBox = root.querySelector('[data-dl-error]'), tbl = root.querySelector('[data-dl-table]'), pager = root.querySelector('[data-dl-pager]');

    function filterControl(f) {
      var id = 'dl-f-' + f.id, label = '<label for="' + id + '" class="block text-xs font-medium text-text-secondary mb-1">' + esc(f.label) + '</label>';
      if (f.type === 'daterange') {
        return '<div>' + label + '<div class="flex items-center gap-1"><input id="' + id + '" type="date" data-f="' + esc(f.id) + '" data-end="from" aria-label="' + esc(f.label) + ' from" class="' + INPUT + '"><span class="text-text-disabled">–</span><input type="date" data-f="' + esc(f.id) + '" data-end="to" aria-label="' + esc(f.label) + ' to" class="' + INPUT + '"></div></div>';
      }
      if (f.type === 'text') return '<div>' + label + '<input id="' + id + '" type="text" data-f="' + esc(f.id) + '" class="' + INPUT + '"></div>';
      if (f.type === 'multiselect') {
        return '<div><span class="block text-xs font-medium text-text-secondary mb-1">' + esc(f.label) + '</span><details class="relative"><summary class="' + INPUT + ' cursor-pointer select-none list-none" data-ms-summary="' + esc(f.id) + '">All</summary>'
          + '<div class="absolute z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-surface-raised shadow-md p-2 space-y-1">'
          + f.options.map(function (o) { return '<label class="flex items-center gap-2 text-sm text-text-primary cursor-pointer"><input type="checkbox" data-f="' + esc(f.id) + '" data-ms="' + esc(o.value) + '" class="rounded border-border accent-primary">' + esc(o.label) + '</label>'; }).join('')
          + '</div></details></div>';
      }
      return '<div>' + label + '<select id="' + id + '" data-f="' + esc(f.id) + '" class="' + INPUT + '"><option value="">All</option>' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('') + '</select></div>';
    }
    bar.innerHTML = (cfg.search ? '<div class="flex-1 min-w-[12rem] max-w-md"><label for="dl-search" class="sr-only">Search</label><div class="relative"><i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-disabled" aria-hidden="true"></i><input id="dl-search" type="search" placeholder="' + esc(cfg.search.placeholder || 'Search…') + '" class="w-full pl-8 ' + INPUT + '"></div></div>' : '')
      + filters.map(filterControl).join('');

    function readFilters() {
      var out = {};
      filters.forEach(function (f) {
        if (f.type === 'daterange') {
          var from = bar.querySelector('[data-f="' + f.id + '"][data-end=from]').value, to = bar.querySelector('[data-f="' + f.id + '"][data-end=to]').value;
          if (from || to) out[f.id] = { from: from || null, to: to || null };
        } else if (f.type === 'multiselect') {
          var on = [].slice.call(bar.querySelectorAll('[data-f="' + f.id + '"][data-ms]:checked')).map(function (c) { return c.getAttribute('data-ms'); });
          if (on.length) out[f.id] = on;
          var s = bar.querySelector('[data-ms-summary="' + f.id + '"]');
          if (s) s.textContent = on.length ? on.length + ' selected' : 'All';
        } else {
          var el = bar.querySelector('[data-f="' + f.id + '"]'); if (el && el.value) out[f.id] = el.value;
        }
      });
      return out;
    }
    bar.addEventListener('change', function (e) { if (e.target.hasAttribute('data-f')) { state.filters = readFilters(); state.page = 1; if (cfg.onFilters) cfg.onFilters(state.filters); load(); } });
    if (cfg.search) bar.querySelector('#dl-search').addEventListener('input', function (e) {
      clearTimeout(searchTimer); var v = e.target.value;
      searchTimer = setTimeout(function () { state.search = v.trim(); state.page = 1; load(); }, 300);
    });

    function query() {
      var q = Object.assign({}, state.params);
      q[cfg.pageParam || 'page'] = state.page - 1 + (cfg.pageBase || 0);
      q[cfg.sizeParam || 'pageSize'] = state.pageSize;
      if (state.search) q[cfg.searchParam || 'search'] = state.search;
      if (state.sort) q[cfg.sortParam || 'sort'] = state.sort.key + ':' + state.sort.dir;
      filters.forEach(function (f) { Object.assign(q, filterParams(f, state.filters[f.id])); });
      if (cfg.filterParams) Object.assign(q, cfg.filterParams(state.filters));
      Object.keys(q).forEach(function (k) { if (q[k] === undefined || q[k] === '' || q[k] === null) delete q[k]; });
      return q;
    }

    function draw() {
      var cols = cfg.columns, sort = state.sort;
      var head = cols.map(function (c) {
        var on = sort && sort.key === c.key;
        var cls = 'px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider ' + (c.align === 'right' ? 'text-right' : 'text-left') + (c.hide ? ' ' + HIDE[c.hide] : '') + (c.sortable ? ' cursor-pointer select-none hover:text-text-primary transition-colors' : '');
        return '<th scope="col" class="' + cls + '"' + (c.sortable ? ' data-sort="' + esc(c.key) + '" aria-sort="' + (on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' : '') + '><span class="inline-flex items-center gap-1">' + (c.header || '')
          + (c.sortable ? '<i class="fa-solid ' + (on ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort') + ' w-2.5 h-2.5" aria-hidden="true"></i>' : '') + '</span></th>';
      }).join('') + (actions.length ? '<th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>' : '');
      var span = cols.length + (actions.length ? 1 : 0);
      var body = rows.length === 0
        ? '<tr><td colspan="' + span + '" class="px-4 py-8 text-center text-text-secondary">' + (loading ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>' : (state.search || Object.keys(state.filters).length ? (cfg.emptySearch || 'Nothing matches.') : (cfg.empty || 'Nothing here yet.'))) + '</td></tr>'
        : rows.map(function (r, i) {
          return '<tr class="hover:bg-surface-overlay transition-colors' + (cfg.onRowClick ? ' cursor-pointer' : '') + '" data-i="' + i + '">' + cols.map(function (c) {
            return '<td class="px-4 py-3 text-text-primary' + (c.align === 'right' ? ' text-right' : '') + (c.hide ? ' ' + HIDE[c.hide] : '') + '">' + c.render(r) + '</td>';
          }).join('') + (actions.length ? '<td class="px-4 py-3 text-right whitespace-nowrap">' + actions.filter(function (a) { return !a.visible || a.visible(r); }).map(function (a) {
            return '<button type="button" data-act="' + esc(a.id) + '" title="' + esc(a.label) + '" aria-label="' + esc(a.label) + '" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ' + (a.destructive ? 'text-error hover:bg-error-subtle' : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay') + '">' + (a.icon ? '<i class="fa-solid ' + a.icon + '" aria-hidden="true"></i>' : '') + '<span class="' + (a.icon ? 'sr-only sm:not-sr-only' : '') + '">' + esc(a.label) + '</span></button>';
          }).join('') + '</td>' : '') + '</tr>';
        }).join('');
      tbl.innerHTML = '<div class="w-full overflow-x-auto rounded-lg border border-border' + (loading ? ' opacity-60' : '') + '" role="region" aria-label="' + esc(cfg.caption || 'Table') + '" aria-busy="' + loading + '"><table class="w-full text-sm"><caption class="sr-only">' + esc(cfg.caption || 'Table') + '</caption>'
        + '<thead class="bg-surface-sunken border-b border-border"><tr>' + head + '</tr></thead><tbody class="divide-y divide-border bg-surface-base">' + body + '</tbody></table></div>';
      var pages = Math.max(1, Math.ceil(total / state.pageSize));
      var btn = 'inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed';
      pager.innerHTML = '<span>' + (total ? total + ' result' + (total === 1 ? '' : 's') + ' · ' : '') + 'Page ' + state.page + ' of ' + pages + '</span>'
        + '<div class="flex items-center gap-2"><label class="flex items-center gap-1 text-xs">Rows<select data-size class="' + INPUT + ' py-1">' + sizes.map(function (n) { return '<option value="' + n + '"' + (n === state.pageSize ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>'
        + '<button type="button" data-prev class="' + btn + '"' + (state.page <= 1 ? ' disabled' : '') + ' aria-label="Previous page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>'
        + '<button type="button" data-next class="' + btn + '"' + (state.page >= pages ? ' disabled' : '') + ' aria-label="Next page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div>';
    }

    tbl.addEventListener('click', function (e) {
      var th = e.target.closest('[data-sort]');
      if (th) {
        var key = th.getAttribute('data-sort');
        state.sort = state.sort && state.sort.key === key ? { key: key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: key, dir: 'asc' };
        state.page = 1; load(); return;
      }
      var tr = e.target.closest('tr[data-i]'); if (!tr) return;
      var row = rows[Number(tr.getAttribute('data-i'))];
      var ab = e.target.closest('[data-act]');
      if (ab) { var a = actions.filter(function (x) { return x.id === ab.getAttribute('data-act'); })[0]; if (a) a.onClick(row, api_); return; }
      if (e.target.closest('a,button,input,select')) return;
      if (cfg.onRowClick) cfg.onRowClick(row);
    });
    pager.addEventListener('click', function (e) {
      if (e.target.closest('[data-prev]') && state.page > 1) { state.page--; load(); }
      if (e.target.closest('[data-next]')) { state.page++; load(); }
    });
    pager.addEventListener('change', function (e) { if (e.target.hasAttribute('data-size')) { state.pageSize = Number(e.target.value); state.page = 1; load(); } });

    function load() {
      if (ctl) ctl.abort();
      ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      loading = true; error = ''; errBox.className = 'hidden'; draw();
      var mine = ctl;
      return api.get(cfg.endpoint, { params: query(), signal: mine ? mine.signal : undefined }).then(function (res) {
        var body = res.data || {};
        rows = (cfg.rows || defaultRows)(body); total = cfg.total ? cfg.total(body) : defaultTotal(body, rows);
        if (cfg.onResponse) cfg.onResponse(body);
        loading = false; draw();
      }).catch(function (err) {
        if (mine && mine.signal.aborted) return;
        loading = false; rows = []; total = 0;
        var msg = err && err.response && err.response.data && err.response.data.message;
        error = typeof msg === 'string' && msg ? msg : 'The list could not be loaded.';
        errBox.className = 'flex items-start gap-3 rounded-lg border p-3 bg-error-subtle border-error text-error-fg text-sm';
        errBox.innerHTML = '<i class="fa-solid fa-circle-xmark mt-0.5 shrink-0" aria-hidden="true"></i><span class="flex-1"></span><button type="button" class="shrink-0 underline underline-offset-2" data-retry>Retry</button>';
        errBox.querySelector('span').textContent = error;
        errBox.querySelector('[data-retry]').addEventListener('click', load);
        draw();
      });
    }
    var api_ = { reload: load, setParams: function (p) { state.params = p || {}; state.page = 1; return load(); }, rows: function () { return rows; } };
    draw(); load();
    return api_;
  }

  // The page's notice line (#dl-notice): a success hides itself.
  var noticeTimer = null;
  function notice(kind, text) {
    var el = document.getElementById('dl-notice'); if (!el) return;
    clearTimeout(noticeTimer);
    var tone = { error: 'bg-error-subtle border-error text-error-fg', success: 'bg-success-subtle border-success text-success-fg', info: 'bg-info-subtle border-info text-info-fg', warning: 'bg-warning-subtle border-warning text-warning-fg' }[kind];
    var icon = { error: 'fa-circle-xmark', success: 'fa-circle-check', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' }[kind];
    el.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm ' + tone;
    el.innerHTML = '<i class="fa-solid ' + icon + ' mt-0.5 shrink-0" aria-hidden="true"></i><span></span>';
    el.lastChild.textContent = text;
    if (kind === 'success') noticeTimer = setTimeout(function () { el.className = 'hidden'; el.textContent = ''; }, 4000);
  }

  window.KuiList = { notice: notice, mount: mount, esc: esc, badge: badge, when: when, shortId: shortId };
})();
