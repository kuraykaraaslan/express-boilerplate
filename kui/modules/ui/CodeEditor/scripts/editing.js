/*
 * modules/ui/CodeEditor/scripts/editing.js
 *
 * The pure text operations of the CodeEditor (M2 and M3): indent, comment toggle, auto-indent
 * on Enter, bracket and quote pairs, line / column maths, the word under a point, completion
 * filtering and find. Mirrors kui-react modules/ui/CodeEditor/editing.ts one to one. No DOM:
 * every operation takes the text and a selection and returns one edit
 * ({ from, to, text, selStart, selEnd }), so the engine can apply it through the browser's own
 * undo stack (`insertText`) or as a plain value change.
 *
 * Exposed as window.KuiCodeEditorEditing (and module.exports under Node).
 */
(function (global) {
  'use strict';

  /** the text after an edit */
  function applyEdit(value, e) {
    return value.slice(0, e.from) + e.text + value.slice(e.to);
  }

  /** the line comment of a language, or null when it has none the editor toggles */
  function commentTokenOf(language) {
    switch (language) {
      case 'js': case 'ts': return '//';
      case 'python': case 'yaml': return '#';
      case 'sql': return '--';
      default: return null;
    }
  }

  /** start of the line holding `start`, and the end of the line holding `end` (whole lines) */
  function lineRange(value, start, end) {
    var from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    // a selection that ends at the very start of a line does not take that line
    var last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    var nl = value.indexOf('\n', last);
    return { from: start === 0 ? 0 : from, to: nl === -1 ? value.length : nl };
  }

  /** Tab and Shift+Tab: a caret gets `unit`; a selection (or Shift+Tab) indents or outdents every line it touches. */
  function indentEdit(value, start, end, outdent, unit) {
    if (unit === undefined) unit = '  ';
    if (start === end && !outdent) return { from: start, to: end, text: unit, selStart: start + unit.length, selEnd: start + unit.length };
    var r = lineRange(value, start, end);
    var lines = value.slice(r.from, r.to).split('\n');
    var firstShift = 0;
    var total = 0;
    var out = lines.map(function (line, i) {
      if (!outdent) { if (i === 0) firstShift = unit.length; total += unit.length; return unit + line; }
      var spaces = /^ +/.exec(line);
      var cut = line.indexOf(unit) === 0 ? unit.length : line.charAt(0) === '\t' ? 1 : (spaces ? spaces[0].length : 0);
      var n = Math.min(cut, unit.length);
      if (i === 0) firstShift = -n;
      total -= n;
      return line.slice(n);
    });
    var text = out.join('\n');
    var selStart = Math.max(r.from, start + firstShift);
    return { from: r.from, to: r.to, text: text, selStart: selStart, selEnd: start === end ? selStart : end + total };
  }

  /** Ctrl+/: comment the touched lines out with `token`, or back in when every non-empty one already is. */
  function commentEdit(value, start, end, token) {
    var r = lineRange(value, start, end);
    var from = r.from, to = r.to;
    var lines = value.slice(from, to).split('\n');
    var filled = lines.filter(function (l) { return l.trim(); });
    var commented = filled.length > 0 && filled.every(function (l) { return l.replace(/^\s+/, '').indexOf(token) === 0; });
    var indent = Math.min.apply(Math, filled.map(function (l) { return /^\s*/.exec(l)[0].length; }).concat([Infinity]));
    var out = lines.map(function (l) {
      if (!l.trim()) return l;
      if (commented) {
        var at = l.indexOf(token);
        var len = token.length + (l[at + token.length] === ' ' ? 1 : 0);
        return l.slice(0, at) + l.slice(at + len);
      }
      var cut = isFinite(indent) ? indent : 0;
      return l.slice(0, cut) + token + ' ' + l.slice(cut);
    });
    var text = out.join('\n');
    var delta = text.length - (to - from);
    if (start === end) {
      var caret = Math.max(from, start + (out[0].length - lines[0].length));
      return { from: from, to: to, text: text, selStart: caret, selEnd: caret };
    }
    return { from: from, to: to, text: text, selStart: from, selEnd: to + delta };
  }

  var OPEN = '([{';
  var CLOSE = ')]}';
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

  /** Enter: the new line keeps the indentation; after an opening bracket it goes one step in, and a closing bracket right after the caret moves to a line of its own. */
  function enterEdit(value, start, end, unit) {
    if (unit === undefined) unit = '  ';
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var indent = /^[ \t]*/.exec(value.slice(lineStart, start))[0];
    var before = value[start - 1];
    var after = value[end];
    if (before && OPEN.indexOf(before) !== -1) {
      var inner = '\n' + indent + unit;
      if (after && CLOSE.indexOf(after) !== -1 && CLOSE.indexOf(after) === OPEN.indexOf(before)) {
        return { from: start, to: end, text: inner + '\n' + indent, selStart: start + inner.length, selEnd: start + inner.length };
      }
      return { from: start, to: end, text: inner, selStart: start + inner.length, selEnd: start + inner.length };
    }
    var text = '\n' + indent;
    return { from: start, to: end, text: text, selStart: start + text.length, selEnd: start + text.length };
  }

  /**
   * A typed bracket or quote: a selection is wrapped, an opening character gets its closing one, a closing
   * character that is already next to the caret is stepped over. Null when the key should simply type (a quote
   * inside a word).
   */
  function pairEdit(value, start, end, ch) {
    var next = value[end];
    var isQuote = ch === '"' || ch === "'" || ch === '`';
    if (start === end && (CLOSE.indexOf(ch) !== -1 || isQuote) && next === ch) return { from: start, to: start, text: '', selStart: start + 1, selEnd: start + 1 };
    var close = Object.prototype.hasOwnProperty.call(PAIRS, ch) ? PAIRS[ch] : null;
    if (!close) return null;
    if (start !== end) {
      var inner = value.slice(start, end);
      return { from: start, to: end, text: ch + inner + close, selStart: start + 1, selEnd: end + 1 };
    }
    if (isQuote) {
      var prev = value[start - 1];
      if (prev && /[\w$\\]/.test(prev)) return null;
      if (next && !/[\s)\]},;:]/.test(next)) return null;
    } else if (next && /[\w$]/.test(next)) return null;
    return { from: start, to: end, text: ch + close, selStart: start + 1, selEnd: start + 1 };
  }

  /** Backspace between an empty pair (`(|)`, `"|"`) removes both; null otherwise. */
  function backspaceEdit(value, start, end) {
    if (start !== end || start === 0) return null;
    var prev = value[start - 1];
    if (Object.prototype.hasOwnProperty.call(PAIRS, prev) && value[start] === PAIRS[prev]) return { from: start - 1, to: start + 1, text: '', selStart: start - 1, selEnd: start - 1 };
    return null;
  }

  /** 1-based line and column of a position */
  function cursorAt(value, index) {
    var upto = value.slice(0, Math.max(0, index));
    var line = upto.split('\n').length;
    return { line: line, column: index - (upto.lastIndexOf('\n') + 1) + 1 };
  }

  /** the position of a 1-based line and column, clamped to the text */
  function indexAt(value, line, column) {
    if (column === undefined) column = 1;
    var lines = value.split('\n');
    var l = Math.min(Math.max(1, line), lines.length);
    var at = 0;
    for (var i = 0; i < l - 1; i++) at += lines[i].length + 1;
    return at + Math.min(Math.max(0, column - 1), lines[l - 1].length);
  }

  /** the dotted name that ends at `index` (`msg.pay` in `x = msg.pay|`): what a completion replaces */
  function prefixAt(value, index) {
    var m = /[A-Za-z_$][\w$]*(?:\.[\w$]*)*$|$/.exec(value.slice(0, index));
    var text = m ? m[0] : '';
    return { text: text, from: index - text.length };
  }

  /** the dotted name around `index`, for a hover (`msg.payload` with the point anywhere in it), or '' */
  function wordAt(value, index) {
    var left = /[\w$.]*$/.exec(value.slice(0, index))[0];
    var right = /^[\w$.]*/.exec(value.slice(index))[0];
    return (left + right).replace(/^\.+|\.+$/g, '');
  }

  /** the suggestions that start with what was typed (case-insensitive), best first, at most `max` */
  function filterSuggestions(list, prefix, max) {
    if (max === undefined) max = 50;
    var p = prefix.toLowerCase();
    var hits = (list || []).filter(function (s) { return s.label.toLowerCase().indexOf(p) === 0 && s.label !== prefix; });
    // what continues the dotted part the user is in comes before what only shares its start
    return hits.sort(function (a, b) {
      return Number(b.label.indexOf(prefix) === 0) - Number(a.label.indexOf(prefix) === 0) || a.label.length - b.label.length;
    }).slice(0, max);
  }

  /** the edit a picked suggestion makes: it replaces the typed prefix */
  function suggestionEdit(value, index, s) {
    var from = prefixAt(value, index).from;
    var text = s.insertText != null ? s.insertText : s.label;
    return { from: from, to: index, text: text, selStart: from + text.length, selEnd: from + text.length };
  }

  /** every match of `query` as start–end pairs (no regular expressions: the text is what is searched for) */
  function findMatches(value, query, caseSensitive) {
    if (!query) return [];
    var hay = caseSensitive ? value : value.toLowerCase();
    var needle = caseSensitive ? query : query.toLowerCase();
    var out = [];
    for (var at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
    return out;
  }

  /** the text with every match replaced */
  function replaceAllText(value, query, replacement, caseSensitive) {
    var hits = findMatches(value, query, caseSensitive);
    var out = '';
    var last = 0;
    for (var i = 0; i < hits.length; i++) { out += value.slice(last, hits[i][0]) + replacement; last = hits[i][1]; }
    return { value: out + value.slice(last), count: hits.length };
  }

  var api = {
    applyEdit: applyEdit,
    commentTokenOf: commentTokenOf,
    lineRange: lineRange,
    indentEdit: indentEdit,
    commentEdit: commentEdit,
    enterEdit: enterEdit,
    pairEdit: pairEdit,
    backspaceEdit: backspaceEdit,
    cursorAt: cursorAt,
    indexAt: indexAt,
    prefixAt: prefixAt,
    wordAt: wordAt,
    filterSuggestions: filterSuggestions,
    suggestionEdit: suggestionEdit,
    findMatches: findMatches,
    replaceAllText: replaceAllText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KuiCodeEditorEditing = api;
})(typeof window !== 'undefined' ? window : globalThis);
