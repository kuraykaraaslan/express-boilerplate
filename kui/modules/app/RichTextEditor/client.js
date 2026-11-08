/* =========================================================
   client.js — bootstrap entry. Parallel of React's index.tsx
   composition. Reads attributes off the editor root, builds
   a per-instance ctx, mounts Quill, wires popups and actions,
   exposes the imperative API on window.KuiRte._byId.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  window.KuiRte = window.KuiRte || {
    _byId: {},
    get: function (i) { return this._byId[i] || null; },
  };

  K.boot = function (cfg) {
    var id          = cfg.id;
    var initialHtml = cfg.initialHtml || '';
    var readOnly    = !!cfg.readOnly;
    var placeholder = cfg.placeholder || 'Write something…';

    var root      = document.getElementById(id);
    var editorEl  = document.getElementById(id + '-editor');
    var toolbarEl = document.getElementById(id + '-toolbar');
    var hidden    = document.getElementById(id + '-value');
    var skel      = document.getElementById(id + '-skel');
    var htmlSrc   = document.getElementById(id + '-html-src');
    if (!root || !editorEl || !toolbarEl || root.getAttribute('data-kui-rte-bound') === '1') return;
    if (typeof Quill === 'undefined') { return setTimeout(function () { K.boot(cfg); }, 60); }
    root.setAttribute('data-kui-rte-bound', '1');
    K.registerSizeWhitelist();

    var maxLength    = Number(root.getAttribute('data-max-length') || 0);
    var autosaveKey  = root.getAttribute('data-autosave-key') || '';
    var sanitize     = root.getAttribute('data-sanitize') === '1';
    var uploadFnName = root.getAttribute('data-image-upload-fn') || '';
    var mentions     = K.parseJSONAttr(root, 'data-mentions');
    var slashItems   = K.parseJSONAttr(root, 'data-slash');

    var quill = new Quill(editorEl, {
      theme: 'snow', readOnly: readOnly, placeholder: placeholder,
      modules: {
        toolbar: {
          container: toolbarEl,
          handlers: { image: function () { ctx.savedRange = quill.getSelection(true); if (window.openModal) window.openModal(id + '-img-modal'); } },
        },
        history: { delay: 100, maxStack: 200, userOnly: true },
      },
    });

    // Restore autosave / initialHtml
    var initial = '';
    if (autosaveKey) { try { initial = localStorage.getItem('kui-rte:' + autosaveKey) || ''; } catch (e) {} }
    if (!initial) initial = initialHtml;
    if (initial) quill.clipboard.dangerouslyPasteHTML(sanitize ? K.sanitize(initial) : initial, 'silent');

    if (skel) skel.style.display = 'none';

    var store = K.createStore(quill.root.innerHTML);
    var counterEl = document.getElementById(id + '-counter');

    var ctx = {
      id: id, root: root, editorEl: editorEl, toolbarEl: toolbarEl, hidden: hidden,
      htmlSrc: htmlSrc, htmlBtn: document.getElementById(id + '-html'),
      fullBtn: document.getElementById(id + '-full'),
      quill: quill, store: store, readOnly: readOnly,
      sanitize: sanitize, autosaveKey: autosaveKey, maxLength: maxLength,
      uploadFnName: uploadFnName,
      mentions: mentions, slashItems: slashItems,
      counterEl: counterEl,
      wordEl: counterEl && counterEl.querySelector('[data-rte-words]'),
      charEl: counterEl && counterEl.querySelector('[data-rte-chars]'),
      lastEmitted: quill.root.innerHTML,
      savedRange: null,
    };

    // Attach popup orchestration + actions, then Quill events last
    // so emit() / show*() callbacks exist.
    K.attachAllPopups(ctx);
    ctx.actions = K.createActions(ctx);
    K.setupQuill(ctx);
    K.attachTriggerKeyboard(ctx);

    K.bindStandaloneButtons(ctx);
    K.bindImageModal(ctx);
    K.bindTableModal(ctx);
    K.bindColorPickers(ctx);

    // Imperative API
    window.KuiRte._byId[id] = {
      focus: function () { quill.focus(); },
      blur:  function () { quill.blur(); },
      clear: function () { quill.setText('', 'user'); },
      getHTML: function () { return quill.root.innerHTML; },
      getText: function () { return quill.getText(); },
      setHTML: function (h) {
        var safe = sanitize ? K.sanitize(h) : h;
        quill.setText(''); quill.clipboard.dangerouslyPasteHTML(safe, 'silent');
        ctx.emit && ctx.emit();
      },
      insertHTML: function (h) {
        var safe = sanitize ? K.sanitize(h) : h;
        var range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
        quill.clipboard.dangerouslyPasteHTML(range.index, safe, 'user');
      },
      getDelta: function () { return quill.getContents(); },
      quill: quill,
    };

    // Controlled value sync via event
    root.addEventListener('kui-rte:set-html', function (ev) {
      var html = ev && ev.detail && ev.detail.html;
      if (typeof html !== 'string') return;
      if (html === ctx.lastEmitted) return;
      window.KuiRte._byId[id].setHTML(html);
    });

    // Initial counts
    K.updateCounts(quill, ctx);
  };
})();
