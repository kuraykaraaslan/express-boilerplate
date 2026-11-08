/*
 * modules/app/WidgetKit/scripts/zoom-pane.js
 *
 * The full-screen zoom of a picture that zooms (a process diagram, `scada.scene`; kui-react ZoomPane.tsx + zoom-logic.ts).
 * scripts/widget-kit.js calls `open(card)` when the card goes full screen and `close(card)` when it leaves:
 *   - `open` wraps what the card body draws in the pane kui-react draws: the scroll pane (`role="group"`, `data-zoom`, the
 *     level as its name, the hint as its description), the picture box (`@container`, `zoom` x 100 % wide and high), the
 *     sr-only hint and the toolbar bottom-right (zoom out, the percent, zoom in, fit; disabled at the limits). The texts
 *     are the server's (`data-wk-zoom` on the card body, from the placement's `card.zoom*` messages);
 *   - it opens fitted (100 %). Ctrl or Cmd + wheel and a pinch zoom about the pointer, the + = - _ 0 keys and the buttons
 *     about the middle; the wheel and the scroll bars scroll; a drag (a mouse only on a zoomed picture, with the main
 *     button) moves the picture once it has gone 4 px, and the click that ends a drag or a pinch reaches nothing, so a
 *     press that does not move still clicks a symbol (the scene's hit areas keep working);
 *   - `close` puts the drawing back where it was and removes the pane, so the card is exactly as before (zoom 1 again on
 *     the next open).
 *   - `clampZoom`, `stepZoom`, `wheelZoom`, `scrollForZoom`, `zoomKey`, `zoomPercent` and the constants are ports of the
 *     vendored src/widget-kit/zoom-logic.ts, one to one, and `pinch` of kui-react's scene-editor-state.ts
 *     (tests/widget-kit-zoom.test.ts runs both over the same inputs and compares).
 *
 * Exposed as window.KuiZoomPane (and module.exports under Node).
 */
