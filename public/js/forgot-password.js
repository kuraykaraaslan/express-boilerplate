// Behaviour of views/auth/forgot-password.ejs; the port of NB's forgot-password page and form.
(function () {
  var K = window.Kui, U = window.AuthUi;
  var root = document.getElementById('forgot-root');
  var tenantId = U.tenantId(root);
  var banner = document.getElementById('forgot-banner');
  var form = document.querySelector('#forgot-form-area form');
  var btn = form.querySelector('button[type=submit]');
  var email = document.getElementById('forgot-email');
  U.autocomplete({ 'forgot-email': 'email' });
  document.getElementById('forgot-signin').href = K.tenantPath(tenantId, '/auth/login');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    U.clear(banner);
    U.fieldError('forgot-email', '');
    var value = email.value.trim();
    if (!value) return U.fieldError('forgot-email', 'Email is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return U.fieldError('forgot-email', 'Enter a valid email address.');
    U.busy(btn, true);
    K.api.post(K.tenantPath(tenantId, '/api/auth/forgot-password'), { email: value }).then(function () {
      document.getElementById('forgot-sent-email').textContent = value;
      document.getElementById('forgot-form-area').classList.add('hidden');
      var sent = document.getElementById('forgot-sent');
      sent.classList.remove('hidden');
      sent.focus(); // the notice replaces the form: read it out instead of dropping focus to the page
    }).catch(function (err) {
      var o = {}; o[K.VALIDATION_ISSUES] = 'Enter a valid email address.';
      U.say(banner, 'error', U.errorText(err, 'Failed to send reset link.', o));
      U.busy(btn, false);
    });
  });
})();
