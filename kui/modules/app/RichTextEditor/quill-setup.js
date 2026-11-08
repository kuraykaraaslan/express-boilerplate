/* =========================================================
   quill-setup.js — instantiates Quill, wires text/selection/
   editor-change + DOM events. Parallel of useQuillSetup.ts.
   Exposes K.setupQuill(ctx) → cleanup fn.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  // Register numeric px whitelist for the `size` attributor once, before
  // any editor instance is mounted. Idempotent — subsequent registrations
  // overwrite the whitelist harmlessly.
  K.registerSizeWhitelist = function () {
    if (typeof Quill === 'undefined' || K._sizeRegistered) return;
    try {
      var Size = Quill.import('attributors/style/size');
      Size.whitelist = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '32px'];
      Quill.register(Size, true);
      K._sizeRegistered = true;
    } catch (e) {}
  };

  K.setupQuill = function (ctx) {
    var q = ctx.quill;
    var store = ctx.store;
    var debounceTimer;

    function emit() {
      var html = q.root.innerHTML;
      ctx.lastEmitted = html;
      store.set({ html: html });
      if (ctx.hidden) {
        ctx.hidden.value = html;
        try { ctx.hidden.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
      try { ctx.root.dispatchEvent(new CustomEvent('kui-rte:change', { bubbles: true, detail: { html: html } })); } catch (e) {}
      if (ctx.autosaveKey) {
        try { localStorage.setItem('kui-rte:' + ctx.autosaveKey, html); } catch (e) {}
      }
      K.updateCounts(q, ctx);
    }
    ctx.emit = emit;

    function enforceMax() {
      if (!ctx.maxLength) return;
      var text = q.getText().replace(/\n+$/, '');
      if (text.length <= ctx.maxLength) return;
      var excess = text.length - ctx.maxLength;
      q.deleteText(q.getLength() - excess - 1, excess, 'silent');
    }

    function onTextChange() {
      clearTimeout(debounceTimer);
      K.applyMarkdown(q);
      enforceMax();
      debounceTimer = setTimeout(emit, 120);
    }

    function onSelectionChange(range) {
      if (range) {
        try { store.set({ active: q.getFormat(range) }); } catch (e) {}
      }
      if (range && range.length > 0) ctx.showBubble(range);
      else                            ctx.hideBubble();
      if (!range) ctx.closePopups();
    }

    function onEditorChange() {
      var sel = q.getSelection();
      if (!sel || sel.length > 0) { ctx.closePopups(); return; }
      K.detectTriggers(q, sel.index, ctx);
    }

    q.on('text-change', onTextChange);
    q.on('selection-change', onSelectionChange);
    q.on('editor-change', onEditorChange);

    function onBlurDom() {
      try { ctx.root.dispatchEvent(new CustomEvent('kui-rte:blur', { bubbles: true, detail: { html: q.root.innerHTML } })); } catch (e) {}
    }
    q.root.addEventListener('blur', onBlurDom);

    function onDrop(e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var img = null;
      for (var i = 0; i < files.length; i++) if (files[i].type.indexOf('image/') === 0) { img = files[i]; break; }
      if (!img) return;
      e.preventDefault();
      K.resolveImageSrc(img, ctx.uploadFnName).then(function (src) {
        var range = q.getSelection(true) || { index: q.getLength(), length: 0 };
        q.insertEmbed(range.index, 'image', src, 'user');
        q.setSelection(range.index + 1, 0, 'user');
      });
    }
    function onDragOver(e) {
      if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) e.preventDefault();
    }
    q.root.addEventListener('drop', onDrop);
    q.root.addEventListener('dragover', onDragOver);

    function onPaste(ev) {
      if (!ctx.sanitize) return;
      var data = ev.clipboardData; if (!data) return;
      var html = data.getData('text/html'); if (!html) return;
      ev.preventDefault();
      var safe = K.sanitize(html);
      var range = q.getSelection(true) || { index: q.getLength(), length: 0 };
      q.clipboard.dangerouslyPasteHTML(range.index, safe, 'user');
    }
    q.root.addEventListener('paste', onPaste);

    function onClick(e) {
      var t = e.target;
      if (t && t.tagName === 'IMG') ctx.showImgOverlay(t);
      else ctx.hideImgOverlay();
    }
    q.root.addEventListener('click', onClick);

    // Click anywhere in the kutucuk → focus editor at end.
    function onWrapperMouseDown(e) {
      if (ctx.readOnly || store.getState().htmlMode) return;
      var t = e.target; if (!t) return;
      if (t.closest('.ql-editor')) return;
      if (t.closest('.ql-toolbar')) return;
      if (t.closest('.kui-rte-counter')) return;
      if (t.closest('button')) return;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      e.preventDefault();
      try { q.focus(); var len = q.getLength(); q.setSelection(Math.max(0, len - 1), 0, 'user'); } catch (_) {}
    }
    ctx.root.addEventListener('mousedown', onWrapperMouseDown);

    return function cleanup() {
      clearTimeout(debounceTimer);
      q.off('text-change', onTextChange);
      q.off('selection-change', onSelectionChange);
      q.off('editor-change', onEditorChange);
      q.root.removeEventListener('blur', onBlurDom);
      q.root.removeEventListener('drop', onDrop);
      q.root.removeEventListener('dragover', onDragOver);
      q.root.removeEventListener('paste', onPaste);
      q.root.removeEventListener('click', onClick);
      ctx.root.removeEventListener('mousedown', onWrapperMouseDown);
    };
  };
})();
