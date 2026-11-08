// modules/ui/FileInput/scripts/file-input.js
//
// Client-side wiring for the FileInput EJS component.
// Inlined by FileInput.ejs via <script>…</script> wrapping an IIFE that
// reads its options from a data-fi-options JSON blob and binds to the root.
//
// M1 features:
// - Drag & drop with hover state.
// - Browse button + native <input type="file">.
// - Validation: maxSize (bytes) + allowedTypes (MIME) + accept pattern.
// - Paste from clipboard (image bytes) when enablePaste.
// - maxFiles cap with messages.tooMany.
// - Optional onUpload callback (looked up by name on window).
//
// TODO M2: image thumbnail decode, crop dialog.
// TODO M3: chunked + resumable upload.
// TODO M4: camera input, tus.io adapter, S3 multipart.
// TODO M5: full a11y announce + i18n.

(function () {
  function init(root) {
    if (!root || root.__fiBound) return;
    root.__fiBound = true;

    var opts = {};
    try { opts = JSON.parse(root.getAttribute('data-fi-options') || '{}'); }
    catch (e) { opts = {}; }

    var dropzone   = root.querySelector('[data-fi-dropzone]');
    var input      = root.querySelector('[data-fi-input]');
    var browseBtn  = root.querySelector('[data-fi-browse]');
    var list       = root.querySelector('[data-fi-list]');
    var uploadWrap = root.querySelector('[data-fi-upload-wrap]');
    var uploadBtn  = root.querySelector('[data-fi-upload-btn]');
    var errEl      = root.querySelector('[data-fi-error]');
    var okEl       = root.querySelector('[data-fi-success]');

    var multiple    = !!opts.multiple;
    var maxBytes    = opts.maxSizeBytes || 0;
    var allowed     = Array.isArray(opts.allowedTypes) ? opts.allowedTypes : [];
    var accept      = opts.accept || '';
    var maxFiles    = opts.maxFiles || 0;
    var disabled    = !!opts.disabled;
    var enablePaste = !!opts.enablePaste;
    var uploadCb    = opts.onUpload || '';
    var uploadLbl   = opts.uploadLabel || 'Upload';
    var messages    = opts.messages || {};

    var entries = [];
    var uploadState = 'idle';

    function fmtBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function matchesAccept(file) {
      if (!accept) return true;
      var patterns = accept.split(',').map(function (p) { return p.trim().toLowerCase(); }).filter(Boolean);
      if (!patterns.length) return true;
      var name = (file.name || '').toLowerCase();
      var mime = (file.type || '').toLowerCase();
      for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i];
        if (p.charAt(0) === '.') { if (name.indexOf(p, name.length - p.length) !== -1) return true; continue; }
        if (p.slice(-2) === '/*') { if (mime.indexOf(p.slice(0, -1)) === 0) return true; continue; }
        if (mime === p) return true;
      }
      return false;
    }

    function validate(file) {
      if (maxBytes && file.size > maxBytes) {
        return messages.invalidSize
          ? messages.invalidSize.replace('{limit}', fmtBytes(maxBytes))
          : 'File exceeds ' + fmtBytes(maxBytes) + ' limit';
      }
      if (allowed.length && allowed.indexOf(file.type) === -1) {
        return messages.invalidType || 'File type not allowed';
      }
      if (accept && !matchesAccept(file)) {
        return messages.invalidType || 'File type not allowed';
      }
      return '';
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }

    function renderList() {
      if (entries.length === 0) {
        list.classList.add('hidden');
        list.innerHTML = '';
        if (uploadWrap) uploadWrap.classList.add('hidden');
        return;
      }
      list.classList.remove('hidden');
      if (uploadWrap) uploadWrap.classList.remove('hidden');

      list.innerHTML = entries.map(function (entry, i) {
        var hasErr  = !!entry.error;
        var rowCls  = hasErr
          ? 'flex items-center gap-3 rounded-md border px-3 py-2 text-sm border-error bg-error-subtle text-error-fg'
          : 'flex items-center gap-3 rounded-md border px-3 py-2 text-sm border-border bg-surface-raised text-text-primary';

        var status  = '';
        if (entry.status === 'uploading') {
          status = '<div class="w-full mt-1 h-1 rounded-full bg-surface-sunken overflow-hidden"><div class="h-full bg-primary transition-all" style="width:' + (entry.progress || 0) + '%"></div></div>';
        } else if (entry.status === 'success') {
          status = '<p class="text-xs text-success-fg mt-0.5" role="status">' + escapeHtml(entry.message || 'Uploaded') + '</p>';
        } else if (entry.status === 'error') {
          status = '<p class="text-xs text-error mt-0.5" role="alert">' + escapeHtml(entry.message || 'Upload failed') + '</p>';
        }

        return '<li class="' + rowCls + '">'
          + '<span class="flex-1 truncate min-w-0">'
            + '<span class="font-medium">' + escapeHtml(entry.file.name) + '</span>'
            + '<span class="ml-2 text-xs text-text-secondary">' + fmtBytes(entry.file.size) + '</span>'
            + status
          + '</span>'
          + (hasErr ? '<span class="text-xs text-error shrink-0">' + escapeHtml(entry.error) + '</span>' : '')
          + '<button type="button" aria-label="Remove ' + escapeHtml(entry.file.name) + '" data-fi-remove="' + i + '"'
            + ' class="shrink-0 hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded">'
            + '<span class="w-3 h-3 inline-flex items-center justify-center" aria-hidden="true"><i class="fa-solid fa-xmark w-3 h-3"></i></span>'
          + '</button>'
        + '</li>';
      }).join('');

      var removeBtns = list.querySelectorAll('[data-fi-remove]');
      removeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-fi-remove'), 10);
          entries.splice(idx, 1);
          if (input) input.value = '';
          if (errEl) errEl.classList.add('hidden');
          renderList();
        });
      });
    }

    function setGlobalError(msg) {
      if (!errEl) return;
      if (msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      else     { errEl.classList.add('hidden'); }
    }

    function addFiles(fileList) {
      if (!fileList) return;
      var arr = Array.prototype.slice.call(fileList);
      if (!arr.length) return;
      var added = arr.map(function (f) {
        return { file: f, error: validate(f), status: 'idle', progress: 0 };
      });
      var combined = multiple ? entries.concat(added) : added;
      if (maxFiles && combined.length > maxFiles) {
        var tooManyMsg = (messages.tooMany || 'Too many files — limit is {max}').replace('{max}', maxFiles);
        setGlobalError(tooManyMsg);
        entries = combined.slice(0, maxFiles);
      } else {
        setGlobalError('');
        entries = combined;
      }
      uploadState = 'idle';
      if (okEl) okEl.classList.add('hidden');
      if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = uploadLbl; }
      renderList();
    }

    // ── browse + drag/drop ──
    if (browseBtn && !disabled) {
      browseBtn.addEventListener('click', function () { input.click(); });
    }
    if (input) {
      input.addEventListener('change', function (e) { addFiles(e.target.files); });
    }
    if (dropzone && !disabled) {
      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropzone.classList.add('border-primary', 'bg-primary-subtle');
      });
      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('border-primary', 'bg-primary-subtle');
      });
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('border-primary', 'bg-primary-subtle');
        addFiles(e.dataTransfer.files);
      });
    }

    // ── paste from clipboard (M1) ──
    if (enablePaste && !disabled) {
      document.addEventListener('paste', function (ev) {
        var active = document.activeElement;
        var inside = active && (active === root || root.contains(active));
        if (!inside) return;
        var items = ev.clipboardData && ev.clipboardData.items;
        if (!items || !items.length) return;
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.kind === 'file') {
            var f = it.getAsFile();
            if (f) {
              if (!f.name || f.name === 'image.png') {
                try {
                  var ext = (f.type.split('/')[1] || 'bin').replace('+xml', '');
                  f = new File([f], 'pasted-' + Date.now() + '.' + ext, { type: f.type, lastModified: Date.now() });
                } catch (_) { /* fall back to original */ }
              }
              out.push(f);
            }
          }
        }
        if (out.length) {
          ev.preventDefault();
          addFiles(out);
        }
      });
      // Make root focusable so paste capture works.
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    }

    // ── upload action (existing API) ──
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () {
        if (uploadState === 'uploading') return;
        var cb = uploadCb && typeof window[uploadCb] === 'function' ? window[uploadCb] : null;
        if (!cb) return;

        var validFiles = entries.filter(function (e) { return !e.error; }).map(function (e) { return e.file; });
        if (validFiles.length === 0) return;

        uploadState = 'uploading';
        uploadBtn.disabled    = true;
        uploadBtn.textContent = 'Uploading…';
        if (errEl) errEl.classList.add('hidden');
        if (okEl)  okEl.classList.add('hidden');

        entries.forEach(function (e) { if (!e.error) { e.status = 'uploading'; e.progress = 0; } });
        renderList();

        var progressTimer = setInterval(function () {
          entries.forEach(function (e) {
            if (e.status === 'uploading' && e.progress < 90) {
              e.progress = Math.min(90, e.progress + 10);
            }
          });
          renderList();
        }, 200);

        Promise.resolve(cb(validFiles)).then(function () {
          clearInterval(progressTimer);
          entries.forEach(function (e) {
            if (e.status === 'uploading') { e.status = 'success'; e.progress = 100; e.message = 'Uploaded'; }
          });
          uploadState = 'success';
          if (okEl) okEl.classList.remove('hidden');
          renderList();
          setTimeout(function () {
            entries = [];
            if (input) input.value = '';
            renderList();
          }, 1500);
        }).catch(function (err) {
          clearInterval(progressTimer);
          var msg = (err && err.message) ? err.message : 'Upload failed. Please try again.';
          entries.forEach(function (e) {
            if (e.status === 'uploading') { e.status = 'error'; e.message = msg; }
          });
          uploadState = 'error';
          setGlobalError(msg);
          uploadBtn.disabled    = false;
          uploadBtn.textContent = uploadLbl;
          renderList();
        });
      });
    }
  }

  // Auto-init: any root with a data-fi-options attribute.
  if (window.__kuiFileInputInit) return;
  window.__kuiFileInputInit = true;

  function bindAll() {
    document.querySelectorAll('[data-fi-root]').forEach(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }
  // Also re-scan after dynamic inserts.
  var mo = new MutationObserver(bindAll);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
