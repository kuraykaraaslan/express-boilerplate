/* =========================================================
   bubble-menu.js — selection-anchored floating toolbar.
   Parallel of BubbleMenu.tsx. Attaches showBubble/hideBubble
   onto ctx.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.attachBubbleMenu = function (ctx) {
    var q = ctx.quill;
    var bubbleEl = null;

    function build() {
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'kui-rte-popup kui-rte-bubble';
      bubbleEl.innerHTML =
        '<button type="button" data-fmt="bold" title="Bold (Ctrl+B)"><i class="fa-solid fa-bold w-3.5 h-3.5"></i></button>' +
        '<button type="button" data-fmt="italic" title="Italic (Ctrl+I)"><i class="fa-solid fa-italic w-3.5 h-3.5"></i></button>' +
        '<button type="button" data-fmt="underline" title="Underline (Ctrl+U)"><i class="fa-solid fa-underline w-3.5 h-3.5"></i></button>' +
        '<button type="button" data-fmt="strike" title="Strikethrough"><i class="fa-solid fa-strikethrough w-3.5 h-3.5"></i></button>' +
        '<span class="w-px h-5 bg-border mx-1 self-center"></span>' +
        '<button type="button" data-fmt="link" title="Insert link"><i class="fa-solid fa-link w-3.5 h-3.5"></i></button>';
      document.body.appendChild(bubbleEl);
      bubbleEl.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('button[data-fmt]');
        if (!btn) return;
        e.preventDefault();
        var fmt = btn.getAttribute('data-fmt');
        if (fmt === 'link') {
          // The kit's ConfirmDialog, never window.prompt (kui-react PopupOverlays). The dialog takes the focus, so the
          // selection is kept and the link applied to it.
          var range = q.getSelection();
          var ask = window.KuiConfirm && window.KuiConfirm.confirmDialog;
          if (!ask) return;
          ask({ title: 'Add link', confirmLabel: 'Add link', input: { kind: 'text', label: 'Link URL', placeholder: 'https://', required: true } }).then(function (r) {
            if (!r) return;
            if (range && range.length) q.formatText(range.index, range.length, 'link', r.value, 'user');
            else q.format('link', r.value, 'user');
          });
        } else {
          var fmts = q.getFormat();
          q.format(fmt, !fmts[fmt], 'user');
        }
      });
    }

    ctx.showBubble = function (range) {
      if (!range || range.length === 0) { ctx.hideBubble(); return; }
      var bounds = q.getBounds(range.index, range.length);
      var rect = q.container.getBoundingClientRect();
      var top = Math.max(8, rect.top + bounds.top - 40);
      var left = rect.left + bounds.left + bounds.width / 2 - 90;
      if (!bubbleEl) build();
      bubbleEl.style.position = 'fixed';
      bubbleEl.style.top = top + 'px';
      bubbleEl.style.left = left + 'px';
      var fmts = q.getFormat(range);
      ['bold', 'italic', 'underline', 'strike'].forEach(function (f) {
        var b = bubbleEl.querySelector('[data-fmt="' + f + '"]');
        if (b) b.classList.toggle('is-active', !!fmts[f]);
      });
    };

    ctx.hideBubble = function () {
      if (bubbleEl) { bubbleEl.remove(); bubbleEl = null; }
    };
  };
})();
