/* =========================================================
   suggestion-popup.js — builds the floating <ul> popup used by
   mention (@) and slash (/) menus. Parallel of SuggestionPopup.tsx.
   Exposes K.buildSuggestionPopup(items, pos, onPick, kind).
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.buildSuggestionPopup = function (items, pos, onPick, kind) {
    var pop = document.createElement('div');
    pop.className = 'kui-rte-popup';
    pop.setAttribute('role', 'listbox');
    pop.style.position = 'fixed';
    pop.style.top = pos.top + 'px';
    pop.style.left = pos.left + 'px';
    pop.style.minWidth = '14rem';
    pop.style.maxHeight = '16rem';
    pop.style.overflow = 'auto';

    items.forEach(function (it, idx) {
      var row = document.createElement('div');
      row.className = 'kui-rte-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      row.setAttribute('data-idx', String(idx));

      var content = document.createElement('div');
      content.style.flex = '1';
      content.style.minWidth = '0';
      content.innerHTML =
        '<div style="font-weight:500;">' + K.escapeHtml(it.label) + '</div>' +
        (it.description ? '<div class="kui-rte-item-desc">' + K.escapeHtml(it.description) + '</div>' : '');
      row.appendChild(content);

      row.addEventListener('mousedown', function (e) { e.preventDefault(); onPick(it); });
      pop.appendChild(row);
    });

    pop._items = items;
    pop._idx = 0;
    pop._kind = kind;
    document.body.appendChild(pop);
    return pop;
  };

  /** Attached to a ctx: opens / closes mention + slash popups. */
  K.attachPopupOrchestrator = function (ctx) {
    function close() {
      if (ctx.mentionPop) { ctx.mentionPop.remove(); ctx.mentionPop = null; }
      if (ctx.slashPop)   { ctx.slashPop.remove();   ctx.slashPop   = null; }
    }
    ctx.closePopups = close;

    ctx.renderMention = function (query, trigger) {
      var filtered = (ctx.mentions || []).filter(function (m) {
        return m.label.toLowerCase().indexOf(query.toLowerCase()) !== -1 ||
               (m.description || '').toLowerCase().indexOf(query.toLowerCase()) !== -1;
      });
      close();
      if (!filtered.length) return;
      var bounds = ctx.quill.getBounds(trigger, 0);
      var rect = ctx.quill.container.getBoundingClientRect();
      var pos = { top: rect.top + bounds.bottom + 4, left: rect.left + bounds.left };
      ctx.mentionPop = K.buildSuggestionPopup(filtered, pos, function (it) {
        ctx.mentionPop && (ctx.mentionPop._trigger = trigger, ctx.mentionPop._query = query);
        ctx.acceptMention && ctx.acceptMention(it);
      }, 'mention');
      ctx.mentionPop._trigger = trigger;
      ctx.mentionPop._query = query;
    };

    ctx.renderSlash = function (query, trigger) {
      var filtered = (ctx.slashItems || []).filter(function (s) {
        return s.label.toLowerCase().indexOf(query.toLowerCase()) !== -1;
      });
      close();
      if (!filtered.length) return;
      var bounds = ctx.quill.getBounds(trigger, 0);
      var rect = ctx.quill.container.getBoundingClientRect();
      var pos = { top: rect.top + bounds.bottom + 4, left: rect.left + bounds.left };
      ctx.slashPop = K.buildSuggestionPopup(filtered, pos, function (it) {
        ctx.slashPop && (ctx.slashPop._trigger = trigger, ctx.slashPop._query = query);
        ctx.acceptSlash && ctx.acceptSlash(it);
      }, 'slash');
      ctx.slashPop._trigger = trigger;
      ctx.slashPop._query = query;
    };
  };
})();
