/*
 * modules/ui/BulkActionTable/scripts/bulk-logic.js
 *
 * Pure selection, label, action and sort helpers of BulkActionTable. No DOM.
 * Mirrors the logic inside kui-react modules/ui/BulkActionTable.tsx (toggleRow, toggleAllVisible, the
 * header checkbox state, the action `disabled` reason) and modules/ui/Table/Table.tsx (the sort cycle).
 *
 * A row id is identified by its JSON text (`keyOf`), so 1 and "1" stay different ids as in a JS Set.
 * Exposed as window.KuiBulkLogic (and module.exports under Node).
 */
(function (global) {
  'use strict';

  /** The class lists of the bar, the same text the EJS partial writes (tests/bulk-action-table.test.ts compares them). */
  var CLASSES = {
    bar: 'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-overlay px-3 py-2',
    count: 'text-sm font-medium text-text-primary',
    matching: 'text-sm text-primary hover:underline',
    actions: 'ml-auto flex flex-wrap items-center gap-2',
    actionBase: 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50',
    actionPrimary: 'bg-primary text-primary-fg hover:bg-primary-hover',
    actionDestructive: 'bg-error text-white hover:opacity-90',
    clear: 'text-sm text-text-secondary hover:text-text-primary'
  };

  /** The identity of a row id. */
  function keyOf(id) { return JSON.stringify(id); }

  /** The selected ids with `id` toggled; a new id goes last (a Set keeps insertion order). */
  function toggleRow(selectedKeys, key) {
    var next = selectedKeys.filter(function (k) { return k !== key; });
    if (next.length === selectedKeys.length) next.push(key);
    return next;
  }

  /**
   * The header checkbox: selects every selectable row on the page, or, when they are all selected,
   * deselects only those. A selection made on another page survives.
   */
  function toggleAllVisible(selectedKeys, selectableKeys) {
    var all = state(selectedKeys, selectableKeys).all;
    if (all) {
      return selectedKeys.filter(function (k) { return selectableKeys.indexOf(k) === -1; });
    }
    var next = selectedKeys.slice();
    selectableKeys.forEach(function (k) { if (next.indexOf(k) === -1) next.push(k); });
    return next;
  }

  /** { visibleSelected, all, some } of the selectable rows on the page. */
  function state(selectedKeys, selectableKeys) {
    var count = selectableKeys.filter(function (k) { return selectedKeys.indexOf(k) !== -1; }).length;
    var all = selectableKeys.length > 0 && count === selectableKeys.length;
    return { visibleSelected: count, all: all, some: count > 0 && !all };
  }

  /** A label with its `{n}` placeholder filled. */
  function fill(template, n) { return String(template).split('{n}').join(String(n)); }

  /** Whether an action is disabled for `count` selected rows, and the reason it shows as a tooltip. */
  function actionState(action, count) {
    var min = typeof action.minSelected === 'number' ? action.minSelected : 0;
    var max = typeof action.maxSelected === 'number' ? action.maxSelected : Infinity;
    var disabled = count < min || count > max;
    return { disabled: disabled, reason: disabled ? String(action.disabledReason || '') : '' };
  }

  /** The next sort of the cycle ascending, descending, none (kui-react Table.handleSort). */
  function nextSort(current, key) {
    if (current.key !== key) return { key: key, dir: 'asc' };
    if (current.dir === 'asc') return { key: key, dir: 'desc' };
    return { key: '', dir: null };
  }

  /** Two cell values in the order the table sorts by: text, with numbers by value. */
  function compareValues(a, b) {
    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { numeric: true });
  }

  /**
   * The order of the rows, as indexes into the original order. [{ index, value }] in, indexes out;
   * without a sort the original order.
   */
  function sortedOrder(entries, sort) {
    var list = entries.slice();
    if (!sort.key || !sort.dir) return list.sort(function (a, b) { return a.index - b.index; }).map(function (e) { return e.index; });
    var sign = sort.dir === 'asc' ? 1 : -1;
    return list.sort(function (a, b) { return sign * compareValues(a.value, b.value) || a.index - b.index; }).map(function (e) { return e.index; });
  }

  var api = {
    CLASSES: CLASSES, keyOf: keyOf, toggleRow: toggleRow, toggleAllVisible: toggleAllVisible, state: state,
    fill: fill, actionState: actionState, nextSort: nextSort, compareValues: compareValues, sortedOrder: sortedOrder
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KuiBulkLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
