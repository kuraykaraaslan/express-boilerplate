/*
 * modules/ui/ControlTile/scripts/control-bind.js
 *
 * DOM binding for the async controls (ControlSwitch / ControlSlider /
 * ControlSetpoint / ControlButton). Mirrors the kui-react components in
 * modules/ui/ControlTile/. Requires control-logic.js + async-control.js.
 *
 * Mounted by KuiControl.autoInit() from `[data-kui-control="<kind>"]` +
 * `data-kui-control-config` (JSON) + `data-kui-messages` (JSON).
 *
 * The write (kui-react `onCommit: (value, confirmation?) => Promise<void>`) is resolved in this order:
 *   1. root.__kuiControl.onCommit = function (value, confirmation) { return promise }
 *   2. the global function named by the `onCommit` local / data-on-commit
 *   3. the DOM event 'kui:control-commit' on the root (bubbles):
 *        detail: { value, confirmation, kind, id, respond(promise) }
 *      call respond() with the promise of your write; reject it to fail.
 *   With none of these the commit resolves at once. `confirmation` is
 *   { confirmed: true, typed? } when the control asked first (`confirm` local), else undefined.
 *   ControlButton has no value: its first argument is the confirmation.
 *
 * Runtime API on the root element: root.__kuiControl = {
 *   setValue(v)        the bound value changed
 *   setReported(v)     the value the other side reports (undefined = no report)
 *   onCommit           assign the write handler (see above)
 *   state()            'idle' | 'pending' | 'confirmed' | 'mismatch' | 'failed'
 *   destroy()
 * }
 */
