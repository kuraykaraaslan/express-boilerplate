/*
 * modules/ui/ServiceMap/scripts/service-map.js
 *
 * Behaviour of ServiceMap (kui-react modules/ui/ServiceMap/index.tsx): the measured size and the fit-to-view
 * transform, pan (drag on the background, Shift + arrows), zoom (buttons, + / - / 0, Ctrl or Cmd + wheel around the
 * cursor), roving-focus keyboard navigation along the call graph (arrows follow calls, Up / Down move between
 * siblings of a layer, Home / End, Enter / Space select, Escape clears), node selection with its panel, the dimming
 * of what the selection does not touch, and the mirrored layout when the page is right to left. Needs map-model.js
 * (window.KuiServiceMapModel) first.
 *
 * The server draws the whole map for the state at render time (at the width the `width` local says); this file
 * measures the real width and fits the drawing to it, then only changes attributes: the transform of the viewport
 * group, the aria-pressed / opacity / stroke of nodes and edges, the tabindex of the roving focus and, on a mirrored
 * page, the geometry of nodes, edges and badges. The panel of a selected service is taken from the page:
 * <template data-sm-panels> holds one panel per service, drawn by the server.
 *
 * Idempotent: window.KuiServiceMap.autoInit() mounts every [data-sm-root] once. Events on the root (bubble):
 *   kui:service-map-select   { id, node }   a service was selected, or cleared (id and node null)
 * A root with data-sm-select-controlled only emits the event; the host applies the state with
 * KuiServiceMap.select(root, id). KuiServiceMap.fit(root) and KuiServiceMap.zoom(root, factor) are the buttons.
 */
