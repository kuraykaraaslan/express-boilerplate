// Behaviour of views/auth/logout.ejs; the port of NB's logout page.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('logout-root'));
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  document.querySelectorAll('.logout-continue').forEach(function (a) { a.href = tp('/auth/login'); });

  // The logout route's own failure answer (503 { success:false }) has already cleared both cookies, so a retry would end nothing.
  function routeClearedCookies(err) {
    var r = err && err.response;
    return !!r && r.status === 503 && r.data && r.data.success === false;
  }
  function run() {
    $('logout-failed').classList.add('hidden');
    $('logout-working').classList.remove('hidden');
    api.post(tp('/api/auth/logout')).then(function () { location.href = tp('/auth/login'); }, function (err) {
      // A failed sign-out is said, not passed off as one; a 401 means there is no session: done.
      if (err && err.response && err.response.status === 401) { location.href = tp('/auth/login'); return; }
      $('logout-working').classList.add('hidden');
      if (routeClearedCookies(err)) { $('logout-device-only').classList.remove('hidden'); return; }
      $('logout-failed-message').textContent = U.errorText(err, 'Your session may still be active. Try again, or continue to sign in.');
      $('logout-failed').classList.remove('hidden');
    });
  }
  $('logout-failed').querySelector('button').addEventListener('click', run);
  run();
})();
