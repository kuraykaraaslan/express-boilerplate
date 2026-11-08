// Behaviour of views/admin/module-settings.ejs; the port of ModuleSettingsPage. Reads the tenant's settings through the generic
// endpoint /api/admin-settings (ADMIN-gated) and patches only the keys of this page that the admin changed, so saving one
// module's settings never touches another module's keys and an untouched field never shadows the platform default.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var root = document.getElementById('ms-root');
  var tenantId = root.getAttribute('data-tenant-id');
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var MASK = '***SET***';
  var SUCCESS_DISMISS_MS = 4000;
  var defs = JSON.parse(root.getAttribute('data-fields'));
  var form = $('ms-form'), notice = $('ms-notice');
  var saveBtn = form.querySelector('button[type=submit]');
  var own = {}, inherited = {}, baseline = {}, levels, cleared = {}, dismissTimer = null;

  function followsLevel(view, key) {
    return (view.keys || []).indexOf(key) >= 0 || (view.prefixes || []).some(function (p) { return key.length > p.length && key.indexOf(p) === 0; });
  }
  // A field the platform provides is neither shown nor saved (its value in force is the operator's).
  function platformProvided(key) {
    return Object.keys(levels || {}).some(function (m) { var v = levels[m]; return v.level === 'platform' && followsLevel(v, key); });
  }
  var visible = [];

  function field(key) { return $(key); }
  function getValue(d) {
    var el = field(d.key);
    if (d.type === 'boolean') return el.checked ? 'true' : 'false';
    if (d.type === 'secret') return el.value !== '' ? el.value : (cleared[d.key] ? '' : (baseline[d.key] || ''));
    return el.value;
  }
  function setValue(d, v) {
    var el = field(d.key);
    if (d.type === 'boolean') {
      var tgl = document.querySelector('[data-toggle-root="' + d.key + '"]');
      if (tgl && tgl.__toggle && tgl.__toggle.setChecked) tgl.__toggle.setChecked(v === 'true'); else el.checked = v === 'true';
    } else if (d.type === 'secret') {
      el.value = '';
    } else if (d.type === 'date') {
      el.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    } else el.value = v;
  }
  function paintSecret(d) {
    var stored = baseline[d.key] || '';
    var state = document.querySelector('[data-secret-state="' + d.key + '"]');
    var clr = document.querySelector('[data-secret-clear="' + d.key + '"]');
    var has = stored !== '' && !cleared[d.key];
    state.textContent = has ? 'A value is saved. Type a new one to replace it.' : (cleared[d.key] ? 'The saved value will be removed when you save.' : '');
    state.classList.toggle('hidden', !state.textContent);
    clr.classList.toggle('hidden', !has);
  }

  function say(kind, text) {
    clearTimeout(dismissTimer);
    var tone = { error: 'bg-error-subtle border-error text-error-fg', success: 'bg-success-subtle border-success text-success-fg', info: 'bg-info-subtle border-info text-info-fg', warning: 'bg-warning-subtle border-warning text-warning-fg' }[kind];
    var icon = { error: 'fa-circle-xmark', success: 'fa-circle-check', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' }[kind];
    notice.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm ' + tone;
    notice.innerHTML = '<i class="fa-solid ' + icon + ' mt-0.5 shrink-0" aria-hidden="true"></i><span></span>';
    notice.lastChild.textContent = text;
    // Only a success hides itself, with a timer the next save cancels.
    if (kind === 'success') dismissTimer = setTimeout(function () { notice.className = 'hidden'; notice.textContent = ''; }, SUCCESS_DISMISS_MS);
  }

  function load() {
    $('ms-loading').classList.remove('hidden'); $('ms-load-error').classList.add('hidden'); form.classList.add('hidden');
    api.get(tp('/api/admin-settings')).then(function (res) {
      var data = res && res.data || {};
      own = data.settings || {}; inherited = data.inherited || {}; levels = data.levels;
      visible = defs.filter(function (d) { return !platformProvided(d.key); });
      defs.forEach(function (d) {
        var box = document.querySelector('[data-field="' + d.key + '"]');
        var shown = visible.indexOf(d) >= 0;
        box.classList.toggle('hidden', !shown);
        if (!shown) return;
        var v = own[d.key] != null ? own[d.key] : (inherited[d.key] != null ? inherited[d.key] : (d.defaultValue || ''));
        baseline[d.key] = v;
        setValue(d, v);
        if (d.type === 'secret') paintSecret(d);
        // A platform default still in force is said, not shown as the tenant's own choice.
        var note = box.querySelector('[data-inherited-note]');
        var isInh = !(d.key in own) && d.key in inherited;
        if (isInh && !note) {
          note = document.createElement('p'); note.setAttribute('data-inherited-note', ''); note.className = 'text-xs text-text-secondary mt-1';
          note.textContent = 'Platform default: the platform’s value applies until you change it.'; box.appendChild(note);
        } else if (!isInh && note) note.remove();
      });
      // Sections left with no visible field are hidden with their card.
      form.querySelectorAll('section').forEach(function (s) { s.classList.toggle('hidden', !s.querySelector('[data-field]:not(.hidden)')); });
      $('ms-loading').classList.add('hidden');
      form.classList.toggle('hidden', visible.length === 0);
    }).catch(function (err) {
      // A failed load (403, 429, 5xx, network) is not a new tenant: showing defaults would let a save write them (and '' over every
      // secret). An error with Retry and no form instead.
      $('ms-loading').classList.add('hidden');
      $('ms-load-error-text').textContent = U.errorText(err, 'The settings could not be loaded.');
      $('ms-load-error').classList.remove('hidden');
    });
  }
  $('ms-retry').addEventListener('click', load);

  document.querySelectorAll('[data-secret-clear]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-secret-clear');
      cleared[key] = true; field(key).value = ''; paintSecret(defs.filter(function (d) { return d.key === key; })[0]);
    });
  });
  document.querySelectorAll('input[data-secret]').forEach(function (i) {
    i.addEventListener('input', function () { if (i.value) { cleared[i.id] = false; paintSecret(defs.filter(function (d) { return d.key === i.id; })[0]); } });
  });

  var labelOf = function (key) { var l = document.querySelector('label[for="' + key + '"]'); return l ? l.textContent.replace(/\(required\)|\*/g, '').trim() : key; };
  function fieldErrors(map) {
    document.querySelectorAll('[data-field-error]').forEach(function (e) { e.remove(); });
    Object.keys(map).forEach(function (k) {
      var el = field(k); if (!el) return;
      el.setAttribute('aria-invalid', 'true');
      var p = document.createElement('p'); p.setAttribute('data-field-error', ''); p.id = k + '-error'; p.className = 'text-xs text-error mt-1'; p.textContent = map[k];
      el.setAttribute('aria-describedby', p.id);
      document.querySelector('[data-field="' + k + '"]').appendChild(p);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(dismissTimer); notice.className = 'hidden'; fieldErrors({});
    // Only what the admin changed.
    var patch = {};
    visible.forEach(function (d) {
      var v = getValue(d);
      if (v === (baseline[d.key] || '')) return;
      if (d.type === 'secret' && v === MASK) return; // never write the mask sentinel
      patch[d.key] = v;
    });
    if (!Object.keys(patch).length) return say('info', 'Nothing to save: no setting was changed.');
    U.busy(saveBtn, true);
    api.put(tp('/api/admin-settings'), { settings: patch }).then(function (res) {
      var data = res && res.data || {};
      // What was written, what waits for approval, what was skipped.
      var pending = (Array.isArray(data.pending) ? data.pending : []).filter(function (p) { return p && typeof p.key === 'string' && p.key in patch; }).map(function (p) { return p.key; });
      var written = data.settings && typeof data.settings === 'object' ? data.settings : null;
      var applied = {};
      Object.keys(patch).forEach(function (k) {
        if (pending.indexOf(k) >= 0) return;
        if (written === null) applied[k] = patch[k]; else if (k in written) applied[k] = written[k];
      });
      var skipped = Object.keys(patch).filter(function (k) { return !(k in applied) && pending.indexOf(k) < 0; });
      Object.keys(applied).forEach(function (k) { own[k] = applied[k]; baseline[k] = applied[k]; cleared[k] = false; });
      visible.forEach(function (d) {
        if (d.key in applied || pending.indexOf(d.key) >= 0) {
          // A change waiting for approval did not happen yet: the field shows the stored value again.
          setValue(d, pending.indexOf(d.key) >= 0 ? (baseline[d.key] || '') : applied[d.key]);
          if (d.type === 'secret') paintSecret(d);
        }
      });
      document.querySelectorAll('[data-inherited-note]').forEach(function (n) { var k = n.parentNode.getAttribute('data-field'); if (k in own) n.remove(); });
      if (!pending.length && !skipped.length) return say('success', 'Settings saved.');
      var names = function (keys) { return keys.map(labelOf).join(', '); }, parts = [], ak = Object.keys(applied);
      if (ak.length) parts.push('Saved: ' + names(ak) + '.');
      if (pending.length) parts.push('Sent for approval: ' + names(pending) + '. The change applies once it is approved.');
      if (skipped.length) parts.push('Not saved: ' + names(skipped) + '. These settings are locked or could not be changed.');
      say(skipped.length ? 'warning' : 'info', parts.join(' '));
    }).catch(function (err) {
      var body = err && err.response && err.response.data || {};
      var msg = body.message || U.errorText(err, 'Failed to save settings.');
      // A refusal that names one of this page's keys is shown under that field, and the field gets the focus.
      var d = body.details || {}, keys = [];
      if (typeof d.key === 'string' && d.key) keys.push(d.key);
      if (Array.isArray(d.keys)) d.keys.forEach(function (k) { if (typeof k === 'string' && k) keys.push(k); });
      keys = keys.filter(function (k) { return visible.some(function (v) { return v.key === k; }); });
      if (keys.length) {
        var map = {}; keys.forEach(function (k) { map[k] = msg; });
        fieldErrors(map);
        say('error', 'Not saved: check ' + keys.map(labelOf).join(', ') + '.');
        var f = field(keys[0]); if (f) f.focus();
      } else say('error', msg);
    }).then(function () { U.busy(saveBtn, false); });
  });

  load();
})();
