// /admin/audit-logs (audit_log/ui/audit-logs.page.tsx). The root tenant reads the merged cross-tenant view; others their own trail (1-based pages).
(function () {
  var K = window.Kui, L = window.KuiList, esc = L.esc;
  var page = document.getElementById('dl-page'), tenantId = page.getAttribute('data-tenant-id'), isRoot = page.getAttribute('data-root') === '1';
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var SEVERITY = { low: 'neutral', medium: 'info', high: 'warning', critical: 'error' };
  var filters = [
    { id: 'severity', label: 'Severity', type: 'radio', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }] },
    { id: 'created', label: 'Date range', type: 'daterange' },
  ];
  var tenantFilter = { id: 'filterTenantId', label: 'Tenant', type: 'select', options: [] };
  if (isRoot) filters.unshift(tenantFilter);

  function two(top, bottom) { return '<div class="flex flex-col"><span class="text-text-primary">' + esc(top) + '</span><span class="font-mono text-[11px] text-text-secondary">' + esc(bottom) + '</span></div>'; }
  var columns = [];
  if (isRoot) columns.push({ key: 'tenant', header: 'Tenant', render: function (r) { return '<span class="text-text-primary truncate">' + esc(r.tenant && r.tenant.name || r.tenantId) + '</span>'; } });
  columns.push(
    { key: 'createdAt', header: 'Time', sortable: true, render: function (r) { return '<span class="text-text-secondary whitespace-nowrap">' + esc(L.when(r.createdAt)) + '</span>'; } },
    { key: 'action', header: 'Action', sortable: !isRoot, render: function (r) { return '<span class="font-mono text-xs text-text-primary">' + esc(r.action) + '</span>'; } },
    { key: 'severity', header: 'Severity', render: function (r) { return L.badge(SEVERITY[r.severity] || 'neutral', r.severity, { dot: true }); } },
    { key: 'actorType', header: 'Actor', hide: 'md', render: function (r) { return two(r.actorType, L.shortId(r.actorId || r.actorRef)); } },
    { key: 'resourceType', header: 'Resource', sortable: !isRoot, hide: 'md', render: function (r) { return r.resourceType ? two(r.resourceType, L.shortId(r.resourceId)) : '<span class="text-text-secondary">—</span>'; } },
    { key: 'ipAddress', header: 'IP', hide: 'lg', render: function (r) { return '<span class="font-mono text-xs text-text-secondary">' + esc(r.ipAddress || '—') + '</span>'; } }
  );

  function row(label, value, mono) {
    return '<div class="flex flex-col gap-0.5"><span class="text-xs font-semibold text-text-secondary uppercase tracking-wider">' + esc(label) + '</span><span class="' + (mono ? 'font-mono text-xs break-all ' : '') + 'text-text-primary">' + esc(value == null || value === '' ? '—' : value) + '</span></div>';
  }
  function detail(r) {
    var meta = r.metadata && Object.keys(r.metadata).length ? '<pre class="text-xs bg-surface-sunken rounded-lg p-3 overflow-x-auto text-text-primary">' + esc(JSON.stringify(r.metadata, null, 2)) + '</pre>' : '<p class="text-text-secondary">—</p>';
    return '<div class="flex items-center gap-2">' + L.badge(SEVERITY[r.severity] || 'neutral', r.severity, { dot: true }) + '<span class="font-mono text-xs text-text-primary">' + esc(r.action) + '</span></div>'
      + (isRoot ? row('Tenant', r.tenant && r.tenant.name || r.tenantId) : '') + row('Time', L.when(r.createdAt)) + row('Actor type', r.actorType) + row('Actor ID', r.actorId, true)
      + (r.onBehalfOfActorId ? row('On behalf of', r.onBehalfOfActorId, true) : '') + row('Resource type', r.resourceType) + row('Resource ID', r.resourceId, true)
      + row('IP address', r.ipAddress, true) + row('User agent', r.userAgent)
      + '<div><p class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Metadata</p>' + meta + '</div>'
      + '<div class="space-y-3"><p class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Integrity (hash chain)</p>' + row('Row hash', r.rowHash, true) + row('Prev hash', r.prevHash, true) + '</div>'
      + row('Audit log ID', r.auditLogId, true);
  }

  // The export follows the date filter of the table.
  var exportLink = document.querySelector('a[href*="/api/audit-logs/export"]');
  function exportHref(f) {
    var qs = new URLSearchParams({ format: 'csv' }), c = f.created;
    if (c && c.from) qs.set('fromDate', c.from + 'T00:00:00.000Z');
    if (c && c.to) qs.set('toDate', c.to + 'T23:59:59.999Z');
    return tp('/api/audit-logs/export?' + qs.toString());
  }
  if (exportLink) exportLink.href = exportHref({});

  var list = L.mount(document.getElementById('dl-root'), {
    endpoint: tp(isRoot ? '/api/audit-logs/cross-tenant' : '/api/audit-logs'), pageBase: 1, caption: 'Audit Logs',
    rows: function (b) { return b.logs || []; },
    columns: columns, filters: filters, search: { placeholder: 'Search action, e.g. auth.login' },
    sort: { key: 'createdAt', dir: 'desc' },
    onFilters: function (f) { if (exportLink) exportLink.href = exportHref(f); },
    onRowClick: function (r) { document.getElementById('dl-drawer-body').innerHTML = detail(r); window.openDrawer('dl-drawer'); },
    empty: 'No audit logs recorded yet.',
  });
  // The tenant filter (root only): every tenant by name. The select is drawn empty and filled when the list arrives.
  if (isRoot) K.api.get(tp('/api/tenants'), { params: { pageSize: 200 } }).then(function (res) {
    var sel = document.querySelector('[data-f="filterTenantId"]');
    ((res.data && res.data.tenants) || []).forEach(function (t) { var o = document.createElement('option'); o.value = t.tenantId; o.textContent = t.name; sel.appendChild(o); });
  }).catch(function () {});
})();
