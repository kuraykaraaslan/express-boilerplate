/* =========================================================
   bindings.js — wires standalone toolbar buttons, image +
   table modals, and the two ColorPicker instances. No React
   counterpart (in the React side this is inline in Toolbar
   props + dedicated callbacks); grouped here for clarity.
   Exposes K.bindStandaloneButtons / bindImageModal /
   bindTableModal / bindColorPickers.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.bindStandaloneButtons = function (ctx) {
    var id = ctx.id, a = ctx.actions;
    var btn = function (s) { return document.getElementById(id + s); };
    if (btn('-undo'))  btn('-undo').addEventListener('click', a.onUndo);
    if (btn('-redo'))  btn('-redo').addEventListener('click', a.onRedo);
    if (btn('-hr-btn')) btn('-hr-btn').addEventListener('click', a.onInsertHR);
    if (btn('-full'))  btn('-full').addEventListener('click', a.onToggleFullscreen);
    if (btn('-html'))  btn('-html').addEventListener('click', a.onToggleHtmlMode);
    if (btn('-emoji-btn')) btn('-emoji-btn').addEventListener('click', function () { ctx.openEmoji(btn('-emoji-btn')); });
    if (btn('-tbl-btn'))   btn('-tbl-btn').addEventListener('click', function () { if (window.openModal) window.openModal(id + '-table-modal'); });
  };

  K.bindImageModal = function (ctx) {
    var id = ctx.id, q = ctx.quill;
    var fileInput = document.getElementById(id + '-img-file');
    var browseBtn = document.getElementById(id + '-img-browse');
    var fileName  = document.getElementById(id + '-img-filename');
    var urlInput  = document.getElementById(id + '-img-url');
    var altInput  = document.getElementById(id + '-img-alt');
    var insertBtn = document.getElementById(id + '-img-insert');
    var errorEl   = document.getElementById(id + '-img-error');
    var pickedFile = null;
    var MAX_BYTES = 5 * 1024 * 1024;

    function showError(msg) { if (!errorEl) return; errorEl.textContent = msg || ''; errorEl.classList.toggle('hidden', !msg); }
    function resetFile() {
      pickedFile = null;
      if (fileInput) fileInput.value = '';
      if (fileName) { fileName.textContent = ''; fileName.classList.add('hidden'); }
    }
    function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

    if (browseBtn && fileInput) browseBtn.addEventListener('click', function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { showError('File must be an image.'); resetFile(); return; }
      if (f.size > MAX_BYTES) { showError('Image exceeds ' + fmtBytes(MAX_BYTES) + ' limit.'); resetFile(); return; }
      showError('');
      pickedFile = f;
      if (fileName) { fileName.textContent = f.name + ' (' + fmtBytes(f.size) + ')'; fileName.classList.remove('hidden'); }
    });

    function doInsertSrc(src, alt) {
      var range = ctx.savedRange || { index: q.getLength(), length: 0 };
      q.insertEmbed(range.index, 'image', src, 'user');
      var imgs = q.root.querySelectorAll('img');
      var last = imgs[imgs.length - 1];
      if (last && alt) last.setAttribute('alt', alt);
      q.setSelection(range.index + 1, 0, 'user');
      if (window.closeModal) window.closeModal(id + '-img-modal');
    }
    if (insertBtn) insertBtn.addEventListener('click', function () {
      var alt = (altInput && altInput.value || '').trim();
      var url = (urlInput && urlInput.value || '').trim();
      if (pickedFile) {
        K.resolveImageSrc(pickedFile, ctx.uploadFnName).then(function (src) {
          doInsertSrc(src, alt);
          resetFile();
          if (urlInput) urlInput.value = '';
          if (altInput) altInput.value = '';
          showError('');
        }).catch(function () { showError('Failed to read file.'); });
      } else if (url) {
        doInsertSrc(url, alt);
        if (urlInput) urlInput.value = '';
        if (altInput) altInput.value = '';
        showError('');
      } else {
        showError('Choose a file or paste a URL.');
      }
    });
  };

  K.bindTableModal = function (ctx) {
    var id = ctx.id;
    var tblInsert    = document.getElementById(id + '-tbl-insert');
    var tblRowsInput = document.getElementById(id + '-tbl-rows');
    var tblColsInput = document.getElementById(id + '-tbl-cols');
    var tblGrid      = document.getElementById(id + '-table-grid');

    if (tblGrid) {
      tblGrid.innerHTML = '';
      var allCells = [];
      var hoverR = 0, hoverC = 0;
      for (var r = 1; r <= 12; r++) {
        var rowEl = document.createElement('div');
        rowEl.setAttribute('role', 'row');
        rowEl.style.display = 'contents';
        for (var c = 1; c <= 12; c++) {
          (function (rr, cc) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'gridcell');
            b.setAttribute('aria-label', rr + ' \u00d7 ' + cc);
            b.style.width = '1.25rem'; b.style.height = '1.25rem';
            b.style.background = 'var(--surface-base)';
            b.style.border = '1px solid var(--border)';
            b.style.borderRadius = '2px';
            b.addEventListener('mouseenter', function () {
              hoverR = rr; hoverC = cc;
              allCells.forEach(function (cell, i) {
                var rrr = Math.floor(i / 12) + 1, ccc = (i % 12) + 1;
                var active = rrr <= hoverR && ccc <= hoverC;
                cell.style.background = active ? 'var(--primary)' : 'var(--surface-base)';
                cell.style.borderColor = active ? 'var(--primary)' : 'var(--border)';
              });
            });
            b.addEventListener('click', function () {
              if (tblRowsInput) tblRowsInput.value = String(rr);
              if (tblColsInput) tblColsInput.value = String(cc);
            });
            rowEl.appendChild(b);
            allCells.push(b);
          })(r, c);
        }
        tblGrid.appendChild(rowEl);
      }
    }
    if (tblInsert) tblInsert.addEventListener('click', function () {
      var rows = Math.max(1, Math.min(12, Number(tblRowsInput && tblRowsInput.value) || 3));
      var cols = Math.max(1, Math.min(12, Number(tblColsInput && tblColsInput.value) || 3));
      ctx.actions.insertTable(rows, cols);
      if (window.closeModal) window.closeModal(ctx.id + '-table-modal');
    });
  };

  K.bindColorPickers = function (ctx) {
    var id = ctx.id, q = ctx.quill;
    var colorRoot = document.querySelector('[data-kui-colorpicker="' + id + '-cp-color"]');
    var bgRoot    = document.querySelector('[data-kui-colorpicker="' + id + '-cp-bg"]');
    if (colorRoot) colorRoot.addEventListener('kui-colorpicker:change', function (ev) {
      var v = ev && ev.detail && ev.detail.value;
      q.format('color', v || false, 'user');
    });
    if (bgRoot) bgRoot.addEventListener('kui-colorpicker:change', function (ev) {
      var v = ev && ev.detail && ev.detail.value;
      q.format('background', v || false, 'user');
    });
  };
})();
