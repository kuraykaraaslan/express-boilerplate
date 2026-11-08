/* =========================================================
   quill-helpers.js — pure helpers used by quill-setup.
   Pixel-parallel sibling of React's quill-helpers.ts.
   Exposes K.updateCounts, K.detectTriggers.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.updateCounts = function (q, ctx) {
    var text = q.getText().replace(/\n+$/, '');
    var chars = text.length;
    var words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    ctx.store.set({ chars: chars, words: words });
    if (ctx.wordEl)  ctx.wordEl.textContent = words + ' ' + (words === 1 ? 'word' : 'words');
    if (ctx.charEl)  ctx.charEl.textContent = chars + (ctx.maxLength ? ' / ' + ctx.maxLength : '');
    if (ctx.counterEl) ctx.counterEl.classList.toggle('is-over', !!(ctx.maxLength && chars > ctx.maxLength));
  };

  K.detectTriggers = function (q, idx, ctx) {
    var text = q.getText(0, idx);
    var atIdx = text.lastIndexOf('@');
    var slashIdx = text.lastIndexOf('/');
    var state = ctx.store.getState();

    if (ctx.mentions && atIdx >= 0) {
      var before = atIdx === 0 ? ' ' : text[atIdx - 1];
      if (/\s/.test(before)) {
        var query = text.slice(atIdx + 1);
        if (!/\s/.test(query)) {
          ctx.renderMention(query, atIdx);
          return;
        }
      }
    }

    if (ctx.slashItems && slashIdx >= 0) {
      var beforeS = slashIdx === 0 ? '\n' : text[slashIdx - 1];
      if (beforeS === '\n' || slashIdx === 0) {
        var qs = text.slice(slashIdx + 1);
        if (!/\s/.test(qs)) {
          ctx.renderSlash(qs, slashIdx);
          return;
        }
      }
    }
    ctx.closePopups();
  };

  K.runSlashCommand = function (q, cmd) {
    if (!cmd) return;
    var parts = String(cmd).split(':');
    var op = parts[0], val = parts[1];
    if (op === 'header')          q.format('header', Number(val), 'user');
    else if (op === 'list')       q.format('list', val, 'user');
    else if (op === 'blockquote') q.format('blockquote', true, 'user');
    else if (op === 'code-block') q.format('code-block', true, 'user');
    else if (op === 'hr')         q.clipboard.dangerouslyPasteHTML('<hr/>', 'user');
  };
})();
