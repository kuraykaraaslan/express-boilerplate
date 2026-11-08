/*
 * modules/ui/CodeEditor/scripts/view.js
 *
 * The CodeEditor pieces the browser redraws (M3): the gutter rows with their diagnostic dots,
 * the tinted lines, the problems list under the field, the completion listbox and the hover
 * card. Each is an HTML string with the same classes as kui-react (parts/Gutter.tsx,
 * engines/codemirror.tsx, index.tsx). The server draws the first frame with the EJS partials
 * (partials/_gutter.ejs, _tints.ejs, _problems.ejs); tests/code-editor.test.ts checks both agree.
 * Also the default English messages and the marker helpers (markersByLine, sortMarkers).
 *
 * Exposed as window.KuiCodeEditorView (and module.exports under Node).
 */
(function (global) {
  'use strict';

  /** the text box's line height and padding (leading-5, px-3 py-2): the gutter, the tints and the popups line up with them */
  var LINE_H = 20;
  var PAD_Y = 8;
  var PAD_X = 12;

  var DEFAULT_MESSAGES = {
    placeholder: '',
    loading: 'Loading…',
    readOnlyLabel: 'read-only',
    toolbarLabel: 'Code tools',
    find: 'Find and replace',
    findPlaceholder: 'Find',
    replacePlaceholder: 'Replace with',
    findPrev: 'Previous match',
    findNext: 'Next match',
    findClose: 'Close find',
    replaceOne: 'Replace',
    replaceAll: 'Replace all',
    matchCase: 'Match case',
    findNone: 'No match',
    findCount: '{current} of {total}',
    format: 'Format the code',
    copy: 'Copy the code',
    copied: 'Copied',
    fullscreen: 'Full screen',
    exitFullscreen: 'Leave full screen',
    suggestions: 'Suggestions',
    problems: 'Problems in the code',
    markerAt: 'Line {line}: {message}',
    markerAtColumn: 'Line {line}, column {column}: {message}',
  };

  var SEVERITY_RANK = { error: 3, warning: 2, info: 1, hint: 0 };
  var DOT = { error: 'bg-error', warning: 'bg-warning', info: 'bg-info', hint: 'bg-text-disabled' };
  var LINE_TINT = { error: 'bg-error-subtle', warning: 'bg-warning-subtle', info: 'bg-info-subtle', hint: 'bg-surface-overlay' };
  var MARKER_ICON = { error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info', hint: 'fa-circle-info' };
  var MARKER_TONE = { error: 'text-error', warning: 'text-warning-fg', info: 'text-info', hint: 'text-text-secondary' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' }[c];
    });
  }

  /** a message: a `{name}` template filled from `vars`, or a function (from attach()) called with `args` */
  function fmt(msg, vars, args) {
    if (typeof msg === 'function') return String(msg.apply(null, args || []));
    return String(msg == null ? '' : msg).replace(/\{(\w+)\}/g, function (all, k) {
      return Object.prototype.hasOwnProperty.call(vars || {}, k) ? String(vars[k]) : all;
    });
  }

  function mergeMessages(own) {
    var out = {};
    var k;
    for (k in DEFAULT_MESSAGES) out[k] = DEFAULT_MESSAGES[k];
    for (k in (own || {})) if (own[k] != null) out[k] = own[k];
    return out;
  }

  /** a marker as a row of the problems list says it */
  function markerText(m, mk) {
    if (typeof m.markerAt === 'function') return String(m.markerAt(mk.line, mk.column, mk.message));
    return mk.column ? fmt(m.markerAtColumn, { line: mk.line, column: mk.column, message: mk.message })
      : fmt(m.markerAt, { line: mk.line, message: mk.message });
  }

  /** the valid markers (a line, a known severity, a message) */
  function cleanMarkers(markers) {
    return (Array.isArray(markers) ? markers : []).filter(function (mk) {
      return mk && Number(mk.line) >= 1 && Object.prototype.hasOwnProperty.call(SEVERITY_RANK, mk.severity);
    });
  }

  /** the markers in reading order, for the list under the field */
  function sortMarkers(markers) {
    return cleanMarkers(markers).slice().sort(function (a, b) { return a.line - b.line || (a.column || 0) - (b.column || 0); });
  }

  /** the worst marker of each line, as { [line]: marker } */
  function markersByLine(markers) {
    var out = {};
    cleanMarkers(markers).forEach(function (mk) {
      var had = out[mk.line];
      if (!had || SEVERITY_RANK[mk.severity] > SEVERITY_RANK[had.severity]) out[mk.line] = mk;
    });
    return out;
  }

  function hasAny(byLine) {
    for (var k in byLine) if (Object.prototype.hasOwnProperty.call(byLine, k)) return true;
    return false;
  }

  /** the rows of the gutter: one per line, the active one bold, a dot when the editor has markers */
  function gutterRowsHtml(lineCount, activeLine, byLine) {
    var dots = byLine && hasAny(byLine);
    var out = '';
    for (var n = 1; n <= Math.max(lineCount, 1); n++) {
      var mk = dots ? byLine[n] : null;
      out += '<div' + (mk ? ' data-marker="' + esc(mk.severity) + '" title="' + esc(mk.message) + '"' : '')
        + ' class="flex items-center justify-end gap-1 tabular-nums' + (n === activeLine ? ' text-text-primary font-semibold' : '') + '">'
        + (dots ? '<span class="h-1.5 w-1.5 shrink-0 rounded-full ' + (mk ? DOT[mk.severity] : 'bg-transparent') + '"></span>' : '')
        + n + '</div>';
    }
    return out;
  }

  /** the tinted lines behind the text (empty when no line has a marker) */
  function tintsHtml(byLine, scrollTop) {
    if (!hasAny(byLine)) return '';
    var rows = Object.keys(byLine).map(Number).sort(function (a, b) { return a - b; }).map(function (line) {
      var mk = byLine[line];
      return '<div data-line="' + line + '" class="absolute inset-x-0 ' + LINE_TINT[mk.severity] + '" style="top: ' + (PAD_Y + (line - 1) * LINE_H) + 'px; height: ' + LINE_H + 'px"></div>';
    }).join('');
    return '<div aria-hidden="true" data-kui-codeeditor-tints class="pointer-events-none absolute inset-x-0 top-0" style="transform: translateY(' + (-(scrollTop || 0)) + 'px)">' + rows + '</div>';
  }

  /** the problems list under the field, its rows jump to the spot (empty when there are no markers) */
  function problemsHtml(sorted, m, id) {
    if (!sorted.length) return '';
    return '<ul id="' + esc(id) + '" aria-label="' + esc(m.problems) + '" data-kui-codeeditor-problems class="mt-1 space-y-0.5">'
      + sorted.map(function (mk) {
        var who = [mk.source, mk.code].filter(Boolean).join(' ');
        return '<li><button type="button" data-severity="' + esc(mk.severity) + '" data-line="' + Number(mk.line) + '" data-column="' + Number(mk.column || 1) + '"'
          + ' class="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' + MARKER_TONE[mk.severity] + '">'
          + '<i class="fa-solid ' + MARKER_ICON[mk.severity] + ' mt-0.5 h-3 w-3 shrink-0 text-center leading-3" aria-hidden="true"></i>'
          + '<span>' + esc(markerText(m, mk)) + (who ? '<span class="text-text-secondary">' + esc(' (' + who + ')') + '</span>' : '') + '</span>'
          + '</button></li>';
      }).join('')
      + '</ul>';
  }

  /** the completion listbox under the caret's line */
  function suggestHtml(items, index, listId, m, at) {
    return '<ul id="' + esc(listId) + '" role="listbox" aria-label="' + esc(m.suggestions) + '" data-kui-codeeditor-suggest'
      + ' class="absolute z-20 max-h-48 min-w-48 max-w-[min(24rem,90%)] overflow-y-auto rounded-md border border-border bg-surface-overlay py-1 text-xs shadow-lg"'
      + ' style="top: ' + at.top + 'px; left: ' + at.left + 'px">'
      + items.map(function (s, i) {
        return '<li id="' + esc(listId + '-' + i) + '" role="option" aria-selected="' + (i === index) + '" data-index="' + i + '"'
          + ' class="flex cursor-pointer items-baseline gap-2 px-2 py-1 ' + (i === index ? 'bg-primary-subtle text-primary' : 'text-text-primary hover:bg-surface-raised') + '">'
          + '<span class="font-mono">' + esc(s.label) + '</span>'
          + (s.detail ? '<span class="ml-auto truncate pl-3 font-sans text-[11px] text-text-secondary">' + esc(s.detail) + '</span>' : '')
          + '</li>';
      }).join('')
      + '</ul>';
  }

  /** the hover card under the name the pointer rests on */
  function hoverHtml(text, at) {
    return '<div role="tooltip" data-kui-codeeditor-hover'
      + ' class="pointer-events-none absolute z-20 max-w-72 whitespace-pre-wrap rounded-md border border-border bg-surface-overlay px-2.5 py-1.5 font-sans text-xs text-text-primary shadow-lg"'
      + ' style="top: ' + at.y + 'px; left: ' + at.x + 'px">' + esc(text) + '</div>';
  }

  var api = {
    LINE_H: LINE_H,
    PAD_Y: PAD_Y,
    PAD_X: PAD_X,
    DEFAULT_MESSAGES: DEFAULT_MESSAGES,
    DOT: DOT,
    LINE_TINT: LINE_TINT,
    MARKER_ICON: MARKER_ICON,
    MARKER_TONE: MARKER_TONE,
    esc: esc,
    fmt: fmt,
    mergeMessages: mergeMessages,
    markerText: markerText,
    sortMarkers: sortMarkers,
    markersByLine: markersByLine,
    hasAny: hasAny,
    gutterRowsHtml: gutterRowsHtml,
    tintsHtml: tintsHtml,
    problemsHtml: problemsHtml,
    suggestHtml: suggestHtml,
    hoverHtml: hoverHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KuiCodeEditorView = api;
})(typeof window !== 'undefined' ? window : globalThis);
