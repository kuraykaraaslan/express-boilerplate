// /admin/api-keys (api_key/ui/api-keys.page.tsx, api-key-columns, api-key-create-modal). Server paging, sort and filters; 1-based API.
(function () {
  var K = window.Kui, L = window.KuiList, esc = L.esc, api = K.api;
  var page = document.getElementById('dl-page'), tenantId = page.getAttribute('data-tenant-id');
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  function errText(err, fallback) { var m = err && err.response && err.response.data && err.response.data.message; return typeof m === 'string' && m ? m : (err && err.message) || fallback; }
  var SCOPE_LABEL = { read: 'Read', write: 'Write', admin: 'Admin', 'scim:read': 'SCIM Read', 'scim:write': 'SCIM Write' };
  var SCOPE_TONE = { read: 'primary', write: 'warning', admin: 'error', 'scim:read': 'primary', 'scim:write': 'warning' };
  function date(v) { return v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; }
  function status(k) {
    if (k.successorKeyId) return ['info', 'Rotated'];
    if (!k.isActive) return ['neutral', 'Inactive'];
    if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return ['warning', 'Expired'];
    return ['success', 'Active'];
  }
  function sw(k) {
    return '<button type="button" role="switch" data-act="toggle" aria-checked="' + !!k.isActive + '" aria-label="Active: ' + esc(k.name) + '" class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus '
      + (k.isActive ? 'bg-primary' : 'bg-surface-sunken border border-border') + '"><span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ' + (k.isActive ? 'translate-x-4' : 'translate-x-0.5') + '"></span></button>';
  }

  // The keys an admin should narrow (phase 48 D14) and the banner that filters the list to them.
  var onlyReview = false, reviewCount = 0, list;
  var banner = document.createElement('div'); banner.className = 'hidden'; banner.setAttribute('role', 'status');
  $('dl-root').parentNode.insertBefore(banner, $('dl-root'));
  function paintBanner() {
    if (reviewCount <= 0 && !onlyReview) { banner.className = 'hidden'; return; }
    banner.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm bg-warning-subtle border-warning text-warning-fg';
    banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" aria-hidden="true"></i><div class="flex-1"><p class="font-medium">Review the scope of older keys</p><p></p></div><button type="button" class="shrink-0 underline underline-offset-2"></button>';
    banner.querySelector('p:last-child').textContent = reviewCount + ' active keys were created before keys had per-module permissions. They keep working with their integration scopes; open each one, give it only the module permissions it needs, or mark it reviewed.';
    var b = banner.querySelector('button'); b.textContent = onlyReview ? 'Show all keys' : 'Show them';
    b.onclick = function () { onlyReview = !onlyReview; list.setParams(onlyReview ? { scopeReview: 'true' } : {}); paintBanner(); };
  }

  // ── Create ──
  var MAX_TTL = 365, DEFAULT_TTL = 90, DAY = 86400000, picker = null, capDays = MAX_TTL;
  function dateInput(d) { return new Date(Date.now() + d * DAY).toISOString().slice(0, 10); }
  function lastDay(cap) { return Math.max(0, cap - 1); }
  function setExpiryBounds() {
    var el = $('key-expiry'); el.min = dateInput(Math.min(1, lastDay(capDays))); el.max = dateInput(lastDay(capDays));
    if (!el.value || el.value > el.max) el.value = dateInput(Math.min(DEFAULT_TTL, lastDay(capDays)));
  }
  function openCreate() {
    $('key-name').value = ''; $('key-description').value = ''; $('key-ip-allowlist').value = '';
    [].slice.call(document.querySelectorAll('[data-scope]')).forEach(function (c) { c.checked = false; });
    $('ak-scopes').classList.add('hidden'); $('ak-scopes-toggle').setAttribute('aria-expanded', 'false');
    window.AuthUi.clear($('ak-create-error')); window.AuthUi.clear($('ak-catalog-error'));
    $('key-expiry').value = ''; setExpiryBounds();
    picker = window.KuiPermissionPicker.mount($('ak-picker'), { modules: null, value: [] });
    window.openModal('ak-create');
    // Read again each time the dialog opens (the admin's own rights may have changed).
    api.get(tp('/api/api-keys/permission-catalog')).then(function (res) {
      picker.setModules(res.data && res.data.modules || []);
      var m = res.data && res.data.maxTtlDays; capDays = Math.min(typeof m === 'number' && m > 0 ? m : MAX_TTL, MAX_TTL); setExpiryBounds();
    }).catch(function (err) {
      picker.setModules([]); window.AuthUi.say($('ak-catalog-error'), 'info', errText(err, 'Failed to load the permissions you can give.'));
    });
  }
  $('ak-scopes-toggle').addEventListener('click', function () {
    var open = $('ak-scopes').classList.toggle('hidden') === false;
    this.setAttribute('aria-expanded', String(open)); this.querySelector('i').className = 'fa-solid text-xs ' + (open ? 'fa-chevron-down' : 'fa-chevron-right');
  });
  $('ak-create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('key-name').value.trim(); if (!name) return;
    var perms = picker.value(), scopes = [].slice.call(document.querySelectorAll('[data-scope]:checked')).map(function (c) { return c.getAttribute('data-scope'); });
    var err = $('ak-create-error'); window.AuthUi.clear(err);
    if (!perms.length && !scopes.length) { window.AuthUi.say(err, 'error', 'Select at least one module permission or integration scope.'); return; }
    var expiry = $('key-expiry').value; if (!expiry) { window.AuthUi.say(err, 'error', 'Choose an expiry date.'); return; }
    var payload = { name: name, permissions: perms, scopes: scopes, expiresAt: new Date(expiry + 'T23:59:59.000Z').toISOString() };
    var desc = $('key-description').value.trim(); if (desc) payload.description = desc;
    var ips = $('key-ip-allowlist').value.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean); if (ips.length) payload.ipAllowlist = ips;
    var btn = $('ak-create-submit'); window.AuthUi.busy(btn, true);
    // A new key is minted under the creator's step-up when they hold a factor (the route asks).
    window.KuiStepUp.run(tenantId, function (headers) { return api.post(tp('/api/api-keys'), payload, { headers: headers }); }).then(function (res) {
      window.closeModal('ak-create'); list.reload();
      $('ak-reveal-key').textContent = res.data.rawKey; $('ak-copied').classList.add('hidden'); window.openModal('ak-reveal');
    }).catch(function (e2) { if (!K.isStepUpCancelled(e2)) window.AuthUi.say(err, 'error', errText(e2, 'Failed to create key.')); })
      .then(function () { window.AuthUi.busy(btn, false); });
  });
  $('ak-copy').addEventListener('click', function () {
    navigator.clipboard.writeText($('ak-reveal-key').textContent).then(function () { $('ak-copied').classList.remove('hidden'); setTimeout(function () { $('ak-copied').classList.add('hidden'); }, 2000); });
  });
  document.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c) { window.closeModal(c.getAttribute('data-close')); if (c.getAttribute('data-close') === 'ak-reveal') $('ak-reveal-key').textContent = ''; } });

  // The page header's New API Key button.
  var actions = document.querySelector('#dl-page .flex.items-center.gap-2.shrink-0');
  if (actions) {
    var nb = document.createElement('button'); nb.type = 'button';
    nb.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-primary text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
    nb.textContent = 'New API Key'; nb.addEventListener('click', openCreate); actions.appendChild(nb);
  }

  list = L.mount($('dl-root'), {
    endpoint: tp('/api/api-keys'), pageBase: 1, caption: 'API Keys',
    // Each key with its owner's email, from the answer's `owners` map: the creator, or for a service key whose creator left, the OWNER who marked it.
    rows: function (b) {
      return (b.keys || []).map(function (k) {
        var o = b.owners || {};
        return Object.assign({}, k, { ownerLabel: o[k.createdByUserId] || (k.isServiceKey && k.serviceKeyMarkedByUserId ? o[k.serviceKeyMarkedByUserId] : null) || null });
      });
    },
    onResponse: function (b) { reviewCount = Number(b.reviewCount || 0); paintBanner(); },
    sort: { key: 'createdAt', dir: 'desc' },
    search: { placeholder: 'Search name or description…' },
    filters: [
      { id: 'isActive', label: 'Active', type: 'radio', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
      { id: 'environment', label: 'Environment', type: 'multiselect', options: [{ value: 'live', label: 'Live' }, { value: 'test', label: 'Test' }] },
    ],
    columns: [
      { key: 'name', header: 'Name', sortable: true, render: function (k) { return '<div class="min-w-0"><p class="font-medium text-text-primary truncate">' + esc(k.name) + '</p>' + (k.description ? '<p class="text-xs text-text-secondary mt-0.5 truncate max-w-xs">' + esc(k.description) + '</p>' : '') + '</div>'; } },
      { key: 'scopes', header: 'Access', hide: 'md', render: function (k) {
        return '<div class="flex flex-wrap gap-1">' + ((k.permissions || []).length ? L.badge('primary', k.permissions.length + ' permissions', { sm: true }) : '')
          + (k.scopes || []).map(function (s) { return L.badge(SCOPE_TONE[s] || 'neutral', SCOPE_LABEL[s] || s, { sm: true }); }).join('') + (k.scopeReview ? L.badge('warning', 'Review scope', { sm: true }) : '') + '</div>';
      } },
      { key: 'owner', header: 'Owner', hide: 'lg', render: function (k) { return '<span class="text-text-secondary text-xs">' + esc(k.ownerLabel || 'Not a member') + '</span>'; } },
      { key: 'lastUsedAt', header: 'Last used', sortable: true, hide: 'sm', render: function (k) { return '<span class="text-text-secondary text-xs">' + esc(date(k.lastUsedAt)) + '</span>'; } },
      { key: 'expiresAt', header: 'Expires', sortable: true, hide: 'lg', render: function (k) { return '<span class="text-text-secondary text-xs">' + esc(date(k.expiresAt)) + '</span>'; } },
      { key: 'status', header: 'Status', render: function (k) { var s = status(k); return L.badge(s[0], s[1], { sm: true }); } },
      { key: 'isActive', header: 'Active', sortable: true, render: sw },
    ],
    onCellAction: function (act, k) {
      if (act !== 'toggle') return;
      api.put(tp('/api/api-keys/' + encodeURIComponent(k.apiKeyId)), { isActive: !k.isActive }).then(function () {
        list.reload(); L.notice('success', k.isActive ? 'Key deactivated.' : 'Key activated.');
      }).catch(function (err) { L.notice('error', errText(err, 'Failed to update key.')); });
    },
    rowActions: [{
      id: 'revoke', label: 'Revoke', icon: 'fa-trash', destructive: true,
      onClick: function (k) {
        window.confirmDialog({
          title: 'Revoke API Key', tone: 'danger', confirmLabel: 'Revoke Key',
          message: 'Permanently revoke "' + k.name + '"? Any integrations using this key will immediately stop working. This action cannot be undone.',
          action: function () { return api.delete(tp('/api/api-keys/' + encodeURIComponent(k.apiKeyId))); },
          errorMessage: function (err) { return errText(err, 'Failed to revoke key.'); },
        }).then(function (done) { if (done) { list.reload(); L.notice('success', 'Key revoked.'); } });
      },
    }],
    onRowClick: function (k) { window.location.href = tp('/admin/api-keys/' + k.apiKeyId); },
    empty: 'No API keys yet.',
  });
})();
