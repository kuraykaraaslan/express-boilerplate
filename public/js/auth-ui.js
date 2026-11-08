// Small helpers the auth pages share: the banner, per-field errors, the busy state and the English translator stub.
(function () {
  var K = window.Kui;
  var AuthUi = {
    t: function (_key, fallback) { return fallback; },
    tenantId: function (root) { return root.getAttribute('data-tenant-id') || ''; },
    say: function (el, kind, text) {
      var tone = { error: 'bg-error-subtle border-error text-error-fg', success: 'bg-success-subtle border-success text-success-fg', info: 'bg-info-subtle border-info text-info-fg' }[kind];
      var icon = { error: 'fa-circle-xmark', success: 'fa-circle-check', info: 'fa-circle-info' }[kind];
      el.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm ' + tone;
      el.innerHTML = '<i class="fa-solid ' + icon + ' mt-0.5 shrink-0" aria-hidden="true"></i><span></span>';
      el.lastChild.textContent = text;
    },
    clear: function (el) { el.className = 'hidden'; el.textContent = ''; },
    fieldError: function (id, text) {
      var input = document.getElementById(id);
      if (!input) return;
      var box = input.closest('.space-y-1');
      var old = box.querySelector('[data-field-error]');
      if (old) old.remove();
      input.removeAttribute('aria-invalid');
      if (!text) return;
      input.setAttribute('aria-invalid', 'true');
      var p = document.createElement('p');
      p.setAttribute('data-field-error', '');
      p.id = id + '-error';
      p.className = 'text-xs text-error';
      p.textContent = text;
      box.appendChild(p);
    },
    clearFieldErrors: function (ids) { ids.forEach(function (id) { AuthUi.fieldError(id, ''); }); },
    busy: function (btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); },
    // The shared reader of an API failure (the same one NB's pages use), with this page's overrides.
    errorText: function (err, fallback, overrides) { return K.authErrorText(err, AuthUi.t, fallback, overrides || {}); },
    autocomplete: function (map) {
      Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) el.setAttribute('autocomplete', map[id]); });
    },
  };
  window.AuthUi = AuthUi;
})();
