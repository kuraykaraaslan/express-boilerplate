// Behaviour of views/auth/callback.ejs; the port of NB's callback page. The server has already set the session cookies and
// redirected here (with no query, or with `redirect`).
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('cb-root'));
  var sw = function (p) { return K.switchTenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  $('cb-back').href = sw('/auth/login');

  // A `redirect` the flow carried, kept only when it is a local path of THIS tenant. The path is resolved first, as the
  // browser will: "/t/<this>/../<other>/admin" and its %2e%2e spelling are the other tenant.
  function safeSameTenantRedirect(raw) {
    if (!raw) return null;
    if (raw.charAt(0) !== '/' || raw.indexOf('//') === 0) return null;
    if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
    var base = 'http://localhost', resolved;
    try { resolved = new URL(raw, base); } catch (e) { return null; }
    if (resolved.origin !== base) return null;
    if (/%2f|%5c/i.test(resolved.pathname)) return null;
    var s = K.splitTenantBase(resolved.pathname);
    if (s.tenantId !== null && s.tenantId !== tenantId) return null;
    if (s.tenantId === null && K.tenancyMode() !== 'domain') return null;
    return sw(s.appPath) + resolved.search + resolved.hash;
  }
  var status = function (err) { return err && err.response && err.response.status; };

  // Read once, before the query is stripped.
  var rawRedirect = new URLSearchParams(location.search).get('redirect');
  var redirectTo = safeSameTenantRedirect(rawRedirect);
  if (location.search) history.replaceState(history.state, '', location.pathname + (location.hash || ''));

  // The same rule as the login page: the root tenant is the central login, so the picker comes first (always for an
  // account-only session); every other tenant lands in its own admin area.
  var picker = sw('/auth/select-tenant');
  function destination(accountOnly) {
    return K.isRootTenant(tenantId) ? (accountOnly ? picker : (redirectTo || picker)) : (redirectTo || sw('/admin/me'));
  }

  function pendingOtpMethods(err) {
    var raw = err && err.response && err.response.data && err.response.data.userSecurity && err.response.data.userSecurity.otpMethods;
    var m = Array.isArray(raw) ? U.orderOtpMethods(raw.filter(function (x) { return typeof x === 'string'; })) : [];
    return m.length ? m : ['EMAIL'];
  }

  function check() {
    $('cb-otp').classList.add('hidden');
    $('cb-working').classList.remove('hidden');
    api.get(sw('/api/auth/session')).then(function () { location.href = destination(false); }, function (err) {
      // On the root tenant a signed-in account that is not a member there is refused, not unauthenticated: the picker is its place.
      if (status(err) === 403 && K.isRootTenant(tenantId)) { location.href = destination(true); return; }
      if (status(err) === 401 && K.authErrorCodes(err).indexOf('OTP_REQUIRED') >= 0) {
        // A session the risk check stepped up: the one-time code comes before anything else.
        $('cb-working').classList.add('hidden');
        $('cb-otp').classList.remove('hidden');
        U.otpStep($('cb-otp'), {
          tenantId: tenantId, methods: pendingOtpMethods(err), apiPath: K.switchTenantPath,
          onVerified: check,
          // No password form to go back to here: the pending session is ended first, then the person signs in again.
          onCancel: function () { api.post(sw('/api/auth/logout')).catch(function () {}).then(function () { location.href = sw('/auth/login'); }); }
        });
        return;
      }
      $('cb-working').classList.add('hidden');
      $('cb-error-text').textContent = status(err) === 401
        ? 'The sign-in could not be completed. Please sign in again.'
        : U.errorText(err, 'Authentication failed. Please try again.');
      $('cb-error').classList.remove('hidden');
    });
  }
  check();
})();
