// /admin/members (tenant_member/ui/members.page.tsx + members.hooks.ts). The caller's role decides the actions (the server's rank rule,
// tenant_member.rank): an OWNER acts on anyone but themselves, anyone else only on a member strictly below their own rank.
(function () {
  var K = window.Kui, L = window.KuiList, esc = L.esc, api = K.api;
  var page = document.getElementById('dl-page'), tenantId = page.getAttribute('data-tenant-id');
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var RANK = { OWNER: 3, ADMIN: 2, USER: 1 };
  var ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', USER: 'User' };
  var ROLE_TONE = { OWNER: 'primary', ADMIN: 'warning', USER: 'neutral' };
  var STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended', PENDING: 'Pending' };
  var rank = function (r) { return Object.prototype.hasOwnProperty.call(RANK, r) ? RANK[r] : Infinity; };
  var callerRank = function (r) { return Object.prototype.hasOwnProperty.call(RANK, r) ? RANK[r] : 0; };
  function assignable(caller) { return ['ADMIN', 'USER'].filter(function (r) { return RANK[r] < callerRank(caller); }); }
  function mayActOn(caller, target, isSelf) { if (isSelf) return false; if (caller === 'OWNER') return true; return rank(target) < callerRank(caller); }
  function errText(err, fallback) { var m = err && err.response && err.response.data && err.response.data.message; return typeof m === 'string' && m ? m : fallback; }
  function say(el, kind, text) { window.AuthUi.say(el, kind, text); }

  // The select helpers of the server-drawn kui Select (a combobox with a hidden value).
  function comboRoot(id) { return document.querySelector('[data-combobox-id="' + id + '"]'); }
  function getSel(id) { var c = comboRoot(id); return c ? c.querySelector('[data-combobox-value]').value : ($(id) ? $(id).value : ''); }
  function setSel(id, v) {
    var c = comboRoot(id); if (!c) { if ($(id)) $(id).value = v; return; }
    var o = [].slice.call(c.querySelectorAll('[data-combobox-option]')).filter(function (x) { return x.getAttribute('data-combobox-option') === String(v); })[0];
    if (o) o.click();
  }
  // Only the options the caller may give stay in the list.
  function restrict(id, allowed) {
    var c = comboRoot(id); if (!c) return;
    [].slice.call(c.querySelectorAll('[data-combobox-option]')).forEach(function (o) {
      if (allowed.indexOf(o.getAttribute('data-combobox-option')) < 0) o.remove();
    });
  }

  function start(session) {
    var me = session && session.tenantMember || {};
    var callerRole = me.memberRole, selfId = me.tenantMemberId;
    var canManage = callerRole === 'ADMIN' || callerRole === 'OWNER';
    var canAct = function (m) { return canManage && mayActOn(callerRole, m.memberRole, m.tenantMemberId === selfId); };
    var list;
    function nameOf(m) {
      if (m.user && m.user.email) return m.user.email;
      if (m.displayName) return m.displayName;
      return 'displayName' in m ? 'Name not shared' : 'Unknown user';
    }
    function initials(n) { return String(n || '').trim().split(/[\s@.]+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase() || '?'; }

    // ── Invite ──
    var inviteOpts = assignable(callerRole);
    restrict('mb-invite-role', inviteOpts);
    function openInvite() {
      $('mb-invite-email').value = ''; setSel('mb-invite-role', inviteOpts.indexOf('USER') >= 0 ? 'USER' : inviteOpts[0]); window.AuthUi.clear($('mb-invite-error'));
      window.openModal('mb-invite');
    }
    $('mb-invite-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('mb-invite-email').value.trim(); if (!email) return;
      var btn = $('mb-invite-send'); window.AuthUi.busy(btn, true); window.AuthUi.clear($('mb-invite-error'));
      api.post(tp('/api/invitations'), { email: email, memberRole: getSel('mb-invite-role') }).then(function () {
        window.closeModal('mb-invite');
        L.notice('success', 'Invitation sent.');
      }).catch(function (err) { say($('mb-invite-error'), 'error', errText(err, 'Failed to send invitation.')); })
        .then(function () { window.AuthUi.busy(btn, false); });
    });

    // ── Edit (a role change is made under the administrator's step-up when they hold a factor) ──
    var editing = null;
    function openEdit(m) {
      editing = m;
      var allowed = assignable(callerRole).concat(m.memberRole);
      var c = comboRoot('mb-edit-role');
      // Restore the options a previous member removed, then keep what this one may take.
      if (c) [].slice.call(c.querySelectorAll('[data-combobox-option]')).forEach(function (o) { o.classList.toggle('hidden', allowed.indexOf(o.getAttribute('data-combobox-option')) < 0); });
      setSel('mb-edit-role', m.memberRole); setSel('mb-edit-status', m.memberStatus || 'ACTIVE');
      $('mb-edit-owner-hint').classList.toggle('hidden', callerRole !== 'OWNER');
      window.AuthUi.clear($('mb-edit-error'));
      window.openModal('mb-edit');
    }
    $('mb-edit-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!editing) return;
      var target = editing, changes = {};
      if (getSel('mb-edit-role') !== target.memberRole) changes.memberRole = getSel('mb-edit-role');
      if (getSel('mb-edit-status') !== (target.memberStatus || 'ACTIVE')) changes.memberStatus = getSel('mb-edit-status');
      if (!Object.keys(changes).length) return;
      var btn = $('mb-edit-save'); window.AuthUi.busy(btn, true); window.AuthUi.clear($('mb-edit-error'));
      window.KuiStepUp.run(tenantId, function (headers) { return api.put(tp('/api/members/' + encodeURIComponent(target.tenantMemberId)), changes, { headers: headers }); }).then(function (res) {
        window.closeModal('mb-edit'); list.reload();
        var pending = res && (res.status === 202 || (res.data && res.data.pendingApproval === true));
        L.notice(pending ? 'info' : 'success', pending ? 'The change was submitted for approval. It is not applied until it is approved.' : 'Member updated.');
      }).catch(function (err) {
        if (K.isStepUpCancelled(err)) return;
        say($('mb-edit-error'), 'error', errText(err, 'Failed to update member.'));
      }).then(function () { window.AuthUi.busy(btn, false); });
    });
    document.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c) window.closeModal(c.getAttribute('data-close')); });

    // ── Remove ──
    function remove(m) {
      window.confirmDialog({
        title: 'Remove Member',
        message: 'Remove ' + nameOf(m) + ' from this organization? This will immediately revoke their access. This action cannot be undone.',
        tone: 'danger', confirmLabel: 'Remove',
        action: function () { return api.delete(tp('/api/members/' + encodeURIComponent(m.tenantMemberId))); },
        errorMessage: function (err) { return errText(err, 'Failed to remove member.'); },
      }).then(function (done) { if (done) { list.reload(); L.notice('success', 'Member removed.'); } });
    }

    // The page header's Invite button (managers only).
    if (canManage) {
      var actions = document.querySelector('#dl-page .flex.items-center.gap-2.shrink-0');
      if (actions) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-primary text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
        b.innerHTML = '<i class="fa-solid fa-user-plus" aria-hidden="true"></i>Invite Member';
        b.addEventListener('click', openInvite); actions.appendChild(b);
      }
    }

    list = L.mount($('dl-root'), {
      endpoint: tp('/api/members'), pageBase: 0, caption: 'Members',
      rows: function (b) { return b.members || b.data || []; },
      sort: { key: 'createdAt', dir: 'desc' },
      // The server searches e-mails for member managers only, so the box is theirs alone.
      search: canManage ? { placeholder: 'Search by email…' } : null,
      filters: [
        { id: 'memberRole', label: 'Role', type: 'multiselect', options: [{ value: 'OWNER', label: 'Owner' }, { value: 'ADMIN', label: 'Admin' }, { value: 'USER', label: 'User' }] },
        { id: 'memberStatus', label: 'Status', type: 'multiselect', options: Object.keys(STATUS_LABEL).map(function (k) { return { value: k, label: STATUS_LABEL[k] }; }) },
        { id: 'created', label: 'Joined', type: 'daterange' },
      ],
      columns: [
        { key: 'user', header: 'Member', render: function (m) {
          var n = nameOf(m);
          return '<div class="flex items-center gap-3"><span class="h-8 w-8 text-xs rounded-full bg-primary-subtle text-primary font-semibold flex items-center justify-center border border-primary-subtle select-none shrink-0">' + esc(initials(n)) + '</span><p class="font-medium text-text-primary truncate">' + esc(n) + '</p></div>';
        } },
        { key: 'memberRole', header: 'Role', sortable: true, render: function (m) { return L.badge(ROLE_TONE[m.memberRole] || 'neutral', ROLE_LABEL[m.memberRole] || m.memberRole); } },
        { key: 'memberStatus', header: 'Status', sortable: true, hide: 'sm', render: function (m) { return L.badge(m.memberStatus === 'ACTIVE' ? 'success' : m.memberStatus === 'SUSPENDED' ? 'warning' : 'neutral', STATUS_LABEL[m.memberStatus] || m.memberStatus, { sm: true }); } },
        { key: 'createdAt', header: 'Joined', sortable: true, hide: 'md', render: function (m) { return '<span class="text-text-secondary">' + esc(new Date(m.createdAt).toLocaleDateString()) + '</span>'; } },
      ],
      rowActions: canManage ? [
        { id: 'edit', label: 'Edit', icon: 'fa-pen', visible: canAct, onClick: openEdit },
        { id: 'remove', label: 'Remove', icon: 'fa-trash', destructive: true, visible: canAct, onClick: remove },
      ] : [],
      onRowClick: function (m) { window.location.href = tp('/admin/members/' + m.tenantMemberId); },
      empty: 'No members yet.', emptySearch: 'No members match your search.',
    });
  }

  // The caller's session decides what they may do; unreadable means no management actions (fail closed), the list still loads.
  api.get(tp('/api/auth/session')).then(function (r) { start(r.data); }, function () { start(null); });
})();
