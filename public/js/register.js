// Behaviour of views/auth/register.ejs; the port of NB's register page, form and registration-status hook.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var root = document.getElementById('register-root');
  var tenantId = U.tenantId(root);
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var ONBOARDING_REDIRECT_DELAY_MS = 6000; // the new session's refresh token is valid only after a few seconds
  var banner = document.getElementById('register-banner');
  var area = document.getElementById('register-form-area');
  var form = area.querySelector(':scope > form');
  var btn = form.querySelector('button[type=submit]');
  var IDS = ['register-email', 'register-password', 'register-confirm-password'];
  U.autocomplete({ 'register-email': 'email', 'register-password': 'new-password', 'register-confirm-password': 'new-password' });

  function safeRedirect(raw) {
    if (!raw || raw.length > 4096 || raw.charAt(0) !== '/' || raw.indexOf('//') === 0 || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
    return raw;
  }
  var redirectTo = safeRedirect(new URLSearchParams(location.search).get('redirect'));
  var signInHref = tp('/auth/login') + (redirectTo ? '?redirect=' + encodeURIComponent(redirectTo) : '');
  document.getElementById('register-signin').href = signInHref;
  document.getElementById('register-continue').href = signInHref;

  var enabled = false;
  // Fails closed: an error is "not open".
  api.get(tp('/api/auth/registration')).then(function (res) { enabled = !!(res.data && res.data.enabled === true); }).catch(function () { enabled = false }).then(function () {
    document.getElementById('register-loading').classList.add('hidden');
    if (enabled) area.classList.remove('hidden'); else document.getElementById('register-closed').classList.remove('hidden');
  });

  var sso = document.getElementById('register-sso');
  api.get(tp('/api/auth/sso')).then(function (res) {
    var list = ((res.data && res.data.providers) || []).map(function (p) { return String(p).toUpperCase(); });
    sso.querySelectorAll('form').forEach(function (f) {
      var provider = f.querySelector('input[name="provider"]').value;
      if (list.indexOf(provider) < 0) { f.remove(); return; }
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        U.clear(banner);
        api.get(tp('/api/auth/sso/' + provider.toLowerCase())).then(function (r) {
          var url = r.data && r.data.url;
          if (!url) throw new K.AuthUiError('No SSO URL returned.');
          location.href = url;
        }).catch(function (err) { U.say(banner, 'error', U.errorText(err, 'SSO sign-up failed.')); });
      });
    });
    if (list.length) sso.classList.remove('hidden');
  }).catch(function () {});

  function showSuccess(email) {
    area.classList.add('hidden');
    document.getElementById('register-success-message').textContent = 'Account created for ' + email;
    var box = document.getElementById('register-success');
    box.classList.remove('hidden');
    box.focus();
    if (redirectTo) document.getElementById('register-continue').classList.remove('hidden');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(banner);
    U.clearFieldErrors(IDS);
    var email = document.getElementById(IDS[0]).value.trim();
    var pw = document.getElementById(IDS[1]).value;
    var cf = document.getElementById(IDS[2]).value;
    var bad = false;
    if (!email) { U.fieldError(IDS[0], 'Email is required.'); bad = true; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { U.fieldError(IDS[0], 'Enter a valid email address.'); bad = true; }
    if (!pw) { U.fieldError(IDS[1], 'Password is required.'); bad = true; }
    else if (pw.length < 8) { U.fieldError(IDS[1], 'Password must be at least 8 characters.'); bad = true; }
    if (!cf) { U.fieldError(IDS[2], 'Please confirm your password.'); bad = true; }
    else if (pw !== cf) { U.fieldError(IDS[2], 'Passwords do not match.'); bad = true; }
    if (bad) return;

    U.busy(btn, true);
    api.post(tp('/api/auth/register'), { email: email, password: pw }).then(function (res) {
      var onboarding = !!(res.data && res.data.onboarding === true);
      showSuccess(email);
      if (!onboarding) return;
      // Sign the new account in (the platform's central login gives it an account-only session) and continue to the
      // onboarding; when that is not possible the success panel and its sign-in link remain.
      return api.post(tp('/api/auth/login'), { email: email, password: pw, rememberMe: false }).then(function (login) {
        var methods = (login.data && login.data.userSecurity && login.data.userSecurity.otpMethods) || [];
        if (methods.length > 0) return;
        document.getElementById('register-continue').classList.add('hidden');
        document.getElementById('register-onboarding').classList.remove('hidden');
        setTimeout(function () { location.href = tp('/auth/onboarding'); }, ONBOARDING_REDIRECT_DELAY_MS);
      }).catch(function () {});
    }, function (err) {
      var o = {}; o[K.VALIDATION_ISSUES] = 'Enter a valid email address.';
      U.say(banner, 'error', U.errorText(err, 'Registration failed.', o));
      U.busy(btn, false);
    });
  });
})();
