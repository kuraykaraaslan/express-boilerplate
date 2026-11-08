/*
 * modules/ui/LogViewer/log-model.js
 *
 * Pure log model of LogViewer: severities, filtering (search, severity and field facets), the display list with
 * context lines pulled in around a selected line, facet counts, wrapped-height estimation, the row window and the
 * stream buffer rule. A port of kui-react modules/ui/LogViewer/model.ts plus the derived view the React component
 * computes in its body and the variable-height case of modules/ui/Virtual/useVirtualList.ts. No DOM. One source for
 * both sides: LogViewer.ejs loads it on the server through _observability/_load.ejs, the browser scripts are inlined
 * after it, and tests/log-viewer.test.ts runs it under Node. window.KuiLogModel.
 */
(function (global) {
  'use strict';
  if (global.KuiLogModel) return;

  var LOG_SEVERITIES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  var ROW_PAD = 4;
  var LINE_H = 20;
  // Row chrome in px: padding, border, line number, time, severity badge, copy button and the gaps between them.
  var GUTTER_PX = 270;
  var DEFAULT_CHAR_W = 7.2;
  var DEFAULT_LIST_W = 800;

  function severityRank(s) { return LOG_SEVERITIES.indexOf(s); }

  function hasActiveFilters(f) {
    var q = f.query && String(f.query).trim();
    if (q) return true;
    if (f.severities && f.severities.size) return true;
    var facets = f.facets || {};
    return Object.keys(facets).some(function (k) { return facets[k].size > 0; });
  }

  /** The value of a facet key on a line (`severity` and `source` are built in; other keys read `fields`). */
  function facetValue(line, key) {
    if (key === 'severity') return line.severity;
    if (key === 'source') return line.source;
    var v = line.fields ? line.fields[key] : undefined;
    return v === undefined ? undefined : String(v);
  }

  function matchesQuery(line, q) {
    if (line.message.toLowerCase().indexOf(q) !== -1) return true;
    if (line.source && line.source.toLowerCase().indexOf(q) !== -1) return true;
    if (line.fields) {
      var keys = Object.keys(line.fields);
      for (var i = 0; i < keys.length; i++) if ((keys[i] + '=' + line.fields[keys[i]]).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  /** Indices (into `lines`) of the lines that satisfy every filter. */
  function matchingIndices(lines, f) {
    var q = f.query ? String(f.query).trim().toLowerCase() : '';
    var sev = f.severities && f.severities.size > 0 ? f.severities : null;
    var facetEntries = Object.keys(f.facets || {}).filter(function (k) { return f.facets[k].size > 0; });
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (sev && !sev.has(line.severity)) continue;
      if (facetEntries.length && !facetEntries.every(function (key) { var v = facetValue(line, key); return v !== undefined && f.facets[key].has(v); })) continue;
      if (q && !matchesQuery(line, q)) continue;
      out.push(i);
    }
    return out;
  }

  /**
   * What the viewer lists: the matches plus, for each expanded line, the lines around it from the unfiltered stream.
   * `expansions` is keyed by line id. With no filter every line is a match and expansions change nothing.
   */
  function buildDisplay(lines, matches, expansions) {
    var ids = Object.keys(expansions);
    if (ids.length === 0) return { indices: matches, context: new Set() };
    var matchSet = new Set(matches);
    var keep = new Set(matches);
    if (matchSet.size < lines.length) {
      var byId = new Map();
      for (var i = 0; i < lines.length; i++) if (expansions[lines[i].id]) byId.set(lines[i].id, i);
      byId.forEach(function (idx, id) {
        var e = expansions[id];
        for (var k = Math.max(0, idx - e.before); k <= Math.min(lines.length - 1, idx + e.after); k++) keep.add(k);
      });
    }
    var indices = Array.from(keep).sort(function (a, b) { return a - b; });
    var context = new Set();
    indices.forEach(function (i) { if (!matchSet.has(i)) context.add(i); });
    return { indices: indices, context: context };
  }

  /** Top values per facet key (by count, then name), at most `limit` each. Counted over all `lines`. */
  function facetCounts(lines, keys, limit) {
    if (limit === undefined) limit = 8;
    var maps = {};
    keys.forEach(function (k) { maps[k] = new Map(); });
    lines.forEach(function (line) {
      keys.forEach(function (k) {
        var v = facetValue(line, k);
        if (v === undefined) return;
        maps[k].set(v, (maps[k].get(v) || 0) + 1);
      });
    });
    var out = {};
    keys.forEach(function (k) {
      var rows = [];
      maps[k].forEach(function (count, value) { rows.push({ value: value, count: count }); });
      if (k === 'severity') rows.sort(function (a, b) { return severityRank(a.value) - severityRank(b.value); });
      else rows.sort(function (a, b) { return (b.count - a.count) || a.value.localeCompare(b.value); });
      out[k] = rows.slice(0, limit);
    });
    return out;
  }

  /** Field keys worth a facet: present on at least a fifth of a sample of lines, with at most `maxValues` distinct values. */
  function detectFacetFields(lines, max, maxValues, sample) {
    if (max === undefined) max = 3;
    if (maxValues === undefined) maxValues = 8;
    if (sample === undefined) sample = 500;
    var n = Math.min(lines.length, sample);
    if (n === 0) return [];
    var seen = new Map();
    var counts = new Map();
    for (var i = 0; i < n; i++) {
      var fields = lines[i].fields;
      if (!fields) continue;
      Object.keys(fields).forEach(function (k) {
        counts.set(k, (counts.get(k) || 0) + 1);
        var set = seen.get(k);
        if (!set) { set = new Set(); seen.set(k, set); }
        if (set.size <= maxValues) set.add(String(fields[k]));
      });
    }
    var out = [];
    seen.forEach(function (vals, k) { if (vals.size >= 2 && vals.size <= maxValues && (counts.get(k) || 0) >= n / 5) out.push(k); });
    out.sort(function (a, b) { return ((counts.get(b) || 0) - (counts.get(a) || 0)) || a.localeCompare(b); });
    return out.slice(0, max);
  }

  /** Visual lines a message takes when it wraps at `charsPerRow` (monospace, break-anywhere). Never less than 1. */
  function wrappedLineCount(message, charsPerRow) {
    var width = Math.max(1, Math.floor(charsPerRow));
    var total = 0;
    var from = 0;
    for (;;) {
      var nl = message.indexOf('\n', from);
      var len = (nl === -1 ? message.length : nl) - from;
      total += Math.max(1, Math.ceil(len / width));
      if (nl === -1) break;
      from = nl + 1;
    }
    return total;
  }

  /** One log line as plain text, for copying. */
  function formatLineText(line, timeText) {
    var fields = line.fields ? Object.keys(line.fields).map(function (k) { return k + '=' + line.fields[k]; }).join(' ') : '';
    return [timeText, line.severity.toUpperCase(), line.source, line.message, fields].filter(Boolean).join(' ');
  }

  /** The retained window of a stream: appends `incoming` to `current`, keeps the newest `maxLines`, reports the drops. */
  function appendWindow(current, incoming, maxLines) {
    var max = Math.max(1, Math.floor(maxLines));
    if (incoming.length === 0) return { lines: current, dropped: 0 };
    var merged = current.concat(incoming);
    var dropped = Math.max(0, merged.length - max);
    return { lines: dropped ? merged.slice(dropped) : merged, dropped: dropped };
  }

  // ── The row window (kui-react useVirtualList, rows of different heights) ────────────────────────────
  /** Prefix sums: out[i] is the top of row i, out[count] the total height. */
  function buildOffsets(count, rowHeight) {
    var out = new Array(count + 1);
    if (typeof rowHeight === 'number') { for (var i = 0; i <= count; i++) out[i] = i * rowHeight; return out; }
    var acc = 0;
    for (var j = 0; j < count; j++) { out[j] = acc; acc += Math.max(1, rowHeight(j)); }
    out[count] = acc;
    return out;
  }

  /** Index of the row containing `offset` (clamped to 0..count-1; -1 when empty). */
  function findIndex(offsets, offset) {
    var count = offsets.length - 1;
    if (count <= 0) return -1;
    if (offset <= 0) return 0;
    if (offset >= offsets[count]) return count - 1;
    var lo = 0, hi = count - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function windowRows(offsets, scrollTop, viewport, overscan) {
    var count = offsets.length - 1;
    var top = Math.max(0, scrollTop);
    var start = Math.max(0, findIndex(offsets, top) - overscan);
    var end = Math.min(count, findIndex(offsets, top + viewport) + 1 + overscan);
    var total = offsets[count] || 0;
    if (count <= 0) { start = 0; end = 0; }
    return { start: start, end: end, offsetTop: offsets[start] || 0, offsetBottom: Math.max(0, total - (offsets[end] === undefined ? total : offsets[end])), total: total };
  }

  /**
   * Everything the component derives from its state, in the order the React body does it.
   * ui: { query, searchMode, severities (Set), facets ({ key: Set }), expansions, wrap }
   * env: { facetFields, listWidth, charWidth, scrollTop, viewport }
   */
  function derive(lines, ui, env) {
    env = env || {};
    var fields = env.facetFields || detectFacetFields(lines);
    var facetKeys = ['severity'].concat(fields);
    var facets = facetCounts(lines, facetKeys);
    var filters = { query: ui.searchMode === 'filter' ? ui.query : '', severities: ui.severities, facets: ui.facets };
    var matches = matchingIndices(lines, filters);
    var display = buildDisplay(lines, matches, ui.expansions);
    var rows = display.indices;
    var shown = new Set(rows);
    var highlight = ui.searchMode === 'highlight' && String(ui.query).trim()
      ? matchingIndices(lines, { query: ui.query }).filter(function (i) { return shown.has(i); }) : [];
    var charW = env.charWidth > 0 ? env.charWidth : DEFAULT_CHAR_W;
    var charsPerRow = Math.max(12, Math.floor(((env.listWidth || DEFAULT_LIST_W) - GUTTER_PX) / charW));
    var rowHeight = ui.wrap
      ? function (i) { return wrappedLineCount(lines[rows[i]] ? lines[rows[i]].message : '', charsPerRow) * LINE_H + ROW_PAD * 2; }
      : LINE_H + ROW_PAD * 2;
    var offsets = buildOffsets(rows.length, rowHeight);
    var win = windowRows(offsets, env.scrollTop || 0, env.viewport || 400, 10);
    return {
      fields: fields, facetKeys: facetKeys, facets: facets, filters: filters, filtered: hasActiveFilters(filters), matches: matches,
      display: display, rows: rows, shown: shown, highlight: highlight, charsPerRow: charsPerRow, offsets: offsets, window: win
    };
  }

  var api = {
    LOG_SEVERITIES: LOG_SEVERITIES, ROW_PAD: ROW_PAD, LINE_H: LINE_H, GUTTER_PX: GUTTER_PX,
    severityRank: severityRank, hasActiveFilters: hasActiveFilters, facetValue: facetValue, matchingIndices: matchingIndices,
    buildDisplay: buildDisplay, facetCounts: facetCounts, detectFacetFields: detectFacetFields, wrappedLineCount: wrappedLineCount,
    formatLineText: formatLineText, appendWindow: appendWindow, buildOffsets: buildOffsets, findIndex: findIndex,
    windowRows: windowRows, derive: derive
  };
  global.KuiLogModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
