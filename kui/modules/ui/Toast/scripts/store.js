<%# modules/ui/Toast/scripts/store.js %>
<%#
  Imperative `window.toast()` API, queue (max 5, FIFO trim) and region
  injection. Identical surface to the NextJS `toast()` API so consumers can
  share code between EJS and NextJS demos:

    window.toast({ variant, title, message, duration, position, actions, ... })
    window.toast.success(opts)
    window.toast.error(opts)
    window.toast.warning(opts)
    window.toast.info(opts)
    window.toast.loading(opts)
    window.toast.promise(promise, { loading, success, error }, opts?)
    window.toast.update(id, patch)
    window.toast.dismiss(id)
    window.toast.clear()

  Backwards-compat alias: window.notify = window.toast.

  M1 milestone — see PLANS/26-Toast.md.
  TODO M2: per-toast variant icon override, custom render slot.
  TODO M3: swipe-to-dismiss + prefers-reduced-motion.
  TODO M4: group/persistent toasts, badge counter, promise UX polish.
%>
<script>
(function () {
  if (window.__toastInit) return;
  window.__toastInit = true;

  var POSITION_MAP = {
    'top-right':     'top-4 right-4 items-end',
    'top-left':      'top-4 left-4 items-start',
    'top-center':    'top-4 left-1/2 -translate-x-1/2 items-center',
    'bottom-right':  'bottom-4 right-4 items-end',
    'bottom-left':   'bottom-4 left-4 items-start',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center',
  };

  // role/aria-live: info/success/loading → status+polite, warning/error → alert+assertive
  var VARIANTS = {
    success: { container: 'bg-success-subtle border-success', iconColor: 'text-success-fg',    progressColor: 'bg-success', icon: 'fa-circle-check',         spin: false, role: 'status', live: 'polite'    },
    warning: { container: 'bg-warning-subtle border-warning', iconColor: 'text-warning',        progressColor: 'bg-warning', icon: 'fa-triangle-exclamation', spin: false, role: 'alert',  live: 'assertive' },
    error:   { container: 'bg-error-subtle border-error',     iconColor: 'text-error',          progressColor: 'bg-error',   icon: 'fa-circle-xmark',         spin: false, role: 'alert',  live: 'assertive' },
    info:    { container: 'bg-info-subtle border-info',       iconColor: 'text-info',           progressColor: 'bg-info',    icon: 'fa-circle-info',          spin: false, role: 'status', live: 'polite'    },
    loading: { container: 'bg-surface-raised border-border',  iconColor: 'text-text-secondary', progressColor: 'bg-primary', icon: 'fa-spinner',              spin: true,  role: 'status', live: 'polite'    },
  };

  // Per-variant default auto-dismiss (ms). null = persistent.
  var VARIANT_DURATION = {
    success: 5000,
    info:    5000,
    warning: 5000,
    error:   null,
    loading: null,
  };

  var DEFAULT_POSITION = 'top-right';
  var MAX_QUEUE        = 5;
  var TICK_MS          = 50;
  var EXIT_MS          = 250;

  // region position -> { el, items: [{id, dismiss}] }
  var regions = {};
  var nextId  = 1;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function getRegion(position) {
    var pos = POSITION_MAP[position] ? position : DEFAULT_POSITION;
    if (regions[pos]) return regions[pos];

    // Reuse a pre-rendered region (from _region.ejs partial) if present.
    var el = document.querySelector('[data-toast-region="' + pos + '"]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'fixed z-[90] flex flex-col gap-2 pointer-events-none ' + POSITION_MAP[pos];
      el.setAttribute('data-toast-region', pos);
      document.body.appendChild(el);
    }
    regions[pos] = { el: el, items: [] };
    return regions[pos];
  }

  function getEffectiveDuration(variant, duration) {
    if (duration === 0) return null;
    if (duration === null) return null;
    if (typeof duration === 'number') return duration;
    return VARIANT_DURATION[variant];
  }

  function renderActions(actions) {
    if (!actions || !actions.length) return '';
    return '<div class="flex flex-wrap gap-x-3 gap-y-1 mt-2.5" data-toast-actions>'
      + actions.map(function (a, i) {
          var danger = a.variant === 'danger';
          var cls = 'text-xs font-semibold rounded transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus '
            + (danger ? 'text-error' : 'text-text-primary underline underline-offset-2');
          return '<button type="button" data-toast-action="' + i + '" class="' + cls + '">' + escapeHtml(a.label) + '</button>';
        }).join('')
      + '</div>';
  }

  function trimQueue(region) {
    while (region.items.length > MAX_QUEUE) {
      var oldest = region.items[0];
      if (oldest && typeof oldest.dismiss === 'function') oldest.dismiss();
      else region.items.shift();
    }
  }

  function showToast(opts) {
    opts = opts || {};
    var variant = VARIANTS[opts.variant] ? opts.variant : 'info';
    var vm      = VARIANTS[variant];
    var id      = 'toast-' + (nextId++);
    var pos     = POSITION_MAP[opts.position] ? opts.position : DEFAULT_POSITION;
    var duration = getEffectiveDuration(variant, opts.duration);
    var hasDuration = duration !== null;
    var showClose = opts.closeButton !== false;

    var region = getRegion(pos);

    var card = document.createElement('div');
    card.setAttribute('data-toast-id', id);
    card.setAttribute('role', vm.role);
    card.setAttribute('aria-live', vm.live);
    card.className = 'relative w-80 rounded-xl border shadow-lg overflow-hidden pointer-events-auto transition-all duration-250 ease-out opacity-0 translate-y-3 scale-95 ' + vm.container;

    var iconSpin = vm.spin ? ' animate-spin' : '';
    var titleHtml = opts.title ? '<p class="text-sm font-semibold text-text-primary leading-snug">' + escapeHtml(opts.title) + '</p>' : '';
    var msgClass  = 'text-sm text-text-secondary leading-snug' + (opts.title ? ' mt-0.5' : '');
    var closeHtml = showClose
      ? '<button type="button" aria-label="Dismiss" data-toast-close class="shrink-0 mt-0.5 rounded text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"><i class="fa-solid fa-xmark text-sm" aria-hidden="true"></i></button>'
      : '';
    var progressHtml = hasDuration
      ? '<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-black/5"><div class="h-full rounded-full ' + vm.progressColor + '" data-toast-progress style="width:100%;opacity:0.5"></div></div>'
      : '';

    card.innerHTML =
        '<div class="flex items-start gap-3 px-4 pt-4 pb-3">'
      +   '<span class="mt-0.5 ' + vm.iconColor + '" aria-hidden="true"><i class="fa-solid ' + vm.icon + iconSpin + ' shrink-0"></i></span>'
      +   '<div class="flex-1 min-w-0">'
      +     titleHtml
      +     '<p class="' + msgClass + '">' + escapeHtml(opts.message || '') + '</p>'
      +     renderActions(opts.actions)
      +   '</div>'
      +   closeHtml
      + '</div>'
      + progressHtml;

    region.el.appendChild(card);

    // ── enter animation ──
    requestAnimationFrame(function () {
      card.classList.remove('opacity-0', 'translate-y-3', 'scale-95');
      card.classList.add('opacity-100', 'translate-y-0', 'scale-100');
    });

    // ── countdown / progress ──
    var paused     = false;
    var exiting    = false;
    var remaining  = duration || 0;
    var lastTick   = 0;
    var tickTimer  = null;
    var progressEl = card.querySelector('[data-toast-progress]');
    var visHandler = null;

    function dismiss() {
      if (exiting) return;
      exiting = true;
      stopTicking();
      if (visHandler) document.removeEventListener('visibilitychange', visHandler);
      card.classList.remove('opacity-100', 'translate-y-0', 'scale-100');
      card.classList.add('opacity-0', 'translate-y-3', 'scale-95');
      // Drop from queue tracker immediately so trimQueue picks the next oldest.
      var idx = -1;
      for (var i = 0; i < region.items.length; i++) {
        if (region.items[i].id === id) { idx = i; break; }
      }
      if (idx >= 0) region.items.splice(idx, 1);
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        if (typeof opts.onDismiss === 'function') {
          try { opts.onDismiss(); } catch (e) {}
        }
      }, EXIT_MS);
    }

    function startTicking() {
      if (!hasDuration || tickTimer) return;
      lastTick = Date.now();
      tickTimer = setInterval(function () {
        if (paused || exiting) return;
        var now = Date.now();
        var elapsed = now - lastTick;
        lastTick = now;
        remaining = Math.max(0, remaining - elapsed);
        if (progressEl) progressEl.style.width = (remaining / duration * 100) + '%';
        if (remaining <= 0) { stopTicking(); dismiss(); }
      }, TICK_MS);
    }
    function stopTicking() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

    // ── pause on hover / tab hidden ──
    card.addEventListener('mouseenter', function () { if (hasDuration) { paused = true; } });
    card.addEventListener('mouseleave', function () { if (hasDuration) { paused = false; lastTick = Date.now(); } });
    if (hasDuration) {
      visHandler = function () { paused = document.hidden; if (!paused) lastTick = Date.now(); };
      document.addEventListener('visibilitychange', visHandler);
    }

    // ── actions ──
    var actionBtns = card.querySelectorAll('[data-toast-action]');
    actionBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-toast-action'), 10);
        var action = opts.actions && opts.actions[idx];
        if (action && typeof action.onClick === 'function') {
          try { action.onClick(dismiss); } catch (e) { dismiss(); }
        }
      });
    });

    // ── close ──
    var closeBtn = card.querySelector('[data-toast-close]');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    startTicking();

    var handle = {
      id: id,
      dismiss: dismiss,
      update: function (patch) {
        if (!patch) return;
        // Allow promise() to flip variant + message after resolve/reject.
        if (patch.variant && VARIANTS[patch.variant]) {
          // Swap variant container classes.
          card.className = 'relative w-80 rounded-xl border shadow-lg overflow-hidden pointer-events-auto transition-all duration-250 ease-out opacity-100 translate-y-0 scale-100 ' + VARIANTS[patch.variant].container;
          card.setAttribute('role', VARIANTS[patch.variant].role);
          card.setAttribute('aria-live', VARIANTS[patch.variant].live);
          // Swap the icon.
          var iconEl = card.querySelector('.fa-solid');
          if (iconEl) {
            iconEl.className = 'fa-solid ' + VARIANTS[patch.variant].icon + (VARIANTS[patch.variant].spin ? ' animate-spin' : '') + ' shrink-0';
          }
          var iconWrap = card.querySelector('[aria-hidden="true"]');
          if (iconWrap) iconWrap.className = 'mt-0.5 ' + VARIANTS[patch.variant].iconColor;
          variant = patch.variant;
          // Reset duration to variant default if not explicitly set.
          if (patch.duration === undefined) {
            duration = getEffectiveDuration(variant, undefined);
            hasDuration = duration !== null;
            remaining = duration || 0;
            if (hasDuration && !tickTimer && !exiting) startTicking();
          }
        }
        if (typeof patch.message === 'string') {
          var msgEl = card.querySelector('.flex-1 > p.text-text-secondary, .flex-1 > p:last-of-type');
          // Fall back to the message paragraph (last <p> inside the text column).
          var ps = card.querySelectorAll('.flex-1 > p');
          if (ps.length) ps[ps.length - 1].textContent = patch.message;
          else if (msgEl) msgEl.textContent = patch.message;
        }
      },
    };

    region.items.push(handle);
    trimQueue(region);

    return id;
  }

  // ── public API ────────────────────────────────────────────────────────────

  function normalize(arg, extra) {
    // Accept toast('message') or toast({ ... }).
    if (typeof arg === 'string') return Object.assign({ message: arg }, extra || {});
    return Object.assign({}, arg || {}, extra || {});
  }

  function findHandle(id) {
    for (var pos in regions) {
      var items = regions[pos].items;
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    }
    return null;
  }

  function toast(arg, extra) { return showToast(normalize(arg, extra)); }

  toast.success = function (arg, extra) { return showToast(normalize(arg, Object.assign({ variant: 'success' }, extra || {}))); };
  toast.error   = function (arg, extra) { return showToast(normalize(arg, Object.assign({ variant: 'error'   }, extra || {}))); };
  toast.warning = function (arg, extra) { return showToast(normalize(arg, Object.assign({ variant: 'warning' }, extra || {}))); };
  toast.info    = function (arg, extra) { return showToast(normalize(arg, Object.assign({ variant: 'info'    }, extra || {}))); };
  toast.loading = function (arg, extra) { return showToast(normalize(arg, Object.assign({ variant: 'loading' }, extra || {}))); };

  toast.update = function (id, patch) {
    var h = findHandle(id);
    if (h && h.update) h.update(patch);
  };

  toast.dismiss = function (id) {
    var h = findHandle(id);
    if (h) h.dismiss();
  };

  toast.clear = function () {
    for (var pos in regions) {
      var items = regions[pos].items.slice();
      for (var i = 0; i < items.length; i++) items[i].dismiss();
    }
  };

  toast.promise = function (promise, messages, opts) {
    messages = messages || {};
    opts = opts || {};
    var id = showToast(Object.assign({ variant: 'loading', message: messages.loading || '' }, opts));
    function resolveSuccess(data) {
      var msg = typeof messages.success === 'function' ? messages.success(data) : (messages.success || '');
      toast.update(id, { variant: 'success', message: msg });
    }
    function resolveError(err) {
      var msg = typeof messages.error === 'function' ? messages.error(err) : (messages.error || '');
      toast.update(id, { variant: 'error', message: msg });
    }
    if (promise && typeof promise.then === 'function') {
      promise.then(resolveSuccess, resolveError);
    }
    return id;
  };

  window.toast  = toast;
  window.notify = toast; // alias
})();
</script>
