/*
 * modules/ui/ControlTile/scripts/async-control.js
 *
 * The state machine behind every async control (kui-react libs/hooks/useAsyncControl.ts):
 *
 *   idle -> pending -> confirmed   (commit resolved, and `reported` matches if given)
 *   idle -> pending -> mismatch    (commit resolved but `reported` never matched in time)
 *   idle -> pending -> failed      (commit rejected; the display rolls back to `value`)
 *
 * No transport knowledge: the caller supplies `commit` and, optionally, the value the
 * other side `reported`. No DOM either; the DOM binding is control-bind.js.
 *
 *   var ctl = KuiControl.createAsyncControl({
 *     value, reported, commit: function (next) { return Promise },
 *     timeoutMs: 10000, confirmedMs: 2000, confirm: false, equals: Object.is,
 *     onChange: function (snapshot) {},   // { displayValue, state, error, awaiting }
 *   });
 *   ctl.set(next) / ctl.retry() / ctl.accept() / ctl.dismiss()
 *   ctl.setValue(v) / ctl.setReported(v)   // the bound / reported value changed
 *   ctl.snapshot() / ctl.destroy()
 *
 * `reported === undefined` means "this control gets no report": a resolved commit is
 * confirmed at once. `reported === null` means "reports, but unknown yet".
 *
 * Exposed as window.KuiControl.createAsyncControl (and module.exports under Node).
 */
(function (global) {
  'use strict';

  function createAsyncControl(opts) {
    var timeoutMs = opts.timeoutMs === undefined ? 10000 : opts.timeoutMs;
    var confirmedMs = opts.confirmedMs === undefined ? 2000 : opts.confirmedMs;
    var confirm = !!opts.confirm;
    var equals = opts.equals || function (a, b) { return Object.is(a, b); };
    var commit = opts.commit;

    var value = opts.value;
    var reported = opts.reported;
    var desiredRaw = null;          // { value, base }
    var state = 'idle';
    var error = null;
    var awaiting = null;
    var seq = 0;
    var alive = true;
    var last = null;
    var resolved = false;
    var timer = null;
    var confirmedTimer = null;

    function clearTimers() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (confirmedTimer) { clearTimeout(confirmedTimer); confirmedTimer = null; }
    }

    // The requested value holds while a write is in flight, and afterwards only until the
    // bound value changes: a fresh bound value supersedes the optimistic one.
    function desired() {
      return desiredRaw && (state === 'pending' || Object.is(desiredRaw.base, value)) ? desiredRaw : null;
    }

    function snapshot() {
      var d = desired();
      return { displayValue: d ? d.value : value, state: state, error: error, awaiting: awaiting };
    }

    function emit() { if (alive && opts.onChange) opts.onChange(snapshot()); }

    function finishConfirmed() {
      clearTimers();
      state = 'confirmed';
      emit();
      if (confirmedMs > 0) {
        confirmedTimer = setTimeout(function () {
          if (alive) { state = 'idle'; emit(); }
        }, confirmedMs);
      }
    }

    // `reported` arriving (or matching) resolves a pending write whose commit already resolved.
    function checkReported() {
      var d = desired();
      if (state === 'pending' && resolved && d && reported !== undefined && reported !== null && equals(reported, d.value)) {
        finishConfirmed();
      }
    }

    function run(next) {
      clearTimers();
      var id = ++seq;
      last = { value: next };
      resolved = false;
      error = null;
      desiredRaw = { value: next, base: value };
      state = 'pending';
      emit();
      var p;
      try { p = Promise.resolve(commit(next)); } catch (e) { p = Promise.reject(e); }
      p.then(
        function () {
          if (!alive || id !== seq) return;
          resolved = true;
          if (reported === undefined) { finishConfirmed(); return; }
          if (reported !== null && equals(reported, next)) { finishConfirmed(); return; }
          timer = setTimeout(function () {
            if (alive && id === seq) { state = 'mismatch'; emit(); }
          }, timeoutMs);
        },
        function (err) {
          if (!alive || id !== seq) return;
          clearTimers();
          desiredRaw = null; // roll the display back to the bound value
          error = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
          state = 'failed';
          emit();
        }
      );
    }

    return {
      snapshot: snapshot,
      set: function (next) {
        if (confirm) { awaiting = { value: next }; emit(); return; }
        run(next);
      },
      accept: function () {
        var a = awaiting;
        awaiting = null;
        if (a) run(a.value); else emit();
      },
      dismiss: function () { awaiting = null; emit(); },
      retry: function () { if (last) run(last.value); },
      setValue: function (v) { value = v; checkReported(); emit(); },
      setReported: function (r) { reported = r; checkReported(); emit(); },
      destroy: function () { alive = false; clearTimers(); },
    };
  }

  var ns = global.KuiControl || {};
  ns.createAsyncControl = createAsyncControl;
  global.KuiControl = ns;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createAsyncControl: createAsyncControl };
})(typeof window !== 'undefined' ? window : globalThis);
