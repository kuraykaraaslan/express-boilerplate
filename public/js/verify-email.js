// Behaviour of views/auth/verify-email.ejs; the port of NB's verify-email page.
// Signed in, the token is read against the caller's own session. Not signed in (401), the page asks for the account's
// password and sends { token, email, password }: the token proves the inbox, the password the account.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('verify-root'));
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var token = q.get('token');
  var email = q.get('email');
  U.autocomplete({ 'verify-email-address': 'email', 'verify-email-password': 'current-password' });
  if (email) $('verify-email-address').value = email;

  function show(id) {
    ['verify-verifying', 'verify-password-form', 'verify-ok', 'verify-error'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); });
    var el = $(id);
    if (id === 'verify-ok' || id === 'verify-error') el.focus(); // the panel replaces the spinner/form: read it out
  }
  function messageFor(err, extra) {
    var o = { INVALID_VERIFICATION_TOKEN: 'This verification link is invalid.', VERIFICATION_TOKEN_EXPIRED: 'This verification link has expired.' };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return U.errorText(err, 'Could not verify this email address.', o);
  }
  function alreadyVerified(err) { return K.authErrorCodes(err).indexOf('EMAIL_ALREADY_VERIFIED') >= 0; }
  function done(text, viaPassword) {
    $('verify-ok-text').textContent = text;
    var a = $('verify-ok-link').querySelector('a');
    a.textContent = viaPassword ? 'Sign in' : 'Continue';
    a.href = tp(viaPassword ? '/auth/login' : '/admin');
    show('verify-ok');
  }

  if (email) $('verify-verifying-text').textContent = 'Verifying ' + email + '…';
  if (!token) {
    $('verify-error-text').textContent = 'This link is missing its verification token.';
    show('verify-error');
  } else {
    api.post(tp('/api/auth/verify-email/verify'), { token: token }).then(function () {
      done('Your email has been verified.', false);
    }, function (err) {
      var status = err && err.response && err.response.status;
      if (status === 401) return show('verify-password-form'); // not signed in: confirm with the password instead
      if (alreadyVerified(err)) return done('This email is already verified.', false);
      $('verify-error-text').textContent = messageFor(err);
      show('verify-error');
    });
  }

  var pwForm = $('verify-password-form'), pwBtn = pwForm.querySelector('button[type=submit]'), cbanner = $('verify-confirm-banner');
  pwForm.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(cbanner);
    var em = $('verify-email-address').value.trim(), pw = $('verify-email-password').value;
    if (!em || !pw) return U.say(cbanner, 'error', 'Enter your email and password.');
    U.busy(pwBtn, true);
    api.post(tp('/api/auth/verify-email/verify'), { token: token, email: em, password: pw }).then(function () {
      done('Your email has been verified.', true);
    }, function (err) {
      if (alreadyVerified(err)) return done('This email is already verified.', true);
      U.say(cbanner, 'error', messageFor(err, { INVALID_VERIFICATION_TOKEN: 'The link, email or password is not right.' }));
    }).then(function () { $('verify-email-password').value = ''; U.busy(pwBtn, false); });
  });

  var resendBtn = $('verify-resend-box').querySelector('button'), rbanner = $('verify-resend-banner');
  resendBtn.addEventListener('click', function () {
    U.clear(rbanner);
    U.busy(resendBtn, true);
    api.post(tp('/api/auth/verify-email/send')).then(function () {
      $('verify-resend-box').classList.add('hidden');
      var r = $('verify-resent'); r.classList.remove('hidden'); r.focus();
    }, function (err) {
      // The route needs a session; a signed-out visitor is told so instead of being shown a bare failure.
      U.say(rbanner, 'error', U.errorText(err, 'Could not send a new verification link. Please try again.', { USER_NOT_AUTHENTICATED: 'Sign in to request a new verification link.' }));
      U.busy(resendBtn, false);
    });
  });
})();
