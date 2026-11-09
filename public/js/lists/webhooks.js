// /admin/webhooks (webhook/ui/webhooks.page.tsx, webhooks.hooks.ts, webhook-columns, webhook-form-modal, webhook-trigger-modal,
// webhook-delivery-modal). Only what the caller holds is offered (GET /api/webhooks/capabilities fails closed).
(function () {
  var K = window.Kui, L = window.KuiList, W = window.KuiWebhook, esc = L.esc, api = K.api, F = W.fmt;
  var page = document.getElementById('dl-page'), tenantId = page.getAttribute('data-tenant-id'), isRoot = page.getAttribute('data-root') === '1';
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var base = tp('/api/webhooks');
  var $ = function (id) { return document.getElementById(id); };
  var say = function (el, kind, text) { window.AuthUi.say(el, kind, text); };
  var NONE = { createEndpoints: false, updateEndpoints: false, deleteEndpoints: false, rotateSecret: false, sendTest: false, trigger: false, readDeliveries: false, redeliver: false, replayDeadLetters: false, readMetrics: false, readReports: false, readEvents: false, readSettings: false, updateSettings: false };
  var caps = NONE, list, catalog = { status: 'idle', data: null, error: '' };

  function btnPrimary(text, onClick) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', onClick);
    b.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-primary text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
    return b;
  }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  // ── Header reads ──
  function loadMetrics() {
    api.get(base + '/metrics?days=7').then(function (res) {
      var m = res.data && res.data.metrics; var box = $('wh-metrics');
      if (!m || !(m.total > 0)) { box.innerHTML = ''; return; }
      var card = function (label, value) { return '<div class="rounded-xl border border-border bg-surface-raised shadow-sm px-4 py-3"><p class="text-xs text-text-secondary">' + esc(label) + '</p><p class="mt-1 text-xl font-semibold text-text-primary">' + esc(value) + '</p></div>'; };
      box.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + card('Deliveries (7d)', F.num(m.total)) + card('Success rate', F.ratio(m.successRate)) + card('Avg latency', F.ms(m.avgDurationMs)) + card('p95 latency', F.ms(m.p95DurationMs)) + '</div>';
    }).catch(function (err) { retry($('wh-metrics'), W.errorMessage(err, 'Could not load the delivery metrics.'), loadMetrics); });
  }
  function loadReport() {
    api.get(base + '/report?days=30').then(function (res) {
      var rows = res.data && res.data.report && res.data.report.autoDisabled || [], box = $('wh-report');
      if (!rows.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="flex items-start gap-3 rounded-lg border p-3 text-sm bg-warning-subtle border-warning text-warning-fg"><i class="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" aria-hidden="true"></i><span></span></div>';
      box.querySelector('span').textContent = rows.length + ' endpoint' + (rows.length === 1 ? '' : 's') + ' auto-disabled by the circuit breaker: ' + rows.map(function (w) { return w.name; }).join(', ') + '. Open an endpoint to review and re-enable it.';
    }).catch(function (err) { retry($('wh-report'), W.errorMessage(err, 'Could not load the circuit-breaker report, so auto-disabled endpoints are not listed here.'), loadReport); });
  }
  function retry(box, text, fn) {
    box.innerHTML = '<div class="flex items-start gap-3 rounded-lg border p-3 text-sm bg-error-subtle border-error text-error-fg"><i class="fa-solid fa-circle-xmark mt-0.5 shrink-0" aria-hidden="true"></i><span class="flex-1"></span><button type="button" class="shrink-0 underline underline-offset-2">Retry</button></div>';
    box.querySelector('span').textContent = text; box.querySelector('button').addEventListener('click', fn);
  }
  function loadCatalog() {
    catalog = { status: 'loading', data: null, error: '' }; paintEvents();
    api.get(base + '/events').then(function (res) { catalog = { status: 'ready', data: res.data && res.data.groups || [], error: '' }; })
      .catch(function (err) { catalog = { status: 'error', data: null, error: W.errorMessage(err, 'Could not load the event catalog.') }; })
      .then(paintEvents);
  }

  // ── Create / edit ──
  var editing = null, seed = null, form = null, saving = false;
  function toState(w) {
    if (!w) return { name: '', description: '', url: '', events: [], tagsText: '', headerRows: [], filtersText: '', rateLimitText: '' };
    return { name: w.name, description: w.description || '', url: w.url, events: (w.events || []).slice(), tagsText: (w.tags || []).join(', '),
      headerRows: Object.keys(w.headers || {}).map(function (k) { return { key: k, value: w.headers[k] }; }),
      filtersText: w.eventFilters ? JSON.stringify(w.eventFilters, null, 2) : '', rateLimitText: w.rateLimitPerMinute != null ? String(w.rateLimitPerMinute) : '' };
  }
  var parseTags = function (t) { return t.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
  function headersOf(rows) { var o = {}; rows.forEach(function (r) { var k = r.key.trim(); if (k) o[k] = r.value; }); return o; }
  var sameList = function (a, b) { var x = a.slice().sort(), y = b.slice().sort(); return x.length === y.length && x.every(function (v, i) { return v === y[i]; }); };
  var sameHeaders = function (a, b) { var ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every(function (k) { return b[k] === a[k]; }); };

  function paintEvents() {
    var box = $('wh-events'); if (!box) return;
    if (catalog.status === 'error') { retry(box, catalog.error || 'Could not load the event catalog.', loadCatalog); return; }
    if (!caps.readEvents && catalog.status === 'idle') { box.innerHTML = '<p class="text-xs text-text-secondary">You cannot view the event catalog, so the events cannot be changed here.</p>'; return; }
    if (catalog.status !== 'ready') { box.innerHTML = '<div class="flex justify-center py-4" role="status"><i class="fa-solid fa-spinner fa-spin text-text-secondary" aria-hidden="true"></i></div>'; return; }
    var known = {}; catalog.data.forEach(function (g) { g.events.forEach(function (e) { known[e.event] = 1; }); });
    var orphaned = form ? form.events.filter(function (e) { return !known[e]; }) : [];
    var chip = function (sel) { return 'rounded-full border px-2.5 py-0.5 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' + (sel ? 'bg-primary text-primary-fg border-primary' : 'bg-surface-base text-text-secondary border-border hover:border-primary'); };
    box.innerHTML = '<div class="space-y-3 max-h-64 overflow-y-auto pr-1">' + catalog.data.map(function (g) {
      return '<div role="group"><p class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">' + esc(g.group) + '</p><div class="flex flex-wrap gap-2">' + g.events.map(function (e) {
        var sel = form && form.events.indexOf(e.event) >= 0;
        return '<button type="button" data-ev="' + esc(e.event) + '" title="' + esc(e.description) + '" aria-pressed="' + !!sel + '" class="' + chip(sel) + '">' + esc(e.event) + '</button>';
      }).join('') + '</div></div>';
    }).join('') + (orphaned.length ? '<div role="group"><p class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">No longer in the catalog</p><p class="text-xs text-text-secondary mb-1">No installed module declares these events any more, so they never fire. They stay subscribed until you remove them.</p><div class="flex flex-wrap gap-2">'
      + orphaned.map(function (e) { return '<span class="inline-flex items-center gap-1 rounded-full border border-warning bg-warning-subtle px-2.5 py-0.5 text-xs font-mono text-text-primary">' + esc(e) + '<button type="button" data-ev="' + esc(e) + '" aria-label="Remove ' + esc(e) + '" class="rounded text-text-secondary hover:text-error"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>'; }).join('') + '</div></div>' : '') + '</div>';
  }
  $('wh-events').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ev]'); if (!b || !form) return;
    var ev = b.getAttribute('data-ev'), i = form.events.indexOf(ev);
    if (i >= 0) form.events.splice(i, 1); else form.events.push(ev);
    paintEvents();
  });
  function paintHeaders() {
    var box = $('wh-headers'); $('wh-no-headers').classList.toggle('hidden', form.headerRows.length > 0);
    box.innerHTML = form.headerRows.map(function (r, i) {
      var inp = 'min-w-0 flex-1 rounded-md border border-border bg-surface-base px-3 py-2 text-sm font-mono text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
      return '<div class="flex items-center gap-2"><input data-hk="' + i + '" aria-label="Header ' + (i + 1) + ' name" placeholder="X-Custom-Header" value="' + esc(r.key) + '" class="' + inp + '"><input data-hv="' + i + '" aria-label="Header ' + (i + 1) + ' value" placeholder="value" value="' + esc(r.value) + '" class="' + inp + '">'
        + '<button type="button" data-hr="' + i + '" aria-label="Remove header ' + (i + 1) + '" class="text-text-secondary hover:text-error px-1 rounded"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>';
    }).join('');
  }
  $('wh-add-header').addEventListener('click', function () { form.headerRows.push({ key: '', value: '' }); paintHeaders(); });
  $('wh-headers').addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-hk'), v = e.target.getAttribute('data-hv');
    if (k != null) form.headerRows[Number(k)].key = e.target.value; if (v != null) form.headerRows[Number(v)].value = e.target.value;
  });
  $('wh-headers').addEventListener('click', function (e) { var r = e.target.closest('[data-hr]'); if (r) { form.headerRows.splice(Number(r.getAttribute('data-hr')), 1); paintHeaders(); } });

  function openForm(w) {
    editing = w; seed = toState(w); form = toState(w); saving = false;
    $('webhook-name').value = form.name; $('webhook-url').value = form.url; $('webhook-description').value = form.description;
    $('webhook-tags').value = form.tagsText; $('webhook-rate-limit').value = form.rateLimitText; $('webhook-filters').value = form.filtersText;
    setText('wh-form-title', w ? (isRoot ? 'Edit Platform Webhook' : 'Edit Webhook') : (isRoot ? 'New Platform Webhook' : 'New Webhook'));
    setText('wh-form-save', w ? 'Save' : 'Create'); window.AuthUi.clear($('wh-form-error')); paintHeaders();
    if (caps.readEvents) { if (catalog.status !== 'ready') loadCatalog(); else paintEvents(); } else { catalog = { status: 'idle', data: null, error: '' }; paintEvents(); }
    window.openModal('wh-form');
  }
  $('wh-form-save').addEventListener('click', function () {
    if (saving) return;
    var err = $('wh-form-error'); window.AuthUi.clear(err);
    form.name = $('webhook-name').value; form.url = $('webhook-url').value; form.description = $('webhook-description').value;
    form.tagsText = $('webhook-tags').value; form.rateLimitText = $('webhook-rate-limit').value; form.filtersText = $('webhook-filters').value;
    var fail = function (t) { say(err, 'error', t); };
    if (!form.name.trim()) return fail('Name is required.');
    if (!form.url.trim()) return fail('URL is required.');
    // Webhook endpoints are HTTPS only (decided 2026-10-20).
    if (!/^https:\/\//i.test(form.url.trim())) return fail('Webhook URL must be a valid HTTPS URL.');
    if (form.events.length === 0) return fail('Select at least one event.');
    var tags = parseTags(form.tagsText), headers = headersOf(form.headerRows), eventFilters;
    if (form.filtersText.trim()) { try { eventFilters = JSON.parse(form.filtersText); } catch (_e) { return fail('Event filters must be valid JSON.'); } }
    var rate = null;
    if (form.rateLimitText.trim()) { var n = parseInt(form.rateLimitText, 10); if (!isFinite(n) || n < 1) return fail('Rate limit must be a positive whole number.'); rate = n; }
    var payload = {};
    if (editing) {
      // An edit sends only what the person changed; an empty optional field is cleared (null) only when they emptied it.
      if (form.name !== seed.name) payload.name = form.name;
      if (form.description !== seed.description) payload.description = form.description;
      if (form.url !== seed.url) payload.url = form.url;
      if (!sameList(form.events, seed.events)) payload.events = form.events;
      if (!sameList(tags, parseTags(seed.tagsText))) payload.tags = tags.length ? tags : null;
      if (!sameHeaders(headers, headersOf(seed.headerRows))) payload.headers = Object.keys(headers).length ? headers : null;
      if (form.filtersText.trim() !== seed.filtersText.trim()) payload.eventFilters = eventFilters || null;
      if (form.rateLimitText.trim() !== seed.rateLimitText.trim()) payload.rateLimitPerMinute = rate;
    } else {
      payload = { name: form.name, description: form.description, url: form.url, events: form.events };
      if (tags.length) payload.tags = tags; if (Object.keys(headers).length) payload.headers = headers;
      if (eventFilters) payload.eventFilters = eventFilters; if (rate != null) payload.rateLimitPerMinute = rate;
    }
    saving = true; window.AuthUi.busy(this, true);
    var btn = this, req = editing ? (Object.keys(payload).length ? api.patch(base + '/' + encodeURIComponent(editing.webhookId), payload) : Promise.resolve(null)) : api.post(base, payload);
    req.then(function (res) {
      window.closeModal('wh-form'); list.reload();
      L.notice('success', editing ? 'Webhook updated.' : 'Webhook created.');
      // The signing secret is in the create answer only: shown once, after the form has closed, and not kept.
      var secret = !editing && res && res.data && typeof res.data.secret === 'string' ? res.data.secret : '';
      if (secret) W.showSecret(secret, 'created');
    }).catch(function (e) { fail(W.errorMessage(e, editing ? 'Failed to update.' : 'Failed to create.')); })
      .then(function () { saving = false; window.AuthUi.busy(btn, false); });
  });

  // ── Trigger ──
  var triggering = null;
  function openTrigger(w) {
    triggering = w; setText('wh-trigger-desc', 'Send a real event to "' + w.name + '" with a sample payload.'); window.AuthUi.clear($('wh-trigger-error'));
    $('wh-trigger-event').innerHTML = (w.events || []).map(function (e) { return '<option value="' + esc(e) + '">' + esc(e) + '</option>'; }).join('');
    $('wh-trigger-payload').value = '{}'; window.openModal('wh-trigger');
  }
  $('wh-trigger-send').addEventListener('click', function () {
    var w = triggering, err = $('wh-trigger-error'), btn = this; window.AuthUi.clear(err);
    var ev = $('wh-trigger-event').value; if (!ev) return say(err, 'error', 'Pick an event.');
    var text = $('wh-trigger-payload').value, payload = {};
    if (text.trim()) {
      var v; try { v = JSON.parse(text); } catch (_e) { return say(err, 'error', 'Payload must be valid JSON.'); }
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return say(err, 'error', 'The payload must be a JSON object ({ … }), not a list, a string or a number.');
      payload = v;
    }
    window.AuthUi.busy(btn, true);
    // The receiver cannot tell this from a real event except by its manual marker: say so before sending.
    window.confirmDialog({
      title: 'Send ' + ev + ' to ' + w.name, tone: 'warning', confirmLabel: 'Trigger',
      message: 'This sends a real, signed ' + ev + ' event to the live endpoint ' + w.url + '. Its body carries "manual": true and the request the header X-Webhook-Manual: true; otherwise the receiver sees it like any other event and may act on it.',
    }).then(function (ok) {
      if (!ok) return;
      return api.post(base + '/' + encodeURIComponent(w.webhookId) + '/trigger', { event: ev, payload: payload }).then(function () {
        window.closeModal('wh-trigger'); L.notice('success', 'Triggered ' + ev + '.');
      }, function (e) { say(err, 'error', W.errorMessage(e, 'Trigger failed.')); });
    }).then(function () { window.AuthUi.busy(btn, false); });
  });

  // ── Deliveries ──
  function openDeliveries(w) {
    setText('wh-deliveries-title', 'Deliveries — ' + w.name); setText('wh-deliveries-desc', w.url);
    W.deliveries($('wh-deliveries-body'), base, w, { canRedeliver: caps.redeliver, canReplay: caps.replayDeadLetters });
    window.openModal('wh-deliveries');
  }
  document.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c) window.closeModal(c.getAttribute('data-close')); });

  // ── Row actions ──
  var testing = {};
  function toggle(w) {
    var go = function () {
      return api.patch(base + '/' + encodeURIComponent(w.webhookId), { isActive: !w.isActive }).then(function () { list.reload(); L.notice('success', w.isActive ? 'Webhook disabled.' : 'Webhook enabled.'); });
    };
    // Disabling drops the events fired meanwhile and re-enabling resets the breaker: say so first.
    var ask = w.isActive ? window.confirmDialog({ title: 'Disable ' + w.name, tone: 'warning', confirmLabel: 'Disable',
      message: 'Events that happen while this endpoint is disabled are not delivered to it, not even later. Deliveries already queued stop too. Enabling it again resets its failure counter.' }) : Promise.resolve(true);
    ask.then(function (ok) { if (ok) return go(); }).catch(function (err) { L.notice('error', W.errorMessage(err, 'Failed to update webhook.')); });
  }
  function actions() {
    var inactive = function (w) { return !w.isActive; };
    return [
      caps.updateEndpoints && { id: 'edit', label: 'Edit', icon: 'fa-pen', onClick: openForm },
      caps.sendTest && { id: 'test', label: 'Send test event', icon: 'fa-flask', visible: function (w) { return w.isActive && !testing[w.webhookId]; }, onClick: function (w) { testing[w.webhookId] = true; W.sendTest(base, w.webhookId).then(function () { delete testing[w.webhookId]; }); } },
      caps.trigger && { id: 'trigger', label: 'Trigger event…', icon: 'fa-bolt', visible: function (w) { return !inactive(w); }, onClick: openTrigger },
      caps.readDeliveries && { id: 'deliveries', label: 'View deliveries', icon: 'fa-list-ul', onClick: openDeliveries },
      caps.rotateSecret && { id: 'rotate', label: 'Rotate signing secret', icon: 'fa-key', onClick: function (w) { W.rotateSecret(base, w).then(function (done) { if (done) list.reload(); }); } },
      caps.deleteEndpoints && { id: 'delete', label: 'Delete', icon: 'fa-trash', destructive: true, onClick: function (w) {
        window.confirmDialog({ title: isRoot ? 'Delete Platform Webhook' : 'Delete Webhook', tone: 'danger', confirmLabel: 'Delete',
          message: 'Delete ' + w.name + '? All delivery history will also be removed.',
          action: function () { return api.delete(base + '/' + encodeURIComponent(w.webhookId)); },
          errorMessage: function (err) { return W.errorMessage(err, 'Failed to delete webhook.'); } })
          .then(function (done) { if (done) { list.reload(); L.notice('success', 'Webhook deleted.'); } });
      } },
    ].filter(Boolean);
  }

  function start() {
    // The header: the settings gear only with the settings read, New only with the create.
    var bar = document.querySelector('#dl-page .flex.items-center.gap-2.shrink-0');
    var gear = bar && bar.querySelector('a[href$="/admin/webhooks/settings"]'); if (gear && !caps.readSettings) gear.remove();
    if (bar && caps.createEndpoints) bar.appendChild(btnPrimary('New Webhook', function () { openForm(null); }));
    if (caps.readMetrics) loadMetrics(); if (caps.readReports) loadReport();
    var yesNo = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
    list = L.mount($('dl-root'), {
      endpoint: base, pageBase: 1, caption: isRoot ? 'Platform Webhooks' : 'Webhooks',
      rows: function (b) { return b.data || b.webhooks || []; },
      sort: { key: 'createdAt', dir: 'desc' }, search: { placeholder: 'Search name, URL or description…' },
      filters: [{ id: 'isActive', label: 'Active', type: 'radio', options: yesNo }, { id: 'autoDisabled', label: 'Auto-disabled', type: 'radio', options: yesNo }],
      columns: [
        { key: 'name', header: 'Webhook', sortable: true, render: function (w) { return '<div class="min-w-0"><p class="font-semibold text-text-primary truncate">' + esc(w.name) + '</p><p class="text-xs text-text-secondary truncate max-w-md">' + esc(w.url) + '</p>' + (w.description ? '<p class="text-xs text-text-secondary mt-0.5 truncate max-w-md">' + esc(w.description) + '</p>' : '') + '</div>'; } },
        { key: 'events', header: 'Events', hide: 'md', render: function (w) { return L.badge('neutral', F.num(w.events.length) + ' event' + (w.events.length !== 1 ? 's' : '')); } },
        { key: 'consecutiveFailures', header: 'Failures in a row', sortable: true, align: 'right', hide: 'lg', render: function (w) { return '<span class="tabular-nums text-text-secondary">' + F.num(w.consecutiveFailures || 0) + '</span>'; } },
        { key: 'isActive', header: 'Active', sortable: true, render: function (w) {
          var off = !caps.updateEndpoints;
          return '<div class="flex items-center gap-2"><button type="button" role="switch" data-act="toggle" aria-checked="' + !!w.isActive + '" aria-label="Active: ' + esc(w.name) + '"' + (off ? ' disabled' : '') + ' class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' + (w.isActive ? 'bg-primary' : 'bg-surface-sunken border border-border') + '"><span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ' + (w.isActive ? 'translate-x-4' : 'translate-x-0.5') + '"></span></button>'
            + (!w.isActive && w.autoDisabledAt ? '<span title="Auto-disabled after ' + F.num(w.consecutiveFailures || 0) + ' consecutive failures. Toggle on to re-enable.">' + L.badge('error', 'Auto-disabled') + '</span>' : '') + '</div>';
        } },
      ],
      onCellAction: function (act, w) { if (act === 'toggle') toggle(w); },
      rowActions: actions(),
      onRowClick: function (w) { window.location.href = tp('/admin/webhooks/' + w.webhookId); },
      empty: 'No webhooks yet.',
    });
  }
  // Nothing is offered until the server answers, and nothing if it never does.
  api.get(base + '/capabilities').then(function (res) {
    var c = res && res.data && res.data.capabilities || {}; caps = Object.assign({}, NONE);
    Object.keys(NONE).forEach(function (k) { caps[k] = c[k] === true; });
  }, function () { caps = NONE; }).then(start);
})();