(function (global) {
  'use strict';
  var KC = global.KuiControl;
  var L = global.KuiControlLogic;
  if (!KC || !L || KC.autoInit) return;

  var RETRY_CLASS = 'rounded-sm text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var SPINNER_CLASS = 'inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none';
  // kui-react Button's loading spinner.
  var BTN_SPINNER_CLASS = 'animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full shrink-0';
  var THUMB_SPINNER_CLASS = 'absolute inset-0 m-auto h-[70%] w-[70%] animate-spin rounded-full border border-primary border-t-transparent motion-reduce:animate-none';
  var MISMATCH_RING = ['ring-2', 'ring-warning', 'ring-offset-1', 'ring-offset-surface-base'];
  var SWITCH_ON = { sm: 'translate-x-3', md: 'translate-x-4', lg: 'translate-x-5' };
  var COMMIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  var KEY_IDLE_MS = 400;
  // How long a stepper waits after the last press before it writes the value (ms).
  var STEP_SETTLE_MS = 700;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function readJson(root, attr) {
    try { return JSON.parse(root.getAttribute(attr) || '{}'); } catch (e) { return {}; }
  }

  function toggle(node, classes, on) {
    if (!node) return;
    for (var i = 0; i < classes.length; i++) node.classList.toggle(classes[i], !!on);
  }

  function attr(node, name, value) {
    if (!node) return;
    if (value === null || value === undefined || value === false) node.removeAttribute(name);
    else node.setAttribute(name, value === true ? 'true' : String(value));
  }

  /** The number text: the `format` global function when named, else the `formatSpec` (see L.formatBySpec), else fixed decimals + unit. */
  function formatter(cfg) {
    var fn = cfg.format && typeof global[cfg.format] === 'function' ? global[cfg.format] : null;
    if (!fn && cfg.formatSpec) fn = L.formatBySpec(cfg.formatSpec);
    var decimals = cfg.decimals || 0;
    var suffix = cfg.unit ? ' ' + cfg.unit : '';
    return function (n) { return fn ? String(fn(n)) : L.formatValue(n, decimals) + suffix; };
  }

  /**
   * The status line's look while it has a status (ControlTile.ejs). Without one it keeps that look (its room), unless it
   * carries data-kui-control-status-collapse (a button): then it is `sr-only` and takes no room.
   */
  var STATUS_CLASS = {
    framed: 'flex min-h-5 items-center gap-2 text-xs',
    unframed: 'flex min-h-4 items-center gap-2 text-[11px] leading-4',
  };

  /** The one live status line every control shares. */
  function renderStatus(root, msgs, state, error, readOnly) {
    var box = root.querySelector('[data-kui-control-status]');
    if (!box) return;
    box.textContent = '';
    var shown = !box.hasAttribute('data-kui-control-status-collapse') || state !== 'idle' || !!readOnly;
    box.className = shown ? STATUS_CLASS[box.getAttribute('data-kui-control-status') === 'unframed' ? 'unframed' : 'framed'] : 'sr-only';
    if (state === 'pending') {
      var sp = el('span', SPINNER_CLASS);
      sp.setAttribute('aria-hidden', 'true');
      box.appendChild(sp);
      box.appendChild(el('span', 'text-text-secondary', msgs.pending));
    }
    if (state === 'confirmed') box.appendChild(el('span', 'text-success', msgs.confirmed));
    if (state === 'mismatch') box.appendChild(el('span', 'text-warning', msgs.mismatch));
    if (state === 'failed') {
      // A host-written failure text leads; the reason the write failed follows it.
      var text = msgs.failedByHost ? (error ? msgs.failed + ' (' + error + ')' : msgs.failed) : (error || msgs.failed);
      var f = el('span', 'text-error', text);
      f.setAttribute('role', 'alert');
      box.appendChild(f);
    }
    if (state === 'failed' || state === 'mismatch') {
      var retry = el('button', RETRY_CLASS, msgs.retry);
      retry.type = 'button';
      retry.setAttribute('data-kui-control-retry', '');
      box.appendChild(retry);
    }
    if (readOnly && state === 'idle') box.appendChild(el('span', 'text-text-secondary', msgs.readOnly));
  }

  /** kui-react Button's loading state, for a button that already exists. */
  function setButtonLoading(btn, on, disabled, showSpinner) {
    if (!btn) return;
    var spin = btn.querySelector('[data-kui-btn-spinner]');
    var spinning = on && showSpinner !== false;
    if (spinning && !spin) {
      spin = el('span', BTN_SPINNER_CLASS);
      spin.setAttribute('aria-hidden', 'true');
      spin.setAttribute('data-kui-btn-spinner', '');
      btn.insertBefore(spin, btn.firstChild);
    } else if (!spinning && spin) {
      btn.removeChild(spin);
    }
    var icons = btn.querySelectorAll('[data-kui-btn-icon]');
    for (var i = 0; i < icons.length; i++) icons[i].hidden = spinning;
    attr(btn, 'aria-busy', on || null);
    btn.disabled = !!disabled;
  }

  /**
   * The "Are you sure?" step (kui-react useControlConfirm + ControlConfirmPrompt, which renders the kit's ConfirmDialog).
   * `request(value)` returns true when the value may be written now (mode none) or parks it and asks through
   * KuiConfirm.confirmDialog with the options of the [data-kui-control-ask] carrier (ControlTile/_parts.ejs).
   */
  function confirmStep(root, cfg, onAccept, onCancel, onToggle) {
    var mode = cfg.confirm || 'none';
    var ask = root.querySelector('[data-kui-control-ask]');
    var parked = null;
    var step = { confirmation: undefined, asking: function () { return !!parked; } };
    function options() {
      try { return JSON.parse(ask.getAttribute('data-kui-confirm-options') || '{}') || {}; } catch (e) { return {}; }
    }
    step.request = function (value) {
      if (mode === 'none' || !ask) { step.confirmation = undefined; return true; }
      var p = { value: value };
      parked = p;
      if (onToggle) onToggle(true);
      var api = global.KuiConfirm;
      var answer = api && api.confirmDialog ? api.confirmDialog(options()) : null;
      if (!answer) {
        // Never the browser's confirm(): without the ConfirmDialog runtime the write is not made.
        if (global.console) global.console.error('ControlTile: the ConfirmDialog runtime (ConfirmDialog/_runtime) is not on the page.');
        answer = Promise.resolve(null);
      }
      answer.then(function (r) {
        if (parked !== p) return;
        parked = null;
        if (onToggle) onToggle(false);
        if (!r) { if (onCancel) onCancel(); return; }
        step.confirmation = { confirmed: true };
        var opts = options();
        if (mode === 'typed') step.confirmation.typed = opts.phrase != null ? String(opts.phrase) : '';
        onAccept(p.value);
      });
      return false;
    };
    return step;
  }

  // The binders by control kind. A host adds its own through `KuiControl.binders` before `autoInit` runs (the WidgetKit's
  // control.form does), with the same signature: (root, cfg, msgs, commitFn) -> { ctl, setValue, setReported, destroy? }.
  var BINDERS = { switch: bindSwitch, slider: bindSlider, setpoint: bindSetpoint, button: bindButton };
  KC.binders = BINDERS;
  KC.confirmStep = confirmStep;
  KC.setButtonLoading = setButtonLoading;
  KC.STEP_SETTLE_MS = STEP_SETTLE_MS;

  function mount(root) {
    var cfg = readJson(root, 'data-kui-control-config');
    var msgs = readJson(root, 'data-kui-messages');
    var kind = root.getAttribute('data-kui-control');
    var id = root.id || '';
    var handlers = { onCommit: null };

    function commitFn(value, confirmation) {
      var args = kind === 'button' ? [confirmation] : (confirmation ? [value, confirmation] : [value]);
      if (typeof handlers.onCommit === 'function') return Promise.resolve(handlers.onCommit.apply(null, args));
      var name = cfg.onCommit;
      if (name && typeof global[name] === 'function') return Promise.resolve(global[name].apply(null, args));
      var promises = [];
      root.dispatchEvent(new CustomEvent('kui:control-commit', {
        bubbles: true,
        detail: {
          value: kind === 'button' ? confirmation : value, confirmation: confirmation, kind: kind, id: id,
          respond: function (p) { promises.push(Promise.resolve(p)); },
        },
      }));
      return promises.length ? Promise.all(promises).then(function () {}) : Promise.resolve();
    }

    var binder = BINDERS[kind];
    if (!binder) return;
    var api = binder(root, cfg, msgs, commitFn);
    if (!api) return;

    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-kui-control-retry]') : null;
      if (t && root.contains(t)) api.ctl.retry();
    });

    root.__kuiControl = {
      setValue: api.setValue,
      setReported: api.setReported,
      state: function () { return api.ctl.snapshot().state; },
      get onCommit() { return handlers.onCommit; },
      set onCommit(fn) { handlers.onCommit = fn; },
      destroy: function () { api.ctl.destroy(); if (api.destroy) api.destroy(); },
    };
  }

  // ── ControlSwitch ─────────────────────────────────────────────────────────
  function bindSwitch(root, cfg, msgs, commitFn) {
    var input = root.querySelector('[data-kui-control-switch]');
    var track = root.querySelector('[data-kui-control-track]');
    var thumb = root.querySelector('[data-kui-control-thumb]');
    var labels = root.querySelectorAll('[data-kui-control-label]');
    var stateEl = root.querySelector('[id="' + root.id + '-hint"]');
    if (!input) return null;
    var colors = cfg.colors || {};
    var stateStyles = cfg.stateStyles || {};
    var locked = !!cfg.disabled || !!cfg.readOnly;
    var onCls = SWITCH_ON[cfg.size] || SWITCH_ON.md;
    var ask = confirmStep(root, cfg, function (v) { ctl.set(v); }, function () { apply(ctl.snapshot()); }, function () { apply(ctl.snapshot()); });
    var ctl = KC.createAsyncControl({
      value: L.asBoolean(cfg.value),
      reported: cfg.reported === undefined ? undefined : L.asBoolean(cfg.reported),
      commit: function (v) { return commitFn(v, ask.confirmation); },
      timeoutMs: cfg.timeoutMs,
      onChange: function (snap) { apply(snap); },
    });
    function apply(snap) {
      var known = snap.displayValue !== null && snap.displayValue !== undefined;
      var shown = known ? snap.displayValue : false;
      var pending = snap.state === 'pending';
      var mismatch = snap.state === 'mismatch';
      input.checked = shown;
      input.setAttribute('aria-checked', String(shown));
      input.disabled = locked || pending || ask.asking();
      attr(input, 'aria-busy', pending || null);
      attr(input, 'aria-invalid', mismatch || null);

      var trackColor = locked ? colors.disabled : shown ? colors.on : colors.off;
      if (track) {
        track.style.background = trackColor || '';
        toggle(track, ['bg-primary'], !trackColor && shown);
        toggle(track, ['border', 'border-border', 'bg-surface-sunken'], !trackColor && !shown);
        toggle(track, MISMATCH_RING, mismatch);
      }
      var thumbColor = (locked ? colors.thumbDisabled : shown ? colors.thumbOn : colors.thumbOff) || colors.thumb;
      if (thumb) {
        thumb.style.background = thumbColor || '';
        toggle(thumb, ['bg-primary-fg'], !thumbColor);
        toggle(thumb, [onCls], shown);
        var spin = thumb.querySelector('[data-kui-control-spinner]');
        if (pending && !spin) {
          spin = el('span', THUMB_SPINNER_CLASS);
          spin.setAttribute('aria-hidden', 'true');
          spin.setAttribute('data-kui-control-spinner', '');
          thumb.appendChild(spin);
        } else if (!pending && spin) {
          thumb.removeChild(spin);
        }
      }
      var showState = cfg.showStateText !== false || !known || !!cfg.custom;
      if (cfg.stateViews) {
        // The layout drew a view per state: show the one the switch is in (the texts, colours and icons are the layout's).
        var key = !known ? 'unknown' : shown ? 'on' : 'off';
        var views = root.querySelectorAll('[data-kui-state]');
        for (var v = 0; v < views.length; v++) views[v].hidden = views[v].getAttribute('data-kui-state') !== key;
      }
      if (stateEl) {
        if (!cfg.stateViews) stateEl.textContent = !known ? cfg.unknownLabel : shown ? cfg.onLabel : cfg.offLabel;
        if (!cfg.custom) {
          stateEl.className = (cfg.labelled && !cfg.centered ? 'text-xs' : 'text-sm font-medium')
            + ' ' + (!known || cfg.labelled ? 'text-text-secondary' : 'text-text-primary');
          stateEl.setAttribute('style', stateStyles[!known ? 'unknown' : shown ? 'on' : 'off'] || '');
          if (!stateEl.getAttribute('style')) stateEl.removeAttribute('style');
          stateEl.hidden = !showState;
        }
      }
      attr(input, 'aria-describedby', showState && stateEl ? stateEl.id : null);
      for (var i = 0; i < labels.length; i++) {
        toggle(labels[i], ['cursor-not-allowed'], locked);
        toggle(labels[i], ['cursor-progress'], !locked && pending);
        toggle(labels[i], ['cursor-pointer'], !locked && !pending);
      }
      renderStatus(root, msgs, snap.state, snap.error, cfg.readOnly);
    }
    input.addEventListener('change', function () {
      var next = input.checked;
      var snap = ctl.snapshot();
      // Controlled, as in kui-react: the switch shows the control's value, not the click.
      input.checked = snap.displayValue === null || snap.displayValue === undefined ? false : snap.displayValue;
      if (ask.request(next)) ctl.set(next);
    });
    return {
      ctl: ctl,
      setValue: function (v) { ctl.setValue(L.asBoolean(v)); },
      setReported: function (v) { ctl.setReported(v === undefined ? undefined : (v === null ? null : L.asBoolean(v))); },
    };
  }

  // ── ControlSlider ─────────────────────────────────────────────────────────
  function bindSlider(root, cfg, msgs, commitFn) {
    var input = root.querySelector('[data-kui-control-range]');
    var textEls = root.querySelectorAll('[data-kui-control-value]');
    var reportedEl = root.querySelector('[data-kui-control-reported]');
    if (!input) return null;
    var range = L.toRange(cfg);
    var fmt = formatter(cfg);
    var colors = cfg.colors || {};
    var locked = !!cfg.disabled || !!cfg.readOnly;
    var main = (locked ? colors.disabledMain : undefined) || colors.main || 'var(--primary)';
    var trackColor = (locked ? colors.disabledTrack : undefined) || colors.track || 'var(--surface-sunken)';
    var debounced = cfg.commitMode === 'debounced';
    var debounceMs = Math.max(100, typeof cfg.debounceMs === 'number' ? cfg.debounceMs : 500);
    var bound = L.asNumber(cfg.value);
    var dragged = null; // { v, base }
    var lastSnap = null;
    var latest = null;
    var timer = null;

    // A format function: redraw the numbers the server wrote with unit / decimals.
    if (cfg.format) {
      var nums = root.querySelectorAll('[data-kui-control-num]');
      for (var n = 0; n < nums.length; n++) nums[n].textContent = fmt(Number(nums[n].getAttribute('data-kui-control-num')));
    }

    function write(v) { dragged = null; ctl.set(v); }
    var ask = confirmStep(root, cfg, write, function () { dragged = null; apply(); }, function () { apply(); });
    var ctl = KC.createAsyncControl({
      value: bound,
      reported: cfg.reported === undefined ? undefined : L.asNumber(cfg.reported),
      commit: function (v) { return commitFn(v, ask.confirmation); },
      timeoutMs: cfg.timeoutMs,
      onChange: function (snap) { lastSnap = snap; apply(); },
    });
    lastSnap = ctl.snapshot();
    function apply() {
      var snap = lastSnap;
      var draft = dragged && dragged.base === bound ? dragged.v : null;
      var shown = draft !== null ? draft : (snap.displayValue !== null && snap.displayValue !== undefined ? snap.displayValue : range.min);
      var pending = snap.state === 'pending';
      if (Number(input.value) !== shown) input.value = String(shown);
      var pct = ((shown - range.min) / (range.max - range.min)) * 100;
      input.style.backgroundImage = 'linear-gradient(to ' + (cfg.vertical ? 'top' : 'right') + ', ' + main + ' ' + pct + '%, ' + trackColor + ' ' + pct + '%)';
      // No value yet reads "—": the thumb has to sit somewhere (the minimum), the text must not claim it.
      var hasValue = draft !== null || (snap.displayValue !== null && snap.displayValue !== undefined);
      var text = hasValue ? fmt(shown) : '—';
      input.setAttribute('aria-valuetext', text);
      input.disabled = locked || pending || ask.asking();
      attr(input, 'aria-busy', pending || null);
      for (var i = 0; i < textEls.length; i++) textEls[i].textContent = text;
      if (reportedEl) {
        var showReported = bound !== null && draft !== null && draft !== bound;
        reportedEl.hidden = !showReported;
        if (showReported) reportedEl.textContent = msgs.reportedLabel.replace('{value}', fmt(bound));
      }
      renderStatus(root, msgs, snap.state, snap.error, cfg.readOnly);
    }
    // One gesture commits exactly once: pointer up, keyboard idle, blur, or (debounced) a pause.
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    function flush() {
      clear();
      var v = latest;
      latest = null;
      if (v !== null && ask.request(v)) write(v);
    }
    function later(ms) { clear(); timer = setTimeout(flush, ms); }
    input.addEventListener('input', function () {
      var v = L.snapToStep(Number(input.value), range);
      dragged = { v: v, base: bound };
      latest = v;
      if (debounced) later(debounceMs);
      apply();
    });
    input.addEventListener('pointerup', flush);
    input.addEventListener('keyup', function (e) {
      if (COMMIT_KEYS.indexOf(e.key) !== -1) later(debounced ? debounceMs : KEY_IDLE_MS);
    });
    input.addEventListener('blur', flush);
    apply();
    return {
      ctl: ctl,
      setValue: function (v) { bound = L.asNumber(v); ctl.setValue(bound); },
      setReported: function (v) { ctl.setReported(v === undefined ? undefined : (v === null ? null : L.asNumber(v))); },
      destroy: clear,
    };
  }

  // ── ControlSetpoint ───────────────────────────────────────────────────────
  function bindSetpoint(root, cfg, msgs, commitFn) {
    var range = L.toRange(cfg);
    var fmt = formatter(cfg);
    var locked = !!cfg.disabled || !!cfg.readOnly;
    var showValue = cfg.showValue !== false;
    var bound = L.asNumber(cfg.value);
    var currentEl = root.querySelector('[data-kui-control-current]');
    var stepped = cfg.layout === 'stepper' || cfg.layout === 'dial';
    // Stepper and dial: how long after the last press the value is written (0 writes every press).
    var settleMs = typeof cfg.settleMs === 'number' ? cfg.settleMs : STEP_SETTLE_MS;
    // Presses in a row move a draft at once; the draft is written once they settle (one command, not one per press).
    var draft = null;
    var settle = null;
    var lastSnap = null;
    var ask = confirmStep(root, cfg, function (v) { ctl.set(v); }, function () { sync(); }, function () { sync(); });
    var ctl = KC.createAsyncControl({
      value: bound,
      reported: cfg.reported === undefined ? undefined : L.asNumber(cfg.reported),
      commit: function (v) { return commitFn(v, ask.confirmation); },
      timeoutMs: cfg.timeoutMs,
      onChange: function (snap) { lastSnap = snap; sync(); },
    });
    lastSnap = ctl.snapshot();
    function request(v) { if (ask.request(v)) ctl.set(v); }
    function current() {
      if (draft !== null) return draft;
      var d = lastSnap.displayValue;
      return d !== null && d !== undefined ? d : bound;
    }
    function showCurrent() {
      if (!currentEl) return;
      var cur = current();
      var on = showValue && bound !== null && (!stepped || (cur !== null && cur !== bound));
      currentEl.hidden = !on;
      if (bound !== null) currentEl.textContent = msgs.current.replace('{value}', fmt(bound));
    }

    var form = root.querySelector('form');
    var input = root.querySelector('[data-kui-control-input]');
    var btn = root.querySelector('[data-kui-control-apply]');
    var errHost = root.querySelector('[data-kui-control-error-host]');
    var outputs = root.querySelectorAll('[data-kui-control-output]');
    var dec = root.querySelector('[data-kui-control-step="-1"]');
    var inc = root.querySelector('[data-kui-control-step="1"]');
    var dial = root.querySelector('[data-kui-control-dial]');
    var errId = root.id + '-error';

    function sync() {
      var snap = lastSnap;
      var pending = snap.state === 'pending';
      var blocked = locked || pending || ask.asking();
      if (stepped) {
        var cur = current();
        var text = cur !== null ? fmt(cur) : '—';
        for (var i = 0; i < outputs.length; i++) {
          // A value partial keeps its own markup around the number: only the number's span changes, and the unit
          // beside it is shown only when there is a number.
          var numEl = outputs[i].querySelector('[data-kui-control-output-text]');
          (numEl || outputs[i]).textContent = text;
          var unitEls = outputs[i].querySelectorAll('[data-kui-control-output-unit]');
          for (var u = 0; u < unitEls.length; u++) unitEls[u].hidden = cur === null;
        }
        if (dec) dec.disabled = blocked || (cur !== null && cur <= range.min);
        if (inc) inc.disabled = blocked || (cur !== null && cur >= range.max);
        if (dial) {
          var len = Number(dial.getAttribute('data-len'));
          var f = cur === null ? 0 : Math.min(1, Math.max(0, (cur - range.min) / (range.max - range.min)));
          dial.setAttribute('stroke-dasharray', (len * f) + ' 999');
          dial.style.display = cur === null ? 'none' : '';
        }
      } else if (input) {
        input.disabled = blocked;
        setButtonLoading(btn, pending, blocked);
      }
      showCurrent();
      renderStatus(root, msgs, snap.state, snap.error, cfg.readOnly);
    }
    function setFieldError(text) {
      if (!errHost || !input) return;
      errHost.textContent = '';
      if (text) {
        var p = el('p', 'text-xs text-error', text);
        p.id = errId;
        p.setAttribute('role', 'alert');
        errHost.appendChild(p);
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errId);
      } else {
        input.setAttribute('aria-invalid', 'false');
        input.removeAttribute('aria-describedby');
      }
    }
    if (form && input) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var checked = L.validateSetpoint(input.value, range);
        if (!checked.ok) {
          setFieldError(checked.reason === 'range'
            ? msgs.outOfRange.replace('{min}', String(range.min)).replace('{max}', String(range.max))
            : msgs.enterNumber);
          return;
        }
        setFieldError(null);
        request(checked.value);
      });
      input.addEventListener('input', function () { setFieldError(null); });
    }
    function stepBy(dir) {
      var cur = current();
      var next = L.snapToStep((cur !== null ? cur : range.min) + dir * range.step, range);
      if (settleMs <= 0) { request(next); return; }
      draft = next;
      sync();
      if (settle) clearTimeout(settle);
      settle = setTimeout(function () {
        settle = null;
        draft = null;
        request(next);
      }, settleMs);
    }
    if (dec) dec.addEventListener('click', function () { stepBy(-1); });
    if (inc) inc.addEventListener('click', function () { stepBy(1); });
    sync();
    return {
      ctl: ctl,
      setValue: function (v) {
        var next = L.asNumber(v);
        var changed = next !== bound;
        bound = next;
        // A new bound value replaces the typed text.
        if (changed && bound !== null && input) input.value = String(bound);
        ctl.setValue(bound);
      },
      setReported: function (v) { ctl.setReported(v === undefined ? undefined : (v === null ? null : L.asNumber(v))); },
      destroy: function () { if (settle) { clearTimeout(settle); settle = null; } },
    };
  }

  // ── ControlButton ─────────────────────────────────────────────────────────
  function bindButton(root, cfg, msgs, commitFn) {
    var main = root.querySelector('[data-kui-control-main]');
    var row = root.querySelector('[data-kui-control-main-row]') || main;
    if (!main) return null;
    var locked = !!cfg.disabled || !!cfg.readOnly;
    var layout = cfg.layout || 'button';
    var ask = confirmStep(root, cfg, function () { ctl.set(undefined); }, function () { main.focus(); }, function (on) { row.hidden = on; });
    var ctl = KC.createAsyncControl({
      value: undefined,
      commit: function () { return commitFn(undefined, ask.confirmation); },
      confirmedMs: 2000,
      onChange: function (snap) {
        var pending = snap.state === 'pending';
        // The tile shows no spinner; the round icon button pulses instead.
        setButtonLoading(main, pending, locked || pending, layout !== 'tile' && layout !== 'icon');
        if (layout === 'icon') toggle(main, ['animate-pulse', 'motion-reduce:animate-none'], pending);
        renderStatus(root, msgs, snap.state, snap.error, cfg.readOnly);
      },
    });
    main.addEventListener('click', function () { if (ask.request(undefined)) ctl.set(undefined); });
    return { ctl: ctl, setValue: function () {}, setReported: function () {} };
  }

  KC.autoInit = function (scope) {
    var rootEl = scope || document;
    var nodes = rootEl.querySelectorAll('[data-kui-control]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiControlMounted) continue;
      // A kind whose binder is not registered yet stays unmounted: a later autoInit (after the host's script) picks it up.
      if (!BINDERS[nodes[i].getAttribute('data-kui-control')]) continue;
      nodes[i].__kuiControlMounted = true;
      mount(nodes[i]);
    }
  };
  KC.renderStatus = renderStatus;
})(typeof window !== 'undefined' ? window : globalThis);
