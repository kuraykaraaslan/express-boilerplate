/* =========================================================
   editor-actions.js — toolbar / modal / overlay action
   handlers bundled together. Parallel of useEditorActions.ts.
   Exposes K.createActions(ctx) → { ...handlers }.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.createActions = function (ctx) {
    var q = ctx.quill, store = ctx.store;

    function applyFormat(name, value) {
      q.format(name, value, 'user');
      try { store.set({ active: q.getFormat() }); } catch (e) {}
    }

    function onUndo() { q.history.undo(); }
    function onRedo() { q.history.redo(); }

    function onInsertHR() {
      var range = q.getSelection(true) || { index: q.getLength(), length: 0 };
      q.clipboard.dangerouslyPasteHTML(
        range.index >= q.getLength() ? '<hr/><p><br></p>' : '<hr/>',
        'user'
      );
    }

    function onToggleFullscreen() {
      var s = store.getState();
      var nowFull = !s.fullscreen;
      store.set({ fullscreen: nowFull });
      ctx.root.classList.toggle('kui-rte-fullscreen', nowFull);
      var icon = ctx.fullBtn && ctx.fullBtn.querySelector('i');
      if (icon) icon.className = nowFull ? 'fa-solid fa-compress w-3.5 h-3.5' : 'fa-solid fa-expand w-3.5 h-3.5';
    }

    function onToggleHtmlMode() {
      var s = store.getState();
      if (!s.htmlMode) {
        ctx.htmlSrc.value = q.root.innerHTML;
        ctx.htmlSrc.classList.remove('hidden');
        ctx.editorEl.classList.add('hidden');
        ctx.htmlBtn.classList.add('is-active');
        ctx.htmlBtn.style.background = 'var(--primary-subtle)';
        ctx.htmlBtn.style.color = 'var(--primary)';
        store.set({ htmlMode: true });
      } else {
        var src = ctx.htmlSrc.value;
        var safe = ctx.sanitize ? K.sanitize(src) : src;
        q.setText('', 'silent');
        q.clipboard.dangerouslyPasteHTML(safe, 'user');
        ctx.htmlSrc.classList.add('hidden');
        ctx.editorEl.classList.remove('hidden');
        ctx.htmlBtn.classList.remove('is-active');
        ctx.htmlBtn.style.background = '';
        ctx.htmlBtn.style.color = '';
        store.set({ htmlMode: false });
      }
    }

    function insertEmoji(emoji) {
      var range = q.getSelection(true) || { index: q.getLength(), length: 0 };
      q.insertText(range.index, emoji, 'user');
      q.setSelection(range.index + emoji.length, 0, 'user');
    }

    function insertTable(rows, cols) {
      var head = '<tr>' + new Array(cols + 1).join('<th>&nbsp;</th>') + '</tr>';
      var body = '';
      for (var i = 0; i < rows - 1; i++) body += '<tr>' + new Array(cols + 1).join('<td>&nbsp;</td>') + '</tr>';
      var html = '<table class="kui-rte-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table><p><br></p>';
      var range = q.getSelection(true) || { index: q.getLength(), length: 0 };
      q.clipboard.dangerouslyPasteHTML(range.index, html, 'user');
    }

    function applyImageResize(width) {
      var sel = store.getState().imgSel;
      if (!sel.el) return;
      sel.el.setAttribute('style', 'width:' + width + ';max-width:100%;height:auto;');
      ctx.emit && ctx.emit();
    }
    function applyImageAlign(align) {
      var sel = store.getState().imgSel;
      if (!sel.el) return;
      sel.el.setAttribute('data-align', align);
      var display = align === 'center' ? 'block' : 'inline-block';
      var margin = align === 'center' ? '0.5em auto' : align === 'right' ? '0.5em 0 0.5em auto' : '0.5em auto 0.5em 0';
      var cur = (sel.el.getAttribute('style') || '').replace(/(display|margin|float)\s*:[^;]+;?/g, '');
      sel.el.setAttribute('style', cur + 'display:' + display + ';margin:' + margin + ';');
      ctx.emit && ctx.emit();
    }
    function removeSelectedImage() {
      var sel = store.getState().imgSel;
      if (!sel.el) return;
      sel.el.parentNode && sel.el.parentNode.removeChild(sel.el);
      store.set({ imgSel: { open: false, el: null, rect: null } });
      ctx.hideImgOverlay();
      ctx.emit && ctx.emit();
    }

    return {
      applyFormat: applyFormat,
      onUndo: onUndo,
      onRedo: onRedo,
      onInsertHR: onInsertHR,
      onToggleFullscreen: onToggleFullscreen,
      onToggleHtmlMode: onToggleHtmlMode,
      insertEmoji: insertEmoji,
      insertTable: insertTable,
      applyImageResize: applyImageResize,
      applyImageAlign: applyImageAlign,
      removeSelectedImage: removeSelectedImage,
    };
  };
})();
