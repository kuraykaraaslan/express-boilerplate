/*
 * modules/app/WidgetKit/scripts/map-replay.js
 *
 * Route replay of the WidgetKit map (kui-react views/MapView.tsx + map-logic.ts). The routes, their times and their pace
 * are the vendored model's (`replayModel`, serialised by the server into `data-wk-replay`); this script holds the viewer's
 * state (playing, where, how fast) and draws it:
 *   - `replayAt` and `replayMarkers` are ports of map-logic.ts, one to one (tests/widget-kit-map-replay.test.ts runs both
 *     over the same routes and compares);
 *   - `mount(card, el)` wires the controls (Play / Pause, the range slider, the time or percent text, the speed buttons)
 *     and, once the map is built (`kui:map-ready`), a layer with a start and an end dot and a moving point per route. The
 *     layer joins the map's `markerLayers`, so the card's "Markers" switch shows and hides it with the other markers.
 *
 * Exposed as window.KuiMapReplay (and module.exports under Node).
 */
(function (global) {
  'use strict';

  function r2(n) { return Math.round(n * 100) / 100; }

  /** Where a route is at `progress` (0 to 1): by time when the points carry times, else by distance walked. */
  function replayAt(route, progress) {
    var p = Math.min(1, Math.max(0, typeof progress === 'number' && isFinite(progress) ? progress : 0));
    var last = route.positions.length - 1;
    var t = route.times;
    var along = t ? t[0] + p * (t[last] - t[0]) : p * route.total;
    var marks = t || route.cumulative;
    var i = 0;
    while (i < last - 1 && marks[i + 1] < along) i += 1;
    var span = marks[i + 1] - marks[i];
    var f = span > 0 ? Math.min(1, Math.max(0, (along - marks[i]) / span)) : 0;
    var a = route.positions[i];
    var b = route.positions[i + 1];
    return {
      position: [r2(a[0] + (b[0] - a[0]) * f), r2(a[1] + (b[1] - a[1]) * f)],
      time: t ? Math.round(along) : null,
      index: i
    };
  }

  /** The markers a replay adds: the start, the end and the moving point (not clickable rows). */
  function replayMarkers(routes, progress, texts, time) {
    var out = [];
    routes.forEach(function (r) {
      var at = replayAt(r, progress);
      var name = r.label || '';
      var now = { id: 'replay:' + r.id + ':now', position: at.position, shape: 'circle', color: r.color, size: 22 };
      if (at.time !== null && time) now.tooltip = { title: time(at.time) };
      out.push(
        { id: 'replay:' + r.id + ':start', position: r.positions[0], shape: 'dot', color: 'var(--success)', size: 12, tooltip: { title: name ? name + ' · ' + texts.start : texts.start } },
        { id: 'replay:' + r.id + ':end', position: r.positions[r.positions.length - 1], shape: 'dot', color: 'var(--error)', size: 12, tooltip: { title: name ? name + ' · ' + texts.end : texts.end } },
        now
      );
    });
    return out;
  }

  var api = { replayAt: replayAt, replayMarkers: replayMarkers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KuiMapReplay = api;
  if (typeof document === 'undefined') return;

  var SPEED_ON = ['bg-primary', 'text-primary-fg'];
  var SPEED_OFF = ['hover:bg-surface-sunken'];

  api.mount = function (card, el) {
    if (el.__kuiReplay) return;
    var cfg;
    try { cfg = JSON.parse(el.getAttribute('data-wk-replay') || ''); } catch (e) { return; }
    if (!cfg || !cfg.routes || !cfg.routes.length) return;
    var playBtn = el.querySelector('[data-wk-replay-play]');
    var range = el.querySelector('[data-wk-replay-range]');
    var timeEl = el.querySelector('[data-wk-replay-time]');
    var speedBtns = el.querySelectorAll('[data-wk-replay-speed]');
    var progress = 0;
    var playing = false;
    var speed = cfg.speed;
    var raf = 0;
    var last = 0;
    var ctx = null;
    var group = null;
    var nowMarkers = {};

    function timeText(ms) { return new Date(ms).toLocaleString(cfg.locale || undefined); }
    function nowText() {
      return cfg.timeSpan ? timeText(cfg.timeSpan.from + progress * (cfg.timeSpan.to - cfg.timeSpan.from)) : Math.round(progress * 100) + ' %';
    }

    function drawMap() {
      if (!ctx || !group) return;
      cfg.routes.forEach(function (r) {
        var marker = nowMarkers[r.id];
        if (!marker) return;
        var at = replayAt(r, progress);
        marker.setLatLng(ctx.flip(at.position));
        if (at.time !== null && marker.setTooltipContent && global.__KuiMapParts) marker.setTooltipContent(global.__KuiMapParts.popupHtml({ title: timeText(at.time) }));
      });
    }

    function draw() {
      if (range) range.value = String(Math.round(progress * 1000));
      if (timeEl) timeEl.textContent = nowText();
      if (playBtn) playBtn.textContent = playing ? cfg.texts.pause : cfg.texts.play;
      for (var i = 0; i < speedBtns.length; i++) {
        var on = Number(speedBtns[i].getAttribute('data-wk-replay-speed')) === speed;
        speedBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        SPEED_ON.forEach(function (c) { speedBtns[i].classList.toggle(c, on); });
        SPEED_OFF.forEach(function (c) { speedBtns[i].classList.toggle(c, !on); });
      }
      drawMap();
    }

    function stop() { playing = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    function tick(now) {
      var dt = (now - last) / 1000;
      last = now;
      progress += (dt * speed) / cfg.seconds;
      if (progress >= 1) { progress = 1; playing = false; }
      draw();
      raf = playing ? requestAnimationFrame(tick) : 0;
    }

    if (playBtn) playBtn.addEventListener('click', function () {
      if (playing) { stop(); draw(); return; }
      if (progress >= 1) progress = 0;
      playing = true;
      last = performance.now();
      draw();
      raf = requestAnimationFrame(tick);
    });
    if (range) range.addEventListener('input', function () { stop(); progress = Number(range.value) / 1000; draw(); });
    for (var s = 0; s < speedBtns.length; s++) {
      speedBtns[s].addEventListener('click', function (e) { speed = Number(e.currentTarget.getAttribute('data-wk-replay-speed')); draw(); });
    }

    // The map is built when it scrolls into view: the layer is made once it exists.
    function build() {
      var mapEl = card.querySelector('[data-wk-map] [id$="-map"]');
      var c = mapEl && mapEl.__kuiMap;
      if (!c || !c.markerFor || !global.L || group) return;
      ctx = c;
      group = global.L.layerGroup();
      replayMarkers(cfg.routes, progress, cfg.texts, timeText).forEach(function (m) {
        var layer = c.markerFor(m);
        group.addLayer(layer);
        var parts = m.id.split(':');
        if (parts[parts.length - 1] === 'now') nowMarkers[m.id.slice('replay:'.length, m.id.length - ':now'.length)] = layer;
      });
      var box = card.querySelector('[data-wk-layer="markers"]');
      if (!box || box.checked) group.addTo(c.map);
      c.markerLayers.push(group);
      drawMap();
    }
    card.addEventListener('kui:map-ready', build);
    build();
    el.__kuiReplay = true;
    draw();
  };
})(typeof window !== 'undefined' ? window : globalThis);
