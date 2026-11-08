/*
 * modules/ui/ConfirmDialog/scripts/confirm-dialog.js
 *
 * The one confirmation of the design system (kui-react modules/ui/ConfirmDialog.tsx). Every "are you sure?" goes
 * through it, never the browser's window.confirm / window.prompt. Inlined once per page by ConfirmDialog/_runtime.ejs
 * (ConfirmHost.ejs, ConfirmDialog.ejs and every partial that asks include it); a second copy on the page joins the
 * first one's queue.
 *
 * Imperative (kui-react confirmDialog / cancelAllConfirms):
 *   window.KuiConfirm.confirmDialog(options) -> Promise<{ value, choice } | null>
 *     options: title, message, tone ('default' | 'warning' | 'danger'), confirmLabel, cancelLabel, closeLabel,
 *              secondaryLabel, details, input { kind: 'text' | 'textarea' | 'date' | 'number', label, placeholder,
 *              defaultValue, required, minLength, maxLength, min, max, step, hint }, acknowledgement, phrase, phraseLabel,
 *              confirmDisabled (a gate of the caller's own: confirm and secondary stay locked, Cancel does not),
 *              size ('sm' | 'md' | 'lg'), portalTarget (Element or selector), className,
 *              action(result) (runs inside the dialog: a throw keeps it open with the error in the footer, the
 *              promise resolves after it succeeded), errorMessage(error) -> footer text.
 *     `message`, `details` and `acknowledgement` are text (or a DOM node), never HTML.
 *     Requests made while one is open wait their turn; resolves null on cancel.
 *   window.KuiConfirm.cancelAllConfirms()   answers every open and waiting request with null.
 *   window.KuiConfirm.confirmReady(gates, state)   the gate check (kui-react confirmReady).
 *   Also as window.confirmDialog / window.cancelAllConfirms.
 *
 * Server-rendered (modules/ui/ConfirmDialog.ejs, the controlled form):
 *   window.KuiConfirm.open(id, { action, errorMessage }?) -> Promise<{ value, choice } | null>
 *   window.KuiConfirm.close(id), setBusy(id, busy), setError(id, text), setConfirmDisabled(id, on)
 *   A [data-kui-confirm-open="<id>"] element opens it on click. The root dispatches 'confirm-dialog:confirm'
 *   ({ detail: { id, value, choice } }) and 'confirm-dialog:cancel' ({ detail: { id } }), both bubbling.
 *
 * Declarative: a <form data-kui-confirm="<options JSON>"> asks before it submits (data-kui-confirm-name="reason"
 * sends the input's value in a hidden field of that name); an <a data-kui-confirm> asks before it navigates.
 *
 * Data hooks for tests (kui-react): data-confirm-action (confirm), data-confirm-cancel, data-confirm-secondary,
 * data-confirm-message.
 *
 * The queue and the host list live on globalThis under Symbol.for('kui.confirmDialog') (as in kui-react): every
 * copy of this script on a page shares one queue, and only the first copy draws it.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var STORE_KEY = typeof Symbol === 'function' ? Symbol.for('kui.confirmDialog') : '__kuiConfirmDialog';
  var EXIT_MS = 250;

  // ── The gates ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** True when the gates of `gates` ({ input, acknowledgement, phrase }) are all met by what the user entered. */
  function confirmReady(gates, state) {
    var input = gates.input;
    if (input) {
      var v = String(state.value || '').trim();
      var min = input.minLength != null ? input.minLength : (input.required ? 1 : 0);
      if (v.length < min) return false;
      if (input.kind === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      if (input.kind === 'number' && v) {
        var n = Number(v);
        if (!isFinite(n)) return false;
        if (input.min != null && n < Number(input.min)) return false;
        if (input.max != null && n > Number(input.max)) return false;
      }
    }
    if (gates.acknowledgement && !state.acknowledged) return false;
    if (gates.phrase != null && String(state.typed || '').trim() !== gates.phrase) return false;
    return true;
  }

  // ── Markup (the same as ConfirmDialog.ejs renders; tests/confirm-dialog.test.ts compares the two) ─────────────────

  var TONE_ICON = { default: 'fa-circle-question', warning: 'fa-triangle-exclamation', danger: 'fa-triangle-exclamation' };
  var TONE_ICON_CLASS = { default: 'text-primary', warning: 'text-warning', danger: 'text-error' };
  var SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' };
  var FIELD = 'block w-full rounded-md border bg-surface-base px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled'
    + ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed';
  var BTN = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none'
    + ' focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed';
  var BTN_VARIANT = {
    primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
    ghost: 'bg-transparent text-text-primary hover:bg-surface-overlay',
    danger: 'bg-error text-text-inverse hover:opacity-90',
    outline: 'border border-border text-text-primary hover:bg-surface-overlay',
  };
  var SPINNER = 'inline-block rounded-full border-current border-t-transparent animate-spin shrink-0 h-4 w-4 border-2';
  var OVERLAY_OPEN = 'fixed inset-0 z-[100] flex p-4 transition-opacity duration-200 items-center justify-center opacity-100';
  var PANEL_BASE = 'relative z-[101] w-full border border-border bg-surface-raised shadow-xl flex flex-col transition-all duration-200 focus-visible:outline-none';

  function panelClass(state, size, className) {
    return PANEL_BASE + (state === 'open' ? ' scale-100 opacity-100' : ' scale-95 opacity-0') + ' rounded-xl ' + (SIZE[size] || SIZE.md)
      + (className ? ' ' + className : '');
  }
  function overlayClass(state) {
    return state === 'open' ? OVERLAY_OPEN : OVERLAY_OPEN.replace('opacity-100', 'opacity-0') + ' pointer-events-none';
  }
  function button(variant, label, attrs) {
    return h('button', Object.assign({ type: 'button', class: BTN + ' ' + BTN_VARIANT[variant] + ' px-3 py-1.5 text-sm' }, attrs), [label]);
  }

  /** An element; `attrs` values of null / undefined / false are left out, true writes an empty attribute. */
  function h(tag, attrs, children) {
    var el = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false || c === '') return;
      el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
    });
    return el;
  }
  /** A text or a DOM node the caller built. */
  function content(v) {
    return v && typeof v === 'object' && v.nodeType ? v : String(v);
  }

  /** The dialog for `o` (confirmDialog options), open. */
  function build(o, id) {
    var tone = TONE_ICON[o.tone] ? o.tone : 'default';
    var input = o.input;
    var hasPhrase = o.phrase != null;
    var ready = !o.confirmDisabled && confirmReady(o, { value: input ? input.defaultValue || '' : '', acknowledged: false, typed: '' });
    var body = [];
    if (o.message) {
      body.push(h('div', { class: 'flex gap-3' }, [
        // kui-react's svg carries h-4 w-4, but Font Awesome's own 1.25em x 1em wins; the bare <i> (h-4) measures the same.
        h('i', { class: 'fa-solid ' + TONE_ICON[tone] + ' mt-0.5 h-4 shrink-0 ' + TONE_ICON_CLASS[tone], 'aria-hidden': 'true' }),
        h('div', { class: 'min-w-0 flex-1 text-sm text-text-secondary whitespace-pre-line', 'data-confirm-message': true }, [content(o.message)]),
      ]));
    }
    if (o.details) body.push(h('div', { class: 'text-sm text-text-primary' }, [content(o.details)]));
    if (input) {
      var star = input.required || (input.minLength || 0) > 0;
      var common = {
        id: id + '-input', placeholder: input.placeholder, maxlength: input.maxLength,
        'aria-required': input.required ? 'true' : null, 'aria-describedby': input.hint ? id + '-hint' : null, 'data-kui-confirm-input': true,
      };
      var field = input.kind === 'textarea'
        ? h('textarea', Object.assign({}, common, { rows: '3', class: FIELD + ' border-border resize-y' }))
        : h('input', Object.assign({}, common, {
          type: input.kind === 'date' || input.kind === 'number' ? input.kind : 'text', inputmode: input.kind === 'number' ? 'decimal' : null,
          step: input.kind === 'number' ? input.step : null, min: input.min, max: input.max, autocomplete: 'off', class: FIELD + ' border-border',
        }));
      body.push(h('div', { class: 'space-y-1.5' }, [
        // The required star is CSS content, so the label's text (its accessible name) stays the label.
        h('label', { for: id + '-input', class: 'block text-sm font-medium text-text-primary' + (star ? " after:ml-0.5 after:text-error after:content-['*']" : '') }, [input.label]),
        field,
        input.hint ? h('p', { id: id + '-hint', class: 'text-xs text-text-secondary' }, [input.hint]) : null,
      ]));
    }
    if (o.acknowledgement) {
      body.push(h('label', { for: id + '-ack', class: 'flex cursor-pointer items-start gap-3 rounded-md border border-warning bg-warning-subtle px-3 py-2.5' }, [
        h('input', {
          id: id + '-ack', type: 'checkbox', 'data-kui-confirm-ack': true,
          class: 'mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        }),
        h('span', { class: 'text-sm text-text-primary' }, [content(o.acknowledgement)]),
      ]));
    }
    if (hasPhrase) {
      body.push(h('div', { class: 'space-y-1.5' }, [
        h('label', { for: id + '-phrase', class: 'block text-sm font-medium text-text-primary' }, [
          o.phraseLabel != null ? o.phraseLabel : 'Type "' + o.phrase + '" to confirm',
        ]),
        h('input', {
          id: id + '-phrase', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': 'false', 'data-kui-confirm-phrase': true,
          class: FIELD + ' font-mono border-border',
        }),
      ]));
    }
    var cfg = {
      input: input ? stripInput(input) : undefined, acknowledgement: !!o.acknowledgement, phrase: hasPhrase ? String(o.phrase) : undefined,
      confirmDisabled: o.confirmDisabled ? true : undefined,
    };
    var root = h('div', {
      id: id, class: OVERLAY_OPEN, 'aria-modal': 'true', role: 'dialog', 'aria-labelledby': id + '-title', 'data-state': 'open',
      'data-kui-confirm-dialog': true, 'data-kui-confirm-config': JSON.stringify(cfg),
    }, [
      h('div', { class: 'absolute inset-0 bg-black/50', 'aria-hidden': 'true', 'data-kui-confirm-backdrop': true }),
      h('div', { tabindex: '-1', 'data-state': 'open', class: panelClass('open', o.size, o.className), 'data-kui-confirm-panel': true }, [
        h('div', { class: 'flex items-start justify-between gap-3 px-6 py-4 border-b border-border shrink-0' }, [
          h('div', null, [h('h2', { id: id + '-title', class: 'text-base font-semibold text-text-primary' }, [o.title || ''])]),
          h('button', {
            type: 'button', 'aria-label': o.closeLabel || 'Close dialog', 'data-kui-confirm-close': true,
            class: 'shrink-0 text-text-disabled hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded',
          }, [
            h('i', { class: 'fa-solid fa-xmark', 'aria-hidden': 'true' }),
          ]),
        ]),
        h('div', { class: 'px-6 py-4 flex-1 min-h-0' }, [h('form', { class: 'space-y-4', 'data-kui-confirm-form': true }, body)]),
        h('div', { class: 'px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0' }, [
          h('div', { class: 'flex w-full flex-wrap items-center justify-end gap-2', 'data-kui-confirm-footer': true }, [
            button('ghost', o.cancelLabel || 'Cancel', { 'data-confirm-cancel': true }),
            o.secondaryLabel ? button('outline', o.secondaryLabel, { disabled: !ready, 'data-confirm-secondary': true }) : null,
            button(o.tone === 'danger' ? 'danger' : 'primary', o.confirmLabel || 'Confirm', { disabled: !ready, 'data-confirm-action': true }),
          ]),
        ]),
      ]),
    ]);
    return root;
  }
  function stripInput(input) {
    return { kind: input.kind, required: !!input.required, minLength: input.minLength, min: input.min, max: input.max, defaultValue: input.defaultValue || '' };
  }

  // ── One dialog's behaviour (built here or rendered by ConfirmDialog.ejs) ──────────────────────────────────────────

  function readConfig(root) {
    try { return JSON.parse(root.getAttribute('data-kui-confirm-config') || '{}') || {}; } catch (e) { return {}; }
  }
  function q(root, attr) { return root.querySelector('[' + attr + ']'); }
  function each(list, fn) { for (var i = 0; i < list.length; i++) if (list[i]) fn(list[i]); }

  /**
   * Wires `root` (a [data-kui-confirm-dialog]) once and returns its controller:
   *   show(), hide(remove), setBusy(b), setError(text), handlers { confirm(result), cancel() } set by the caller.
   */
  function controller(root) {
    if (root.__kuiConfirm) return root.__kuiConfirm;
    var cfg = readConfig(root);
    var id = root.getAttribute('id');
    var panel = q(root, 'data-kui-confirm-panel');
    var input = q(root, 'data-kui-confirm-input');
    var ack = q(root, 'data-kui-confirm-ack');
    var phrase = q(root, 'data-kui-confirm-phrase');
    var footer = q(root, 'data-kui-confirm-footer');
    var cancelBtn = q(root, 'data-confirm-cancel');
    var secondary = q(root, 'data-confirm-secondary');
    var go = q(root, 'data-confirm-action');
    var busy = go ? go.getAttribute('aria-busy') === 'true' : false;
    var timer = null;
    var onKey = null;
    var ctl = { root: root, handlers: {} };

    function state() {
      return { value: input ? input.value : '', acknowledged: ack ? !!ack.checked : false, typed: phrase ? phrase.value : '' };
    }
    function sync() {
      var s = state();
      // confirmDisabled: a gate of the caller's own (a preview still loading); Cancel stays enabled.
      var ready = !cfg.confirmDisabled && confirmReady(cfg, s);
      if (go) go.disabled = !ready || busy;
      if (secondary) secondary.disabled = !ready || busy;
      if (cancelBtn) cancelBtn.disabled = busy;
      each([input, ack, phrase], function (f) { f.disabled = busy; });
      if (phrase) {
        var wrong = s.typed !== '' && s.typed.trim() !== cfg.phrase;
        phrase.setAttribute('aria-invalid', wrong ? 'true' : 'false');
        phrase.setAttribute('class', phrase.getAttribute('class').replace(/ (border-error|border-border)$/, wrong ? ' border-error' : ' border-border'));
      }
      return ready;
    }
    function submit(choice) {
      if (busy || !sync()) return;
      var result = { value: state().value.trim(), choice: choice };
      if (ctl.handlers.confirm) ctl.handlers.confirm(result);
    }
    function cancel() {
      if (busy) return;
      if (ctl.handlers.cancel) ctl.handlers.cancel();
    }
    function enterSubmits(e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit('confirm'); }
    }

    ctl.setBusy = function (on) {
      busy = !!on;
      if (go) {
        var spin = q(go, 'data-kui-confirm-spinner');
        if (busy && !spin) {
          spin = h('span', { 'aria-hidden': 'true', class: SPINNER, 'data-kui-confirm-spinner': true });
          go.insertBefore(spin, go.firstChild);
        } else if (!busy && spin) {
          go.removeChild(spin);
        }
        if (busy) go.setAttribute('aria-busy', 'true'); else go.removeAttribute('aria-busy');
      }
      sync();
    };
    ctl.setError = function (text) {
      var p = q(root, 'data-kui-confirm-error');
      if (!text) { if (p) p.parentNode.removeChild(p); return; }
      if (!p) {
        p = h('p', { role: 'alert', class: 'mr-auto min-w-0 text-sm text-error', 'data-kui-confirm-error': true });
        footer.insertBefore(p, footer.firstChild);
      }
      p.textContent = String(text);
    };
    ctl.setConfirmDisabled = function (on) {
      cfg.confirmDisabled = on ? true : undefined;
      sync();
    };
    ctl.isOpen = function () { return root.getAttribute('data-state') === 'open'; };
    ctl.show = function (target) {
      if (timer) { global.clearTimeout(timer); timer = null; }
      var host = target || doc.fullscreenElement || doc.body;
      if (host && root.parentNode !== host) host.appendChild(root);
      var wasOpen = ctl.isOpen() && !root.hidden && ctl.shown;
      // Reopening clears what was entered last time.
      if (input) input.value = cfg.input && cfg.input.defaultValue ? cfg.input.defaultValue : '';
      if (ack) ack.checked = false;
      if (phrase) phrase.value = '';
      ctl.setError(null);
      root.hidden = false;
      root.removeAttribute('aria-hidden');
      root.setAttribute('data-state', 'open');
      root.setAttribute('class', overlayClass('open'));
      if (panel) {
        panel.setAttribute('data-state', 'open');
        panel.setAttribute('class', panel.getAttribute('class').replace('scale-95 opacity-0', 'scale-100 opacity-100'));
      }
      sync();
      if (wasOpen) return;
      ctl.shown = true;
      if (global.__overlayScrollLock) global.__overlayScrollLock.lock();
      if (global.__overlayFocusTrap) global.__overlayFocusTrap.activate(id, panel);
      onKey = function (e) {
        var ft = global.__overlayFocusTrap;
        if (ft && !ft.isTop(id)) return;
        // An Escape an inner control already handled closes that control, not the dialog.
        if (e.key === 'Escape') { if (!e.defaultPrevented) cancel(); return; }
        if (ft) ft.handleKey(id, panel, e);
      };
      doc.addEventListener('keydown', onKey);
    };
    /** Fades the dialog out (a closing dialog takes no clicks and leaves the accessibility tree); `remove` drops it after. */
    ctl.hide = function (remove, now) {
      if (onKey) { doc.removeEventListener('keydown', onKey); onKey = null; }
      if (ctl.shown) {
        ctl.shown = false;
        if (global.__overlayFocusTrap) global.__overlayFocusTrap.deactivate(id);
        if (global.__overlayScrollLock) global.__overlayScrollLock.unlock();
      }
      function done() {
        timer = null;
        if (remove) { if (root.parentNode) root.parentNode.removeChild(root); return; }
        root.hidden = true;
        root.setAttribute('data-state', 'closed');
      }
      if (now) { done(); return; }
      root.setAttribute('data-state', 'closing');
      root.setAttribute('aria-hidden', 'true');
      root.setAttribute('class', overlayClass('closing'));
      if (panel) {
        panel.setAttribute('data-state', 'closing');
        panel.setAttribute('class', panel.getAttribute('class').replace('scale-100 opacity-100', 'scale-95 opacity-0'));
      }
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(done, EXIT_MS);
    };

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-kui-confirm-backdrop]')) { if (!busy) cancel(); return; }
      if (t.closest('[data-kui-confirm-close]') || t.closest('[data-confirm-cancel]')) { cancel(); return; }
      if (t.closest('[data-confirm-secondary]')) { submit('secondary'); return; }
      if (t.closest('[data-confirm-action]')) submit('confirm');
    });
    var form = q(root, 'data-kui-confirm-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submit('confirm'); });
    each([input, ack, phrase], function (f) {
      f.addEventListener('input', sync);
      f.addEventListener('change', sync);
    });
    // Enter in a single-line field confirms (a form with two fields has no implicit submission without a submit button).
    if (input && input.tagName !== 'TEXTAREA') input.addEventListener('keydown', enterSubmits);
    if (phrase) phrase.addEventListener('keydown', enterSubmits);

    root.__kuiConfirm = ctl;
    return ctl;
  }

  // ── The shared store (one per page) and this copy's host ──────────────────────────────────────────────────────────

  var store = global[STORE_KEY];
  if (!store) {
    store = { state: { queue: [], hosts: [] }, nextKey: 1, nextHost: 1, listeners: [] };
    global[STORE_KEY] = store;
  }
  function update(next) {
    store.state = Object.assign({}, store.state, next);
    store.listeners.slice().forEach(function (l) { l(); });
  }
  function settle(key, result) {
    var item = null;
    store.state.queue.forEach(function (p) { if (p.key === key) item = p; });
    if (!item) return;
    update({ queue: store.state.queue.filter(function (p) { return p.key !== key; }) });
    item.resolve(result);
  }

  function confirmDialog(options) {
    if (!doc) return Promise.resolve(null);
    var s = store;
    return new Promise(function (resolve) {
      update({ queue: s.state.queue.concat([{ key: s.nextKey++, options: options || {}, resolve: resolve }]) });
    });
  }
  function cancelAllConfirms() {
    var all = store.state.queue;
    update({ queue: [] });
    all.forEach(function (p) { p.resolve(null); });
  }
  function defaultErrorMessage(e) { return (e && e.message) || String(e); }
  function portal(target) {
    if (typeof target === 'string') return doc.querySelector(target);
    return target || null;
  }

  var me = store.nextHost++;
  update({ hosts: store.state.hosts.concat([me]) });
  var shown = null;

  /** Draws the head of the queue; only the first host on the page does. */
  function render() {
    if (store.state.hosts[0] !== me) return;
    var head = store.state.queue[0];
    if (shown && (!head || head.key !== shown.key)) {
      var old = shown;
      shown = null;
      if (head) {
        old.ctl.hide(true, true);
      } else {
        // The last request fades out with its text; nothing spins on the way out.
        old.ctl.setBusy(false);
        old.ctl.setError(null);
        old.ctl.hide(true);
      }
    }
    if (!head || shown) return;
    var o = head.options;
    var root = build(o, 'kui-confirm-' + head.key);
    var ctl = controller(root);
    var key = head.key;
    shown = { key: key, ctl: ctl };
    ctl.handlers.cancel = function () { settle(key, null); };
    ctl.handlers.confirm = function (result) {
      if (!o.action) { settle(key, result); return; }
      ctl.setBusy(true);
      ctl.setError(null);
      Promise.resolve().then(function () { return o.action(result); }).then(function () {
        settle(key, result);
      }, function (e) {
        if (!shown || shown.key !== key) return;
        ctl.setBusy(false);
        ctl.setError((o.errorMessage || defaultErrorMessage)(e));
      });
    };
    ctl.show(portal(o.portalTarget));
  }
  store.listeners.push(render);

  // ── Server-rendered dialogs (ConfirmDialog.ejs) ───────────────────────────────────────────────────────────────────

  function rootOf(id) {
    var el = typeof id === 'string' ? doc.getElementById(id) : id;
    return el && el.hasAttribute && el.hasAttribute('data-kui-confirm-dialog') ? el : null;
  }
  function emit(root, name, detail) {
    root.dispatchEvent(new global.CustomEvent(name, { bubbles: true, detail: detail }));
  }
  /** Opens a ConfirmDialog.ejs dialog; resolves { value, choice } on confirm and null on cancel. */
  function open(id, opts) {
    var root = rootOf(id);
    if (!root) return Promise.resolve(null);
    var o = opts || {};
    var ctl = controller(root);
    var rid = root.getAttribute('id');
    if (ctl.pending) ctl.pending(null);
    return new Promise(function (resolve) {
      function finish(result) {
        ctl.pending = null;
        ctl.setBusy(false);
        ctl.hide(false);
        resolve(result);
        if (result) emit(root, 'confirm-dialog:confirm', { id: rid, value: result.value, choice: result.choice });
        else emit(root, 'confirm-dialog:cancel', { id: rid });
      }
      ctl.pending = finish;
      ctl.handlers.cancel = function () { finish(null); };
      ctl.handlers.confirm = function (result) {
        if (!o.action) { finish(result); return; }
        ctl.setBusy(true);
        ctl.setError(null);
        Promise.resolve().then(function () { return o.action(result); }).then(function () {
          if (ctl.pending === finish) finish(result);
        }, function (e) {
          if (ctl.pending !== finish) return;
          ctl.setBusy(false);
          ctl.setError((o.errorMessage || defaultErrorMessage)(e));
        });
      };
      ctl.show(portal(o.portalTarget));
    });
  }
  function close(id) {
    var root = rootOf(id);
    if (!root) return;
    var ctl = controller(root);
    if (ctl.pending) ctl.pending(null); else ctl.hide(false);
  }
  function setBusy(id, on) { var r = rootOf(id); if (r) controller(r).setBusy(on); }
  function setError(id, text) { var r = rootOf(id); if (r) controller(r).setError(text); }
  function setConfirmDisabled(id, on) { var r = rootOf(id); if (r) controller(r).setConfirmDisabled(on); }

  /** Binds every server-rendered dialog not bound yet; one rendered open (`open: true`) is shown now. */
  function autoInit() {
    var list = doc.querySelectorAll('[data-kui-confirm-dialog]');
    each(list, function (root) {
      if (root.__kuiConfirm) return;
      var ctl = controller(root);
      if (root.getAttribute('data-state') === 'open' && !root.hidden) open(root);
      else if (!ctl.handlers.cancel) ctl.handlers.cancel = function () { ctl.hide(false); };
    });
  }

  // ── Declarative: [data-kui-confirm-open], <form data-kui-confirm>, <a data-kui-confirm> ───────────────────────────

  function readOptions(el) {
    try { return JSON.parse(el.getAttribute('data-kui-confirm') || '{}') || {}; } catch (e) { return {}; }
  }
  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.hasAttribute || !form.hasAttribute('data-kui-confirm')) return;
    if (form.__kuiConfirmPass) { form.__kuiConfirmPass = false; return; }
    e.preventDefault();
    var submitter = e.submitter || null;
    confirmDialog(readOptions(form)).then(function (r) {
      if (!r) return;
      var name = form.getAttribute('data-kui-confirm-name');
      if (name) {
        var field = form.querySelector('input[type="hidden"][data-kui-confirm-value]');
        if (!field) {
          field = h('input', { type: 'hidden', 'data-kui-confirm-value': true });
          form.appendChild(field);
        }
        field.setAttribute('name', name);
        field.value = r.value;
      }
      form.__kuiConfirmPass = true;
      if (form.requestSubmit) form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined);
      else { form.__kuiConfirmPass = false; form.submit(); }
    });
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var opener = t.closest('[data-kui-confirm-open]');
    if (opener) { e.preventDefault(); open(opener.getAttribute('data-kui-confirm-open')); return; }
    var link = t.closest('a[data-kui-confirm]');
    if (!link || e.defaultPrevented) return;
    e.preventDefault();
    var href = link.getAttribute('href');
    confirmDialog(readOptions(link)).then(function (r) { if (r && href) global.location.assign(href); });
  }

  var api = {
    confirmDialog: confirmDialog,
    cancelAllConfirms: cancelAllConfirms,
    confirmReady: confirmReady,
    open: open,
    close: close,
    setBusy: setBusy,
    setError: setError,
    setConfirmDisabled: setConfirmDisabled,
    autoInit: autoInit,
    build: build,
  };
  // The first copy's API stays; a later copy shares its queue anyway.
  if (!global.KuiConfirm) {
    global.KuiConfirm = api;
    global.confirmDialog = global.confirmDialog || confirmDialog;
    global.cancelAllConfirms = global.cancelAllConfirms || cancelAllConfirms;
  }
  if (doc && !store.wired) {
    store.wired = true;
    doc.addEventListener('submit', onSubmit, true);
    doc.addEventListener('click', onClick);
  }
  if (doc) {
    autoInit();
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', autoInit);
  }
  // A request made before this copy loaded is drawn now.
  render();
})(typeof window !== 'undefined' ? window : this);
