(function ThemeModule() {
  var html       = document.documentElement;
  var darkToggle = document.getElementById('dark-toggle');
  var darkIcon   = document.getElementById('dark-icon');

  function syncIcon() {
    if (!darkIcon) return;
    darkIcon.className = html.classList.contains('dark')
      ? 'fa-solid fa-sun'
      : 'fa-solid fa-moon';
  }

  syncIcon();

  if (darkToggle) {
    darkToggle.addEventListener('click', function () {
      var isDark = html.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      document.cookie = 'theme=' + (isDark ? 'dark' : 'light') + '; path=/; max-age=31536000; SameSite=Lax';
      syncIcon();
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) {
      html.classList.toggle('dark', e.matches);
      syncIcon();
    }
  });
})();

(function ModalModule() {
  var activeModal = null;
  var triggerEl   = null;

  function getFocusable(el) {
    return Array.from(el.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  function open(modalId, subject) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    if (subject) {
      var subjectEl = modal.querySelector('[data-modal-subject]');
      if (subjectEl) subjectEl.textContent = subject;
    }
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    activeModal = modal;
    var focusable = getFocusable(modal);
    if (focusable.length) focusable[0].focus();
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    if (!activeModal) return;
    activeModal.setAttribute('hidden', '');
    activeModal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown);
    activeModal = null;
    if (triggerEl) { triggerEl.focus(); triggerEl = null; }
  }

  function onKeydown(e) {
    if (!activeModal) return;
    // An inner control (an open ComboBox / Select list) already handled it.
    if (e.key === 'Escape') { if (!e.defaultPrevented) close(); return; }
    if (e.key !== 'Tab') return;
    var focusable = getFocusable(activeModal);
    if (!focusable.length) return;
    var first = focusable[0];
    var last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  document.addEventListener('click', function (e) {
    var openBtn = e.target.closest('[data-modal-open]');
    if (openBtn) {
      triggerEl = openBtn;
      open(openBtn.dataset.modalOpen, openBtn.dataset.modalSubject);
      return;
    }
    if (e.target.closest('[data-modal-close]') || e.target.closest('[data-modal-backdrop]')) {
      close();
    }
  });

  window.openModal  = open;
  window.closeModal = close;
})();

(function MobileMenuModule() {
  var btn  = document.getElementById('mobile-menu-btn');
  var menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  function open() {
    menu.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    menu.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }

  btn.addEventListener('click', function () {
    menu.hasAttribute('hidden') ? open() : close();
  });

  menu.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();

(function ToastModule() {
  var types = {
    success: { bg: 'bg-success-subtle border-success text-success-fg', icon: 'fa-circle-check' },
    warning: { bg: 'bg-warning-subtle border-warning text-warning-fg', icon: 'fa-triangle-exclamation' },
    error:   { bg: 'bg-error-subtle border-error text-error-fg',       icon: 'fa-circle-exclamation' },
    info:    { bg: 'bg-info-subtle border-info text-info-fg',          icon: 'fa-circle-info' },
  };

  window.showToast = function (type, message, duration) {
    duration = duration || 5000;
    var t  = types[type] || types.info;
    var el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.className = 'max-w-sm w-full rounded-lg border p-4 shadow-lg flex items-start gap-3 pointer-events-auto ' + t.bg;
    el.innerHTML =
      '<i class="fa-solid ' + t.icon + ' mt-0.5 shrink-0" aria-hidden="true"></i>' +
      '<p class="text-sm font-medium flex-1">' + message + '</p>' +
      '<button type="button" aria-label="Dismiss" ' +
      'class="shrink-0 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded" ' +
      'onclick="this.closest(\'[role=alert]\').remove()">' +
      '<i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
    var region = document.getElementById('toast-region');
    if (region) region.appendChild(el);
    if (type !== 'error') {
      setTimeout(function () { el.remove(); }, duration);
    }
  };
})();

(function AnnounceModule() {
  var region = document.getElementById('live-region');

  if (!region) {
    region = document.createElement('div');
    region.id = 'live-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';
    document.body.appendChild(region);
  }

  window.announce = function (message, politeness) {
    region.setAttribute('aria-live', politeness === 'assertive' ? 'assertive' : 'polite');
    region.textContent = '';
    setTimeout(function () { region.textContent = message; }, 50);
  };
})();
