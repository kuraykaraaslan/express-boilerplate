// Behaviour of views/auth/login.ejs; the port of NB's login.page.tsx on the shared API client (window.Kui, built from client/api.ts).
(function () {
  var K = window.Kui, api = K.api;
  var root = document.getElementById('login-root');
  var tenantId = root.getAttribute('data-tenant-id') || '';
  var ROOT_TENANT_ID = '00000000-0000-4000-8000-000000000000';
  var POST_LOGIN_REDIRECT_DELAY_MS = 6000; // the refresh token is not valid for 5 s after login (notBefore)
  var q = new URLSearchParams(location.search);
  var tp = function (p) { return K.tenantPath(tenantId, p); };

  function safeRedirect(raw) {
    if (!raw || raw.charAt(0) !== '/' || raw.indexOf('//') === 0) return null;
    if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
    return raw;
  }
  var redirectTo = safeRedirect(q.get('redirect'));

  // Only known codes are shown as text; nothing in the URL is rendered as prose.
  var SSO_ERRORS = {
    sso_account_exists: 'An account with this email already exists. Sign in to it, then link this provider from Connected Accounts.',
    sso_state_invalid: 'This sign-in could not be verified for this browser. Start the sign-in again.',
    sso_provider_not_allowed: 'This sign-in provider is not allowed here.',
    local_credentials_disabled: 'Sign-in with a password, code, passkey or another provider is not available here. Continue with Fleet ID.',
    fleet_id_unavailable: 'Fleet ID sign-in is not available here right now.',
    fleet_id_state_invalid: 'This Fleet ID sign-in could not be verified for this browser. Start the sign-in again.',
    fleet_id_denied: 'The sign-in was cancelled or not allowed at Fleet ID.',
    fleet_id_not_member: 'Your Fleet ID account is not a member of this workspace. Ask an administrator for an invitation.',
    fleet_id_account_disabled: 'Your account in this workspace is disabled.',
    fleet_id_tenant_inactive: 'This workspace is not active.',
    fleet_id_invitation_invalid: 'This invitation can no longer be used. Ask an administrator for a new one.',
    fleet_id_invitation_mismatch: 'This invitation was sent to a different address than the one on your Fleet ID account.',
    fleet_id_failed: 'Fleet ID sign-in failed. Try again.'
  };

  var banner = document.getElementById('login-banner');
  function say(kind, text) {
    var tone = kind === 'error' ? 'bg-error-subtle border-error text-error-fg' : 'bg-info-subtle border-info text-info-fg';
    var icon = kind === 'error' ? 'fa-circle-xmark' : 'fa-circle-info';
    banner.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm ' + tone;
    banner.innerHTML = '<i class="fa-solid ' + icon + ' mt-0.5 shrink-0" aria-hidden="true"></i><span></span>';
    banner.lastChild.textContent = text;
  }
  function clear() { banner.className = 'hidden'; banner.textContent = ''; }

  if (q.get('reason') === 'session_ended') {
    say('info', redirectTo ? 'Your session ended. Sign in again to go back to the page you were on.' : 'Your session ended. Sign in again to continue.');
  }
  if (q.get('error')) say('error', SSO_ERRORS[q.get('error')] || 'SSO sign-in failed.');

  function accountOnlyRedirect(target) {
    if (!target) return null;
    var path;
    try { path = new URL(target, 'http://localhost').pathname; } catch (e) { return null; }
    var m = path.match(/^\/(?:tenant|t)\/([^/]+)(\/.*)?$/);
    var appPath = m ? (m[2] || '/') : path;
    if (m && m[1] !== tenantId) return null;
    return appPath.indexOf('/auth/') === 0 ? target : null;
  }

  function finishLogin(message, accountOnly, mustChangePassword) {
    if (mustChangePassword) {
      var cp = tp('/auth/change-password');
      location.href = redirectTo ? cp + '?redirect=' + encodeURIComponent(redirectTo) : cp;
      return;
    }
    document.getElementById('login-form-area').classList.add('hidden');
    clear();
    document.getElementById('login-success-message').textContent = message;
    var ok = document.getElementById('login-success');
    ok.classList.remove('hidden');
    ok.focus();
    var picker = tp('/auth/select-tenant');
    var isRoot = tenantId === ROOT_TENANT_ID;
    var destination = isRoot ? (accountOnly ? (accountOnlyRedirect(redirectTo) || picker) : (redirectTo || picker)) : (redirectTo || tp('/admin/me'));
    setTimeout(function () { location.href = destination; }, POST_LOGIN_REDIRECT_DELAY_MS);
  }

  var form = document.querySelector('#login-form-area form[novalidate]');
  var submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clear();
    var email = form.elements.email.value, password = form.elements.password.value, rememberMe = !!form.elements.rememberMe.checked;
    submitBtn.disabled = true;
    api.post(tp('/api/auth/login'), { email: email, password: password, rememberMe: rememberMe }).then(function (res) {
      var d = res.data || {};
      var message = typeof d.passwordExpiresInDays === 'number'
        ? 'Signed in as ' + email + ' — your password expires in ' + d.passwordExpiresInDays + ' day(s); change it in your profile.'
        : 'Signed in as ' + email;
      var methods = (d.userSecurity && d.userSecurity.otpMethods) || [];
      if (methods.length > 0) {
        // The one-time code step is not on this page yet: the pending session is dropped and the person is told.
        api.post(tp('/api/auth/logout')).catch(function () {});
        say('error', 'This account asks for a one-time code, which this sign-in page does not support yet.');
        submitBtn.disabled = false;
        return;
      }
      finishLogin(message, d.tenantMember === null, d.mustChangePassword === true);
    }).catch(function (err) {
      var o = {}; o[K.VALIDATION_ISSUES] = 'Enter a valid email address.';
      var t = function (_k, fallback) { return fallback; };
      say('error', K.authErrorText(err, t, 'Login failed.', o));
      submitBtn.disabled = false;
    });
  });

  // Providers the tenant has switched on (SSO and national-identity sign-in).
  var providers = document.getElementById('login-providers');
  api.get(tp('/api/auth/sso')).then(function (res) {
    var list = ((res.data && res.data.providers) || []).map(function (p) { return String(p).toUpperCase(); });
    var sso = document.getElementById('login-sso');
    sso.querySelectorAll('form').forEach(function (f) {
      var provider = f.querySelector('input[name="provider"]').value;
      if (list.indexOf(provider) < 0) { f.remove(); return; }
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        api.get(tp('/api/auth/sso/' + provider.toLowerCase())).then(function (r) {
          var url = r.data && r.data.url;
          if (!url) throw new Error('No SSO URL returned.');
          location.href = url;
        }).catch(function () { say('error', 'SSO sign-in failed.'); });
      });
    });
    if (list.length) { sso.classList.remove('hidden'); providers.classList.remove('hidden'); }
  }).catch(function () {});

  api.get(tp('/api/auth/acs')).then(function (res) {
    var list = (res.data && res.data.providers) || [];
    var host = document.getElementById('login-acs');
    list.forEach(function (p) {
      var a = document.createElement('a');
      a.href = tp('/api/auth/acs/' + encodeURIComponent(p.provider) + '/initiate?tenantId=' + encodeURIComponent(tenantId));
      a.className = 'inline-flex w-full items-center justify-center rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-sunken';
      a.textContent = p.label;
      host.appendChild(a);
    });
    if (list.length) providers.classList.remove('hidden');
  }).catch(function () {});

  document.getElementById('login-forgot').href = tp('/auth/forgot-password');

  // "Sign up" only where sign-up is open.
  api.get(tp('/api/auth/registration')).then(function (res) {
    if (res.data && res.data.enabled) {
      document.getElementById('login-register-link').href = tp('/auth/register');
      document.getElementById('login-register').classList.remove('hidden');
    }
  }).catch(function () {});
})();
