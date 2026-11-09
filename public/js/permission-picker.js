// The API key permission picker (the port of api_key/ui/api-key-permission-picker.component.tsx): a module checkbox selects all of the
// module's permissions (indeterminate when some are on), a module expands to its single permissions, "Read only" selects exactly the
// reading ones, and a search narrows modules and permissions. `kept` are permissions the key holds that the catalogue does not offer
// this admin: listed so they can be removed, never added back.
//
//   var picker = KuiPermissionPicker.mount(el, { modules: [{ moduleId, name, permissions: [{ id, name, readOnly }] }], value: ['id'], kept: [], onChange(set) {} });
//   picker.value() -> string[]    picker.set(ids)    picker.setModules(modules)
(function () {
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var uid = 0;
  function mount(el, o) {
    var id = 'kpp' + (++uid), modules = o.modules || null, value = new Set(o.value || []), kept = o.kept || [], query = '', open = {}, disabled = false;

    function offered() { var s = {}; (modules || []).forEach(function (m) { m.permissions.forEach(function (p) { s[p.id] = 1; }); }); return s; }
    function draw(keepFocus) {
      if (modules === null) { el.innerHTML = '<div class="flex justify-center py-6" role="status"><i class="fa-solid fa-spinner fa-spin text-text-secondary" aria-hidden="true"></i></div>'; return; }
      var q = query.trim().toLowerCase();
      var visible = modules.map(function (m) {
        if (!q) return { m: m, shown: m.permissions };
        var hit = m.name.toLowerCase().indexOf(q) >= 0 || m.moduleId.indexOf(q) >= 0;
        return { m: m, shown: hit ? m.permissions : m.permissions.filter(function (p) { return [p.name, p.id].some(function (v) { return String(v).toLowerCase().indexOf(q) >= 0; }); }) };
      }).filter(function (v) { return v.shown.length > 0; });
      var off = offered(), keptOutside = kept.filter(function (k) { return !off[k] && value.has(k); });
      var rows = visible.map(function (v) {
        var m = v.m, ids = m.permissions.map(function (p) { return p.id; }), readIds = m.permissions.filter(function (p) { return p.readOnly; }).map(function (p) { return p.id; });
        var on = ids.filter(function (x) { return value.has(x); }).length, isOpen = open[m.moduleId] || q.length > 0;
        var readSel = readIds.length > 0 && on === readIds.length && readIds.every(function (x) { return value.has(x); });
        return '<div role="listitem" class="rounded border border-border" data-m="' + esc(m.moduleId) + '"><div class="flex items-center gap-2 px-2 py-1.5">'
          + '<button type="button" data-toggle-open class="w-5 text-text-secondary hover:text-text-primary" aria-expanded="' + !!isOpen + '" aria-label="' + (isOpen ? 'Hide' : 'Show') + ' the permissions of ' + esc(m.name) + '"><i class="fa-solid ' + (isOpen ? 'fa-chevron-down' : 'fa-chevron-right') + ' text-xs" aria-hidden="true"></i></button>'
          + '<label class="flex flex-1 items-center gap-2 text-sm text-text-primary cursor-pointer"><input type="checkbox" data-mod class="rounded border-border accent-primary" id="' + id + '-' + esc(m.moduleId) + '"' + (on === ids.length && ids.length ? ' checked' : '') + (disabled ? ' disabled' : '') + ' data-indeterminate="' + (on > 0 && on < ids.length) + '">' + esc(m.name) + '</label>'
          + '<span class="text-xs text-text-secondary">' + on + '/' + ids.length + '</span>'
          + (readIds.length ? '<button type="button" data-read class="text-xs ' + (readSel ? 'font-medium text-text-primary' : 'text-primary hover:underline') + '" aria-pressed="' + readSel + '"' + (disabled ? ' disabled' : '') + '>Read only</button>' : '') + '</div>'
          + (isOpen ? '<div class="space-y-1 border-t border-border px-2 py-1.5 pl-9">' + v.shown.map(function (p) {
            return '<label class="flex items-start gap-2 text-sm text-text-primary cursor-pointer"><input type="checkbox" data-perm="' + esc(p.id) + '" class="mt-0.5 rounded border-border accent-primary"' + (value.has(p.id) ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>' + esc(p.name) + '<span class="block text-xs text-text-secondary font-mono">' + esc(p.id) + '</span></span></label>';
          }).join('') + '</div>' : '') + '</div>';
      }).join('');
      var focused = keepFocus && document.activeElement && document.activeElement.hasAttribute('data-q');
      el.innerHTML = '<div class="space-y-3"><div class="flex items-center justify-between gap-3"><span class="text-sm font-medium text-text-primary">Module permissions</span>'
        + '<span class="inline-flex items-center rounded-full font-medium bg-surface-sunken text-text-secondary px-1.5 py-0 text-[10px]">' + value.size + ' selected</span></div>'
        + '<p class="text-xs text-text-secondary">The key can do at most what you can do. If your own rights shrink later, the key loses them too.</p>'
        + '<input type="search" data-q aria-label="Search modules or permissions" placeholder="Search modules or permissions…" value="' + esc(query) + '" class="block w-full rounded-md border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">'
        + '<div class="max-h-80 space-y-1 overflow-y-auto pr-1" role="list" aria-label="Module permissions">'
        + (modules.length === 0 ? '<p class="py-6 text-center text-sm text-text-secondary">There is no module permission you can give a key.</p>' : '')
        + (modules.length > 0 && visible.length === 0 ? '<p class="py-6 text-center text-sm text-text-secondary">No module or permission matches that search.</p>' : '') + rows + '</div>'
        + (keptOutside.length ? '<div class="rounded border border-border p-2"><p class="mb-1 text-xs text-text-secondary">Held by the key but not yours to give (or their module is off): they work only while the key\'s owner holds them. You can remove them.</p><div class="space-y-1">'
          + keptOutside.map(function (k) { return '<label class="flex items-center gap-2 text-sm text-text-primary cursor-pointer"><input type="checkbox" data-perm="' + esc(k) + '" checked class="rounded border-border accent-primary"' + (disabled ? ' disabled' : '') + '>' + esc(k) + '</label>'; }).join('') + '</div></div>' : '') + '</div>';
      [].slice.call(el.querySelectorAll('[data-indeterminate="true"]')).forEach(function (c) { c.indeterminate = true; });
      if (focused) { var s = el.querySelector('[data-q]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
    function changed() { if (o.onChange) o.onChange(new Set(value)); }
    function mod(target) { return (modules || []).filter(function (m) { return m.moduleId === target.closest('[data-m]').getAttribute('data-m'); })[0]; }
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-toggle-open]');
      if (t) { var m = mod(t); open[m.moduleId] = !open[m.moduleId]; draw(); return; }
      var r = e.target.closest('[data-read]');
      if (r) {
        var rm = mod(r), ids = rm.permissions.map(function (p) { return p.id; });
        ids.forEach(function (x) { value.delete(x); });
        rm.permissions.filter(function (p) { return p.readOnly; }).forEach(function (p) { value.add(p.id); });
        draw(); changed();
      }
    });
    el.addEventListener('change', function (e) {
      var c = e.target;
      if (c.hasAttribute('data-mod')) {
        var m = mod(c), ids = m.permissions.map(function (p) { return p.id; }), on = ids.filter(function (x) { return value.has(x); }).length;
        ids.forEach(function (x) { value.delete(x); });
        if (on < ids.length) ids.forEach(function (x) { value.add(x); });
        draw(); changed();
      } else if (c.hasAttribute('data-perm')) {
        var p = c.getAttribute('data-perm'); if (value.has(p)) value.delete(p); else value.add(p);
        draw(); changed();
      }
    });
    el.addEventListener('input', function (e) { if (e.target.hasAttribute('data-q')) { query = e.target.value; draw(true); } });
    draw();
    return {
      value: function () { return Array.from(value); },
      set: function (ids) { value = new Set(ids || []); draw(); },
      setModules: function (ms) { modules = ms; draw(); },
      setKept: function (k) { kept = k || []; draw(); },
      setDisabled: function (d) { disabled = !!d; draw(); },
    };
  }
  window.KuiPermissionPicker = { mount: mount };
})();
