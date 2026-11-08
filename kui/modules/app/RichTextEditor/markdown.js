/* =========================================================
   markdown.js — typed inline markdown patterns converted on
   space/enter. Pixel-parallel sibling of React's markdown.ts.
   Exposes K.applyMarkdown(quill).
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  function readCurrentLine(q, index) {
    var total = q.getText();
    var start = index;
    while (start > 0 && total[start - 1] !== '\n') start--;
    var end = index;
    while (end < total.length && total[end] !== '\n') end++;
    return [start, total.slice(start, end)];
  }

  function matchBlockShortcut(line) {
    if (line === '# ')   return { f: 'header',     v: 1,        c: 2 };
    if (line === '## ')  return { f: 'header',     v: 2,        c: 3 };
    if (line === '### ') return { f: 'header',     v: 3,        c: 4 };
    if (line === '> ')   return { f: 'blockquote', v: true,     c: 2 };
    if (line === '- ' || line === '* ')
                         return { f: 'list',       v: 'bullet', c: 2 };
    if (line === '1. ')  return { f: 'list',       v: 'ordered',c: 3 };
    if (line === '```')  return { f: 'code-block', v: true,     c: 3 };
    return null;
  }

  function matchInlineShortcut(win) {
    var m = /\*\*([^*\n]+)\*\*$/.exec(win);
    if (m) return { start: m.index, length: m[0].length, text: m[1], fmt: 'bold' };
    m = /\*([^*\n]+)\*$/.exec(win);
    if (m) return { start: m.index, length: m[0].length, text: m[1], fmt: 'italic' };
    m = /`([^`\n]+)`$/.exec(win);
    if (m) return { start: m.index, length: m[0].length, text: m[1], fmt: 'code' };
    m = /~~([^~\n]+)~~$/.exec(win);
    if (m) return { start: m.index, length: m[0].length, text: m[1], fmt: 'strike' };
    return null;
  }

  K.applyMarkdown = function (q) {
    var sel = q.getSelection();
    if (!sel || sel.length > 0) return;
    var ls = readCurrentLine(q, sel.index);
    var lineStart = ls[0], lineText = ls[1];
    if (!lineText) return;

    var caretCol = sel.index - lineStart;
    if (caretCol === lineText.length) {
      var block = matchBlockShortcut(lineText);
      if (block) {
        q.formatLine(lineStart, 0, block.f, block.v, 'user');
        q.deleteText(lineStart, block.c, 'user');
        return;
      }
    }

    var startWin = Math.max(0, sel.index - 40);
    var win = q.getText(startWin, sel.index - startWin);
    var inline = matchInlineShortcut(win);
    if (inline) {
      var absStart = sel.index - (win.length - inline.start);
      q.deleteText(absStart, inline.length, 'user');
      var formats = {}; formats[inline.fmt] = true;
      q.insertText(absStart, inline.text, formats, 'user');
      q.setSelection(absStart + inline.text.length, 0, 'user');
    }
  };
})();
