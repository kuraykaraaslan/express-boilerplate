// modules/app/FileUploadSection/scripts/file-upload-section.js
//
// Client-side wiring for FileUploadSection EJS — the high-level organism
// (drop zone + file list + remove). M1 only: drop + paste + validation.
//
// TODO M2: thumbnail decode, crop dialog.
// TODO M3: chunked + resumable upload engine + per-file progress / retry.
// TODO M4: camera input, tus.io, S3 multipart, reorder.
// TODO M5: full a11y announce + i18n.

(function () {
  function init(root) {
    if (!root || root.__fusBound) return;
    root.__fusBound = true;

    var opts = {};
    try { opts = JSON.parse(root.getAttribute('data-fus-options') || '{}'); }
    catch (e) { opts = {}; }

    var dropzone  = root.querySelector('[data-fus-dropzone]');
    var input     = root.querySelector('[data-fus-input]');
    var browseBtn = root.querySelector('[data-fus-browse]');
    var list      = root.querySelector('[data-fus-list]');
    var emptyEl   = root.querySelector('[data-fus-empty]');
    var errEl     = root.querySelector('[data-fus-error]');

    var multiple    = !!opts.multiple;
    var maxBytes    = opts.maxSizeBytes || 0;
    var maxFiles    = opts.maxFiles || 0;
    var accept      = opts.accept || '';
    var disabled    = !!opts.disabled;
    var enablePaste = !!opts.enablePaste;
    var messages    = opts.messages || {};

    var items = []; // [{ id, file, status, progress, error }]

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
        return (messages.invalidSize || 'File exceeds {limit} limit').replace('{limit}', fmtBytes(maxBytes));
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

    function setGlobalError(msg) {
      if (!errEl) return;
      if (msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      else     { errEl.classList.add('hidden'); }
    }

    function renderList() {
      if (!list) return;
      if (items.length === 0) {
        list.classList.add('hidden');
        list.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      list.classList.remove('hidden');

      list.innerHTML = items.map(function (it, i) {
        var hasErr = !!it.error;
        var rowCls = hasErr
          ? 'flex items-center gap-3 rounded-md border px-3 py-2 text-sm border-error bg-error-subtle text-error-fg'
          : 'flex items-center gap-3 rounded-md border px-3 py-2 text-sm border-border bg-surface-raised text-text-primary';
        var isImage = (it.file.type || '').indexOf('image/') === 0;
        // TODO M2: <ImagePreview> thumbnail goes here.
        var iconHtml = isImage
          ? '<span class="w-4 h-4 shrink-0 inline-flex items-center justify-center text-text-secondary" aria-hidden="true"><i class="fa-solid fa-image w-4 h-4"></i></span>'
          : '';
        return '<li class="' + rowCls + '">'
          + iconHtml
          + '<span class="flex-1 truncate min-w-0">'
            + '<span class="font-medium">' + escapeHtml(it.file.name) + '</span>'
            + '<span class="ml-2 text-xs text-text-secondary">' + fmtBytes(it.file.size) + '</span>'
          + '</span>'
          + (hasErr ? '<span class="text-xs text-error shrink-0">' + escapeHtml(it.error) + '</span>' : '')
          + '<button type="button" aria-label="Remove ' + escapeHtml(it.file.name) + '" data-fus-remove="' + i + '"'
            + ' class="shrink-0 hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded">'
            + '<span class="w-3 h-3 inline-flex items-center justify-center" aria-hidden="true"><i class="fa-solid fa-xmark w-3 h-3"></i></span>'
          + '</button>'
        + '</li>';
      }).join('');

      list.querySelectorAll('[data-fus-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-fus-remove'), 10);
          items.splice(idx, 1);
          if (input) input.value = '';
          setGlobalError('');
          renderList();
        });
      });
    }

    function addFiles(fileList) {
      if (!fileList) return;
      var arr = Array.prototype.slice.call(fileList);
      if (!arr.length) return;
      var added = arr.map(function (f) {
        return {
          id: f.name + '-' + f.size + '-' + f.lastModified + '-' + Math.random().toString(36).slice(2, 8),
          file: f,
          status: 'idle',
          progress: 0,
          error: validate(f),
        };
      });
      var combined = multiple ? items.concat(added) : added;
      if (maxFiles && combined.length > maxFiles) {
        setGlobalError((messages.tooMany || 'Too many files — limit is {max}').replace('{max}', maxFiles));
        items = combined.slice(0, maxFiles);
      } else {
        setGlobalError('');
        items = combined;
      }
      renderList();
    }

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

    if (enablePaste && !disabled) {
      document.addEventListener('paste', function (ev) {
        var active = document.activeElement;
        var inside = active && (active === root || root.contains(active));
        if (!inside) return;
        var its = ev.clipboardData && ev.clipboardData.items;
        if (!its || !its.length) return;
        var out = [];
        for (var i = 0; i < its.length; i++) {
          var it = its[i];
          if (it.kind === 'file') {
            var f = it.getAsFile();
            if (f) {
              if (!f.name || f.name === 'image.png') {
                try {
                  var ext = (f.type.split('/')[1] || 'bin').replace('+xml', '');
                  f = new File([f], 'pasted-' + Date.now() + '.' + ext, { type: f.type, lastModified: Date.now() });
                } catch (_) {}
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
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    }

    // Initial empty state
    renderList();
  }

  if (window.__kuiFileUploadSectionInit) return;
  window.__kuiFileUploadSectionInit = true;

  function bindAll() {
    document.querySelectorAll('[data-fus-root]').forEach(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }
  var mo = new MutationObserver(bindAll);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
