/* global L */
// MapView · Markers toolbar wiring + click-to-add behaviour.
// Mirrors NextJS modules/ui/MapView/hooks/useAutoMarkers.ts.
//
// Expects window.__MapViewLeaflet to expose `COLORS / createIcon / tooltipHtml`.
//
// Public surface — invoke from MapView.ejs after init():
//   window.__MapViewMarkers.attach({ id, ctx });
(function () {
  if (window.__MapViewMarkers) return;

  function attach(opts) {
    var id = opts.id;
    var ctx = opts.ctx;
    if (!ctx) return;
    var map = ctx.map;
    var mapEl = ctx.mapEl;
    var COLORS = ctx.COLORS;
    var createIcon = ctx.createIcon;
    var tooltipHtml = ctx.tooltipHtml;

    var addMode  = false;
    var addBtn   = document.getElementById(id + '-add-btn');
    var hint     = document.getElementById(id + '-hint');
    var zonesBtn = document.getElementById(id + '-zones-btn');
    var routeBtn = document.getElementById(id + '-routes-btn');

    var btnBase    = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 text-xs';
    var btnOutline = 'border border-border text-text-primary hover:bg-surface-overlay';
    var btnPrimary = 'bg-primary text-primary-fg hover:bg-primary-hover';

    function setActive(btn, on) {
      if (!btn) return;
      btn.className = btnBase + ' ' + (on ? btnPrimary : btnOutline);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function setAddBtnState(active) {
      setActive(addBtn, active);
      if (!addBtn) return;
      var leftIcon = addBtn.querySelector('[data-add-left] i');
      var label    = addBtn.querySelector('[data-add-label]');
      if (leftIcon) leftIcon.className = active ? 'fa-solid fa-xmark' : 'fa-solid fa-plus';
      if (label)    label.textContent  = active ? 'İptal' : 'İşaretçi Ekle';
      addBtn.setAttribute('title', active ? 'İşaretçi eklemeyi iptal et' : 'Haritaya işaretçi ekle');
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addMode = !addMode;
        setAddBtnState(addMode);
        if (hint) hint.classList.toggle('hidden', !addMode);
        mapEl.style.cursor = addMode ? 'crosshair' : '';
      });
    }

    var autoCount = 0;
    map.on('click', function (e) {
      if (!addMode) return;
      autoCount++;
      var pos = [e.latlng.lat, e.latlng.lng];
      var marker = L.marker(pos, { icon: createIcon(COLORS.primary) }).addTo(map);
      marker.bindTooltip(tooltipHtml({
        title: 'İşaretçi ' + autoCount,
        fields: [
          { label: 'Enlem',  value: pos[0].toFixed(5) },
          { label: 'Boylam', value: pos[1].toFixed(5) }
        ]
      }));
      addMode = false;
      setAddBtnState(false);
      if (hint) hint.classList.add('hidden');
      mapEl.style.cursor = '';
    });

    if (zonesBtn) {
      var zonesOn = true;
      zonesBtn.addEventListener('click', function () {
        zonesOn = !zonesOn;
        ctx.zoneLayers.forEach(function (l) { zonesOn ? l.addTo(map) : map.removeLayer(l); });
        var eyeIcon = zonesBtn.querySelector('.fa-eye, .fa-eye-slash');
        if (eyeIcon) eyeIcon.className = zonesOn ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        setActive(zonesBtn, zonesOn);
        zonesBtn.setAttribute('title', zonesOn ? 'Bölgeleri gizle' : 'Bölgeleri göster');
      });
    }

    if (routeBtn) {
      var routesOn = true;
      routeBtn.addEventListener('click', function () {
        routesOn = !routesOn;
        ctx.routeLayers.forEach(function (l) { routesOn ? l.addTo(map) : map.removeLayer(l); });
        var eyeIcon = routeBtn.querySelector('.fa-eye, .fa-eye-slash');
        if (eyeIcon) eyeIcon.className = routesOn ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        setActive(routeBtn, routesOn);
        routeBtn.setAttribute('title', routesOn ? 'Rotaları gizle' : 'Rotaları göster');
      });
    }
  }

  window.__MapViewMarkers = { attach: attach };
})();
