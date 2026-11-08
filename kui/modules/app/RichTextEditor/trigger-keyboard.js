/* =========================================================
   trigger-keyboard.js — Arrow / Enter / Tab / Escape keyboard
   navigation for the mention + slash popups, plus the accept
   callbacks invoked on click.  Parallel of useTriggerKeyboard.ts.
   Exposes K.attachTriggerKeyboard(ctx) → detach fn.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.attachTriggerKeyboard = function (ctx) {
    var q = ctx.quill;

    ctx.acceptMention = function (item) {
      var pop = ctx.mentionPop; if (!pop) return;
      var len = pop._query.length + 1;
      q.deleteText(pop._trigger, len, 'user');
      var chip = '<span class="kui-rte-mention" data-id="' + K.escapeAttr(item.id) + '">@' + K.escapeHtml(item.label) + '</span>&nbsp;';
      q.clipboard.dangerouslyPasteHTML(pop._trigger, chip, 'user');
      ctx.closePopups();
    };

    ctx.acceptSlash = function (item) {
      var pop = ctx.slashPop; if (!pop) return;
      var len = pop._query.length + 1;
      q.deleteText(pop._trigger, len, 'user');
      K.runSlashCommand(q, item.command);
      ctx.closePopups();
    };

    function handler(e) {
      var pop = ctx.mentionPop || ctx.slashPop;
      if (!pop) return;
      var items = pop._items || [];
      var cur = pop._idx || 0;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var next = Math.min(items.length - 1, cur + 1);
        pop._idx = next;
        rePaint(pop, next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        var prev = Math.max(0, cur - 1);
        pop._idx = prev;
        rePaint(pop, prev);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        var item = items[cur];
        if (!item) return;
        if (pop._kind === 'mention') ctx.acceptMention(item);
        else                          ctx.acceptSlash(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        ctx.closePopups();
      }
    }

    function rePaint(pop, idx) {
      var rows = pop.querySelectorAll('.kui-rte-item');
      Array.prototype.forEach.call(rows, function (r, i) {
        r.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      var sel = pop.querySelector('[data-idx="' + idx + '"]');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    document.addEventListener('keydown', handler, true);
    return function detach() { document.removeEventListener('keydown', handler, true); };
  };
})();
