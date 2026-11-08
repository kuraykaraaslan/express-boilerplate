// The one-time-code step (the port of NB's LoginOtpStep): second step of a sign-in whose account has codes on. The session the
// password created is pending until a code is verified with action 'authenticate' on THIS tenant.
// AuthUi.otpStep(container, { tenantId, methods, onVerified, onCancel, apiPath, cancelLabel })
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var ORDER = ['TOTP_APP', 'EMAIL', 'SMS'];
  var LABELS = { TOTP_APP: 'Authenticator app', EMAIL: 'Email', SMS: 'SMS' };
  var CODE_REJECTIONS = ['INVALID_OTP', 'OTP_EXPIRED', K.VALIDATION_ISSUES];
  var BTN = 'inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 ';

  U.orderOtpMethods = function (methods) { return ORDER.filter(function (m) { return (methods || []).indexOf(m) >= 0; }); };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  U.otpStep = function (box, o) {
    var apiPath = o.apiPath || K.tenantPath;
    var methods = o.methods, method = methods[0];
    box.innerHTML = '';
    var wrap = el('div', 'space-y-4');
    box.appendChild(wrap);

    var head = el('div', 'text-center space-y-1');
    head.appendChild(el('h2', 'text-sm font-semibold text-text-primary', 'Two-step verification'));
    var sub = el('p', 'text-sm text-text-secondary');
    head.appendChild(sub);
    wrap.appendChild(head);

    var radios = el('div', 'flex gap-2');
    radios.setAttribute('role', 'radiogroup');
    radios.setAttribute('aria-label', 'Verification method');
    if (methods.length > 1) wrap.appendChild(radios);

    var delivery = el('div', 'space-y-1');
    var sendBtn = el('button', BTN + 'border border-border text-text-primary hover:bg-surface-overlay');
    sendBtn.type = 'button';
    var status = el('p', 'text-center text-xs text-text-secondary');
    status.setAttribute('role', 'status');
    delivery.appendChild(sendBtn); delivery.appendChild(status);
    wrap.appendChild(delivery);

    var banner = el('div', 'hidden'); banner.setAttribute('role', 'alert');
    var form = el('form', 'space-y-4'); form.noValidate = true;
    var field = el('div', 'space-y-1');
    var label = el('label', 'block text-sm font-medium text-text-primary', 'Code'); label.htmlFor = 'login-otp-code';
    var input = el('input', 'block w-full rounded-md border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus');
    input.id = 'login-otp-code'; input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code';
    field.appendChild(label); field.appendChild(input);
    var verifyBtn = el('button', BTN + 'bg-primary text-primary-fg hover:bg-primary-hover', 'Verify'); verifyBtn.type = 'submit';
    form.appendChild(banner); form.appendChild(field); form.appendChild(verifyBtn);
    wrap.appendChild(form);

    var cancelP = el('p', 'text-center text-xs');
    var cancel = el('button', 'text-primary hover:underline', o.cancelLabel || 'Use a different account'); cancel.type = 'button';
    cancelP.appendChild(cancel); wrap.appendChild(cancelP);

    var sentTo = null;
    function needsDelivery() { return method !== 'TOTP_APP'; }
    function paint() {
      sub.textContent = needsDelivery() ? 'Send yourself a code, then enter it below.' : 'Enter the code from your authenticator app.';
      delivery.classList.toggle('hidden', !needsDelivery());
      sendBtn.textContent = sentTo === method ? 'Send the code again' : 'Send code';
      status.textContent = sentTo === method ? (method === 'EMAIL' ? 'We sent a code to your email address.' : 'We sent a code to your phone by SMS.') : '';
      radios.querySelectorAll('[role=radio]').forEach(function (b) {
        var on = b.getAttribute('data-m') === method;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        b.className = 'flex-1 rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
          (on ? 'border-primary bg-primary-subtle text-primary font-medium' : 'border-border text-text-secondary hover:bg-surface-raised');
      });
    }
    function pick(m) { method = m; input.value = ''; U.clear(banner); U.fieldError('login-otp-code', ''); paint(); }
    methods.forEach(function (m, i) {
      var b = el('button', '', LABELS[m]); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('data-m', m);
      b.addEventListener('click', function () { pick(m); });
      // A radiogroup has one Tab stop; the arrows, Home and End move the choice and the focus.
      b.addEventListener('keydown', function (e) {
        var last = methods.length - 1, n = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = i === last ? 0 : i + 1;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = i === 0 ? last : i - 1;
        else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = last;
        if (n === null) return;
        e.preventDefault(); pick(methods[n]); radios.querySelectorAll('[role=radio]')[n].focus();
      });
      radios.appendChild(b);
    });

    sendBtn.addEventListener('click', function () {
      U.busy(sendBtn, true); U.clear(banner);
      api.post(apiPath(o.tenantId, '/api/auth/otp/send'), { method: method, action: 'authenticate' }).then(function () {
        sentTo = method; U.fieldError('login-otp-code', ''); paint();
      }, function (err) { U.say(banner, 'error', U.errorText(err, 'The code could not be sent. Try again.')); })
        .then(function () { U.busy(sendBtn, false); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      U.clear(banner); U.fieldError('login-otp-code', '');
      if (!input.value.trim()) return U.fieldError('login-otp-code', 'Enter the code.');
      U.busy(verifyBtn, true);
      api.post(apiPath(o.tenantId, '/api/auth/otp/verify'), { method: method, action: 'authenticate', otpToken: input.value.trim() }).then(function () {
        o.onVerified();
      }, function (err) {
        var ov = {}; ov[K.VALIDATION_ISSUES] = 'That code is not correct. Check it and try again.';
        var text = U.errorText(err, 'That code did not work. Try again.', ov);
        // A failure about the code itself goes on the field; anything else (a rate limit, a lost session) on the form.
        var aboutCode = !K.isRateLimited(err) && K.authErrorCodes(err).some(function (c) { return CODE_REJECTIONS.indexOf(c) >= 0; });
        if (aboutCode) U.fieldError('login-otp-code', text); else U.say(banner, 'error', text);
        U.busy(verifyBtn, false);
      });
    });
    cancel.addEventListener('click', o.onCancel);

    paint();
    input.focus(); // the step replaces the password form: focus would otherwise drop to the page
  };
})();
