/*
 * modules/app/WidgetKit/scripts/control-form.js
 *
 * The browser part of the WidgetKit's control.form (kui-react views/ControlFormView.tsx + control-form-logic.ts).
 * Two halves:
 *   - the pure checks of control-form-logic.ts, ported one to one: gatedOff, formErrors, formDirty, formPayload,
 *     formInitial, and ControlFormView's `cleared` as formCleared (tests/widget-kit-control-form.test.ts runs both
 *     over the same cases and compares);
 *   - the DOM binder, registered as the `form` kind of the ControlTile runtime (KuiControl.binders.form), so the
 *     shared state machine (async-control.js), the confirm step and the status line are the ones of every other control.
 *
 * The write is ONE request: the commit value is the payload `{ <field key>: <value>, ... }` (an empty or switched-off
 * field is left out, never sent as null; with `saveChangedOnly` only the changed fields); the ControlTile runtime
 * raises `kui:control-commit` (kind 'form') and scripts/widget-kit.js turns it into the card's bubbling
 * `kui:widget-control` event (`kind: 'set'`, `value: <payload>`). Needs control-logic.js, async-control.js and
 * control-bind.js first (load order); without them only the pure functions exist (module.exports under Node).
 *
 * Runtime API on the control root (root.__kuiControl): setValue(record) starts the form from a new record (the page
 * calls it when the device's record changed or a save landed), setReported is a no-op, state(), onCommit, destroy().
 */
