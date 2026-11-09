// The step-up question (the port of auth/ui/step-up.dialog.tsx): a route that guards an action answers 401 with details.stepUp; this asks for
// a second factor (a passkey when the server offers one, the authenticator-app code as the fallback) inside the kui ConfirmDialog and
// repeats the request once with the grant. Each attempt uses a fresh single-use challenge.
//
//   KuiStepUp.run(tenantId, function (headers) { return api.put(url, body, { headers: headers }); })
//   rejects with StepUpCancelled (Kui.isStepUpCancelled(err)) when the person closes the dialog.
(function () {
  var K = window.Kui, api = K.api;
  var T = function (_k, fallback) { return fallback; };

  function options(tp, request) {
    return api.post(tp('/api/auth/step-up/options'), request).then(function (r) { return r.data; });
  }
  function prove(tenantId, request) {
    var tp = function (p) { return K.tenantPath(tenantId, p); };
    return options(tp, request).then(function ask(challenge) {
      var offersPasskey = !!(challenge.methods && challenge.methods.indexOf('webauthn') >= 0 && challenge.webauthn);
      var offersTotp = !!(challenge.methods && challenge.methods.indexOf('totp') >= 0);
      var digits = Number.isInteger(challenge.totpDigits) && challenge.totpDigits >= 4 && challenge.totpDigits <= 10 ? challenge.totpDigits : 6;
      var token = null;
      function verify(body) {
        return api.post(tp('/api/auth/step-up/verify'), Object.assign({ challengeId: challenge.challengeId }, body)).then(function (r) { token = String(r.data.stepUpToken); });
      }
      function usePasskey() {
        return K.startAuthentication({ optionsJSON: challenge.webauthn }).then(function (response) { return verify({ method: 'webauthn', response: response }); });
      }
      // A failed answer burns the challenge: the next attempt gets a fresh one, unless a rate limit stopped everything for a while.
      function failed(err) {
        if (!K.isRateLimited(err)) return options(tp, request).then(function (c) { challenge = c; throw err; });
        throw err;
      }
      return window.confirmDialog({
        title: T('auth.stepUp.title', 'Confirm it is you'),
        message: T('auth.stepUp.intro', 'This action needs a second factor. The confirmation is valid for this one action for five minutes.'),
        size: 'sm',
        confirmLabel: offersTotp ? T('auth.stepUp.confirm', 'Confirm') : T('auth.stepUp.passkey', 'Confirm with a passkey'),
        secondaryLabel: offersTotp && offersPasskey ? T('auth.stepUp.passkey', 'Confirm with a passkey') : undefined,
        input: offersTotp ? { kind: 'text', label: T('auth.stepUp.code', 'Code from your authenticator app'), required: true, minLength: digits, maxLength: digits,
          hint: digits + ' digits. Backup codes cannot confirm an action.' } : undefined,
        action: function (result) {
          var code = result && result.value != null ? String(result.value).replace(/\D/g, '') : '';
          var run = result && result.choice === 'secondary' || !offersTotp ? usePasskey() : verify({ method: 'totp', code: code });
          return run.catch(function (e) {
            // A closed passkey prompt is not an error: the challenge is unused, so the person may try again or use the code.
            if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) throw new Error('The passkey prompt was closed.');
            return failed(e);
          });
        },
        errorMessage: function (e) { return K.authErrorText(e, T, T('auth.stepUp.failed', 'The confirmation could not be verified.')); },
      }).then(function (done) {
        if (!done || !token) throw new K.StepUpCancelled();
        return token;
      });
    }, function (e) { throw e; });
  }

  window.KuiStepUp = {
    run: function (tenantId, call) { return K.withStepUp(call, function (request) { return prove(tenantId, request); }); },
  };
})();
