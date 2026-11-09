// Behaviour of views/admin/account-me.ejs; the port of account/ui/me.page.tsx and the panels it composes (UserProfileForm,
// UserPreferencesForm, ActiveSessionsPanel, TrustedDevicesTable, SocialAccountsPanel). Every save sends only the fields that changed.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var root = document.getElementById('am-root');
  var tenantId = root.getAttribute('data-tenant-id');
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var T = U.t;
  var SUCCESS_MS = 4000;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function errText(err, fallback) { return U.errorText(err, fallback); }
  function isValidation(err) { return !!(err && err.response && err.response.status === 400); }
  function when(iso) { return iso ? new Date(iso).toLocaleString() : ''; }
  var UNITS = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
  function ago(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    var rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (var i = 0; i < UNITS.length; i++) if (Math.abs(diff) >= UNITS[i][1]) return rtf.format(Math.round(diff / UNITS[i][1]), UNITS[i][0]);
    return rtf.format(0, 'second');
  }

  // ── Banners ────────────────────────────────────────────────────────────────────────────────────────────────────────
  var noticeTimer = null;
  function notice(kind, text) {
    var el = $('am-notice');
    clearTimeout(noticeTimer);
    U.say(el, kind, text);
    if (kind === 'success') noticeTimer = setTimeout(function () { U.clear(el); }, SUCCESS_MS);
  }
  function retryBanner(el, text, onRetry) {
    U.say(el, 'error', text);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'shrink-0 ml-auto underline underline-offset-2'; b.textContent = T('account.me.retry', 'Retry');
    b.addEventListener('click', onRetry);
    el.appendChild(b);
  }

  // ── Badges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  var TONE = { success: 'bg-success-subtle text-success-fg', warning: 'bg-warning-subtle text-warning-fg', neutral: 'bg-surface-sunken text-text-secondary', primary: 'bg-primary-subtle text-primary', info: 'bg-info-subtle text-info-fg' };
  var DOT = { success: 'bg-success', warning: 'bg-warning', neutral: 'bg-text-disabled', primary: 'bg-primary', info: 'bg-info' };
  function badge(variant, text, o) {
    o = o || {};
    return '<span class="inline-flex items-center gap-1 rounded-full font-medium ' + (TONE[variant] || TONE.neutral) + ' ' + (o.sm ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs') + '">'
      + (o.dot ? '<span class="h-1.5 w-1.5 rounded-full shrink-0 ' + (DOT[variant] || DOT.neutral) + '" aria-hidden="true"></span>' : '') + esc(text) + '</span>';
  }
  var ROLE_VARIANT = { OWNER: 'success', ADMIN: 'warning', USER: 'neutral' };
  var GLOBAL_ROLE = { ADMIN: ['primary', 'Admin'], USER: ['neutral', 'User'] };

  // ── Selects (kui Select is server-drawn: a native <select>, or a combobox with a hidden value) ──────────────────────
  function comboRoot(id) { return document.querySelector('[data-combobox-id="' + id + '"]'); }
  function getSelect(id) {
    var c = comboRoot(id);
    if (c) return c.querySelector('[data-combobox-value]').value;
    var s = $(id); return s ? s.value : '';
  }
  function setSelect(id, value) {
    var c = comboRoot(id);
    if (c) {
      var opts = c.querySelectorAll('[data-combobox-option]'), hit = null;
      for (var i = 0; i < opts.length; i++) if (opts[i].getAttribute('data-combobox-option') === String(value)) { hit = opts[i]; break; }
      if (hit) hit.click();
      return;
    }
    var s = $(id); if (s) s.value = value;
  }
  function getToggle(id) { var el = $(id); return !!(el && el.checked); }
  function setToggle(id, on) {
    var r = document.querySelector('[data-toggle-root="' + id + '"]');
    if (r && r.__toggle && r.__toggle.setChecked) r.__toggle.setChecked(!!on); else if ($(id)) $(id).checked = !!on;
  }
  function submitBtn(form) { return form.querySelector('button[type=submit]'); }
  function setDisabled(btn, off) { if (btn) btn.disabled = off; }

  // ── A small table (the kui plain Table's look): sortable headers, an optional name filter, row buttons ────────────────
  var HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };
  function table(container, o) {
    var rows = [], sort = o.sort || null, query = '';
    function sorted() {
      var out = rows.filter(function (r) { return !query || String(o.searchOf(r)).toLowerCase().indexOf(query) >= 0; });
      if (!sort) return out;
      var col = o.columns.filter(function (c) { return c.key === sort.key; })[0];
      var val = function (r) { var v = col && col.value ? col.value(r) : r[sort.key]; return v == null ? '' : v; };
      return out.slice().sort(function (a, b) {
        var x = val(a), y = val(b), cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return sort.dir === 'desc' ? -cmp : cmp;
      });
    }
    function draw() {
      var list = sorted();
      var head = o.columns.map(function (c) {
        var cls = 'px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider ' + (c.align === 'right' ? 'text-right' : 'text-left') + (c.hide ? ' ' + HIDE[c.hide] : '') + (c.sortable ? ' cursor-pointer select-none hover:text-text-primary transition-colors' : '');
        var icon = c.sortable ? '<i class="fa-solid ' + (sort && sort.key === c.key ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort') + ' w-2.5 h-2.5" aria-hidden="true"></i>' : '';
        return '<th scope="col" class="' + cls + '"' + (c.sortable ? ' data-sort="' + esc(c.key) + '" aria-sort="' + (sort && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' : '') + '><span class="inline-flex items-center gap-1">' + (c.header || '') + icon + '</span></th>';
      }).join('');
      var body = list.length === 0
        ? '<tr><td colspan="' + o.columns.length + '" class="px-4 py-8 text-center text-text-secondary">' + o.empty + '</td></tr>'
        : list.map(function (r) {
          return '<tr class="hover:bg-surface-overlay transition-colors" data-row="' + esc(o.rowId(r)) + '">' + o.columns.map(function (c) {
            return '<td class="px-4 py-3 text-text-primary' + (c.align === 'right' ? ' text-right' : '') + (c.hide ? ' ' + HIDE[c.hide] : '') + '">' + c.render(r) + '</td>';
          }).join('') + '</tr>';
        }).join('');
      var search = o.searchOf && rows.length > 5
        ? '<div class="mb-3"><input type="search" data-search placeholder="Search" aria-label="Search" value="' + esc(query) + '" class="block w-full max-w-xs rounded-md border border-border bg-surface-base px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"></div>' : '';
      var focused = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-search');
      container.innerHTML = search + '<div class="w-full overflow-x-auto rounded-lg border border-border" role="region" aria-label="' + esc(o.caption) + '"><table class="w-full text-sm"><caption class="sr-only">' + esc(o.caption) + '</caption>'
        + '<thead class="bg-surface-sunken border-b border-border"><tr>' + head + '</tr></thead><tbody class="divide-y divide-border bg-surface-base">' + body + '</tbody></table></div>';
      if (focused) { var s = container.querySelector('[data-search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    }
    container.addEventListener('click', function (e) {
      var th = e.target.closest('[data-sort]');
      if (th) {
        var key = th.getAttribute('data-sort');
        sort = sort && sort.key === key ? { key: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: key, dir: 'asc' };
        draw(); return;
      }
      var btn = e.target.closest('[data-act]');
      if (btn && !btn.disabled) o.onAction(btn.getAttribute('data-act'), btn.closest('[data-row]').getAttribute('data-row'));
    });
    container.addEventListener('input', function (e) { if (e.target.hasAttribute('data-search')) { query = e.target.value.trim().toLowerCase(); draw(); } });
    return { set: function (r) { rows = r; draw(); }, redraw: draw };
  }
  function rowButton(act, label, icon, cls, disabled) {
    return '<button type="button" data-act="' + act + '"' + (disabled ? ' disabled' : '') + ' class="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 shrink-0 ' + cls + '"><i class="fa-solid ' + icon + ' w-3 h-3 mr-1.5" aria-hidden="true"></i>' + esc(label) + '</button>';
  }
  var DANGER_OUTLINE = 'border border-error text-error hover:bg-error-subtle';

  // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  var memberRole = null, currentSessionId = null, sessions = [];
  var profileStart = { name: null, biography: null, profilePicture: null }, profileValues = {};
  var prefsStart = null;

  // ── Profile ────────────────────────────────────────────────────────────────────────────────────────────────────────
  var BIO_MAX = 300;
  var pForm = $('am-profile-form'), pSave = submitBtn(pForm);
  function initials(n) { return (n || '').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase() || '?'; }
  function profileChanges() {
    var out = {};
    ['name', 'biography', 'profilePicture'].forEach(function (k) { if (profileValues[k] !== profileStart[k]) out[k] = profileValues[k]; });
    return out;
  }
  function paintAvatar() {
    var src = profileValues.profilePicture, img = $('am-avatar-img'), fb = $('am-avatar-fallback');
    img.classList.toggle('hidden', !src); fb.classList.toggle('hidden', !!src);
    if (src) img.src = src;
    fb.textContent = initials(profileValues.name || 'User');
    $('am-avatar-remove').classList.toggle('hidden', !src); $('am-avatar-remove').classList.toggle('inline-flex', !!src);
    $('am-avatar-sep').classList.toggle('hidden', !src);
  }
  function profileDirty() { setDisabled(pSave, Object.keys(profileChanges()).length === 0); }
  function fillProfile(p) {
    profileStart = { name: p.name == null ? null : p.name, biography: p.biography == null ? null : p.biography, profilePicture: p.profilePicture == null ? null : p.profilePicture };
    profileValues = Object.assign({}, profileStart);
    $('profile-name').value = profileValues.name || '';
    $('profile-bio').value = profileValues.biography || '';
    paintAvatar(); profileDirty();
  }
  $('profile-name').addEventListener('input', function (e) { profileValues.name = e.target.value || null; paintAvatar(); profileDirty(); });
  $('profile-bio').addEventListener('input', function (e) { profileValues.biography = e.target.value || null; profileDirty(); });
  var avatarFile = $('am-avatar-file');
  function avatarError(text) { var el = $('am-avatar-error'); el.textContent = text || ''; el.classList.toggle('hidden', !text); }
  var TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  function uploadAvatar(file) {
    avatarError('');
    if (TYPES.indexOf(file.type) < 0) { avatarError(T('common.avatarUpload.invalidType', 'Only JPEG, PNG, WebP, or GIF images are allowed.')); return; }
    if (file.size > 5 * 1024 * 1024) { avatarError(T('common.avatarUpload.tooLarge', 'Image must be under 5 MB.')); return; }
    var url = URL.createObjectURL(file);
    $('am-avatar-img').src = url; $('am-avatar-img').classList.remove('hidden'); $('am-avatar-fallback').classList.add('hidden');
    $('am-avatar-busy').classList.remove('hidden'); $('am-avatar-upload').disabled = true; $('am-avatar-upload').textContent = 'Uploading…';
    var fd = new FormData(); fd.append('file', file); fd.append('folder', 'users');
    api.post(tp('/api/storage'), fd).then(function (res) {
      profileValues.profilePicture = res.data.url;
    }).catch(function (err) {
      avatarError(errText(err, T('common.avatarUpload.uploadFailed', 'Upload failed.')));
    }).then(function () {
      URL.revokeObjectURL(url);
      $('am-avatar-busy').classList.add('hidden'); $('am-avatar-upload').disabled = false; $('am-avatar-upload').textContent = 'Upload photo';
      avatarFile.value = ''; paintAvatar(); profileDirty();
    });
  }
  $('am-avatar-change').addEventListener('click', function () { avatarFile.click(); });
  $('am-avatar-upload').addEventListener('click', function () { avatarFile.click(); });
  $('am-avatar-remove').addEventListener('click', function () { profileValues.profilePicture = null; paintAvatar(); profileDirty(); });
  avatarFile.addEventListener('change', function () { if (avatarFile.files[0]) uploadAvatar(avatarFile.files[0]); });
  pForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var changes = profileChanges();
    U.fieldError('profile-bio', '');
    if (profileValues.biography && profileValues.biography.length > BIO_MAX) { U.fieldError('profile-bio', T('user.profileForm.bioTooLong', 'Bio must be 300 characters or less.')); return; }
    if (!Object.keys(changes).length) return;
    U.busy(pSave, true);
    api.put(tp('/api/auth/me/profile'), { userProfile: changes }).then(function () {
      Object.assign(profileStart, changes); profileDirty();
      notice('success', T('account.me.profileSaved', 'Profile updated successfully.'));
    }).catch(function (err) {
      notice('error', isValidation(err) ? T('account.me.profileInvalid', 'Some profile details are not valid. Check them and try again.') : errText(err, T('account.me.profileSaveError', 'Failed to update profile.')));
    }).then(function () { U.busy(pSave, false); profileDirty(); });
  });

  // ── Security overview ──────────────────────────────────────────────────────────────────────────────────────────────
  function paintSecurity(sec) {
    $('am-sec-email').textContent = sec.email || '—';
    var gr = sec.userRole && GLOBAL_ROLE[sec.userRole];
    $('am-sec-role-row').classList.toggle('hidden', !sec.userRole);
    if (sec.userRole) $('am-sec-role').innerHTML = badge(gr ? gr[0] : 'neutral', gr ? gr[1] : sec.userRole);
    $('am-sec-tenant-role').innerHTML = memberRole ? badge(ROLE_VARIANT[memberRole] || 'neutral', memberRole) : '<span class="text-sm text-text-secondary">—</span>';
    var ok = !!sec.emailVerifiedAt;
    $('am-sec-verified').innerHTML = badge(ok ? 'success' : 'warning', ok ? T('account.me.verified', 'Verified') : T('account.me.notVerified', 'Not verified'));
    $('am-sec-last-login').textContent = sec.lastLoginAt ? when(sec.lastLoginAt) : T('account.me.never', 'Never');
    $('am-role').innerHTML = memberRole ? badge(ROLE_VARIANT[memberRole] || 'neutral', memberRole) : '';
  }

  // ── Preferences ────────────────────────────────────────────────────────────────────────────────────────────────────
  var FALLBACK = {
    theme: 'SYSTEM', language: 'en', timezone: 'UTC', dateFormat: 'DD_MM_YYYY', timeFormat: 'H24', firstDayOfWeek: 'MON',
    emailNotifications: true, smsNotifications: false, pushNotifications: true, newsletter: false, productUpdates: false, promotionalOffers: false, announcements: true,
  };
  var CONSENT_OFF = { newsletter: false, productUpdates: false, promotionalOffers: false };
  var SELECTS = { theme: 'theme', language: 'language', timezone: 'timezone', dateFormat: 'date-format', timeFormat: 'time-format', firstDayOfWeek: 'first-day' };
  var TOGGLES = { emailNotifications: 'email-notifications', smsNotifications: 'sms-notifications', pushNotifications: 'push-notifications', newsletter: 'newsletter', productUpdates: 'product-updates', promotionalOffers: 'promotional-offers', announcements: 'announcements' };
  var prForm = $('am-prefs-form'), prSave = submitBtn(prForm);
  function prefsValues() {
    var v = {};
    Object.keys(SELECTS).forEach(function (k) { v[k] = getSelect(SELECTS[k]); });
    Object.keys(TOGGLES).forEach(function (k) { v[k] = getToggle(TOGGLES[k]); });
    return v;
  }
  function prefsChanges() {
    var now = prefsValues(), out = {};
    Object.keys(now).forEach(function (k) { if (now[k] !== prefsStart[k]) out[k] = now[k]; });
    return out;
  }
  function prefsDirty() { setDisabled(prSave, !prefsStart || Object.keys(prefsChanges()).length === 0); }
  // The preferences GET answers { userPreferences, defaults, persisted }; an unsaved account's row is only the defaults.
  function fillPreferences(data) {
    var row = data && data.userPreferences || null, unsaved = data && data.persisted === false;
    var stored = unsaved ? null : row, defaults = (data && data.defaults) || (unsaved ? row : null);
    prefsStart = Object.assign({}, FALLBACK, defaults || {}, CONSENT_OFF, stored || {});
    Object.keys(SELECTS).forEach(function (k) { setSelect(SELECTS[k], prefsStart[k]); });
    Object.keys(TOGGLES).forEach(function (k) { setToggle(TOGGLES[k], prefsStart[k]); });
    // The value a select really holds (an option the tenant does not offer stays as the form shows it).
    Object.keys(SELECTS).forEach(function (k) { prefsStart[k] = getSelect(SELECTS[k]); });
    prefsDirty();
  }
  function showPrefs(state, text) {
    $('am-prefs-loading').classList.toggle('hidden', state !== 'loading');
    $('am-prefs-loading').classList.toggle('flex', state === 'loading');
    var er = $('am-prefs-error');
    if (state === 'error') retryBanner(er, text, reloadPreferences); else U.clear(er);
    prForm.classList.toggle('hidden', state !== 'form');
  }
  function reloadPreferences() {
    showPrefs('loading');
    api.get(tp('/api/auth/me/preferences')).then(function (res) { fillPreferences(res.data); showPrefs('form'); })
      .catch(function (err) { showPrefs('error', errText(err, T('account.me.prefsLoadError', 'Your preferences could not be loaded.'))); });
  }
  prForm.addEventListener('change', prefsDirty);
  prForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var changes = prefsChanges();
    if (!Object.keys(changes).length) return;
    U.busy(prSave, true);
    api.put(tp('/api/auth/me/preferences'), { userPreferences: changes }).then(function () {
      Object.assign(prefsStart, changes);
      notice('success', T('account.me.prefsSaved', 'Preferences updated.'));
      // The shell reads the app_locale cookie; mirror the durable preference so the next page renders in the chosen language.
      if (changes.language) document.cookie = 'app_locale=' + encodeURIComponent(String(changes.language).toLowerCase()) + '; path=/; max-age=31536000; samesite=lax';
    }).catch(function (err) {
      notice('error', isValidation(err) ? T('account.me.prefsInvalid', 'Some preferences are not valid. Check them and try again.') : errText(err, T('account.me.prefsSaveError', 'Failed to update preferences.')));
    }).then(function () { U.busy(prSave, false); prefsDirty(); });
  });

  // ── Active sessions ────────────────────────────────────────────────────────────────────────────────────────────────
  var DEVICE_ICON = { phone: 'fa-mobile-screen-button', tablet: 'fa-tablet-screen-button', watch: 'fa-clock', tv: 'fa-tv', desktop: 'fa-desktop', other: 'fa-desktop' };
  function seenAt(s) { return new Date(s.lastActiveAt || s.createdAt || 0).getTime(); }
  function placeOf(s) {
    var geo = s.metadata && s.metadata.geo || {};
    var parts = [geo.city, geo.country || geo.countryCode].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  var revokingSession = null, revokingOthers = false;
  var sessionsTable = table($('am-sessions-table'), {
    caption: 'Active Sessions',
    // This device first, then the most recently seen; a header click replaces that order.
    sort: { key: '_default', dir: 'asc' },
    empty: 'No active sessions found.',
    rowId: function (s) { return s.userSessionId; },
    onAction: function (act, id) { revokeSession(id); },
    columns: [
      { key: 'userAgent', header: 'Device', render: function (s) {
        var d = s.metadata && s.metadata.device || {};
        var label = d.brand && d.model ? d.brand + ' ' + d.model : (d.name || s.userAgent || 'Unknown device');
        var cur = s.userSessionId === currentSessionId, other = s.tenantId !== tenantId;
        return '<div class="flex items-start gap-3 min-w-0"><i class="fa-solid ' + (DEVICE_ICON[d.type || 'desktop'] || 'fa-desktop') + ' w-4 h-4 text-text-secondary mt-0.5 shrink-0" aria-hidden="true"></i><div class="space-y-0.5 min-w-0">'
          + '<div class="flex items-center gap-2 flex-wrap"><span class="text-sm font-medium text-text-primary truncate max-w-xs">' + esc(label) + '</span>'
          + (cur ? badge('success', 'Current', { dot: true }) : '') + (s.thisDevice && !cur ? badge('info', 'This device') : '') + (other ? badge('neutral', 'Other organization') : '') + '</div>'
          + (d.os ? '<p class="text-xs text-text-secondary">' + esc(d.osVersion ? d.os + ' ' + d.osVersion : d.os) + '</p>' : '') + '</div></div>';
      } },
      { key: 'place', header: 'Location', hide: 'md', render: function (s) { return '<span class="text-xs text-text-secondary">' + esc(placeOf(s) || '—') + '</span>'; } },
      { key: 'ipAddress', header: 'IP address', sortable: true, hide: 'sm', render: function (s) { return '<span class="font-mono text-xs text-text-secondary">' + esc(s.ipAddress || 'Unknown IP') + '</span>'; } },
      { key: 'lastActiveAt', header: 'Last active', sortable: true, value: seenAt, render: function (s) {
        var w = s.lastActiveAt || s.createdAt;
        return w ? '<span class="text-xs text-text-secondary" title="' + esc(when(w)) + '">' + esc(s.userSessionId === currentSessionId ? 'Active now' : ago(w)) + '</span>' : '<span class="text-xs text-text-secondary">—</span>';
      } },
      { key: 'createdAt', header: 'Started', sortable: true, hide: 'md', render: function (s) { return '<span class="text-xs text-text-secondary">' + esc(s.createdAt ? when(s.createdAt) : '—') + '</span>'; } },
      { key: 'sessionExpiry', header: 'Expires', sortable: true, hide: 'lg', render: function (s) { return '<span class="text-xs text-text-disabled">' + esc(when(s.sessionExpiry)) + '</span>'; } },
      { key: '_revoke', header: '<span class="sr-only">Actions</span>', align: 'right', render: function (s) {
        return rowButton('revoke', s.userSessionId === currentSessionId ? 'Sign out' : 'Revoke', 'fa-right-from-bracket', DANGER_OUTLINE, revokingSession === s.userSessionId);
      } },
    ],
  });
  function paintSessions() {
    var ordered = sessions.slice().sort(function (a, b) {
      return (b.userSessionId === currentSessionId) - (a.userSessionId === currentSessionId) || seenAt(b) - seenAt(a);
    });
    sessionsTable.set(ordered);
    $('am-sessions-sub').textContent = sessions.length + ' active session' + (sessions.length !== 1 ? 's' : '');
    var others = sessions.some(function (s) { return s.userSessionId !== currentSessionId; });
    var b = $('am-sessions-revoke-others');
    b.classList.toggle('hidden', !others); b.classList.toggle('inline-flex', others); b.disabled = revokingOthers;
  }
  function revokeSession(id) {
    window.confirmDialog({
      title: T('account.me.revokeSessionTitle', 'Sign out this session'),
      message: T('account.me.revokeSessionMessage', 'The device using this session is signed out at once. If it is the one you are using now, you are signed out too.'),
      tone: 'danger', confirmLabel: T('account.me.revokeSessionAction', 'Sign out session'),
    }).then(function (ok) {
      if (!ok) return;
      revokingSession = id; paintSessions();
      return api.delete(tp('/api/auth/me/sessions/' + encodeURIComponent(id))).then(function (res) {
        sessions = sessions.filter(function (s) { return s.userSessionId !== id; });
        if (res.data && res.data.isCurrentSession) { window.location.href = tp('/auth/logout'); return; }
      }).catch(function (err) { notice('error', errText(err, T('account.me.revokeError', 'Failed to revoke session.'))); })
        .then(function () { revokingSession = null; paintSessions(); });
    });
  }
  $('am-sessions-revoke-others').addEventListener('click', function () {
    window.confirmDialog({
      title: T('account.me.revokeOthersTitle', 'Sign out all other sessions'),
      message: T('account.me.revokeOthersMessage', 'Every other device signed in to your account is signed out at once. The session you are using now stays.'),
      tone: 'danger', confirmLabel: T('account.me.revokeOthersAction', 'Sign out other sessions'),
    }).then(function (ok) {
      if (!ok) return;
      revokingOthers = true; paintSessions();
      return api.delete(tp('/api/auth/me/sessions')).then(function () {
        sessions = sessions.filter(function (s) { return s.userSessionId === currentSessionId; });
      }).catch(function (err) { notice('error', errText(err, T('account.me.revokeError', 'Failed to revoke session.'))); })
        .then(function () { revokingOthers = false; paintSessions(); });
    });
  });

  // ── Trusted devices (loads on its own, so its failure never blanks the page) ───────────────────────────────────────
  var devices = null, revokingDevices = false;
  var devicesTable = table($('am-devices-table'), {
    caption: 'Trusted devices',
    sort: { key: 'createdAt', dir: 'desc' },
    empty: 'No trusted devices.',
    rowId: function (d) { return d.deviceId; },
    searchOf: function (d) { return d.name; },
    onAction: function (act, id) { revokeDevices(id); },
    columns: [
      { key: 'name', header: 'Device', sortable: true, render: function (d) { return '<span class="flex items-center gap-2 text-sm text-text-primary"><i class="fa-solid fa-laptop w-3.5 h-3.5 text-text-secondary" aria-hidden="true"></i>' + esc(d.name) + '</span>'; } },
      { key: 'createdAt', header: 'Trusted since', sortable: true, render: function (d) { return esc(when(d.createdAt)); } },
      { key: 'lastSeenAt', header: 'Last seen', sortable: true, hide: 'sm', render: function (d) { return esc(d.lastSeenAt ? when(d.lastSeenAt) : 'Never'); } },
      { key: 'expiresAt', header: 'Trusted until', sortable: true, hide: 'md', render: function (d) { return esc(when(d.expiresAt)); } },
      { key: '_revoke', header: '<span class="sr-only">Actions</span>', align: 'right', render: function () { return rowButton('revoke', 'Revoke', 'fa-trash', DANGER_OUTLINE, revokingDevices); } },
    ],
  });
  function paintDevices() {
    var rows = (devices || []).map(function (d) { return Object.assign({}, d, { name: d.label || 'Unnamed device' }); });
    devicesTable.set(rows);
    var b = $('am-devices-revoke-all');
    var show = rows.length > 0;
    b.classList.toggle('hidden', !show); b.classList.toggle('inline-flex', show); b.disabled = revokingDevices;
  }
  function loadDevices() {
    devices = null; U.clear($('am-devices-error')); $('am-devices-table').classList.remove('hidden');
    $('am-devices-table').innerHTML = '<div class="flex justify-center py-6" role="status"><i class="fa-solid fa-spinner fa-spin text-text-secondary" aria-hidden="true"></i></div>';
    api.get(tp('/api/auth/me/trusted-devices')).then(function (res) { devices = res.data && res.data.devices || []; paintDevices(); })
      .catch(function (err) {
        devices = [];
        $('am-devices-table').classList.add('hidden');
        $('am-devices-revoke-all').classList.add('hidden');
        retryBanner($('am-devices-error'), errText(err, T('account.me.trustedDevicesLoadError', 'Your trusted devices could not be loaded.')), loadDevices);
      });
  }
  // Revoking a trusted device only takes the skip of the sign-in code away; no session ends.
  function revokeDevices(deviceId) {
    var device = deviceId ? (devices || []).filter(function (d) { return d.deviceId === deviceId; })[0] : null;
    window.confirmDialog({
      title: device ? T('account.me.revokeDeviceTitle', 'Revoke this trusted device') : T('account.me.revokeAllDevicesTitle', 'Revoke all trusted devices'),
      message: device
        ? 'The next sign-in on ' + (device.label || 'this device') + ' asks for your sign-in code again. Nobody is signed out.'
        : T('account.me.revokeAllDevicesMessage', 'The next sign-in on every trusted device asks for your sign-in code again. Nobody is signed out.'),
      tone: 'danger', confirmLabel: T('account.me.revokeDeviceAction', 'Revoke'),
    }).then(function (ok) {
      if (!ok) return;
      revokingDevices = true; paintDevices();
      return api.delete(tp(device ? '/api/auth/me/trusted-devices/' + encodeURIComponent(device.deviceId) : '/api/auth/me/trusted-devices')).then(function () {
        devices = device ? devices.filter(function (d) { return d.deviceId !== device.deviceId; }) : [];
      }).catch(function (err) { notice('error', errText(err, T('account.me.revokeDeviceError', 'The trusted device could not be revoked.'))); })
        .then(function () { revokingDevices = false; paintDevices(); });
    });
  }
  $('am-devices-revoke-all').addEventListener('click', function () { revokeDevices(null); });

  // ── Connected accounts ─────────────────────────────────────────────────────────────────────────────────────────────
  var SSO = ['google', 'apple', 'facebook', 'github', 'linkedin', 'microsoft', 'twitter', 'slack', 'tiktok', 'wechat', 'autodesk', 'yandex', 'vk', 'qq', 'weibo', 'alipay'];
  var BRAND_ICON = { wechat: 'weixin' };
  var GROUPS = { social: 'Social logins', enterprise: 'Enterprise SSO', government: 'Government identities' };
  var accounts = [], available = [], samlEnabled = false, connecting = null, linkedParam = null;
  var apiAuth = function (p) { return tp('/api/auth' + p); };
  function providerLabel(p) { return p === 'saml' ? 'SAML SSO' : p.indexOf('acs:') === 0 ? p.slice(4) : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }
  function accountLabel(a) { return a.displayName || providerLabel(a.provider); }
  function accountGroup(a) { return a.group || (a.provider === 'saml' ? 'enterprise' : a.provider.indexOf('acs:') === 0 ? 'government' : 'social'); }
  function accountIcon(a) {
    var g = accountGroup(a);
    if (g === 'enterprise') return '<i class="fa-solid fa-building-shield" aria-hidden="true"></i>';
    if (g === 'government') return '<i class="fa-solid fa-landmark" aria-hidden="true"></i>';
    if (SSO.indexOf(a.provider) >= 0) return '<i class="fa-brands fa-' + (BRAND_ICON[a.provider] || a.provider) + '" aria-hidden="true"></i>';
    return '<span class="text-sm font-bold">' + esc(accountLabel(a).charAt(0).toUpperCase()) + '</span>';
  }
  // The text for a ?linkError= code: a closed list, so URL text never reaches the page.
  function linkErrorText(code) {
    return ({
      sso_state_invalid: 'This link could not be verified for this browser. Start it again.',
      sso_email_mismatch: 'The provider account email does not match your account email.',
      sso_email_missing: 'The provider did not return an email address.',
      sso_provider_not_allowed: 'This provider is not allowed here.',
      sso_account_already_linked: 'This provider account is already linked to another user.',
      acs_national_id_missing: 'The identity provider did not return a national ID number.',
      local_credentials_disabled: 'Linking a provider is not available here: you sign in with Fleet ID.',
    })[code] || 'Linking the provider failed.';
  }
  function linkedNoticeLabel(linked) {
    var a = accounts.filter(function (x) { return x.provider === linked; })[0];
    if (a) return accountLabel(a);
    return linked === 'saml' || SSO.indexOf(linked) >= 0 ? providerLabel(linked) : null;
  }
  var connTable = table($('am-conn-table'), {
    caption: 'Connected accounts',
    sort: { key: 'groupTitle', dir: 'asc' },
    empty: '<span class="flex flex-col items-center gap-2 text-text-secondary"><i class="fa-solid fa-link text-3xl opacity-30" aria-hidden="true"></i><span class="text-sm">No connected accounts</span></span>',
    rowId: function (a) { return a.provider; },
    onAction: function (act, provider) { unlink(provider); },
    columns: [
      { key: 'groupTitle', header: 'Kind', sortable: true, hide: 'sm', render: function (a) { return '<span class="text-xs font-semibold uppercase tracking-wide text-text-secondary">' + esc(a.groupTitle) + '</span>'; } },
      { key: 'provider', header: 'Account', sortable: true, render: function (a) {
        return '<div class="flex items-center gap-3 min-w-0"><span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-subtle text-primary text-sm font-bold shrink-0">' + accountIcon(a) + '</span><div class="min-w-0">'
          + '<div class="flex items-center gap-2 flex-wrap"><p class="text-sm font-medium text-text-primary">' + esc(accountLabel(a)) + '</p>' + badge('success', 'Connected', { sm: true, dot: true }) + (a.tokenExpired ? badge('warning', 'Token expired', { sm: true }) : '') + '</div>'
          + '<p class="text-xs text-text-secondary truncate">' + esc(a.providerId) + '</p></div></div>';
      } },
      { key: 'createdAt', header: 'Since', sortable: true, hide: 'md', render: function (a) { return '<span class="text-xs text-text-secondary">' + esc(a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—') + '</span>'; } },
      { key: '_unlink', header: '<span class="sr-only">Actions</span>', align: 'right', render: function (a) {
        return '<button type="button" data-act="unlink" aria-label="Unlink ' + esc(accountLabel(a)) + '" class="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-error hover:bg-surface-overlay shrink-0"><i class="fa-solid fa-unlink w-3.5 h-3.5 mr-1" aria-hidden="true"></i>Unlink</button>';
      } },
    ],
  });
  function paintAccounts() {
    connTable.set(accounts.map(function (a) { return Object.assign({}, a, { groupTitle: GROUPS[accountGroup(a)] || accountGroup(a) }); }));
    var linked = {}; accounts.forEach(function (a) { linked[a.provider] = 1; });
    var connectable = SSO.filter(function (p) { return available.indexOf(p) >= 0 && !linked[p]; });
    if (samlEnabled && !linked.saml) connectable.push('saml');
    $('am-conn-connect').classList.toggle('hidden', connectable.length === 0);
    $('am-conn-buttons').innerHTML = connectable.map(function (p) {
      return '<button type="button" data-connect="' + esc(p) + '"' + (connecting ? ' disabled' : '') + ' class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-overlay disabled:opacity-50"><i class="fa-solid ' + (p === 'saml' ? 'fa-building-shield' : 'fa-plus') + ' w-3 h-3 mr-1" aria-hidden="true"></i>' + esc(providerLabel(p)) + '</button>';
    }).join('');
  }
  function loadAccounts() {
    $('am-conn-loading').classList.remove('hidden'); $('am-conn-body').classList.add('hidden'); U.clear($('am-conn-load-error'));
    Promise.all([
      api.get(apiAuth('/me/social-accounts')),
      api.get(apiAuth('/sso')).catch(function () { return { data: { providers: [] } }; }),
      api.get(apiAuth('/saml/status')).catch(function () { return { data: { enabled: false } }; }),
    ]).then(function (r) {
      accounts = r[0].data.accounts || [];
      if (linkedParam !== null) {
        var label = linkedNoticeLabel(linkedParam);
        if (label) U.say($('am-conn-notice'), 'success', label + ' connected successfully.');
        linkedParam = null;
      }
      available = (r[1].data.providers || []).map(function (p) { return String(p).toLowerCase(); });
      samlEnabled = !!(r[2].data && r[2].data.enabled);
      $('am-conn-loading').classList.add('hidden'); $('am-conn-body').classList.remove('hidden');
      paintAccounts();
    }).catch(function (err) {
      $('am-conn-loading').classList.add('hidden');
      retryBanner($('am-conn-load-error'), errText(err, T('user.socialAccounts.loadError', 'Failed to load social accounts.')), loadAccounts);
    });
  }
  function unlink(provider) {
    var acc = accounts.filter(function (a) { return a.provider === provider; })[0];
    window.confirmDialog({
      title: 'Unlink Account',
      message: 'Are you sure you want to unlink your ' + (acc ? accountLabel(acc) : provider) + ' account?',
      tone: 'danger', confirmLabel: 'Unlink',
      // Runs inside the dialog: a failure keeps it open with the error in its footer.
      action: function () { return api.delete(apiAuth('/me/social-accounts/' + encodeURIComponent(provider))); },
      errorMessage: function (err) { return errText(err, T('user.socialAccounts.unlinkError', 'Failed to unlink account.')); },
    }).then(function (done) {
      if (!done) return;
      accounts = accounts.filter(function (a) { return a.provider !== provider; });
      paintAccounts();
    });
  }
  $('am-conn-buttons').addEventListener('click', function (e) {
    var b = e.target.closest('[data-connect]');
    if (!b || connecting) return;
    var p = b.getAttribute('data-connect');
    U.clear($('am-conn-error')); connecting = p; paintAccounts();
    api.get(apiAuth('/me/social-accounts/connect/' + encodeURIComponent(p))).then(function (res) {
      var url = res.data && res.data.url;
      if (!url) throw new Error('No connect URL returned.');
      window.location.href = url;
    }).catch(function (err) {
      U.say($('am-conn-error'), 'error', errText(err, T('user.socialAccounts.connectError', 'Failed to start connection.')));
      connecting = null; paintAccounts();
    });
  });
  // ?linked= / ?linkError= from the OAuth or SAML round trip.
  (function () {
    var params = new URLSearchParams(window.location.search), linked = params.get('linked'), linkError = params.get('linkError');
    if (linked) { linkedParam = linked; params.delete('linked'); }
    if (linkError) { U.say($('am-conn-error'), 'error', linkErrorText(linkError)); params.delete('linkError'); }
    if (linked || linkError) { var qs = params.toString(); window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash); }
  })();

  // ── Load ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  function load() {
    $('am-loading').classList.remove('hidden'); $('am-content').classList.add('hidden'); $('am-load-error').classList.add('hidden');
    Promise.all([
      api.get(tp('/api/auth/session')),
      api.get(tp('/api/auth/me/profile')),
      api.get(tp('/api/auth/me/security')).catch(function () { return { data: { userSecurity: {} } }; }),
      // Kept apart: its failure is shown on the Preferences tab, with a Retry.
      api.get(tp('/api/auth/me/preferences')).then(function (res) { return { ok: true, data: res.data }; }, function (err) { return { ok: false, err: err }; }),
      api.get(tp('/api/auth/me/sessions')).catch(function () { return { data: { sessions: [] } }; }),
    ]).then(function (r) {
      var session = r[0].data, sec = r[2].data.userSecurity || {};
      memberRole = session.tenantMember && session.tenantMember.memberRole || null;
      paintSecurity({
        email: sec.email || (session.user && session.user.email), userRole: sec.userRole, emailVerifiedAt: sec.emailVerifiedAt || null,
        lastLoginAt: sec.lastLoginAt || (session.user && session.user.lastLoginAt) || null,
      });
      fillProfile(r[1].data.userProfile || {});
      if (r[3].ok) { fillPreferences(r[3].data); showPrefs('form'); } else showPrefs('error', errText(r[3].err, T('account.me.prefsLoadError', 'Your preferences could not be loaded.')));
      sessions = r[4].data.sessions || [];
      currentSessionId = session.userSession && session.userSession.userSessionId || null;
      paintSessions();
      $('am-loading').classList.add('hidden'); $('am-content').classList.remove('hidden');
    }).catch(function (err) {
      $('am-loading').classList.add('hidden');
      $('am-load-error').classList.remove('hidden');
      $('am-load-error-text').textContent = errText(err, T('account.me.loadError', 'Failed to load profile.'));
    });
    loadDevices();
    loadAccounts();
  }
  $('am-retry').addEventListener('click', load);
  load();
})();
