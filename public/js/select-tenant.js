// Behaviour of views/auth/select-tenant.ejs; the port of NB's select-tenant page, with enterTenantUrl.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var root = document.getElementById('pick-root');
  var tenantId = U.tenantId(root);
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var banner = document.getElementById('pick-banner');
  var list = document.getElementById('pick-list');
  var selecting = null;

  var ROLES = { OWNER: 'Owner', ADMIN: 'Admin', USER: 'User' };
  function roleLabel(r) { return ROLES[String(r).toUpperCase()] || r; }

  // Every session is scoped to one tenant: exchange the current one for a session scoped to the target, then land there.
  // A tenant on a host of its own answers with a one-time handoff URL on that host instead.
  function enterTenantUrl(target, path) {
    return api.post(K.switchTenantPath(target, '/api/auth/session/exchange'), { handoff: true }).then(function (res) {
      var h = res && res.data && res.data.handoffUrl;
      if (typeof h === 'string' && /^https?:\/\//.test(h)) return h;
      return target === tenantId ? tp(path) : K.switchTenantPath(target, path);
    });
  }

  function setBusy(on) { list.querySelectorAll('button').forEach(function (b) { b.disabled = on; }); }
  function select(target) {
    selecting = target;
    setBusy(true);
    U.clear(banner);
    var spin = list.querySelector('[data-tenant="' + target + '"] [data-chevron]');
    if (spin) spin.className = 'fa-solid fa-spinner fa-spin text-text-disabled shrink-0';
    return enterTenantUrl(target, '/admin').then(function (url) { location.href = url; }, function (err) {
      selecting = null;
      setBusy(false);
      if (spin) spin.className = 'fa-solid fa-chevron-right text-xs text-text-disabled shrink-0';
      U.say(banner, 'error', U.errorText(err, 'Failed to switch organization. Please try again.'));
    });
  }

  function row(m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-tenant', m.tenant.tenantId);
    b.className = 'w-full flex items-center gap-3 rounded-lg border border-border bg-surface-base hover:bg-surface-overlay hover:border-border-focus transition-colors px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50';
    var badge = document.createElement('span');
    badge.className = 'flex h-9 w-9 items-center justify-center rounded-lg bg-primary-subtle text-primary shrink-0 text-sm font-bold';
    badge.textContent = (m.tenant.name || '?').charAt(0).toUpperCase();
    var text = document.createElement('div');
    text.className = 'flex-1 min-w-0';
    var name = document.createElement('p'); name.className = 'text-sm font-medium text-text-primary truncate'; name.textContent = m.tenant.name;
    text.appendChild(name);
    if (m.tenant.description) { var d = document.createElement('p'); d.className = 'text-xs text-text-secondary truncate'; d.textContent = m.tenant.description; text.appendChild(d); }
    var role = document.createElement('p'); role.className = 'text-xs text-text-disabled'; role.textContent = roleLabel(m.memberRole);
    text.appendChild(role);
    var chev = document.createElement('i');
    chev.setAttribute('data-chevron', ''); chev.setAttribute('aria-hidden', 'true');
    chev.className = 'fa-solid fa-chevron-right text-xs text-text-disabled shrink-0';
    b.appendChild(badge); b.appendChild(text); b.appendChild(chev);
    b.addEventListener('click', function () { if (selecting === null) select(m.tenant.tenantId); });
    return b;
  }

  // Fleet ID: on a node this list holds its workspaces only; the node says where the full list is.
  api.get(tp('/api/auth/fleet-id/status')).then(function (res) {
    var url = res.data && res.data.enabled === true ? res.data.switcherUrl : null;
    if (typeof url === 'string' && /^https:\/\/[^/\\]+\//.test(url)) {
      var a = document.getElementById('pick-fleet'); a.href = url; document.getElementById('pick-fleet-wrap').classList.remove('hidden');
    }
  }).catch(function () {});

  // Self-service onboarding (platform sign-up): the server decides whether this person may open one.
  if (K.isRootTenant(tenantId)) {
    var c = document.getElementById('pick-create'); c.href = tp('/auth/onboarding'); document.getElementById('pick-create-wrap').classList.remove('hidden');
  }

  Promise.all([
    // Tenant-scoped, so an account-only session (central login, not a member here) is refused: only the role is read from it.
    api.get(tp('/api/auth/session')).catch(function () { return { data: { user: null } }; }),
    api.get(tp('/api/auth/me/tenants')),
  ]).then(function (r) {
    var user = r[0].data.user;
    var own = r[1].data.tenants || [];
    if (user && user.userRole === 'ADMIN' && K.isRootTenant(tenantId)) {
      var s = document.getElementById('pick-settings'); s.href = tp('/admin/settings'); document.getElementById('pick-settings-wrap').classList.remove('hidden');
    }
    document.getElementById('pick-loading').classList.add('hidden');
    if (own.length === 0) return document.getElementById('pick-empty').classList.remove('hidden');
    own.forEach(function (m) { list.appendChild(row(m)); });
    // Central login with a single workspace that is not this one: there is nothing to choose, enter it.
    if (own.length === 1 && own[0].tenant.tenantId !== tenantId) select(own[0].tenant.tenantId);
  }).catch(function (err) {
    document.getElementById('pick-loading').classList.add('hidden');
    // The sign-in this page follows is still waiting for its one-time code: finish it on the login page.
    if (err && err.response && err.response.data && err.response.data.code === 'OTP_REQUIRED') { location.href = tp('/auth/login'); return; }
    U.say(banner, 'error', U.errorText(err, 'Failed to load organizations. Please refresh.'));
  });
})();