(function (global) {
  'use strict';
  var L = global.KuiControlLogic;
  var KC = global.KuiControl;

  var HOP = Object.prototype.hasOwnProperty;

  function gatedOff(f, values) { return !!f.gate && values[f.gate] !== true; }

  /** The values the record holds, as the form starts with them. A missing number is null, never 0. */
  function formInitial(fields, record, logic) {
    var lg = logic || L;
    var out = {};
    fields.forEach(function (f) {
      var raw = record && HOP.call(record, f.key) ? record[f.key] : undefined;
      out[f.key] = f.type === 'number' ? lg.asNumber(raw)
        : f.type === 'boolean' ? lg.asBoolean(raw) === true
          : raw === null || raw === undefined ? '' : String(raw);
    });
    return out;
  }

  /** What stops a save, per field key ('required' | 'nan' | 'range' | 'invalid'). Read-only and switched-off fields are never checked. */
  function formErrors(fields, values) {
    var out = {};
    fields.forEach(function (f) {
      if (f.readOnly || gatedOff(f, values)) return;
      var v = values[f.key];
      if (f.type === 'number') {
        if (v === null || v === undefined || v === '') { if (f.required) out[f.key] = 'required'; return; }
        if (typeof v !== 'number' || !isFinite(v)) out[f.key] = 'nan';
        else if ((f.min !== undefined && f.min !== null && v < f.min) || (f.max !== undefined && f.max !== null && v > f.max)) out[f.key] = 'range';
      } else if (f.type === 'text') {
        if (f.required && String(v === null || v === undefined ? '' : v).trim() === '') out[f.key] = 'required';
      } else if (f.type === 'enum') {
        var s = String(v === null || v === undefined ? '' : v);
        if (s === '') { if (f.required) out[f.key] = 'required'; } else if (!f.options || f.options.indexOf(s) === -1) out[f.key] = 'invalid';
      }
    });
    return out;
  }

  function same(a, b) { return (a === undefined ? null : a) === (b === undefined ? null : b); }

  /** The keys the viewer changed (read-only fields never count). */
  function formDirty(fields, initial, values) {
    return fields.filter(function (f) { return !f.readOnly && !same(initial[f.key], values[f.key]); }).map(function (f) { return f.key; });
  }

  /**
   * What a save sends: the editable fields that have something to say. A text is trimmed, a list choice is its value, a
   * number is a number, an on / off field is always sent (`false` is a value). An empty text, an empty number, an empty
   * choice and a switched-off gated field are LEFT OUT, never sent as null (the command sees the field as absent). With
   * `only` (the keys the viewer changed, see formDirty) just those fields are sent.
   */
  function formPayload(fields, values, only) {
    var keep = null;
    if (only) { keep = {}; only.forEach(function (k) { keep[k] = true; }); }
    var out = Object.create(null);
    fields.forEach(function (f) {
      if (f.readOnly || gatedOff(f, values) || (keep && !HOP.call(keep, f.key))) return;
      var v = values[f.key];
      if (f.type === 'boolean') out[f.key] = v === true;
      else if (f.type === 'number') { if (typeof v === 'number' && isFinite(v)) out[f.key] = v; }
      else {
        var text = String(v === null || v === undefined ? '' : v).trim();
        if (text) out[f.key] = text;
      }
    });
    return out;
  }

  /**
   * The changed fields a save would leave out: a clear (a field the viewer emptied). The form cannot say "unset", so it
   * does not save while one is pending (kui-react ControlFormView `cleared`). A field its gate switched off is not a
   * clear (its flag is what the viewer changed, and that is sent).
   */
  function formCleared(fields, dirty, payload, values) {
    return fields.filter(function (f) { return dirty.indexOf(f.key) >= 0 && !(f.key in payload) && !gatedOff(f, values); }).map(function (f) { return f.key; });
  }

  /** The text of a field error; `{min}` / `{max}` are replaced. */
  function errorText(f, code, t) {
    if (code === 'required') return t.fieldRequired;
    if (code === 'nan') return t.fieldNumber;
    if (code === 'invalid') return t.fieldInvalid;
    var has = function (n) { return n !== undefined && n !== null; };
    if (has(f.min) && has(f.max)) return t.outOfRange.replace('{min}', String(f.min)).replace('{max}', String(f.max));
    return has(f.min) ? t.atLeast.replace('{min}', String(f.min)) : t.atMost.replace('{max}', String(f.max));
  }

  var api = { gatedOff: gatedOff, formInitial: formInitial, formErrors: formErrors, formDirty: formDirty, formPayload: formPayload, formCleared: formCleared, errorText: errorText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KuiControlForm = api;

  if (!KC || !KC.binders || KC.binders.form || typeof document === 'undefined') return;

  function bindForm(root, cfg, msgs, commitFn) {
    var form = root.querySelector('form[data-kui-form]');
    if (!form) return null;
    var fields = cfg.fields || [];
    var texts = cfg.texts || {};
    var blocked = !!cfg.disabled;
    var changedOnly = !!cfg.saveChangedOnly;
    var initial = cfg.initial || {};
    var values = {};
    var touched = {};
    var inputs = {};
    var holders = {};
    fields.forEach(function (f) {
      inputs[f.key] = form.querySelector('[data-kui-form-field="' + f.key.replace(/"/g, '\\"') + '"]');
      holders[f.key] = form.querySelector('[data-kui-form-error="' + f.key.replace(/"/g, '\\"') + '"]');
    });
    var save = form.querySelector('[data-kui-form-save]');
    var reset = form.querySelector('[data-kui-form-reset]');
    var actions = form.querySelector('[data-kui-form-actions]');
    var clearedNote = form.querySelector('[data-part="cleared-note"]');
    var lastSnap = null;

    /** What Save would send now, the clears it would drop, and whether it cannot save (kui-react `cannotSave`). */
    function plan() {
      var errors = formErrors(fields, values);
      var dirty = formDirty(fields, initial, values);
      var payload = formPayload(fields, values, changedOnly ? dirty : undefined);
      var cleared = formCleared(fields, dirty, payload, values);
      return { errors: errors, dirty: dirty, payload: payload, cleared: cleared, cannotSave: dirty.length === 0 || cleared.length > 0 || Object.keys(errors).length > 0 };
    }

    function copy(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }

    /** Put the state's values into the inputs (a reset, or a new record). */
    function writeInputs() {
      fields.forEach(function (f) {
        var input = inputs[f.key];
        var v = values[f.key];
        if (!input) return;
        if (f.type === 'boolean') input.checked = v === true;
        else input.value = v === null || v === undefined ? '' : String(v);
      });
    }

    function render() {
      var snap = lastSnap || { state: 'idle', error: null };
      var busy = snap.state === 'pending';
      var now = plan();
      var errors = now.errors;
      var dirty = now.dirty;
      fields.forEach(function (f) {
        var input = inputs[f.key];
        var holder = holders[f.key];
        if (input) input.disabled = f.readOnly || blocked || busy || ask.asking() || gatedOff(f, values);
        var code = touched[f.key] ? errors[f.key] : undefined;
        if (input) {
          if (code) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', input.id + '-err');
          } else {
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-describedby');
          }
        }
        if (holder) {
          var text = code ? errorText(f, code, texts) : '';
          var p = holder.firstChild;
          if (!text) { if (p) holder.removeChild(p); } else {
            if (!p) {
              p = document.createElement('p');
              p.className = 'mt-1 text-xs text-error';
              p.setAttribute('role', 'alert');
              holder.appendChild(p);
            }
            p.id = input ? input.id + '-err' : '';
            if (p.textContent !== text) p.textContent = text;
          }
        }
      });
      if (clearedNote) clearedNote.hidden = blocked || now.cleared.length === 0;
      if (save) KC.setButtonLoading(save, false, blocked || busy || now.cannotSave);
      if (reset) reset.disabled = busy || dirty.length === 0;
      KC.renderStatus(root, msgs, snap.state, snap.error, false);
    }

    var ask = KC.confirmStep(root, cfg, function (payload) { ctl.set(payload); }, function () { render(); }, function (on) { if (actions) actions.hidden = on; render(); });
    var ctl = KC.createAsyncControl({
      value: undefined,
      commit: function (payload) { return commitFn(payload, ask.confirmation); },
      timeoutMs: cfg.timeoutMs,
      onChange: function (snap) { lastSnap = snap; render(); },
    });
    lastSnap = ctl.snapshot();

    function start(next) {
      initial = next;
      values = copy(initial);
      touched = {};
      writeInputs();
      render();
    }
    values = copy(initial);

    function read(f, input) {
      if (f.type === 'boolean') return input.checked;
      if (f.type === 'number') return input.value.trim() === '' ? null : Number(input.value);
      return input.value;
    }
    fields.forEach(function (f) {
      var input = inputs[f.key];
      if (!input) return;
      var onEdit = function () {
        values[f.key] = read(f, input);
        // A new edit clears the last outcome ("Done", a failure) the way kui-react's phase goes back to idle.
        if (lastSnap && (lastSnap.state === 'confirmed' || lastSnap.state === 'failed')) lastSnap = { state: 'idle', error: null, displayValue: undefined, awaiting: null };
        render();
      };
      input.addEventListener(f.type === 'boolean' || f.type === 'enum' ? 'change' : 'input', onEdit);
      input.addEventListener('blur', function () { touched[f.key] = true; render(); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      fields.forEach(function (f) { touched[f.key] = true; });
      var now = plan();
      var snap = lastSnap || { state: 'idle' };
      render();
      if (blocked || snap.state === 'pending' || ask.asking() || now.cannotSave) return;
      if (ask.request(now.payload)) ctl.set(now.payload);
    });
    if (reset) reset.addEventListener('click', function () { start(initial); });
    render();
    return {
      ctl: ctl,
      // A record of field values: the form starts from it unless it is what the form already started from.
      setValue: function (record) {
        var next = formInitial(fields, record && typeof record === 'object' ? record : {});
        if (JSON.stringify(next) !== JSON.stringify(initial)) start(next);
      },
      setReported: function () {},
    };
  }

  KC.binders.form = bindForm;
  if (typeof KC.autoInit === 'function') KC.autoInit();
})(typeof window !== 'undefined' ? window : globalThis);
