/*
 * modules/ui/Table/scripts/table-logic.js
 *
 * Pure helpers of the DataTable browser script. No DOM. Mirrors kui-react
 * modules/ui/Table/core/filterPanel.ts (isFilterValueActive, activeFilterValues,
 * defaultFilterValues, matchFilterField, builtInDatePresets, filterValueText,
 * filterChipText), core/useRowState.ts (toggle / toggleShown), core/useTable.ts
 * (nextSortState), core/columnHelpers.ts (sortMappers) and types.ts
 * (formatMessage), plus the query string server mode sends (`fetchQuery`).
 *
 * A row id is identified by its JSON text (`keyOf`), so 1 and "1" stay different
 * ids, as in kui-react's Set.
 * Exposed as window.KuiDataTableLogic (and module.exports under Node).
 */
(function (global) {
  'use strict';

  /** The identity of a row id. */
  function keyOf(id) { return JSON.stringify(id); }

  /** The ids with `id` toggled; a new id goes last (a Set keeps insertion order). */
  function toggleId(ids, id) {
    var key = keyOf(id);
    var out = [];
    var had = false;
    for (var i = 0; i < ids.length; i++) {
      if (keyOf(ids[i]) === key) had = true;
      else out.push(ids[i]);
    }
    if (!had) out.push(id);
    return out;
  }

  /**
   * Header checkbox: selects the rows shown, or clears them when all are already
   * selected. Rows on other pages keep their state either way.
   */
  function toggleShown(ids, shownIds) {
    var keys = ids.map(keyOf);
    var allShown = shownIds.length > 0 && shownIds.every(function (id) { return keys.indexOf(keyOf(id)) !== -1; });
    var out = ids.slice();
    shownIds.forEach(function (id) {
      var k = keyOf(id);
      var at = -1;
      for (var i = 0; i < out.length; i++) { if (keyOf(out[i]) === k) { at = i; break; } }
      if (allShown) { if (at !== -1) out.splice(at, 1); }
      else if (at === -1) out.push(id);
    });
    return out;
  }

  /** The header checkbox state for the rows shown. */
  function headerState(ids, shownIds) {
    var keys = ids.map(keyOf);
    var n = shownIds.filter(function (id) { return keys.indexOf(keyOf(id)) !== -1; }).length;
    var all = shownIds.length > 0 && n === shownIds.length;
    return { checked: all, indeterminate: n > 0 && !all, disabled: shownIds.length === 0 };
  }

  /** A `numberrange` value: `{ min, max }`, either end may be null. */
  function isNumberRange(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && ('min' in value || 'max' in value);
  }

  /** Whether a field's value narrows the rows at all. */
  function isFilterValueActive(field, value) {
    if (value === undefined || value === null || value === '' || value === false) return false;
    if (typeof value === 'number') return !isNaN(value);
    if (Array.isArray(value)) {
      if (field.type === 'range') return value[0] !== field.min || value[1] !== field.max;
      return value.length > 0;
    }
    if (isNumberRange(value)) return value.min !== null && value.min !== undefined || value.max !== null && value.max !== undefined;
    if (typeof value === 'object') return Boolean(value.from || value.to);
    return true;
  }

  /** Whether the field is a single choice that is always set (`required` on a select or radio field). */
  function isRequiredChoice(field) {
    return !!field && field.required === true && (field.type === 'select' || field.type === 'radio');
  }

  /** Whether the field is drawn in the toolbar (`placement: 'toolbar'` on a select or radio field). */
  function inToolbar(field) {
    return !!field && field.placement === 'toolbar' && (field.type === 'select' || field.type === 'radio');
  }

  /**
   * Every field's `defaultValue`, keyed by field id (the start values, and what Reset returns to); a
   * required choice without one starts on its first option.
   */
  function defaultFilterValues(fields) {
    var out = {};
    (fields || []).forEach(function (field) {
      if (field.defaultValue !== undefined) out[field.id] = field.defaultValue;
      else if (isRequiredChoice(field) && field.options && field.options.length > 0) out[field.id] = field.options[0].value;
    });
    return out;
  }

  /** The values "Clear all" keeps: every required choice, back on its default. */
  function requiredFilterDefaults(fields) {
    var defaults = defaultFilterValues(fields);
    var out = {};
    (fields || []).forEach(function (field) {
      if (isRequiredChoice(field) && Object.prototype.hasOwnProperty.call(defaults, field.id)) out[field.id] = defaults[field.id];
    });
    return out;
  }

  /** An empty cell (`null`, `undefined`, `''`): it sorts last whatever the direction. */
  function isEmptyCell(v) { return v === undefined || v === null || v === ''; }

  /** Two set cells: numbers by value, anything else as text with numeric awareness. */
  function compareCells(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  /**
   * kui-react applySort over a list of indices into `data`: entries in order, the first non-zero
   * comparison wins; empty values go last in both directions.
   */
  function sortIndices(indices, data, sort) {
    if (!sort || !sort.length) return indices;
    return indices.slice().sort(function (a, b) {
      for (var s = 0; s < sort.length; s++) {
        var key = sort[s].key;
        var av = data[a] ? data[a][key] : undefined;
        var bv = data[b] ? data[b][key] : undefined;
        var ae = isEmptyCell(av);
        var be = isEmptyCell(bv);
        if (ae || be) {
          if (ae && be) continue;
          return ae ? 1 : -1;
        }
        var cmp = compareCells(av, bv);
        if (cmp !== 0) return sort[s].dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  /**
   * kui-react applyGrouping: the items of one group together, groups in the order they first appear in
   * `order` (keys in source order), each group keeping the order `items` gave it.
   */
  function groupItems(items, keyOfItem, order) {
    var rank = {};
    var n = 0;
    (order || []).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(rank, k)) rank[k] = n++; });
    var buckets = {};
    var keys = [];
    items.forEach(function (it) {
      var k = keyOfItem(it);
      if (!Object.prototype.hasOwnProperty.call(rank, k)) rank[k] = n++;
      if (!Object.prototype.hasOwnProperty.call(buckets, k)) { buckets[k] = []; keys.push(k); }
      buckets[k].push(it);
    });
    keys.sort(function (a, b) { return rank[a] - rank[b]; });
    var out = [];
    keys.forEach(function (k) { out = out.concat(buckets[k]); });
    return out;
  }

  /** The set values only, in field order: what a server receives. */
  function activeFilterValues(fields, values) {
    var out = {};
    values = values || {};
    fields.forEach(function (field) {
      if (isFilterValueActive(field, values[field.id])) out[field.id] = values[field.id];
    });
    return out;
  }

  function day(raw) { return raw === undefined || raw === null ? '' : String(raw).slice(0, 10); }

  /**
   * Default client-side match: compares `row[field.id]` by field type. `match`, when
   * given, is the field's own matcher (kui-react `field.match`); in the browser it is
   * the global function named by the field's `match` string.
   */
  function matchFilterField(field, row, value, match) {
    if (typeof match === 'function') return !!match(row, value);
    var raw = row ? row[field.id] : undefined;
    var rawList = Array.isArray(raw) ? raw.map(String) : [String(raw === undefined || raw === null ? '' : raw)];
    switch (field.type) {
      case 'text':
        return String(raw === undefined || raw === null ? '' : raw).toLowerCase().indexOf(String(value).toLowerCase()) !== -1;
      case 'number':
        return Number(raw) === value;
      case 'select':
      case 'radio':
        return rawList.indexOf(String(value)) !== -1;
      case 'multiselect':
      case 'checkboxes':
        return rawList.some(function (r) { return value.indexOf(r) !== -1; });
      case 'checkbox':
        return Boolean(raw);
      case 'date':
        return day(raw) === value;
      case 'daterange': {
        var d = day(raw);
        return d !== '' && (!value.from || d >= value.from) && (!value.to || d <= value.to);
      }
      case 'range': {
        var n = Number(raw);
        return n >= value[0] && n <= value[1];
      }
      case 'numberrange': {
        if (raw === undefined || raw === null || raw === '') return false;
        var x = Number(raw);
        var min = value.min === undefined ? null : value.min;
        var max = value.max === undefined ? null : value.max;
        return (min === null || x >= min) && (max === null || x <= max);
      }
      default:
        // `custom` without `match` only reaches the server.
        return true;
    }
  }

  /** Whether a row passes every set field. `matchers` maps a field id to its own matcher. */
  function matchRow(fields, active, row, matchers) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!Object.prototype.hasOwnProperty.call(active, f.id)) continue;
      if (!matchFilterField(f, row, active[f.id], matchers ? matchers[f.id] : undefined)) return false;
    }
    return true;
  }

  /**
   * Server mode wire format (GET query string): page, pageSize and search as plain
   * parameters; sort, filters and filterValues as JSON text. kui-react passes the same
   * object to `fetchPage`.
   */
  function fetchQuery(args) {
    var parts = [
      ['page', String(args.page)],
      ['pageSize', String(args.pageSize)],
      ['search', args.search || ''],
      ['sort', JSON.stringify(args.sort || [])],
      ['filters', JSON.stringify(args.filters || {})],
      ['filterValues', JSON.stringify(args.filterValues || {})]
    ];
    return parts.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
  }

  /**
   * The inverse of `fetchQuery`, for an Express route: pass `req.query`. Bad JSON
   * reads as empty; page and pageSize fall back to 1 and 10.
   */
  function parseFetchQuery(query) {
    query = query || {};
    function json(text, fallback) {
      if (typeof text !== 'string' || text === '') return fallback;
      try { var v = JSON.parse(text); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
    }
    var page = parseInt(query.page, 10);
    var pageSize = parseInt(query.pageSize, 10);
    var sort = json(query.sort, []);
    return {
      page: page > 0 ? page : 1,
      pageSize: pageSize > 0 ? pageSize : 10,
      search: typeof query.search === 'string' ? query.search : '',
      sort: Array.isArray(sort) ? sort : [],
      filters: json(query.filters, {}),
      filterValues: json(query.filterValues, {})
    };
  }

  /** `{count} selected` with the count filled in. */
  function fillCount(template, n) { return String(template).split('{count}').join(String(n)); }

  /** Fills `{name}` placeholders of a message (kui-react formatMessage). */
  function formatMessage(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (all, name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : all;
    });
  }

  /**
   * The next sort after a click on a column header. Without `multi` the column replaces the sort
   * (asc, desc, off); with it (shift held and `multiSort` on) the column is added or cycled in place.
   */
  function nextSortState(curr, key, multi) {
    var idx = -1;
    for (var i = 0; i < curr.length; i++) { if (curr[i].key === key) { idx = i; break; } }
    if (!multi) {
      if (idx < 0) return [{ key: key, dir: 'asc' }];
      return curr[idx].dir === 'asc' ? [{ key: key, dir: 'desc' }] : [];
    }
    var next = curr.slice();
    if (idx < 0) { next.push({ key: key, dir: 'asc' }); return next; }
    if (next[idx].dir === 'asc') { next[idx] = { key: key, dir: 'desc' }; return next; }
    next.splice(idx, 1);
    return next;
  }

  /**
   * Maps sort entries between column keys and the outward sort keys (`column.sortKey`) that
   * server mode sends and manual mode reports.
   */
  function sortMappers(columns) {
    var out = {};
    var back = {};
    (columns || []).forEach(function (col) {
      if (!col.sortKey) return;
      out[String(col.key)] = col.sortKey;
      back[col.sortKey] = String(col.key);
    });
    function map(table) {
      return function (sort) {
        return (sort || []).map(function (s) {
          var copy = { key: Object.prototype.hasOwnProperty.call(table, s.key) ? table[s.key] : s.key, dir: s.dir };
          return copy;
        });
      };
    }
    return { toWire: map(out), fromWire: map(back) };
  }

  /** `YYYY-MM-DD` in local time, the wire format of date filters. */
  function toDay(d) {
    if (!d) return null;
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** The built-in date-range presets (`presets: true`), relative to `today`. */
  function builtInDatePresets(msgs, today) {
    msgs = msgs || {};
    today = today || new Date();
    var y = today.getFullYear();
    var m = today.getMonth();
    var d = today.getDate();
    function back(days) { return toDay(new Date(y, m, d - days)); }
    return [
      { label: msgs.presetToday || 'Today', from: toDay(today), to: toDay(today) },
      { label: msgs.presetLast7Days || 'Last 7 days', from: back(6), to: toDay(today) },
      { label: msgs.presetLast30Days || 'Last 30 days', from: back(29), to: toDay(today) },
      { label: msgs.presetThisMonth || 'This month', from: toDay(new Date(y, m, 1)), to: toDay(today) },
      { label: msgs.presetLastMonth || 'Last month', from: toDay(new Date(y, m - 1, 1)), to: toDay(new Date(y, m, 0)) }
    ];
  }

  function optionLabel(options, v) {
    var list = options || [];
    for (var i = 0; i < list.length; i++) if (list[i].value === v) return list[i].label;
    return v;
  }

  /**
   * Readable text of a set value, without the field label. `format`, when given, is the field's own
   * formatter (kui-react `field.formatChip`; in the browser the global function named by `formatChip`).
   */
  function filterValueText(field, value, format) {
    if (typeof format === 'function') return String(format(value));
    switch (field.type) {
      case 'select':
      case 'radio':
        return optionLabel(field.options, String(value));
      case 'multiselect':
      case 'checkboxes':
        return value.map(function (v) { return optionLabel(field.options, v); }).join(', ');
      case 'checkbox':
        return '';
      case 'daterange': {
        var from = value.from;
        var to = value.to;
        if (from && to) return from === to ? from : from + ' – ' + to;
        return from ? '≥ ' + from : '≤ ' + to;
      }
      case 'range':
        return value[0] + ' – ' + value[1];
      case 'numberrange': {
        var min = value.min === undefined ? null : value.min;
        var max = value.max === undefined ? null : value.max;
        if (min !== null && max !== null) return min + ' – ' + max;
        return min !== null ? '≥ ' + min : '≤ ' + max;
      }
      default:
        return Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  /** One chip per set field: `Status: Paid`; a checkbox field shows its label alone. */
  function filterChipText(field, value, format) {
    var text = filterValueText(field, value, format);
    return text ? field.label + ': ' + text : field.label;
  }

  // --- Column chooser (kui-react core/columnVisibility.ts) ------------------------------------------

  /** The localStorage key a table's column choices live under (the same key as kui-react); `v1` is the stored shape. */
  function columnChoicesKey(tableId) {
    return 'kui.dataTable.columns.v1.' + tableId;
  }

  /** Stored text -> { columnKey: shown }; anything unreadable counts as none. */
  function parseColumnChoices(raw) {
    if (!raw) return {};
    try {
      var value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      var out = {};
      Object.keys(value).forEach(function (k) { if (typeof value[k] === 'boolean') out[k] = value[k]; });
      return out;
    } catch (e) {
      return {};
    }
  }

  /**
   * The chooser's state for `cols` (every column, { key, hideable, defaultHidden, hideBelow }) and the viewer's own
   * `choices`: `hidden` (keys), `base` (the choice the next change starts from) and `locked` (the keys the viewer may
   * not hide). Only the viewer's own choices are stored, so a column without one follows its default. A choice that
   * would leave the table without a column is ignored (the defaults apply and the next change starts from them);
   * columns that all start hidden all show. A column without `hideBelow` shows on every screen: when the table has
   * one, it keeps one such column, so the last of them is locked unless a column that cannot be hidden does that.
   */
  function resolveColumns(cols, choices) {
    var resolve = function (from) {
      return cols.filter(function (c) {
        if (c.hideable === false) return true;
        var key = String(c.key);
        return Object.prototype.hasOwnProperty.call(from, key) ? from[key] : !c.defaultHidden;
      });
    };
    var anyOnEveryScreen = cols.some(function (c) { return !c.hideBelow; });
    var enough = function (list) {
      return list.length > 0 && (!anyOnEveryScreen || list.some(function (c) { return !c.hideBelow; }));
    };
    var base = choices || {};
    var shown = resolve(base);
    if (!enough(shown)) {
      base = {};
      shown = resolve(base);
    }
    if (shown.length === 0) {
      base = {};
      cols.forEach(function (c) { base[String(c.key)] = true; });
      shown = cols.slice();
    }
    var keepers = anyOnEveryScreen ? shown.filter(function (c) { return !c.hideBelow; }) : shown;
    var lockNeeded = !keepers.some(function (c) { return c.hideable === false; });
    return {
      hidden: cols.filter(function (c) { return shown.indexOf(c) === -1; }).map(function (c) { return String(c.key); }),
      base: base,
      locked: lockNeeded && keepers.length <= 1 ? keepers.map(function (c) { return String(c.key); }) : []
    };
  }

  /** The keys of the hidden columns (resolveColumns). */
  function hiddenColumnKeys(cols, choices) {
    return resolveColumns(cols, choices).hidden;
  }

  /** The CSS that hides those columns' cells (`data-dt-col`) inside the table root `data-dt-id`. */
  function columnHideRule(tableDomId, keys) {
    if (!keys.length) return '';
    var q = function (v) { return '"' + String(v).replace(/[\\"]/g, '\\$&').replace(/</g, '\\3c ') + '"'; };
    return keys.map(function (k) { return '[data-dt-id=' + q(tableDomId) + '] [data-dt-col=' + q(k) + ']'; }).join(',')
      + '{display:none!important}';
  }

  var api = {
    columnChoicesKey: columnChoicesKey,
    parseColumnChoices: parseColumnChoices,
    resolveColumns: resolveColumns,
    hiddenColumnKeys: hiddenColumnKeys,
    columnHideRule: columnHideRule,
    keyOf: keyOf,
    toggleId: toggleId,
    toggleShown: toggleShown,
    headerState: headerState,
    isFilterValueActive: isFilterValueActive,
    isRequiredChoice: isRequiredChoice,
    inToolbar: inToolbar,
    requiredFilterDefaults: requiredFilterDefaults,
    isEmptyCell: isEmptyCell,
    sortIndices: sortIndices,
    groupItems: groupItems,
    activeFilterValues: activeFilterValues,
    defaultFilterValues: defaultFilterValues,
    matchFilterField: matchFilterField,
    matchRow: matchRow,
    fetchQuery: fetchQuery,
    parseFetchQuery: parseFetchQuery,
    fillCount: fillCount,
    formatMessage: formatMessage,
    nextSortState: nextSortState,
    sortMappers: sortMappers,
    toDay: toDay,
    builtInDatePresets: builtInDatePresets,
    filterValueText: filterValueText,
    filterChipText: filterChipText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.KuiDataTableLogic = api;
})(typeof window !== 'undefined' ? window : this);
