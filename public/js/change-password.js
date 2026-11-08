// Behaviour of views/auth/change-password.ejs; the port of NB's change-password page (auth.05, the forced step).
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var root = document.getElementById('chpw-root');
  var tenantId = U.tenantId(root);
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var banner = document.getElementById('chpw-banner');
  var form = document.getElementById('chpw-form');
  var btn = form.querySelector('button[type=submit]');
  var IDS = ['change-password-current', 'change-password-new', 'change-password-confirm'];
  U.autocomplete({ 'change-password-username': 'username', 'change-password-current': 'current-password', 'change-password-new': 'new-password', 'change-password-confirm': 'new-password' });
  document.getElementById('chpw-continue-link').href = tp('/auth/login');

  function safeRedirect(raw) {
    if (!raw || raw.charAt(0) !== '/' || raw.indexOf('//') === 0) return null;
    if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
    if (raw.indexOf('/auth/change-password') >= 0) return null;
    return raw;
  }
  var redirectTo = safeRedirect(new URLSearchParams(location.search).get('redirect'));

  // The account's email for the read-only username field, so a password manager files the new password under it.
  api.get(tp('/api/auth/session')).then(function (res) {
    var email = res && res.data && res.data.user && res.data.user.email;
    if (typeof email === 'string' && email) {
      document.getElementById('change-password-username').value = email;
      document.getElementById('chpw-username-box').classList.remove('hidden');
    }
  }).catch(function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(banner);
    U.clearFieldErrors(IDS);
    var cur = document.getElementById(IDS[0]).value, nw = document.getElementById(IDS[1]).value, cf = document.getElementById(IDS[2]).value;
    var bad = false;
    if (!cur) { U.fieldError(IDS[0], 'Enter your current password.'); bad = true; }
    if (!nw) { U.fieldError(IDS[1], 'Password is required.'); bad = true; }
    else if (nw.length < 8) { U.fieldError(IDS[1], 'Password must be at least 8 characters.'); bad = true; }
    else if (nw === cur) { U.fieldError(IDS[1], 'Choose a password different from the current one.'); bad = true; }
    if (!cf) { U.fieldError(IDS[2], 'Please confirm your password.'); bad = true; }
    else if (nw !== cf) { U.fieldError(IDS[2], 'Passwords do not match.'); bad = true; }
    if (bad) return;

    U.busy(btn, true);
    api.post(tp('/api/auth/change-password'), { currentPassword: cur, newPassword: nw }).then(function () {
      form.classList.add('hidden');
      document.getElementById('chpw-footer').classList.add('hidden');
      document.getElementById('chpw-done').classList.remove('hidden');
      location.href = redirectTo || (K.isRootTenant(tenantId) ? tp('/auth/select-tenant') : tp('/admin/me'));
    }, function (err) {
      U.say(banner, 'error', U.errorText(err, 'Could not change your password.', { INVALID_CREDENTIALS: 'Your current password is not correct.' }));
      U.busy(btn, false);
    });
  });

  // A failed sign-out is said, not hidden behind the login form: the server session may still be alive.
  function routeClearedCookies(err) {
    var r = err && err.response;
    return !!r && r.status === 503 && r.data && r.data.success === false;
  }
  var out = document.getElementById('chpw-signout');
  out.addEventListener('click', function () {
    var toLogin = function () { location.href = tp('/auth/login'); };
    out.disabled = true;
    U.clear(banner);
    api.post(tp('/api/auth/logout')).then(toLogin, function (err) {
      if (err && err.response && err.response.status === 401) return toLogin();
      if (routeClearedCookies(err)) {
        form.classList.add('hidden');
        document.getElementById('chpw-footer').classList.add('hidden');
        document.getElementById('chpw-device-only').classList.remove('hidden');
        document.getElementById('chpw-continue').classList.remove('hidden');
        return;
      }
      U.say(banner, 'error', U.errorText(err, 'Could not sign you out. Your session may still be active.'));
      document.getElementById('chpw-continue').classList.remove('hidden');
      out.disabled = false;
    });
  });
})();