(function (global) {
  'use strict';

  /** 1 is the whole picture in the pane (fit); the view never zooms out past it. */
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 8;
  /** One button press or key: a quarter more, or a fifth less. */
  var ZOOM_STEP = 1.25;

  function clampZoom(z) { return Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : ZOOM_MIN; }

  /** One step in or out. A step that lands within a hair of fit is fit, so stepping back always reaches 100 %. */
  function stepZoom(z, dir) {
    var next = clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP);
    return Math.abs(next - ZOOM_MIN) < 0.01 ? ZOOM_MIN : next;
  }

  /** Ctrl + wheel: a mouse notch (about 100 px, or a line or page) is one step; a trackpad pinch zooms smoothly. */
  function wheelZoom(z, deltaY, deltaMode) {
    var mode = deltaMode === undefined ? 0 : deltaMode;
    var px = mode === 1 ? deltaY * 33 : mode === 2 ? deltaY * 800 : deltaY;
    if (Math.abs(px) >= 50) return stepZoom(z, px < 0 ? 1 : -1);
    return clampZoom(z * Math.exp(-px * 0.01));
  }

  /** The scroll that keeps `at` (pixels from the pane's top-left corner) over the same spot when the zoom changes. */
  function scrollForZoom(scroll, at, from, to) {
    var f = to / from;
    return { left: Math.max(0, (scroll.left + at.x) * f - at.x), top: Math.max(0, (scroll.top + at.y) * f - at.y) };
  }

  /** + and = zoom in, - zooms out, 0 fits (with or without Ctrl or Cmd); nothing with Alt. */
  function zoomKey(e) {
    if (e.altKey) return null;
    if (e.key === '+' || e.key === '=') return 'in';
    if (e.key === '-' || e.key === '_') return 'out';
    if (e.key === '0') return 'fit';
    return null;
  }

  function zoomPercent(z) { return Math.round(z * 100); }

  /** Two pointers moving: the zoom factor (distance ratio), the move of their middle and where the middle is now. */
  function pinch(a0, b0, a1, b1) {
    var d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
    var d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
    var m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    var m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    return { factor: d0 > 0 && d1 > 0 ? d1 / d0 : 1, dx: m1.x - m0.x, dy: m1.y - m0.y, mid: m1 };
  }

  var api = {
    ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX, ZOOM_STEP: ZOOM_STEP,
    clampZoom: clampZoom, stepZoom: stepZoom, wheelZoom: wheelZoom, scrollForZoom: scrollForZoom, zoomKey: zoomKey,
    zoomPercent: zoomPercent, pinch: pinch,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Inlined again on the same page (a second diagram without a shared runtimeOnce): the first copy stays.
  if (global.KuiZoomPane && global.KuiZoomPane.open) return;
  global.KuiZoomPane = api;
  if (typeof document === 'undefined') return;

  /** A press that moves less than this (pixels) is a click, not a drag. */
  var DRAG_PX = 4;
  // kui-react ZoomPane's classes, word for word (the Button is variant ghost, size sm, iconOnly).
  var WRAP = 'relative h-full min-h-[60vh]';
  var PANE = 'h-full overflow-auto overscroll-contain rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var TOOLBAR = 'absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5 shadow-sm';
  var BUTTON = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-text-primary hover:bg-surface-overlay p-1.5 text-sm';
  var LEVEL = 'min-w-11 px-1 text-center text-xs tabular-nums text-text-secondary';
  var seq = 0;

  api.open = function (card) {
    if (card.__wkZoom) return;
    var body = card.querySelector('[data-wk-zoom]');
    if (!body) return;
    var t;
    try { t = JSON.parse(body.getAttribute('data-wk-zoom') || ''); } catch (e) { return; }
    if (!t || typeof t !== 'object') return;
    var doc = body.ownerDocument || document;
    var make = function (tag, cls) { var n = doc.createElement(tag); if (cls) n.className = cls; return n; };
    var levelText = function (p) { return t.level ? t.level[0] + p + t.level[1] : (t.levels && t.levels[p]) || ''; };
    var hintId = 'wk-zoom-hint-' + (++seq);

    var wrap = make('div', WRAP);
    wrap.setAttribute('data-part', 'zoom-pane');
    var pane = make('div', PANE);
    pane.setAttribute('tabindex', '0');
    pane.setAttribute('role', 'group');
    pane.setAttribute('aria-describedby', hintId);
    // Touch pans and pinches here, not the page.
    pane.style.touchAction = 'none';
    var picture = make('div', '@container');
    while (body.firstChild) picture.appendChild(body.firstChild);
    pane.appendChild(picture);
    var hint = make('p', 'sr-only');
    hint.id = hintId;
    hint.textContent = t.zoomHint;
    var bar = make('div', TOOLBAR);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t.zoom);
    bar.setAttribute('title', t.zoomHint);
    var button = function (label, key, icon) {
      var b = make('button', BUTTON);
      b.setAttribute('type', 'button');
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label + ' (' + key + ')');
      var i = make('i', 'fas ' + icon + ' fa-fw');
      i.setAttribute('aria-hidden', 'true');
      b.appendChild(i);
      return b;
    };
    var out = button(t.zoomOut, '-', 'fa-magnifying-glass-minus');
    var level = make('span', LEVEL);
    level.setAttribute('aria-hidden', 'true');
    level.setAttribute('data-part', 'zoom-level');
    var inn = button(t.zoomIn, '+', 'fa-magnifying-glass-plus');
    var fitBtn = button(t.zoomFit, '0', 'fa-expand');
    bar.appendChild(out);
    bar.appendChild(level);
    bar.appendChild(inn);
    bar.appendChild(fitBtn);
    wrap.appendChild(pane);
    wrap.appendChild(hint);
    wrap.appendChild(bar);
    body.appendChild(wrap);

    var zoom = ZOOM_MIN;
    var panning = false;
    var pointers = new Map();
    var drag = null;
    var swallowClick = false;

    function draw() {
      var size = zoom * 100 + '%';
      pane.setAttribute('aria-label', levelText(zoomPercent(zoom)));
      pane.setAttribute('data-zoom', String(zoom));
      pane.className = PANE + (zoom > ZOOM_MIN ? (panning ? ' cursor-grabbing select-none' : ' cursor-grab') : '');
      picture.style.width = size;
      picture.style.height = size;
      level.textContent = zoomPercent(zoom) + '%';
      out.disabled = zoom <= ZOOM_MIN;
      inn.disabled = zoom >= ZOOM_MAX;
      fitBtn.disabled = zoom <= ZOOM_MIN;
    }
    function local(p) {
      var r = pane.getBoundingClientRect();
      return 'clientX' in p ? { x: p.clientX - r.left, y: p.clientY - r.top } : { x: p.x - r.left, y: p.y - r.top };
    }
    function zoomTo(to, at) {
      var from = zoom;
      var next = clampZoom(to);
      if (next === from) return;
      var s = scrollForZoom({ left: pane.scrollLeft, top: pane.scrollTop }, at || { x: pane.clientWidth / 2, y: pane.clientHeight / 2 }, from, next);
      zoom = next;
      // The picture has its new size before the scroll moves to the new spot.
      draw();
      pane.scrollLeft = s.left;
      pane.scrollTop = s.top;
    }
    function step(dir) { zoomTo(stepZoom(zoom, dir)); }
    function fit() { zoomTo(ZOOM_MIN); }
    function setPanning(v) { panning = v; draw(); }

    // Ctrl + wheel zooms instead of the page, so the listener cannot be passive; the wheel alone scrolls as usual.
    pane.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(wheelZoom(zoom, e.deltaY, e.deltaMode), local(e));
    }, { passive: false });
    pane.addEventListener('pointerdown', function (e) {
      swallowClick = false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size > 1) { drag = null; return; }
      // A mouse drags only a zoomed picture (there is nothing to move at fit) and only with the main button.
      if (e.pointerType === 'mouse' && (e.button !== 0 || zoom === ZOOM_MIN)) return;
      drag = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, scroll: { left: pane.scrollLeft, top: pane.scrollTop }, moved: false };
    });
    pane.addEventListener('pointermove', function (e) {
      var before = pointers.get(e.pointerId);
      if (!before) return;
      var now = { x: e.clientX, y: e.clientY };
      if (pointers.size === 2) {
        var both = Array.from(pointers.entries());
        var a = both[0];
        var b = both[1];
        pointers.set(e.pointerId, now);
        var r = pinch(a[1], b[1], pointers.get(a[0]), pointers.get(b[0]));
        pane.scrollLeft -= r.dx;
        pane.scrollTop -= r.dy;
        zoomTo(zoom * r.factor, local(r.mid));
        swallowClick = true;
        return;
      }
      pointers.set(e.pointerId, now);
      var d = drag;
      if (!d || d.id !== e.pointerId) return;
      var dx = now.x - d.start.x;
      var dy = now.y - d.start.y;
      if (!d.moved) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        d.moved = true;
        if (pane.setPointerCapture) pane.setPointerCapture(e.pointerId);
        setPanning(true);
      }
      pane.scrollLeft = d.scroll.left - dx;
      pane.scrollTop = d.scroll.top - dy;
    });
    var end = function (e) {
      pointers.delete(e.pointerId);
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved) { swallowClick = true; setPanning(false); }
      drag = null;
    };
    pane.addEventListener('pointerup', end);
    pane.addEventListener('pointercancel', end);
    // The click that ends a drag or a pinch is not a click on a symbol: stopped on the way down, before the card sees it.
    pane.addEventListener('click', function (e) {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    pane.addEventListener('keydown', function (e) {
      var k = zoomKey(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'fit') fit(); else step(k === 'in' ? 1 : -1);
    });
    out.addEventListener('click', function () { step(-1); });
    inn.addEventListener('click', function () { step(1); });
    fitBtn.addEventListener('click', fit);
    draw();

    card.__wkZoom = {
      body: body,
      close: function () {
        while (picture.firstChild) body.insertBefore(picture.firstChild, wrap);
        body.removeChild(wrap);
      },
    };
  };

  api.close = function (card) {
    var z = card.__wkZoom;
    if (!z) return;
    card.__wkZoom = null;
    z.close();
  };
})(typeof window !== 'undefined' ? window : globalThis);
