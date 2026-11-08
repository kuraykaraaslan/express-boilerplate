/* global L, IntersectionObserver, MutationObserver, CustomEvent */
// MapView · Leaflet provider runtime
// Mirrors NextJS providers/leaflet.ts + parts/LeafletCanvas.tsx + hooks.
//
// Public surface — invoke from MapView.ejs:
//   window.__MapViewLeaflet.init({
//     id, center, zoom, markers, zones, routes, fitBoundsPadding,
//     showMarkers, showZones, showRoutes,   // optional, default true
//     image, minZoom,                       // optional, see below
//     maxZoom, cluster, clusterRadius, clusterText, showLabels, tooltipTrigger,
//     scrollWheelZoom, zoomControl, controlsPosition, fitMaxZoom,   // display options
//     onMarkerClick(id), onMarkerMove(id, position),                // optional callbacks
//   });
//
// Requires scripts/map-parts.js (window.__KuiMapParts): marker drawing, the tooltip body,
// clustering and the token class lists, shared with kui-react's MapView one to one.
//
// Behaviour parity with NextJS M1:
//   • Lazy load: defers L.map() until the container enters the viewport.
//   • Token-based theming: OpenStreetMap's standard tiles by default, darkened in the dark theme (or the installation's
//     tile source, `__KuiMapParts.setTileSource`, with its dark URL when it has one), swapped in response to
//     <html class="dark"> changes. `tiles` (one layer, or a light / dark pair) wins over both, unless `followSource`
//     marks them as a fallback (the map widget's "Follow the theme" style): then a set installation source wins.
//     Every tile request sends the page's origin only (`MP.TILE_REFERRER_POLICY`), also on a no-referrer page.
//   • Display options (kui-react MapDisplayOptions): minZoom / maxZoom, cluster (overlapping
//     markers become a count bubble in their shared colour, else the worst status variant among them, that zooms in on
//     click; clusterRadius px, default 40; clusterText(markers) what a bubble says, default how many it holds), showLabels (each marker's label as a permanent chip; a marker's own `permanentLabel` wins),
//     tooltipTrigger ('hover' default | 'click' | 'none'), scrollWheelZoom (true),
//     zoomControl (true), controlsPosition ('topleft'), fitMaxZoom (15, the closest zoom a
//     fit may reach). Markers take color / shape ('pin' | 'dot' | 'circle' | 'icon' | 'image') / text (a short count
//     inside a dot or circle) /
//     icon (Font Awesome class) / image (an internal path or https address, checked again here) / size /
//     draggable, and a tooltip { title, description, fields, color,
//     href (internal path only), linkLabel }; every text is escaped.
//   • Draggable markers: a marker with `draggable: true` can be moved; `onMarkerMove(id, position)` is told where it was
//     dropped, in the map's own coordinates (a geographic map: [lat, lng]; an image map: [y, x] whole pixels from the
//     picture's top-left corner, kept inside the picture), kui-react LeafletCanvas parity.
//   • Fit-to-bounds: zoom to the bounds of the markers and the zone / route
//     vertices when `fitBoundsPadding` is set.
//   • Layer visibility: `showMarkers` / `showZones` / `showRoutes` === false leaves that
//     layer off the map. A hidden layer still counts for fit-to-bounds, so hiding a layer
//     never moves the view (kui-react MapCanvas / LeafletCanvas parity). The layers are
//     still built and returned (markerLayers / zoneLayers / routeLayers), so a toggle can
//     add them later with `layer.addTo(map)`.
//   • Layers after the build: the context has `setLayerVisible(name, visible)` ('markers' | 'zones' | 'routes'); it is
//     also on the map element as `__kuiMap`, with a bubbling `kui:map-ready` event (detail: { id }) once the map exists.
//   • Image map: `image` ({ url, width, height }) draws a picture (a floor plan) instead of
//     tiles. The map uses flat coordinates (L.CRS.Simple) and an L.imageOverlay over
//     [[0, 0], [height, width]]; markers / zones / routes are [y, x] pixels from the
//     picture's TOP-LEFT, flipped here to Leaflet's upward y ([height - y, x]). The view
//     starts on the picture's centre at zoom 0, fit-to-bounds frames the whole picture (not
//     the markers) and minZoom defaults to -5 (kui-react MapCanvas `image` parity). An
//     unsafe `url` (anything but an internal `/path` or https) draws no picture.
//
// TODO M2: activeMarkerId.
// TODO M3: search/geocoder, route polylines from a directions service.
// TODO M4: locate-me, layer toggle, draw tools.
// TODO M5: keyboard nav, reduced-motion mode, i18n strings, telemetry hook.
(function () {
  if (window.__MapViewLeaflet) return;

  var MP = window.__KuiMapParts;
  if (!MP) return;
  var COLORS = MP.VARIANT_HEX;
  var FILL = MP.VARIANT_FILL;
  var esc = MP.esc;

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  // A pin in a (safe) colour; kept for markers.js and other callers of the old API.
  function createIcon(color) {
    var spec = MP.markerIcon({ color: color });
    return L.divIcon({ className: '', html: spec.html, iconSize: spec.iconSize, iconAnchor: spec.iconAnchor, tooltipAnchor: spec.tooltipAnchor });
  }

  // The tooltip body (kui-react Popup), escaped.
  var tooltipHtml = MP.popupHtml;

  /**
   * One Leaflet marker (kui-react MarkerPart): its drawing, an accessible name, an optional permanent
   * label chip, and its details in a hover tooltip or, on click (or beside a permanent label, since a
   * marker holds one tooltip), a popup.
   */
  function markerLayer(m, display, onMarkerClick, onMarkerMove) {
    var spec = MP.markerIcon(m);
    var marker = L.marker(m.position, {
      icon: L.divIcon({ className: '', html: spec.html, iconSize: spec.iconSize, iconAnchor: spec.iconAnchor, tooltipAnchor: spec.tooltipAnchor }),
      alt: (m.tooltip && m.tooltip.title) || m.label || 'Map marker',
      draggable: m.draggable === true
    });
    if (typeof onMarkerClick === 'function' && m.id !== undefined) marker.on('click', function () { onMarkerClick(m.id); });
    if (m.draggable === true && typeof onMarkerMove === 'function' && m.id !== undefined) {
      marker.on('dragend', function () { var p = marker.getLatLng(); onMarkerMove(m.id, [p.lat, p.lng]); });
    }
    // a marker may say for itself whether its label is permanent (the "alerts only" label mode names only the markers in trouble)
    var label = (m.permanentLabel !== undefined ? m.permanentLabel : display.showLabels) && m.label ? String(m.label) : '';
    var trigger = display.tooltipTrigger || 'hover';
    var click = trigger === 'click' || !!label;
    var body = trigger === 'none' ? '' : m.tooltip ? tooltipHtml(m.tooltip)
      : !label && m.label ? '<span class="text-xs font-semibold">' + esc(m.label) + '</span>' : '';
    if (label) marker.bindTooltip(esc(label), { permanent: true, direction: 'right', offset: [6, 0], className: MP.LABEL_CLASS });
    if (body && click) marker.bindPopup(body, { className: MP.POPUP_CLASS, closeButton: false });
    if (body && !click) marker.bindTooltip(body, { className: MP.TIP_CLASS, direction: 'top', opacity: 1 });
    return marker;
  }

  // `tiles` is one layer for both themes ({ url, attribution }) or a light/dark pair
  // ({ light, dark }); omitted = the installation's tile source, else OpenStreetMap's (darkened in the dark theme).
  function tileSet(tiles) {
    var base = MP.defaultTiles();
    if (!tiles) return base;
    if (tiles.url) return { light: tiles, dark: tiles };
    return { light: tiles.light || base.light, dark: tiles.dark || tiles.light || base.dark };
  }

  // A tile layer's options: its attribution, the server's deepest zoom (closer zooms enlarge its tiles; default 16),
  // its {s} subdomains and, for a dark rendition of a light map, the darkening class.
  function tileOptions(t) {
    var o = { attribution: t.attribution, maxNativeZoom: typeof t.maxZoom === 'number' ? t.maxZoom : 16, maxZoom: 20, referrerPolicy: MP.TILE_REFERRER_POLICY };
    if (t.subdomains) o.subdomains = t.subdomains;
    if (t.dim) o.className = MP.DIM_TILES_CLASS;
    return o;
  }

  function setupTileTheme(map, tiles) {
    var set = tileSet(tiles);
    var current = isDark() ? set.dark : set.light;
    var layers = [];
    function add() {
      layers = [L.tileLayer(current.url, tileOptions(current)).addTo(map)];
      if (current.labels) layers.push(L.tileLayer(current.labels, { maxNativeZoom: typeof current.maxZoom === 'number' ? current.maxZoom : 16, maxZoom: 20, zIndex: 2, referrerPolicy: MP.TILE_REFERRER_POLICY }).addTo(map));
    }
    add();
    var mo = new MutationObserver(function () {
      var next = isDark() ? set.dark : set.light;
      if (next === current) return;
      layers.forEach(function (l) { map.removeLayer(l); });
      current = next;
      add();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return function dispose() { mo.disconnect(); };
  }

  // The picture's address: an internal path (`/x`, never `//host` or `/\host`) or https. The
  // template checks it server-side too; this guards a direct init() call.
  function safeImageUrl(url) {
    if (typeof url !== 'string') return null;
    var v = url.trim();
    if (!v || v.length > 2048 || /[\u0000-\u001f\u007f\s<>]/.test(v)) return null;
    return (/^\/(?![\/\\])/.test(v) || /^https:\/\/[^\/\\]/i.test(v)) ? v : null;
  }

  // { url, width, height } with a positive size, or null (a geographic map).
  function imageOf(image) {
    if (!image || typeof image !== 'object') return null;
    var w = Number(image.width), h = Number(image.height);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    return { url: safeImageUrl(image.url), width: w, height: h };
  }

  function build(opts) {
    var mapEl = document.getElementById(opts.id + '-map');
    if (!mapEl || !window.L) return;

    // The "loading" placeholder (MapCanvas / MapView `loadingLabel`) goes once the map exists.
    var loading = mapEl.querySelector('[data-map-loading]');
    if (loading && loading.parentNode) loading.parentNode.removeChild(loading);

    var image = imageOf(opts.image);
    var map;
    var display = {
      showLabels: !!opts.showLabels,
      tooltipTrigger: ['click', 'none'].indexOf(opts.tooltipTrigger) !== -1 ? opts.tooltipTrigger : 'hover'
    };
    var common = { zoomControl: false, scrollWheelZoom: opts.scrollWheelZoom !== false };
    if (typeof opts.maxZoom === 'number') common.maxZoom = opts.maxZoom;
    // The token background and font, small attribution and kit-styled zoom buttons (kui-react CANVAS_CLASS).
    mapEl.style.background = 'var(--surface-sunken)';
    mapEl.style.fontFamily = 'inherit';
    MP.CANVAS_CLASS.split(' ').forEach(function (c) { if (c) mapEl.classList.add(c); });
    var imageBounds = null;
    var flip = function (p) { return p; };
    // A drop is told in the map's own coordinates; on an image map in whole pixels from the top-left, inside the picture.
    var moved = typeof opts.onMarkerMove === 'function' ? function (id, p) { opts.onMarkerMove(id, p); } : undefined;
    if (image) {
      // An image map takes [y, x] pixels from the picture's top-left; Leaflet's flat
      // coordinates grow upwards.
      flip = function (p) { return [image.height - p[0], p[1]]; };
      if (moved) {
        moved = function (id, p) {
          opts.onMarkerMove(id, [Math.min(image.height, Math.max(0, Math.round(image.height - p[0]))), Math.min(image.width, Math.max(0, Math.round(p[1])))]);
        };
      }
      opts = Object.assign({}, opts, {
        markers: (opts.markers || []).map(function (m) { return Object.assign({}, m, { position: flip(m.position) }); }),
        zones:   (opts.zones   || []).map(function (z) { return Object.assign({}, z, { positions: (z.positions || []).map(flip) }); }),
        routes:  (opts.routes  || []).map(function (r) { return Object.assign({}, r, { positions: (r.positions || []).map(flip) }); })
      });
      imageBounds = [[0, 0], [image.height, image.width]];
      // Fractional zoom steps so the picture fills its card (kui-react f67ed92).
      map = L.map(opts.id + '-map', Object.assign({ crs: L.CRS.Simple, zoomSnap: 0.1, zoomDelta: 0.5, minZoom: typeof opts.minZoom === 'number' ? opts.minZoom : -5 }, common))
        .setView([image.height / 2, image.width / 2], 0);
      if (image.url) L.imageOverlay(image.url, imageBounds).addTo(map);
    } else {
      map = L.map(opts.id + '-map', Object.assign(typeof opts.minZoom === 'number' ? { minZoom: opts.minZoom } : {}, common)).setView(opts.center, opts.zoom);
      setupTileTheme(map, opts.followSource && MP.tileSource() ? null : opts.tiles);
    }
    if (opts.zoomControl !== false) {
      var corner = ['topright', 'bottomleft', 'bottomright'].indexOf(opts.controlsPosition) !== -1 ? opts.controlsPosition : 'topleft';
      L.control.zoom({ position: corner }).addTo(map);
    }
    // The Leaflet credit without its flag: shorter, and the attribution stays one small line.
    if (map.attributionControl) map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');

    // A hidden layer is built but not added to the map; it still frames the view below.
    function show(layer, visible) { return visible ? layer.addTo(map) : layer; }
    var zonesVisible   = opts.showZones !== false;
    var routesVisible  = opts.showRoutes !== false;
    var markersVisible = opts.showMarkers !== false;

    var zoneLayers = (opts.zones || []).map(function (z) {
      var v = z.variant || 'primary';
      var layer = L.polygon(z.positions, {
        color: COLORS[v], fillColor: FILL[v],
        fillOpacity: z.fillOpacity != null ? z.fillOpacity : 0.25, weight: 2
      });
      show(layer, zonesVisible);
      if (z.label) layer.bindTooltip('<span style="font-weight:600;font-size:12px;color:' + COLORS[v] + '">' + esc(z.label) + '</span>', { sticky: true });
      return layer;
    });

    var routeLayers = (opts.routes || []).map(function (r) {
      var layer = L.polyline(r.positions, {
        color: r.color || COLORS.primary,
        weight: r.weight || 3,
        dashArray: r.dashed ? '8 6' : null
      });
      show(layer, routesVisible);
      if (r.label) layer.bindTooltip('<span style="font-weight:600;font-size:12px">' + esc(r.label) + '</span>', { sticky: true });
      return layer;
    });

    var markerLayers;
    if (opts.cluster) {
      // Markers grouped by overlap at the current zoom; a group is a count bubble that zooms in on click.
      var radius = Math.min(200, Math.max(10, typeof opts.clusterRadius === 'number' ? opts.clusterRadius : 40));
      var group = L.layerGroup();
      var drawClusters = function () {
        group.clearLayers();
        var zoom = map.getZoom();
        MP.clusterMarkers(opts.markers || [], function (pos) { return map.project(pos, zoom); }, radius).forEach(function (g) {
          if (g.markers.length === 1) { group.addLayer(markerLayer(g.markers[0], display, opts.onMarkerClick, moved)); return; }
          var spec = MP.clusterIcon(g.markers.length, MP.clusterColor(g.markers), typeof opts.clusterText === 'function' ? opts.clusterText(g.markers) : undefined);
          var bubble = L.marker(g.position, {
            icon: L.divIcon({ className: '', html: spec.html, iconSize: spec.iconSize, iconAnchor: spec.iconAnchor }),
            alt: g.markers.length + ' markers, zoom in'
          });
          bubble.on('click', function () {
            map.fitBounds(L.latLngBounds(g.markers.map(function (m) { return m.position; })), { padding: [32, 32] });
          });
          group.addLayer(bubble);
        });
      };
      map.on('zoomend', drawClusters);
      show(group, markersVisible);
      markerLayers = [group];
    } else {
      markerLayers = (opts.markers || []).map(function (m) {
        return show(markerLayer(m, display, opts.onMarkerClick, moved), markersVisible);
      });
    }

    // Fit-to-bounds when requested. It frames the zones' and routes' vertices too, not only
    // the markers: a map of zones or routes alone was not framed (kui-react LeafletCanvas parity).
    // Hidden layers (show* === false) are framed too, so hiding a layer never moves the view.
    // An image map is framed as a whole: a floor plan is read in full, not cropped to its markers.
    var fitPoints = imageBounds ? imageBounds : (opts.markers || []).map(function (m) { return m.position; });
    if (!imageBounds) {
      (opts.zones || []).forEach(function (z) { fitPoints = fitPoints.concat(z.positions || []); });
      (opts.routes || []).forEach(function (r) { fitPoints = fitPoints.concat(r.positions || []); });
    }
    if (typeof opts.fitBoundsPadding === 'number' && fitPoints.length) {
      var bounds = L.latLngBounds(fitPoints);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [opts.fitBoundsPadding, opts.fitBoundsPadding], maxZoom: typeof opts.fitMaxZoom === 'number' ? opts.fitMaxZoom : 15 });
      }
    }
    if (opts.cluster) drawClusters();

    // Switch one layer ('markers' | 'zones' | 'routes') on or off after the map is built. A layer that is off is
    // still built, so it still frames the view and switching never moves the map (the widget's layer switch).
    function setLayerVisible(name, visible) {
      var layers = name === 'markers' ? markerLayers : name === 'zones' ? zoneLayers : name === 'routes' ? routeLayers : null;
      if (!layers) return;
      layers.forEach(function (l) {
        if (visible) { if (!map.hasLayer(l)) l.addTo(map); } else if (map.hasLayer(l)) map.removeLayer(l);
      });
    }

    // A marker a host adds after the build (the widget's route replay): `position` is given as the markers' are
    // ([y, x] on an image map). `markerLayers` is the list the layer switch walks, so push the layer there to have it
    // follow the markers switch. `flip` maps a position of the markers' kind to Leaflet's.
    function markerFor(m) { return markerLayer(Object.assign({}, m, { position: flip(m.position) }), display, null, null); }

    return { map: map, mapEl: mapEl, image: image, COLORS: COLORS, markerLayers: markerLayers, zoneLayers: zoneLayers, routeLayers: routeLayers, setLayerVisible: setLayerVisible, createIcon: createIcon, tooltipHtml: tooltipHtml, markerFor: markerFor, flip: flip };
  }

  function init(opts) {
    var mapEl = document.getElementById(opts.id + '-map');
    if (!mapEl) return;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      var ctx = build(opts);
      if (ctx) {
        // The built map is on its element (`__kuiMap`) and a bubbling `kui:map-ready` says so, for a host that
        // draws its own controls around the map (the WidgetKit layer switch).
        ctx.mapEl.__kuiMap = ctx;
        if (typeof CustomEvent === 'function' && typeof ctx.mapEl.dispatchEvent === 'function') {
          ctx.mapEl.dispatchEvent(new CustomEvent('kui:map-ready', { bubbles: true, detail: { id: opts.id } }));
        }
      }
      if (ctx && typeof opts.onReady === 'function') opts.onReady(ctx);
    }
    if (typeof IntersectionObserver === 'undefined') { start(); return; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { start(); io.disconnect(); break; }
      }
    }, { rootMargin: '200px', threshold: 0.01 });
    io.observe(mapEl);
  }

  window.__MapViewLeaflet = { init: init, COLORS: COLORS, createIcon: createIcon, tooltipHtml: tooltipHtml };
})();
