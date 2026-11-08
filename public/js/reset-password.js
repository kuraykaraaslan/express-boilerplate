// Behaviour of views/auth/reset-password.ejs; the port of NB's reset-password page and form.
(function () {
  var K = window.Kui, U = window.AuthUi;
  var root = document.getElementById('reset-root');
  var tenantId = U.tenantId(root);
  var banner = document.getElementById('reset-banner');
  var form = document.getElementById('reset-form');
  var btn = form.querySelector('button[type=submit]');
  var q = new URLSearchParams(location.search);
  var resetToken = q.get('resetToken'), email = q.get('email');
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var IDS = ['reset-password-new', 'reset-password-confirm'];
  U.autocomplete({ 'reset-password-username': 'username', 'reset-password-new': 'new-password', 'reset-password-confirm': 'new-password' });
  document.querySelector('#reset-done a').href = tp('/auth/login');
  document.getElementById('reset-request-new-link').href = tp('/auth/forgot-password');

  if (!resetToken || !email) {
    U.say(banner, 'error', 'This link is missing its reset token.');
    document.getElementById('reset-request-new').classList.remove('hidden');
    return;
  }
  document.getElementById('reset-password-username').value = email;
  form.classList.remove('hidden');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(banner);
    U.clearFieldErrors(IDS);
    var pw = document.getElementById('reset-password-new').value;
    var cf = document.getElementById('reset-password-confirm').value;
    var bad = false;
    if (!pw) { U.fieldError(IDS[0], 'Password is required.'); bad = true; }
    else if (pw.length < 8) { U.fieldError(IDS[0], 'Password must be at least 8 characters.'); bad = true; }
    if (!cf) { U.fieldError(IDS[1], 'Please confirm your password.'); bad = true; }
    else if (pw !== cf) { U.fieldError(IDS[1], 'Passwords do not match.'); bad = true; }
    if (bad) return;
    U.busy(btn, true);
    K.api.post(tp('/api/auth/reset-password'), { email: email, resetToken: resetToken, password: pw }).then(function () {
      form.classList.add('hidden');
      var done = document.getElementById('reset-done');
      done.classList.remove('hidden');
      done.focus();
    }).catch(function (err) {
      var invalid = 'This reset link is invalid or has expired.';
      U.say(banner, 'error', U.errorText(err, 'Could not reset your password.', { INVALID_TOKEN: invalid, USER_NOT_FOUND: invalid }));
      U.busy(btn, false);
    });
  });
})();
