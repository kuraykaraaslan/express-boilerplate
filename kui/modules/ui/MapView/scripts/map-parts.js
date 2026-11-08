/*
 * modules/ui/MapView/scripts/map-parts.js
 *
 * Pure drawing helpers of the map (no Leaflet, no DOM), mirrors of kui-react
 * modules/ui/MapView: types.ts (safeMarkerColor, safeMarkerIcon, safeMarkerImage, markerSvg, the variant
 * colours), parts/Marker.tsx (markerIcon), parts/Cluster.tsx (clusterMarkers, clusterColor,
 * the count bubble), parts/Popup.tsx (isInternalHref and the tooltip body), parts/styles.ts
 * (the class lists that restyle Leaflet's chrome with the design tokens), tiles.ts (OpenStreetMap's tiles by
 * default, the installation's tile source and its checks) and MapTilesProvider.tsx (here `setTileSource`: an
 * installation sets its basemap once, or puts it in `window.__KuiMapTileSource` before the maps load).
 *
 * Exposed as window.__KuiMapParts (and module.exports under Node, for the tests).
 */
(function (global) {
  'use strict';
  if (global.__KuiMapParts) {
    if (typeof module !== 'undefined' && module.exports) module.exports = global.__KuiMapParts;
    return;
  }

  var VARIANT_HEX = {
    primary: '#3b82f6', success: '#22c55e', warning: '#f59e0b',
    error: '#ef4444', info: '#06b6d4', neutral: '#6b7280'
  };
  var VARIANT_FILL = {
    primary: '#3b82f620', success: '#22c55e20', warning: '#f59e0b20',
    error: '#ef444420', info: '#06b6d420', neutral: '#6b728020'
  };

  // Esri's keyless Canvas basemaps' attribution, kept for hosts that pick them as their `tiles` (the map widget's styles do).
  var ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // The default basemap: OpenStreetMap's standard tiles, keyless, with their attribution; the dark theme draws them
  // darkened. (CARTO's basemaps, an earlier default, answer every keyless request with an "API key required" tile.)
  // OSM's tile policy fits light use: an installation with real traffic sets a keyed provider of its own.
  var OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var OSM_TILES = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19 };

  /** A source as the light / dark tile pair a map draws: `darkUrl` for the dark theme, else the light tiles darkened. */
  function tileSourceTiles(source) {
    var light = { url: source.url, attribution: source.attribution };
    if (source.subdomains !== undefined) light.subdomains = source.subdomains;
    if (source.maxZoom !== undefined) light.maxZoom = source.maxZoom;
    var dark = Object.assign({}, light, source.darkUrl ? { url: source.darkUrl } : { dim: true });
    return { light: light, dark: dark };
  }
  var TILES = tileSourceTiles(OSM_TILES);

  // The tile requests' referrer policy (kui-react tiles.ts TILE_REFERRER_POLICY): the page's origin, never its path. A
  // keyed provider may check the Referer, and a no-referrer page (a display link with its token) would send none.
  var TILE_REFERRER_POLICY = 'strict-origin';

  // An https URL template with {z}, {x} and {y} and no quotes, angle brackets, backslashes, spaces or control characters.
  var TILE_URL_RE = /^https:\/\/[^\s"'<>\\\u0000-\u001f\u007f]{1,480}$/;
  function tileUrl(v) {
    if (typeof v !== 'string') return undefined;
    var url = v.trim();
    return TILE_URL_RE.test(url) && url.indexOf('{z}') !== -1 && url.indexOf('{x}') !== -1 && url.indexOf('{y}') !== -1 ? url : undefined;
  }
  // A link in an attribution: an https address and plain text, nothing else.
  var ATTRIBUTION_LINK_RE = /<a href="(https:\/\/[^\s"'<>\\]{1,200})">([^<>]{1,120})<\/a>/g;
  function escapeText(t) { return t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** Attribution HTML that may only hold text, entities and `<a href="https://...">text</a>` links; any other markup is escaped. */
  function safeAttribution(html) {
    var out = '';
    var at = 0;
    var m;
    ATTRIBUTION_LINK_RE.lastIndex = 0;
    while ((m = ATTRIBUTION_LINK_RE.exec(html)) !== null) {
      out += escapeText(html.slice(at, m.index)) + '<a href="' + m[1] + '">' + escapeText(m[2]) + '</a>';
      at = m.index + m[0].length;
    }
    return out + escapeText(html.slice(at));
  }

  /**
   * A host's tile source, checked: the URLs are https templates with {z} {x} {y}, the subdomains short letters or digits,
   * the deepest zoom a whole number from 1 to 22 and the attribution text with plain links (it is written into the page).
   * Returns undefined when the URL or the attribution is missing or unusable; a bad optional field is dropped.
   */
  function safeTileSource(value) {
    if (!value || typeof value !== 'object') return undefined;
    var url = tileUrl(value.url);
    var attribution = typeof value.attribution === 'string' ? value.attribution.trim() : '';
    if (!url || !attribution || attribution.length > 500) return undefined;
    var subs = typeof value.subdomains === 'string' ? value.subdomains.trim() : Array.isArray(value.subdomains) ? value.subdomains : undefined;
    var subdomains = typeof subs === 'string'
      ? (/^[a-z0-9]{1,10}$/i.test(subs) ? subs : undefined)
      : subs && subs.length > 0 && subs.length <= 10 && subs.every(function (x) { return typeof x === 'string' && /^[a-z0-9-]{1,20}$/i.test(x); }) ? subs : undefined;
    var maxZoom = typeof value.maxZoom === 'number' && Math.floor(value.maxZoom) === value.maxZoom && value.maxZoom >= 1 && value.maxZoom <= 22 ? value.maxZoom : undefined;
    var darkUrl = tileUrl(value.darkUrl);
    var out = { url: url, attribution: safeAttribution(attribution) };
    if (subdomains) out.subdomains = subdomains;
    if (maxZoom !== undefined) out.maxZoom = maxZoom;
    if (darkUrl) out.darkUrl = darkUrl;
    return out;
  }

  /** The installation's basemap for every map drawn after this (kui-react MapTilesProvider); null clears it. */
  function setTileSource(source) { global.__KuiMapTileSource = source || null; }
  /** The installation's tile source, checked, or null (the default applies). */
  function tileSource() { return safeTileSource(global.__KuiMapTileSource) || null; }
  /** The tile pair a map draws when it is given no `tiles`: the installation's source, else OpenStreetMap's. */
  function defaultTiles() { var s = tileSource(); return s ? tileSourceTiles(s) : TILES; }

  // Class lists that restyle Leaflet's own chrome (tooltips, popups, zoom buttons, attribution) with
  // the design tokens. Leaflet's stylesheet is unlayered, so these use Tailwind's important modifier (`!`).
  var TIP_CLASS = [
    'rounded-lg! border! border-border! bg-surface-raised! text-text-primary! px-3! py-2! shadow-lg!',
    'whitespace-normal! before:hidden!'
  ].join(' ');
  var LABEL_CLASS = [
    'rounded-md! border! border-border! bg-surface-raised/95! text-text-primary! px-1.5! py-0.5! shadow-sm!',
    'text-[11px]! font-semibold! leading-4! before:hidden!'
  ].join(' ');
  var POPUP_CLASS = [
    '[&_.leaflet-popup-content-wrapper]:rounded-lg! [&_.leaflet-popup-content-wrapper]:border [&_.leaflet-popup-content-wrapper]:border-border',
    '[&_.leaflet-popup-content-wrapper]:bg-surface-raised! [&_.leaflet-popup-content-wrapper]:text-text-primary! [&_.leaflet-popup-content-wrapper]:shadow-lg!',
    '[&_.leaflet-popup-content-wrapper]:p-0! [&_.leaflet-popup-content]:mx-3! [&_.leaflet-popup-content]:my-2.5! [&_.leaflet-popup-content]:text-[13px]!',
    '[&_.leaflet-popup-tip]:bg-surface-raised! [&_.leaflet-popup-tip]:shadow-none!',
    '[&_.leaflet-popup-close-button]:text-text-secondary! [&_.leaflet-popup-close-button:hover]:text-text-primary!'
  ].join(' ');
  // kui-react passes its CANVAS_CLASS through tailwind-merge, which drops `[&_.leaflet-bar_a]:leading-7!` because the
  // later `text-base!` sets the line height too; the list below is that merged result (the zoom glyphs sit on 24px).
  var CANVAS_CLASS = [
    '[&_.leaflet-control-attribution]:rounded-tl-md! [&_.leaflet-control-attribution]:bg-surface-raised/75! [&_.leaflet-control-attribution]:px-1.5!',
    '[&_.leaflet-control-attribution]:text-[10px]! [&_.leaflet-control-attribution]:leading-4! [&_.leaflet-control-attribution]:text-text-secondary!',
    '[&_.leaflet-control-attribution_a]:text-text-secondary! [&_.leaflet-control-attribution_a:hover]:text-text-primary!',
    '[&_.leaflet-bar]:overflow-hidden [&_.leaflet-bar]:rounded-lg! [&_.leaflet-bar]:border! [&_.leaflet-bar]:border-border! [&_.leaflet-bar]:shadow-sm!',
    '[&_.leaflet-bar_a]:h-7! [&_.leaflet-bar_a]:w-7! [&_.leaflet-bar_a]:text-base!',
    '[&_.leaflet-bar_a]:border-border! [&_.leaflet-bar_a]:bg-surface-raised! [&_.leaflet-bar_a]:text-text-primary!',
    '[&_.leaflet-bar_a:hover]:bg-surface-overlay! [&_.leaflet-bar_a.leaflet-disabled]:text-text-disabled!',
    '[&_.leaflet-bar_a:focus-visible]:outline-none [&_.leaflet-bar_a:focus-visible]:ring-2 [&_.leaflet-bar_a:focus-visible]:ring-inset [&_.leaflet-bar_a:focus-visible]:ring-border-focus'
  ].join(' ');
  // A light basemap's dark rendition (a tile source without a dark URL): inverted with the hues turned back, so water
  // stays blue and land dark, and softened so the markers keep the colour. Set on the tile layer's own container.
  var DIM_TILES_CLASS = '[filter:invert(1)_hue-rotate(180deg)_brightness(0.95)_contrast(0.9)_saturate(0.6)]';
  var LINK_CLASS = 'inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** A marker colour that is safe to write into marker HTML: #hex, rgb()/rgba(), hsl()/hsla(), var(--token) or `transparent`. */
  var SAFE_COLOR_RE = new RegExp(
    '^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})' +
    '|rgba?\\([0-9.,%\\s/]{5,40}\\)' +
    '|hsla?\\([0-9.,%\\s/deg]{5,40}\\)' +
    '|var\\(--[a-z][a-z0-9-]{0,63}\\)' +
    '|transparent)$'
  );
  function safeMarkerColor(value) {
    return typeof value === 'string' && value.length <= 80 && SAFE_COLOR_RE.test(value.trim()) ? value.trim() : undefined;
  }

  /** A Font Awesome class list (`fas fa-truck`, `fa-solid fa-truck`) that is safe to write into marker HTML. */
  var SAFE_ICON_RE = /^(?:fa[srbldt]?|fa-(?:solid|regular|brands|light|duotone|thin))(?: fa-[a-z0-9-]+){1,3}$/;
  function safeMarkerIcon(value) {
    return typeof value === 'string' && value.length <= 80 && SAFE_ICON_RE.test(value.trim()) ? value.trim() : undefined;
  }

  /**
   * A marker picture that is safe to write into marker HTML: an internal path (`/...`, not `//`) or an https address,
   * without quotes, angle brackets, backslashes, spaces or control characters. Anything else returns undefined.
   */
  var SAFE_IMAGE_RE = /^(?:\/(?![\/\\])|https:\/\/)[^\s"'<>\\\u0000-\u001f\u007f]{1,480}$/;
  function safeMarkerImage(value) {
    return typeof value === 'string' && SAFE_IMAGE_RE.test(value.trim()) ? value.trim() : undefined;
  }

  /** The pin drawing. `color` must already be safe (a VARIANT_HEX value or safeMarkerColor's result). */
  function markerSvg(color, size) {
    if (size === undefined) size = 24;
    var w = Math.round(size);
    var h = Math.round(size * 1.5);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="' + w + '" height="' + h + '" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))">'
      + '<path d="M12 0C5.373 0 0 5.373 0 12c0 3.143 1.204 5.997 3.17 8.126L12 36l8.83-15.874A11.945 11.945 0 0 0 24 12C24 5.373 18.627 0 12 0z" fill="' + color + '" style="fill:' + color + '"/>'
      + '<circle cx="12" cy="12" r="4.5" fill="white" opacity="0.9"/></svg>';
  }

  /** The marker's HTML and geometry: a pin (default), a dot, a tinted ring (`circle`), a Font Awesome icon or a picture (`image`). */
  function markerIcon(marker) {
    var color = safeMarkerColor(marker.color) || VARIANT_HEX[marker.variant] || VARIANT_HEX.primary;
    var raw = Number(marker.size);
    var size = Math.min(64, Math.max(8, typeof marker.size === 'number' && isFinite(raw) ? raw : 24));
    var icon = marker.shape === 'icon' ? safeMarkerIcon(marker.icon) : undefined;
    var image = marker.shape === 'image' ? safeMarkerImage(marker.image) : undefined;
    var shape = (marker.shape === 'icon' && !icon) || (marker.shape === 'image' && !image) ? 'dot' : (marker.shape || 'pin');
    if (shape === 'image' && image) {
      return {
        html: '<img src="' + image + '" alt="" draggable="false" style="display:block;width:' + size + 'px;height:' + size + 'px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))" />',
        iconSize: [size, size], iconAnchor: [size / 2, size / 2], tooltipAnchor: [0, -size / 2 - 2]
      };
    }
    if (shape === 'pin') {
      var h = Math.round(size * 1.5);
      return { html: markerSvg(color, size), iconSize: [size, h], iconAnchor: [size / 2, h], tooltipAnchor: [0, -h - 2] };
    }
    var round = { iconSize: [size, size], iconAnchor: [size / 2, size / 2], tooltipAnchor: [0, -size / 2 - 2] };
    // A dot or a circle may carry a short text (a count) in its middle.
    var text = markerText(marker.text);
    var inner = text
      ? 'display:flex;align-items:center;justify-content:center;font:600 ' + Math.max(9, Math.round(size * 0.42)) + 'px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;'
      : 'display:block;';
    if (shape === 'icon') {
      round.html = '<span style="display:flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;color:' + color + ';font-size:' + Math.round(size * 0.9) + 'px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))"><i class="' + icon + '" aria-hidden="true"></i></span>';
    } else if (shape === 'circle') {
      round.html = '<span style="' + inner + 'width:' + size + 'px;height:' + size + 'px;border-radius:9999px;background:color-mix(in srgb, ' + color + ' 28%, transparent);border:2px solid ' + color + ';box-shadow:0 1px 2px rgba(0,0,0,0.25);box-sizing:border-box' + (text ? ';color:' + color : '') + '">' + text + '</span>';
    } else {
      round.html = '<span style="' + inner + 'width:' + size + 'px;height:' + size + 'px;border-radius:9999px;background:' + color + ';border:2px solid #ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.4);box-sizing:border-box' + (text ? ';color:#ffffff;text-shadow:0 1px 1px rgba(0,0,0,0.45)' : '') + '">' + text + '</span>';
    }
    return round;
  }

  /** A marker's inner text, escaped for its HTML: at most 4 characters, '' when there is none. */
  function markerText(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return esc(Array.from(String(value).trim()).slice(0, 4).join(''));
  }

  /**
   * Greedy grid clustering in screen pixels: markers whose projected points fall within `radius` px
   * of a group's first marker join it. `project` maps a position to pixels at the current zoom.
   */
  function clusterMarkers(markers, project, radius) {
    if (radius === undefined) radius = 40;
    var groups = [];
    markers.forEach(function (m) {
      var p = project(m.position);
      var hit = null;
      for (var i = 0; i < groups.length; i++) {
        if (Math.abs(groups[i].px.x - p.x) <= radius && Math.abs(groups[i].px.y - p.y) <= radius) { hit = groups[i]; break; }
      }
      if (hit) hit.markers.push(m);
      else groups.push({ id: m.id, markers: [m], px: p });
    });
    return groups.map(function (g) {
      var n = g.markers.length;
      return {
        id: g.id,
        markers: g.markers,
        position: [
          g.markers.reduce(function (a, m) { return a + m.position[0]; }, 0) / n,
          g.markers.reduce(function (a, m) { return a + m.position[1]; }, 0) / n
        ]
      };
    });
  }

  // The status variants a group shows before the others (worst first): a cluster never hides a marker in trouble.
  var SEVERE = ['error', 'warning', 'info'];

  /**
   * A group's colour: the one its markers share; else, when one of them is drawn in a status variant (error, warning,
   * info, by its variant and no own colour), the worst of those; else the primary colour. Always a safe colour.
   */
  function clusterColor(markers) {
    var seen = {};
    var count = 0;
    var last;
    var variants = {};
    markers.forEach(function (m) {
      var c = safeMarkerColor(m.color) || VARIANT_HEX[m.variant] || VARIANT_HEX.primary;
      if (!seen[c]) { seen[c] = true; count++; last = c; }
      if (!safeMarkerColor(m.color)) variants[m.variant] = true;
    });
    if (count === 1) return last;
    for (var i = 0; i < SEVERE.length; i++) if (variants[SEVERE[i]]) return VARIANT_HEX[SEVERE[i]];
    return 'var(--primary, #3b82f6)';
  }

  /** The bubble of a cluster: its HTML and size. It says `text` (escaped) when given, else how many markers it holds. */
  function clusterIcon(count, color, text) {
    var size = count < 10 ? 30 : count < 100 ? 36 : 42;
    var label = text === undefined || text === null ? String(count) : markerText(text);
    return {
      html: '<span style="display:flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;border-radius:9999px;background:' + color + ';color:#ffffff;font:600 12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 0 4px color-mix(in srgb, ' + color + ' 22%, transparent),0 1px 3px rgba(0,0,0,0.3);box-sizing:border-box">' + label + '</span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    };
  }

  /** Only a path-absolute internal target (`/x`), never `//host`, `/\host`, a scheme or a control character. */
  function isInternalHref(href) {
    if (typeof href !== 'string' || !/^\/(?![\/\\])/.test(href)) return false;
    if (/[\u0000-\u001f\u007f]/.test(href)) return false;
    return !/^\/\s*[a-z][a-z0-9+.-]*:/i.test(href);
  }

  /**
   * The marker tooltip / popup body in the kit's look (kui-react Popup): a title with an optional
   * status dot, a muted description, label / value rows and an optional internal link. Every text is escaped.
   */
  function popupHtml(tt) {
    var href = isInternalHref(tt.href) ? tt.href : undefined;
    var dot = safeMarkerColor(tt.color);
    var html = '<div class="min-w-36 max-w-60 font-sans text-text-primary">'
      + '<p class="m-0! flex items-center gap-2 text-[13px] font-semibold leading-snug">'
      + (dot ? '<span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full" style="background: ' + dot + '"></span>' : '')
      + '<span class="min-w-0 truncate">' + esc(tt.title) + '</span></p>';
    if (tt.description) html += '<p class="m-0! mt-0.5! text-xs leading-snug text-text-secondary">' + esc(tt.description) + '</p>';
    if (tt.fields && tt.fields.length) {
      html += '<dl class="m-0! mt-1.5! flex flex-col">';
      tt.fields.forEach(function (f) {
        html += '<div class="flex min-h-6 items-center justify-between gap-4 border-t border-border py-0.5 text-xs">'
          + '<dt class="truncate text-text-secondary">' + esc(f.label) + '</dt>'
          + '<dd class="m-0 shrink-0 text-right font-medium tabular-nums text-text-primary">' + esc(f.value) + '</dd></div>';
      });
      html += '</dl>';
    }
    if (href) {
      html += '<p class="m-0! mt-1.5! border-t border-border pt-1.5"><a href="' + esc(href) + '" class="' + LINK_CLASS + '">' + esc(tt.linkLabel || 'Open') + '</a></p>';
    }
    return html + '</div>';
  }

  var api = {
    VARIANT_HEX: VARIANT_HEX, VARIANT_FILL: VARIANT_FILL, TILES: TILES, ESRI_ATTRIBUTION: ESRI_ATTRIBUTION,
    OSM_TILES: OSM_TILES, OSM_ATTRIBUTION: OSM_ATTRIBUTION, DIM_TILES_CLASS: DIM_TILES_CLASS, TILE_REFERRER_POLICY: TILE_REFERRER_POLICY,
    tileSourceTiles: tileSourceTiles, safeAttribution: safeAttribution, safeTileSource: safeTileSource,
    setTileSource: setTileSource, tileSource: tileSource, defaultTiles: defaultTiles, markerText: markerText,
    TIP_CLASS: TIP_CLASS, LABEL_CLASS: LABEL_CLASS, POPUP_CLASS: POPUP_CLASS, CANVAS_CLASS: CANVAS_CLASS, LINK_CLASS: LINK_CLASS,
    esc: esc, safeMarkerColor: safeMarkerColor, safeMarkerIcon: safeMarkerIcon, safeMarkerImage: safeMarkerImage, markerSvg: markerSvg, markerIcon: markerIcon,
    clusterMarkers: clusterMarkers, clusterColor: clusterColor, clusterIcon: clusterIcon,
    isInternalHref: isInternalHref, popupHtml: popupHtml
  };
  global.__KuiMapParts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
