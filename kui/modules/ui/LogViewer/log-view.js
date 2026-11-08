/*
 * modules/ui/LogViewer/log-view.js
 *
 * The markup of LogViewer as strings, for the browser script: a list that filters, steps through matches, expands
 * context and takes new lines has to draw rows and panels itself. The server draws the same markup in
 * LogViewer.ejs; tests/batch-b-parity.test.ts draws it with these functions too, from the page's own config and lines,
 * and compares both with the HTML kui-react renders, so the two cannot drift. Pure (strings in, strings out), needs
 * KuiObsFormat and KuiLogModel (loaded first). The class lists are kui-react's, after its class merge (`cn`).
 * window.KuiLogView.
 */
(function (global) {
  'use strict';
  if (global.KuiLogView) return;
  var F = global.KuiObsFormat;
  var M = global.KuiLogModel;
  var esc = F.escapeHtml;

  var FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var GHOST_BASE = 'inline-flex items-center rounded border px-2 py-1 text-xs transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50 ' + FOCUS;
  var GHOST = GHOST_BASE + ' border-border bg-surface-base text-text-primary';
  var FOLLOW_ON = GHOST_BASE + ' gap-1.5 border-success bg-success-subtle text-success-fg';
  var FOLLOW_OFF = GHOST + ' gap-1.5';
  var CHIP_ON = 'border-primary bg-primary-subtle text-primary';
  var CHIP_OFF = 'border-border bg-surface-base text-text-secondary hover:bg-surface-overlay';
  var SEV = {
    trace: { badge: 'text-text-disabled', bar: 'border-s-2 border-border', row: '' },
    debug: { badge: 'text-text-secondary', bar: 'border-s-2 border-border-strong', row: '' },
    info: { badge: 'text-info', bar: 'border-s-2 border-info', row: '' },
    warn: { badge: 'text-warning-fg bg-warning-subtle', bar: 'border-s-2 border-warning', row: '' },
    error: { badge: 'text-error-fg bg-error-subtle', bar: 'border-s-2 border-error', row: '' },
    fatal: { badge: 'text-error-fg bg-error-subtle font-bold', bar: 'border-error border-s-4', row: 'bg-error-subtle/40' }
  };
  var LINE_H = M.LINE_H;
  var ROW_PAD = M.ROW_PAD;

  function icon(name, cls) { return '<i class="fa-solid fa-' + name + (cls ? ' ' + cls : '') + '" aria-hidden="true"></i>'; }
  function fill(t, v) { return F.fillMessage(t, v); }
  function num(n) { return Number(n).toLocaleString(); }

  /** Everything the pieces below read, from a context { uid, msg, lines, ui, env }, in the order React computes it. */
  function view(ctx) {
    var ui = ctx.ui;
    var d = M.derive(ctx.lines, ui, ctx.env);
    var lines = ctx.lines;
    var selIndex = ui.selected ? lines.findIndex(function (l) { return l.id === ui.selected; }) : -1;
    var selected = selIndex >= 0 ? ui.selected : null;
    var want = ui.activeId != null ? ui.activeId : selected;
    var ai = -1;
    if (want) for (var i = 0; i < d.rows.length; i++) if (lines[d.rows[i]].id === want) { ai = i; break; }
    if (ai < 0) ai = d.rows.length ? 0 : -1;
    return {
      ctx: ctx, ui: ui, d: d, lines: lines, msg: ctx.msg, selIndex: selIndex, selected: selected, activeIndex: ai,
      matchSet: new Set(d.highlight), rowId: function (id) { return ctx.uid + '-line-' + id; },
      isFacetOn: function (key, value) { return key === 'severity' ? ui.severities.has(value) : Boolean(ui.facets[key] && ui.facets[key].has(value)); }
    };
  }

  function clearButton(v) {
    if (!v.ui.query) return '';
    return '<button type="button" aria-label="' + esc(v.msg.clearSearch) + '" data-lv-clear-search class="absolute end-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-secondary hover:bg-surface-overlay ' + FOCUS + '">' + icon('xmark', 'h-3 w-3') + '</button>';
  }

  function searchBox(v) {
    if (v.ui.hideSearch) return '';
    return '<div class="relative min-w-48 flex-1" data-lv-search-wrap>' + icon('magnifying-glass', 'pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled')
      + '<input type="search" value="' + esc(v.ui.query) + '" aria-label="' + esc(v.msg.searchLabel) + '" placeholder="' + esc(v.msg.searchPlaceholder) + '" data-lv-search class="w-full rounded-md border border-border bg-surface-base py-1.5 ps-8 pe-8 text-text-primary placeholder:text-text-disabled ' + FOCUS + '">'
      + clearButton(v) + '</div>';
  }

  function nav(v) {
    if (!(v.ui.searchMode === 'highlight' && String(v.ui.query).trim() !== '')) return '';
    var hm = v.d.highlight;
    var pos = hm.length ? fill(v.msg.matchPosition, { current: Math.min(v.ui.matchPos + 1, hm.length), total: hm.length }) : fill(v.msg.matchPosition, { current: 0, total: 0 });
    var dis = hm.length ? '' : ' disabled';
    return '<div class="flex items-center gap-1 text-xs text-text-secondary" data-lv-nav><button type="button" class="' + GHOST + '"' + dis + ' data-lv-prev>' + esc(v.msg.previousMatch) + '</button>'
      + '<button type="button" class="' + GHOST + '"' + dis + ' data-lv-next>' + esc(v.msg.nextMatch) + '</button><span aria-live="polite">' + esc(pos) + '</span></div>';
  }

  function wrapLabel(v) {
    return '<label class="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary" data-lv-wrap-label><input type="checkbox"' + (v.ui.wrap ? ' checked' : '') + ' data-lv-wrap class="h-3.5 w-3.5 accent-primary ' + FOCUS + '">' + esc(v.msg.wrap) + '</label>';
  }

  function followInner(v) {
    return icon(v.ui.following ? 'play' : 'pause', 'h-3 w-3') + esc(v.msg.follow) + (v.ui.following ? '' : '<span class="text-text-secondary">(' + esc(v.msg.paused) + ')</span>');
  }
  function followClass(v) { return v.ui.following ? FOLLOW_ON : FOLLOW_OFF; }
  function followButton(v) {
    return '<button type="button" aria-pressed="' + (v.ui.following ? 'true' : 'false') + '" data-lv-follow class="' + followClass(v) + '">' + followInner(v) + '</button>';
  }

  function tail(v) {
    var out = '';
    if (v.ui.dropped > 0) out += '<span role="status" data-lv-dropped class="rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning-fg">' + esc(fill(v.msg.dropped, { count: num(v.ui.dropped) })) + '</span>';
    if (v.d.filtered || v.ui.searchMode === 'highlight') out += '<span class="ms-auto text-xs text-text-secondary" data-lv-count>' + esc(fill(v.msg.lineCount, { shown: num(v.d.rows.length), total: num(v.lines.length) })) + '</span>';
    return out;
  }

  function toolbar(v) {
    return '<div class="flex flex-wrap items-center gap-2" data-lv-toolbar>' + searchBox(v) + nav(v) + wrapLabel(v) + followButton(v) + tail(v) + '</div>';
  }

  function facets(v) {
    var d = v.d;
    if (!d.facetKeys.some(function (k) { return d.facets[k] && d.facets[k].length; })) return '';
    var out = '<div class="flex flex-col gap-1.5" data-lv-facets>';
    d.facetKeys.forEach(function (key) {
      if (!(d.facets[key] && d.facets[key].length)) return;
      out += '<div role="group" aria-label="' + esc(fill(v.msg.facetGroup, { field: key })) + '" class="flex flex-wrap items-center gap-1.5"><span class="text-xs font-medium text-text-secondary">' + esc(key) + '</span>';
      d.facets[key].forEach(function (f) {
        var on = v.isFacetOn(key, f.value);
        out += '<button type="button" aria-pressed="' + (on ? 'true' : 'false') + '" data-lv-facet-key="' + esc(key) + '" data-lv-facet-value="' + esc(f.value) + '" class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ' + FOCUS + ' ' + (on ? CHIP_ON : CHIP_OFF) + '">'
          + (on ? icon('check', 'h-2.5 w-2.5') : '') + esc(key === 'severity' ? (v.msg.severity[f.value] || f.value) : f.value) + '<span class="text-text-disabled">' + esc(num(f.count)) + '</span></button>';
      });
      out += '</div>';
    });
    if (d.filtered) out += '<button type="button" data-lv-clear-filters class="' + GHOST + ' self-start">' + esc(v.msg.clearFilters) + '</button>';
    return out + '</div>';
  }

  function highlighted(text, query) {
    if (!String(query).trim()) return esc(text);
    return F.splitMatches(text, query).map(function (p) {
      return p.match ? '<mark class="rounded-sm bg-warning-subtle px-0.5 text-text-primary">' + esc(p.text) + '</mark>' : '<span>' + esc(p.text) + '</span>';
    }).join('');
  }

  function row(v, lineIndex, position) {
    var line = v.lines[lineIndex];
    var ui = v.ui;
    var sev = SEV[line.severity] || SEV.info;
    var isSel = v.selected === line.id;
    var isCtx = v.d.display.context.has(lineIndex);
    var isMatch = v.matchSet.has(lineIndex);
    var ms = F.toEpochMs(line.ts);
    var valid = isFinite(ms);
    var lh = 'line-height: ' + LINE_H + 'px';
    var cls = 'group flex cursor-pointer items-start gap-2 px-2 hover:bg-surface-overlay ' + sev.bar + (isSel ? ' bg-primary-subtle' : (sev.row ? ' ' + sev.row : ''))
      + (isCtx ? ' opacity-70' : '') + (v.activeIndex === position ? ' outline-2 -outline-offset-2 outline-border-focus' : '');
    var style = (ui.wrap ? '' : 'min-height: ' + (LINE_H + ROW_PAD * 2) + 'px; height: ' + (LINE_H + ROW_PAD * 2) + 'px; ') + 'padding-block: ' + ROW_PAD + 'px';
    var query = ui.searchMode === 'highlight' || v.d.filters.query ? ui.query : '';
    return '<div id="' + esc(v.rowId(line.id)) + '" role="option" aria-selected="' + (isSel ? 'true' : 'false') + '" aria-posinset="' + (position + 1) + '" aria-setsize="' + v.d.rows.length + '" data-severity="' + esc(line.severity) + '"'
      + (isCtx ? ' data-context="true"' : '') + (isMatch ? ' data-match="true"' : '') + ' data-lv-row="' + esc(line.id) + '" class="' + cls + '" style="' + style + '">'
      + '<span aria-hidden="true" class="w-12 shrink-0 select-none text-end text-text-disabled" style="' + lh + '">' + (lineIndex + 1) + '</span>'
      + '<time class="w-24 shrink-0 text-text-secondary" style="' + lh + '"' + (valid ? ' datetime="' + esc(new Date(ms).toISOString()) + '"' : '') + '>' + (valid ? esc(F.formatClock(ms, ui.timeZone)) : '–') + '</time>'
      + '<span class="w-12 shrink-0 rounded px-1 text-center text-[10px] ' + (line.severity === 'fatal' ? '' : 'font-semibold ') + sev.badge + '" style="' + lh + '">' + esc(v.msg.severity[line.severity] || line.severity) + '</span>'
      + '<span class="min-w-0 flex-1 text-text-primary ' + (ui.wrap ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-pre') + '" style="' + lh + '">'
      + (isCtx ? '<span class="sr-only">' + esc(v.msg.context) + ': </span>' : '') + (line.source ? '<span class="me-2 text-text-secondary">' + esc(line.source) + '</span>' : '') + highlighted(line.message, query) + '</span>'
      + '<button type="button" tabindex="-1" aria-label="' + esc(v.msg.copy) + '" title="' + esc(v.msg.copy) + '" data-lv-copy="' + esc(line.id) + '" class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-surface-sunken ' + (isSel ? 'opacity-100' : 'opacity-0') + ' group-hover:opacity-100 focus-visible:opacity-100">' + icon('copy', 'h-3 w-3') + '</button></div>';
  }

  /** The inside of the listbox: the empty message, or the windowed rows between their two spacers. */
  function rows(v) {
    var d = v.d;
    if (d.rows.length === 0) return '<div class="p-4 font-sans text-sm text-text-secondary">' + esc(v.lines.length === 0 ? v.msg.noLines : v.msg.noMatches) + '</div>';
    var w = d.window;
    var out = w.offsetTop > 0 ? '<div aria-hidden="true" style="height: ' + w.offsetTop + 'px"></div>' : '';
    for (var i = w.start; i < w.end; i++) out += row(v, d.rows[i], i);
    return out + (w.offsetBottom > 0 ? '<div aria-hidden="true" style="height: ' + w.offsetBottom + 'px"></div>' : '');
  }

  function listAttrs(v) {
    return v.activeIndex >= 0 ? ' aria-activedescendant="' + esc(v.rowId(v.lines[v.d.rows[v.activeIndex]].id)) + '"' : '';
  }

  function newLines(v) {
    if (v.ui.following || !(v.ui.newWhilePaused > 0)) return '';
    return '<button type="button" data-lv-newlines class="absolute bottom-3 start-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-fg shadow-md hover:bg-primary-hover ' + FOCUS + '">'
      + esc(fill(v.msg.newLines, { count: num(v.ui.newWhilePaused) })) + ' · ' + esc(v.msg.jumpToLatest) + '</button>';
  }

  function list(v) {
    return '<div class="relative"><span aria-hidden="true" class="invisible absolute -z-10 whitespace-pre font-mono text-xs" data-lv-probe>' + '00000000000000000000' + '</span>'
      + '<div role="listbox" tabindex="0" aria-label="' + esc(v.msg.label) + '"' + listAttrs(v) + ' data-lv-list class="overflow-auto rounded-md border border-border bg-surface-base font-mono text-xs ' + FOCUS + '" style="height: ' + v.ui.height + 'px">'
      + rows(v) + '</div>' + newLines(v) + '</div>';
  }

  function status(v) { return '<div class="sr-only" role="status" aria-live="polite" data-lv-status>' + esc(v.ui.status || '') + '</div>'; }

  function detail(v) {
    if (v.selIndex < 0) return '';
    var line = v.lines[v.selIndex];
    var ui = v.ui;
    var shown = v.d.shown;
    var hiddenBefore = v.selIndex > 0 && !shown.has(v.selIndex - 1);
    var hiddenAfter = v.selIndex < v.lines.length - 1 && !shown.has(v.selIndex + 1);
    var out = '<section role="region" aria-label="' + esc(v.msg.selectedLine) + '" data-lv-detail class="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-3">'
      + '<pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-text-primary">' + esc(line.message) + '</pre>';
    var keys = line.fields ? Object.keys(line.fields) : [];
    if (keys.length > 0) {
      out += '<div class="flex flex-wrap items-center gap-1.5"><span class="text-xs font-medium text-text-secondary">' + esc(v.msg.fields) + '</span>';
      keys.forEach(function (k) {
        var val = String(line.fields[k]);
        var on = v.isFacetOn(k, val);
        var filterable = k !== 'severity' && M.facetValue(line, k) !== undefined;
        out += '<button type="button" aria-pressed="' + (on ? 'true' : 'false') + '"' + (filterable ? '' : ' disabled') + ' data-lv-facet-key="' + esc(k) + '" data-lv-facet-value="' + esc(val) + '" class="rounded-full border px-2 py-0.5 font-mono text-xs transition-colors ' + FOCUS + ' ' + (on ? CHIP_ON : CHIP_OFF) + '">' + esc(k) + '=' + esc(val) + '</button>';
      });
      out += '</div>';
    }
    out += '<div class="flex flex-wrap gap-2"><button type="button" data-lv-copy="' + esc(line.id) + '" class="' + GHOST + '">' + icon('copy', 'me-1.5 h-3 w-3') + esc(v.msg.copy) + '</button>';
    if (hiddenBefore) out += '<button type="button" data-lv-context="before" class="' + GHOST + '">' + esc(fill(v.msg.showBefore, { count: ui.contextStep })) + '</button>';
    if (hiddenAfter) out += '<button type="button" data-lv-context="after" class="' + GHOST + '">' + esc(fill(v.msg.showAfter, { count: ui.contextStep })) + '</button>';
    if (ui.expansions[line.id]) out += '<button type="button" data-lv-context="hide" class="' + GHOST + '">' + esc(v.msg.hideContext) + '</button>';
    return out + '</div></section>';
  }

  /** The children of the root, in order. */
  function inner(v) { return toolbar(v) + facets(v) + list(v) + status(v) + detail(v); }

  var api = {
    view: view, inner: inner, toolbar: toolbar, searchBox: searchBox, clearButton: clearButton, nav: nav, wrapLabel: wrapLabel,
    followButton: followButton, followInner: followInner, followClass: followClass, tail: tail, facets: facets, rows: rows,
    listAttrs: listAttrs, newLines: newLines, list: list, status: status, detail: detail, row: row
  };
  global.KuiLogView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
