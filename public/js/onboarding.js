// Behaviour of views/auth/onboarding.ejs; the port of NB's onboarding page. The server decides who may open an organization
// (GET/POST /api/auth/onboarding); this page only asks.
(function () {
  var K = window.Kui, U = window.AuthUi, api = K.api;
  var tenantId = U.tenantId(document.getElementById('ob-root'));
  var tp = function (p) { return K.tenantPath(tenantId, p); };
  var $ = function (id) { return document.getElementById(id); };
  var SLUG_CHECK_DEBOUNCE_MS = 350;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  var form = $('ob-form'), banner = $('ob-banner'), btn = form.querySelector('button[type=submit]');
  var nameEl = $('onboarding-name'), slugEl = $('onboarding-slug'), baseEl = $('onboarding-base');
  var hint = $('ob-slug-hint'), statusEl = $('ob-slug-status');
  U.autocomplete({ 'onboarding-name': 'organization', 'onboarding-slug': 'off' });
  slugEl.setAttribute('autocapitalize', 'none'); slugEl.setAttribute('spellcheck', 'false');
  $('ob-picker').href = tp('/auth/select-tenant');

  // The zone of a fleet chooser link (?fleet=1&zone=<id>), or '' when the address carries none or a malformed one.
  function zoneFromSearch(search) {
    var p = new URLSearchParams(search);
    if (p.get('fleet') !== '1') return '';
    var z = (p.get('zone') || '').trim().toLowerCase();
    return /^[a-z][a-z0-9-]{0,31}$/.test(z) ? z : '';
  }
  // A 409 refusing the sign-up's zone, with the chooser link only when it is an https (or localhost) URL.
  function zoneRefusalOf(err) {
    var r = err && err.response;
    if (!r || r.status !== 409 || !r.data || !r.data.details || r.data.details.reason !== 'ZONE_NOT_HERE') return null;
    var raw = r.data.details.chooserUrl, url = null;
    if (typeof raw === 'string') {
      try {
        var u = new URL(raw);
        if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || /\.localhost$/.test(u.hostname)))) url = u.href;
      } catch (e) { /* not a URL: no link */ }
    }
    return { chooserUrl: url };
  }
  // An address suggestion from an organization name: lowercase ASCII letters, digits and single hyphens, at most 63.
  function slugFromName(name) {
    return name.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  }
  // The node's Fleet ID callback (an https URL with a host and a path, no query, fragment or credentials), asked BEFORE the
  // organization is opened so the POST can tell the server whether to mint a fallback way in.
  function fleetIdEnterBase() {
    return api.get(tp('/api/auth/fleet-id/status')).then(function (res) {
      var enter = res.data && res.data.enabled === true ? res.data.enterUrl : null;
      return typeof enter === 'string' && /^https:\/\/[^/\\?#@]+\/[^?#]*$/.test(enter) ? enter : null;
    }, function () { return null; });
  }

  var zone = zoneFromSearch(location.search);
  var domainMode = K.tenancyMode() === 'domain';
  var loginUrl = tp('/auth/login') + '?redirect=' + encodeURIComponent(tp('/auth/onboarding') + (zone ? '?fleet=1&zone=' + encodeURIComponent(zone) : ''));

  var status = null, offer = null, base = '', slugEdited = false, check = null, checkFailed = false, checking = false, submitting = false;
  var latestSlug = '', timer = null;

  function picking() { return domainMode && offer && offer.choice === 'tenant' && offer.offered.length > 1; }
  function wildcard() { return domainMode ? (base || (offer && offer.defaultBase) || '') : ''; }
  function takenUnderBase() { return picking() && !!base && (offer.takenUnder || []).indexOf(base) >= 0; }

  function slugMessage(c) {
    if (!c) return null;
    if (c.available) return { text: 'This address is available.', ok: true };
    if (c.reason === 'taken') return { text: 'This address is already taken.', ok: false };
    if (c.reason === 'reserved') return { text: 'This address is reserved.', ok: false };
    return { text: 'Use 5–63 lowercase letters, digits and hyphens (no dot, no hyphen at the start or end).', ok: false };
  }
  function canSubmit() { return nameEl.value.trim().length >= 2 && !!check && check.available && check.slug === slugEl.value && !takenUnderBase() && !submitting; }

  function paint() {
    var w = wildcard(), s = slugEl.value;
    hint.textContent = w && s ? s + '.' + w : '';
    hint.classList.toggle('hidden', !(w && s));
    var m = slugMessage(check), text = '', cls = 'text-text-secondary';
    if (m) { text = m.text; cls = m.ok ? 'text-success-fg' : 'text-error'; }
    else if (checkFailed) { text = 'The address could not be checked. Edit it to try again.'; cls = 'text-error'; }
    else if (checking) { text = 'Checking the address…'; }
    statusEl.className = '-mt-3 text-xs ' + cls + (text ? '' : ' hidden');
    statusEl.textContent = text;
    U.fieldError('onboarding-base', takenUnderBase() ? 'This address is already taken under ' + base + '. Pick another domain or address.' : '');
    btn.disabled = !canSubmit();
  }

  // Ask whether the address is free, debounced; a late answer for an older value is dropped.
  function scheduleCheck() {
    var slug = slugEl.value;
    latestSlug = slug; check = null; checkFailed = false;
    clearTimeout(timer);
    // An emptied address ends any check in flight: its answer is dropped below, so it would never clear the line.
    if (!slug) { checking = false; paint(); return; }
    checking = true; paint();
    timer = setTimeout(function () {
      api.get(tp('/api/auth/onboarding/slug'), { params: { slug: slug } }).then(function (res) {
        if (latestSlug === slug) check = res.data;
      }, function () { if (latestSlug === slug) { check = null; checkFailed = true; } }).then(function () {
        if (latestSlug === slug) { checking = false; paint(); }
      });
    }, SLUG_CHECK_DEBOUNCE_MS);
  }

  // Phase 56: which base domains the address may use. A failure (tenant_domain off, an older server) just means no picker.
  var offerTimer = null;
  function loadOffer() {
    if (!domainMode || !status || !status.canCreate) return;
    clearTimeout(offerTimer);
    offerTimer = setTimeout(function () {
      var s = slugEl.value;
      api.get(tp('/api/base-domain-offer'), { params: s ? { slug: s } : {} }).then(function (res) {
        offer = res.data;
        var keep = base && offer.offered.indexOf(base) >= 0;
        base = keep ? base : (offer.defaultBase && offer.offered.indexOf(offer.defaultBase) >= 0 ? offer.defaultBase : (offer.offered[0] || ''));
        baseEl.innerHTML = '';
        offer.offered.forEach(function (b) { var o = document.createElement('option'); o.value = b; o.textContent = b; if (b === base) o.selected = true; baseEl.appendChild(o); });
        $('ob-base-box').classList.toggle('hidden', !picking());
        paint();
      }, function () { offer = null; $('ob-base-box').classList.add('hidden'); paint(); });
    }, 0);
  }
  baseEl.addEventListener('change', function () { base = baseEl.value; paint(); });

  nameEl.addEventListener('input', function () {
    if (!slugEdited) { slugEl.value = slugFromName(nameEl.value); scheduleCheck(); loadOffer(); }
    paint();
  });
  slugEl.addEventListener('input', function () {
    slugEdited = true;
    var v = slugEl.value.trim().toLowerCase(); if (v !== slugEl.value) slugEl.value = v;
    scheduleCheck(); loadOffer();
  });

  api.get(tp('/api/auth/onboarding')).then(function (res) {
    status = res.data;
    $('ob-loading').classList.add('hidden');
    if (!status.canCreate) {
      $('ob-closed-text').textContent = status.reason === 'limit'
        ? 'You have already opened the organizations you can open yourself.'
        : 'Opening an organization is not available right now.';
      $('ob-closed').classList.remove('hidden');
      return;
    }
    form.classList.remove('hidden');
    paint();
    loadOffer();
  }, function (err) {
    // Not signed in (or the sign-in still waits for its code): sign in first, then come back here.
    if (err && err.response && err.response.status === 401) { location.href = loginUrl; return; }
    $('ob-loading').classList.add('hidden');
    var b = $('ob-load-error'); U.say(b, 'error', U.errorText(err, 'Could not load. Please refresh.'));
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canSubmit()) return;
    submitting = true; U.busy(btn, true); U.clear(banner);
    var slug = slugEl.value;
    // With a usable Fleet ID callback here, a Fleet ID session enters the new organization through a login of its own (so the
    // hub's "my workspaces" list learns it); `enter` tells the server, which then mints no fallback way in nobody would use.
    fleetIdEnterBase().then(function (enterBase) {
      var body = { name: nameEl.value.trim(), slug: slug };
      if (picking() && base) body.baseDomain = base;
      if (zone) body.zone = zone;
      if (enterBase) body.enter = 'fleet-id';
      return api.post(tp('/api/auth/onboarding'), body).then(function (res) {
        var handoff = res.data && res.data.handoffUrl;
        var newId = res.data && res.data.tenant && res.data.tenant.tenantId;
        if (res.data && res.data.fleetIdLogin === true && enterBase && typeof newId === 'string' && UUID_RE.test(newId)) {
          location.href = enterBase + '?fid_enter=' + encodeURIComponent(newId);
          return;
        }
        // Created: go in. Without a usable answer the organization still exists, so the picker lists it.
        location.href = typeof handoff === 'string' && /^https?:\/\//.test(handoff) ? handoff
          : typeof newId === 'string' ? K.switchTenantPath(newId, '/admin') : tp('/auth/select-tenant');
      });
    }).catch(function (err) {
      var refused = zoneRefusalOf(err);
      submitting = false; U.busy(btn, false);
      if (refused) {
        form.classList.add('hidden');
        $('ob-zone').classList.remove('hidden');
        if (refused.chooserUrl) { var a = $('ob-zone-link'); a.href = refused.chooserUrl; a.classList.remove('hidden'); }
        return;
      }
      U.say(banner, 'error', U.errorText(err, 'The organization could not be created. Please try again.'));
      paint();
    });
  });
})();