(function (global) {
  'use strict';
  if (global.KuiServiceMap) return;
  var Model = global.KuiServiceMapModel;

  var STROKE = { ok: 'var(--border-strong)', warn: 'var(--warning)', error: 'var(--error)', unknown: 'var(--border)' };

  function nodeStrokeWidth(health, selected) {
    return selected ? 3 : health === 'error' ? 2.5 : health === 'warn' ? 2 : 1.25;
  }

  function mount(root) {
    if (root.getAttribute('data-sm-mounted')) return;
    var svg = root.querySelector('[data-sm-svg]');
    var box = root.querySelector('[data-sm-box]');
    var viewEl = root.querySelector('[data-sm-view]');
    if (!svg || !box || !viewEl) return;
    root.setAttribute('data-sm-mounted', 'true');

    var cfg;
    try { cfg = JSON.parse(root.getAttribute('data-sm-config') || '{}'); } catch (e) { cfg = {}; }
    var nodesIn = cfg.nodes || [];
    var edgesIn = cfg.edges || [];
    var selectControlled = root.hasAttribute('data-sm-select-controlled');
    var panelsTpl = root.querySelector('template[data-sm-panels]');

    var nodeById = {};
    nodesIn.forEach(function (n) { nodeById[n.id] = n; });
    var nodeEls = {};
    Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (el) { nodeEls[el.getAttribute('data-node-id')] = el; });
    var edgeEls = {};
    Array.prototype.forEach.call(svg.querySelectorAll('[data-sm-edge]'), function (el) { edgeEls[el.getAttribute('data-sm-edge')] = el; });

    var st = {
      w: cfg.width, h: cfg.height, rtl: !!cfg.rtl, touched: false, panning: false, activeId: null,
      selected: cfg.selected != null ? cfg.selected : null, view: null, fitKey: '', layout: null, placed: {}, order: []
    };
    var drag = null;

    function emit(name, detail) { root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); }

    // ── Layout and view ────────────────────────────────────────────────────────────────────────────
    function layOut() {
      st.layout = Model.layoutServiceMap(nodesIn, edgesIn, { nodeWidth: Model.NODE_W, nodeHeight: Model.NODE_H, direction: st.rtl ? 'rtl' : 'ltr' });
      st.placed = {};
      st.layout.nodes.forEach(function (n) { st.placed[n.id] = n; });
      st.order = [];
      st.layout.layers.forEach(function (l) { st.order = st.order.concat(l); });
    }
    function computeFit() { return Model.fitView(st.layout.width, st.layout.height, st.w, st.h); }
    function keyOf() { return Math.round(st.layout.width) + 'x' + Math.round(st.layout.height) + '@' + st.w + 'x' + st.h; }
    function paintView() { viewEl.setAttribute('transform', Model.viewTransform(st.view)); }
    function setView(v) { st.view = v; paintView(); }
    function fit() { st.touched = false; setView(computeFit()); }
    function zoomAt(factor, cx, cy) {
      st.touched = true;
      var v = st.view;
      var k = Model.clampK(v.k * factor);
      var f = k / v.k;
      setView({ k: k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f });
    }

    layOut();
    st.view = computeFit();
    st.fitKey = keyOf();

    // Geometry of the mirrored layout, in place: the set of nodes and edges and their order do not change. The
    // drawing's text direction follows the layout, and inside each node the captions, the warning icon and the
    // error badge move to the other side (kui-react NodeView), so the captions stay inside their boxes.
    function paintGeometry() {
      svg.setAttribute('direction', st.rtl ? 'rtl' : 'ltr');
      st.layout.nodes.forEach(function (pn) {
        var el = nodeEls[pn.id];
        if (!el) return;
        el.setAttribute('transform', 'translate(' + pn.x + ' ' + pn.y + ')');
        Array.prototype.forEach.call(el.querySelectorAll('[data-sm-caption]'), function (t) { t.setAttribute('x', String(st.rtl ? pn.width - 12 : 12)); });
        var icon = el.querySelector('[data-sm-icon]');
        if (icon) icon.setAttribute('transform', 'translate(' + (st.rtl ? 10 : pn.width - 24) + ' 8)');
        var badge = el.querySelector('[data-sm-badge]');
        if (badge) badge.setAttribute('x', String(st.rtl ? 12 : pn.width - 12));
      });
      st.layout.edges.forEach(function (pe) {
        var el = edgeEls[pe.id];
        if (!el) return;
        var path = el.querySelector('path');
        if (path) path.setAttribute('d', pe.path);
        var badge = null;
        for (var i = 0; i < el.children.length; i++) if (el.children[i].tagName.toLowerCase() === 'g') badge = el.children[i];
        if (badge) badge.setAttribute('transform', 'translate(' + pe.mid.x + ' ' + pe.mid.y + ')');
      });
    }

    // Until the viewer moves the map, keep it fitted when the layout or the box changes.
    function refit() {
      var key = keyOf();
      if (key === st.fitKey) return;
      st.fitKey = key;
      if (!st.touched) setView(computeFit());
    }
    function measure() {
      var w = Math.max(0, Math.floor(box.getBoundingClientRect().width));
      if (w <= 0 || w === st.w) return;
      st.w = w;
      svg.setAttribute('width', String(w));
      refit();
    }

    // ── Selection, roving focus ────────────────────────────────────────────────────────────────────
    function activeNow() {
      if (st.activeId != null && st.placed[st.activeId]) return st.activeId;
      if (st.selected != null && st.placed[st.selected]) return st.selected;
      return st.order.length ? st.order[0] : null;
    }
    function paintActive() {
      var a = activeNow();
      Object.keys(nodeEls).forEach(function (id) { nodeEls[id].setAttribute('tabindex', id === a ? '0' : '-1'); });
    }
    function touches(sel, id) {
      return st.layout.edges.some(function (e) { return (e.from === sel && e.to === id) || (e.to === sel && e.from === id); });
    }
    function paintSelection() {
      var sel = st.selected;
      Object.keys(nodeEls).forEach(function (id) {
        var el = nodeEls[id];
        var isSel = sel === id;
        var health = el.getAttribute('data-health');
        el.setAttribute('aria-pressed', isSel ? 'true' : 'false');
        el.setAttribute('opacity', sel !== null && !isSel && !touches(sel, id) ? '0.45' : '1');
        var rect = el.querySelector('rect');
        if (rect) {
          var stroke = isSel ? 'var(--primary)' : STROKE[health];
          if (stroke) rect.setAttribute('stroke', stroke); else rect.removeAttribute('stroke');
          rect.setAttribute('stroke-width', String(nodeStrokeWidth(health, isSel)));
        }
      });
      Object.keys(edgeEls).forEach(function (id) {
        var el = edgeEls[id];
        var dim = sel !== null && el.getAttribute('data-sm-edge-from') !== sel && el.getAttribute('data-sm-edge-to') !== sel;
        el.setAttribute('opacity', dim ? '0.3' : '1');
      });
      paintActive();
      paintPanel();
    }
    function panelOf(el) { return el.hasAttribute && el.hasAttribute('data-sm-panel'); }
    function paintPanel() {
      var current = null;
      Array.prototype.forEach.call(root.children, function (el) { if (panelOf(el)) current = el; });
      var want = null;
      if (st.selected !== null && panelsTpl) {
        Array.prototype.forEach.call(panelsTpl.content.children, function (el) { if (el.getAttribute('data-sm-panel') === st.selected) want = el; });
      }
      if (current && want && current.getAttribute('data-sm-panel') === st.selected) return;
      if (current) root.removeChild(current);
      if (want) box.parentNode.insertBefore(want.cloneNode(true), box.nextSibling);
    }
    function setSelected(id) {
      st.selected = id !== null && st.placed[id] ? id : null;
      paintSelection();
    }
    function requestSelect(id) {
      emit('kui:service-map-select', { id: id, node: id !== null && nodeById[id] ? nodeById[id] : null });
      if (!selectControlled) setSelected(id);
    }

    function ensureVisible(n) {
      var v = st.view;
      var m = 24;
      var left = n.x * v.k + v.x;
      var right = (n.x + n.width) * v.k + v.x;
      var top = n.y * v.k + v.y;
      var bottom = (n.y + n.height) * v.k + v.y;
      var x = v.x;
      var y = v.y;
      if (left < m) x += m - left; else if (right > st.w - m) x -= right - (st.w - m);
      if (top < m) y += m - top; else if (bottom > st.h - m) y -= bottom - (st.h - m);
      if (x !== v.x || y !== v.y) setView({ x: x, y: y, k: v.k });
    }
    function focusNode(id) {
      st.activeId = id;
      var n = st.placed[id];
      if (n) ensureVisible(n);
      paintActive();
      requestAnimationFrame(function () {
        var el = nodeEls[id];
        if (el && el.focus) el.focus({ preventScroll: true });
      });
    }
    function nearestByY(ids, from) {
      var best = null;
      var dist = Infinity;
      ids.forEach(function (id) {
        var n = st.placed[id];
        if (!n) return;
        var d = Math.abs(n.y - from.y);
        if (d < dist) { dist = d; best = id; }
      });
      return best;
    }

    // ── Events ─────────────────────────────────────────────────────────────────────────────────────
    svg.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var cx = st.w / 2;
      var cy = st.h / 2;
      if (e.key === '+' || e.key === '=') { zoomAt(1.2, cx, cy); e.preventDefault(); return; }
      if (e.key === '-' || e.key === '_') { zoomAt(1 / 1.2, cx, cy); e.preventDefault(); return; }
      if (e.key === '0') { fit(); e.preventDefault(); return; }
      if (e.shiftKey && e.key.indexOf('Arrow') === 0) {
        st.touched = true;
        var step = 48;
        var v = st.view;
        setView({ k: v.k, x: v.x + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0), y: v.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) });
        e.preventDefault();
        return;
      }
      var active = activeNow();
      if (active === null) return;
      var me = st.placed[active];
      if (!me) return;
      var nb = Model.neighbours(st.layout, active);
      // Along the flow = toward callees. The flow points left to right, or right to left when mirrored.
      var forward = st.rtl ? 'ArrowLeft' : 'ArrowRight';
      var backward = st.rtl ? 'ArrowRight' : 'ArrowLeft';
      var target = null;
      var key = e.key;
      if (key === forward) target = nearestByY(nb.downstream, me);
      else if (key === backward) target = nearestByY(nb.upstream, me);
      else if (key === 'ArrowDown') { var nx = nb.sameLayer[nb.sameLayer.indexOf(active) + 1]; target = nx !== undefined ? nx : null; }
      else if (key === 'ArrowUp') { var pv = nb.sameLayer[nb.sameLayer.indexOf(active) - 1]; target = pv !== undefined ? pv : null; }
      else if (key === 'Home') target = st.order.length ? st.order[0] : null;
      else if (key === 'End') target = st.order.length ? st.order[st.order.length - 1] : null;
      else if (key === 'Enter' || key === ' ') { requestSelect(st.selected === active ? null : active); e.preventDefault(); return; }
      else if (key === 'Escape') { if (st.selected !== null) { requestSelect(null); e.preventDefault(); } return; }
      else return;
      e.preventDefault();
      if (target !== null) focusNode(target);
    });

    // Pan with the pointer on the background; a click that did not move clears the selection.
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('[data-node-id]'))) return;
      drag = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y, moved: false };
      if (svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function (e) {
      var d = drag;
      if (!d) return;
      var dx = e.clientX - d.x;
      var dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      if (!st.panning) { st.panning = true; svg.style.cursor = 'grabbing'; }
      st.touched = true;
      setView({ k: st.view.k, x: d.vx + dx, y: d.vy + dy });
    });
    function pointerEnd(e) {
      var d = drag;
      drag = null;
      st.panning = false;
      svg.style.cursor = 'grab';
      if (d && svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      if (d && !d.moved && st.selected !== null) requestSelect(null);
    }
    svg.addEventListener('pointerup', pointerEnd);
    svg.addEventListener('pointercancel', pointerEnd);
    // Ctrl / Cmd + wheel zooms around the cursor; a plain wheel scrolls the page as usual. A non-passive listener is
    // what lets it cancel the page zoom.
    svg.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var r = svg.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var button = t.closest('[data-sm-action]');
      if (button && root.contains(button)) {
        var action = button.getAttribute('data-sm-action');
        if (action === 'zoom-in') zoomAt(1.2, st.w / 2, st.h / 2);
        else if (action === 'zoom-out') zoomAt(1 / 1.2, st.w / 2, st.h / 2);
        else if (action === 'fit') fit();
        return;
      }
      if (t.closest('[data-sm-clear]')) { requestSelect(null); return; }
      var nodeEl = t.closest('[data-node-id]');
      if (nodeEl && svg.contains(nodeEl)) {
        var id = nodeEl.getAttribute('data-node-id');
        e.stopPropagation();
        st.activeId = id;
        requestSelect(st.selected === id ? null : id);
      }
    });
    svg.addEventListener('focusin', function (e) {
      var nodeEl = e.target.closest && e.target.closest('[data-node-id]');
      if (nodeEl) { st.activeId = nodeEl.getAttribute('data-node-id'); paintActive(); }
    });

    // ── Start: the page direction, the measured width ──────────────────────────────────────────────
    if (cfg.auto && global.getComputedStyle && global.getComputedStyle(root).direction === 'rtl' && !st.rtl) {
      st.rtl = true;
      layOut();
      paintGeometry();
      st.fitKey = '';
      refit();
    }
    measure();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(box);

    root._kuiServiceMap = {
      select: function (id) { setSelected(id == null ? null : id); },
      fit: fit,
      zoom: function (factor) { zoomAt(factor, st.w / 2, st.h / 2); }
    };
  }

  function autoInit(scope) {
    var host = scope && scope.querySelectorAll ? scope : document;
    Array.prototype.forEach.call(host.querySelectorAll('[data-sm-root]'), mount);
  }
  function api(root) { return root && root._kuiServiceMap; }

  global.KuiServiceMap = {
    mount: mount,
    autoInit: autoInit,
    select: function (root, id) { var a = api(root); if (a) a.select(id); },
    fit: function (root) { var a = api(root); if (a) a.fit(); },
    zoom: function (root, factor) { var a = api(root); if (a) a.zoom(factor); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
