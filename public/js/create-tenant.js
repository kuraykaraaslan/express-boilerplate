// Behaviour of views/auth/create-tenant.ejs; the port of NB's create-tenant page.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('ct-root'));
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var banner = $('ct-banner'), form = $('ct-form'), btn = form.querySelector('button[type=submit]');
  var slug = $('tenant-slug');
  U.autocomplete({ 'tenant-slug': 'off' });
  slug.setAttribute('autocapitalize', 'none'); slug.setAttribute('spellcheck', 'false');
  $('ct-select').href = tp('/auth/select-tenant');
  slug.addEventListener('input', function () { var v = slug.value.trim().toLowerCase(); if (v !== slug.value) slug.value = v; });

  // The same rules as the route's CreateTenantRequestDTO, so a refusal is explained here instead of by a 400.
  function validate(name, s) {
    var bad = false;
    if (!name) { U.fieldError('tenant-name', 'Organization name is required.'); bad = true; }
    else if (name.length < 2) { U.fieldError('tenant-name', 'Organization name must be at least 2 characters.'); bad = true; }
    if (!s.trim()) { U.fieldError('tenant-slug', 'Slug is required.'); bad = true; }
    else {
      var p = K.tenantLabelProblem(s);
      if (p === 'reserved') { U.fieldError('tenant-slug', 'This slug is reserved. Choose another one.'); bad = true; }
      else if (p) { U.fieldError('tenant-slug', 'Use 5–63 lowercase letters, digits and hyphens (no dot, no hyphen at the start or end).'); bad = true; }
    }
    return !bad;
  }

  var createdId = null;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(banner); U.clearFieldErrors(['tenant-name', 'tenant-slug']);
    var name = $('tenant-name').value.trim(), s = slug.value;
    if (!validate(name, s)) return;
    U.busy(btn, true);
    // Platform-level operation: only under the root tenant, guarded by the admin check.
    api.post(tp('/api/tenants/create'), { name: name, slug: s }).then(function (res) {
      var id = res && res.data && res.data.tenant && res.data.tenant.tenantId;
      createdId = typeof id === 'string' && id ? id : null;
      form.classList.add('hidden');
      $('ct-success').classList.remove('hidden');
      if (!createdId) $('ct-open-box').classList.add('hidden');
    }, function (err) {
      var o = {};
      o.CONFLICT = 'This slug is already taken. Choose another one.';
      o.VALIDATION_ERROR = 'This slug is reserved. Choose another one.';
      o[K.VALIDATION_ISSUES] = 'Check the organization name and slug, then try again.';
      U.say(banner, 'error', U.errorText(err, 'Failed to create organization.', o));
      U.busy(btn, false);
    });
  });

  // The creator is the new organization's OWNER: exchange this session for one there, as the picker does.
  var openBtn = $('ct-open-box').querySelector('button'), obanner = $('ct-open-banner');
  openBtn.addEventListener('click', function () {
    if (!createdId) return;
    U.busy(openBtn, true); U.clear(obanner);
    api.post(K.switchTenantPath(createdId, '/api/auth/session/exchange'), { handoff: true }).then(function (res) {
      var h = res && res.data && res.data.handoffUrl;
      location.href = (typeof h === 'string' && /^https?:\/\//.test(h)) ? h : (createdId === tenantId ? tp('/admin') : K.switchTenantPath(createdId, '/admin'));
    }, function (err) {
      U.say(obanner, 'error', U.errorText(err, 'Could not open the organization. Please try again.'));
      U.busy(openBtn, false);
    });
  });
})();
