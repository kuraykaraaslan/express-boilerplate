// Behaviour of views/auth/complete-profile.ejs; the port of NB's complete-profile page. The account holds a synthetic
// placeholder email: the person adds a real email (verified), or merges this identity into an account they already own.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('cp-root'));
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // the same test as the complete-email route's
  var choose = $('cp-choose'), emailForm = $('cp-email-form'), mergeForm = $('cp-merge-form');
  U.autocomplete({ 'complete-profile-email': 'email', 'complete-profile-merge-email': 'username', 'complete-profile-merge-password': 'current-password' });

  var ALL_IDS = ['complete-profile-email', 'complete-profile-merge-email', 'complete-profile-merge-password'];
  function mode(m) {
    choose.classList.toggle('hidden', m !== 'choose');
    emailForm.classList.toggle('hidden', m !== 'email');
    mergeForm.classList.toggle('hidden', m !== 'merge');
    document.querySelectorAll('.cp-banner').forEach(function (b) { U.clear(b); b.classList.add('hidden'); });
    U.clearFieldErrors(ALL_IDS);
  }
  var chooseBtns = choose.querySelectorAll('button');
  chooseBtns[0].addEventListener('click', function () { mode('email'); });
  chooseBtns[1].addEventListener('click', function () { mode('merge'); });
  document.querySelectorAll('.cp-back').forEach(function (b) { b.addEventListener('click', function () { mode('choose'); }); });

  function emailError(v) {
    if (!v.trim()) return 'Email is required.';
    if (!EMAIL_RE.test(v.trim())) return 'Enter a valid email address.';
    return '';
  }
  function bannerOf(form) { return form.querySelector('.cp-banner'); }

  emailForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var banner = bannerOf(emailForm), btn = emailForm.querySelector('button[type=submit]');
    U.clear(banner); U.fieldError('complete-profile-email', '');
    var email = $('complete-profile-email').value;
    var bad = emailError(email);
    if (bad) return U.fieldError('complete-profile-email', bad);
    U.busy(btn, true);
    api.post(tp('/api/auth/me/complete-email'), { email: email }).then(function () {
      choose.classList.add('hidden'); emailForm.classList.add('hidden');
      $('cp-done-text').textContent = 'Verification email sent. Check your inbox to confirm your address.';
      $('cp-done').classList.remove('hidden');
    }, function (err) {
      var o = {};
      // The field already passed the route's own email check, so its one remaining 400 is "this account already has a real email".
      o[K.VALIDATION_ISSUES] = 'This account already has an email address.';
      o.CONFLICT = 'That email is already in use. Sign in to that account and link this identity instead.';
      U.say(banner, 'error', U.errorText(err, 'Could not save email.', o));
      U.busy(btn, false);
    });
  });

  mergeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var banner = bannerOf(mergeForm), btn = mergeForm.querySelector('button[type=submit]');
    U.clear(banner); U.clearFieldErrors(['complete-profile-merge-email', 'complete-profile-merge-password']);
    var email = $('complete-profile-merge-email').value, pw = $('complete-profile-merge-password').value;
    var bad = false, eb = emailError(email);
    if (eb) { U.fieldError('complete-profile-merge-email', eb); bad = true; }
    if (!pw) { U.fieldError('complete-profile-merge-password', 'Password is required.'); bad = true; }
    if (bad) return;
    U.busy(btn, true);
    api.post(tp('/api/auth/me/merge-identity'), { email: email, password: pw }).then(function (res) {
      var redirect = (res.data && res.data.redirect) || tp('/admin');
      // The merged account's own second factor still applies: its session is pending until the code step verifies it.
      var methods = res.data && res.data.otpRequired === true ? U.orderOtpMethods((res.data.userSecurity && res.data.userSecurity.otpMethods) || []) : [];
      if (!methods.length) { location.href = redirect; return; }
      $('cp-main').classList.add('hidden');
      var box = $('cp-otp'); box.classList.remove('hidden');
      U.otpStep(box, {
        tenantId: tenantId, methods: methods,
        onVerified: function () { location.href = redirect; },
        // The placeholder session was replaced by the pending one, so there is no way back to these forms: sign in again.
        onCancel: function () { api.post(tp('/api/auth/logout')).catch(function () {}).then(function () { location.href = tp('/auth/login'); }); }
      });
    }, function (err) {
      U.say(banner, 'error', U.errorText(err, 'Could not merge accounts.'));
      U.busy(btn, false);
    });
  });
})();
