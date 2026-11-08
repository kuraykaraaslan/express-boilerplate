/*
 * modules/ui/ServiceMap/map-model.js
 *
 * Pure model of the service map: the deterministic layered layout, the health of a node, the neighbours used by
 * the keyboard, the fit-to-view transform and the few numbers the markup is drawn from. A port of kui-react
 * modules/ui/ServiceMap/layout.ts and of the helpers of modules/ui/ServiceMap/index.tsx (healthOf, fitView), written
 * so that the same input gives the same coordinates, digit for digit (tests/service-map-parity.test.ts holds the
 * markup to kui-react's). No DOM. One source for both sides: the partial loads it on the server through
 * _observability/_load.ejs, the browser script is inlined after it, and tests/service-map.test.ts runs it under
 * Node. Exposed as window.KuiServiceMapModel (and module.exports under Node).
 *
 * The layout (no graph library):
 *   1. cycles are cut by reversing back edges (DFS in input order);
 *   2. nodes get a layer by longest path from the sources;
 *   3. edges spanning several layers get one dummy point per layer they cross, so they route between nodes;
 *   4. order inside each layer is improved by barycenter sweeps (ties broken by input order);
 *   5. y coordinates follow the neighbours' average while keeping the order and a minimum gap.
 */
(function (global) {
  'use strict';
  if (global.KuiServiceMapModel) return;

  var NODE_W = 184;
  var NODE_H = 64;
  var MIN_K = 0.25;
  var MAX_K = 2.5;

  function maxOf(list, floor) {
    var m = floor;
    for (var i = 0; i < list.length; i++) if (list[i] > m) m = list[i];
    return m;
  }

  function layoutServiceMap(nodesIn, edgesIn, opts) {
    opts = opts || {};
    var nodeW = opts.nodeWidth != null ? opts.nodeWidth : 184;
    var nodeH = opts.nodeHeight != null ? opts.nodeHeight : 64;
    var gapX = opts.gapX != null ? opts.gapX : 96;
    var gapY = opts.gapY != null ? opts.gapY : 28;
    var pad = opts.padding != null ? opts.padding : 24;
    var rtl = opts.direction === 'rtl';

    var ids = [];
    var seen = new Set();
    nodesIn.forEach(function (n) { if (!seen.has(n.id)) { seen.add(n.id); ids.push(n.id); } });

    // Edges: known endpoints, no self loops, one per (from, to) pair; ids stay stable.
    var edges = [];
    var pair = new Set();
    edgesIn.forEach(function (e) {
      if (!seen.has(e.from) || !seen.has(e.to) || e.from === e.to) return;
      var k = e.from + '\u0000' + e.to;
      if (pair.has(k)) return;
      pair.add(k);
      edges.push({ id: e.id != null ? e.id : e.from + '->' + e.to, from: e.from, to: e.to });
    });

    // 1. Cut cycles: a DFS in input order; an edge to a node still on the stack is a back edge and is reversed for layering.
    var out = new Map();
    ids.forEach(function (id) { out.set(id, []); });
    edges.forEach(function (e) { out.get(e.from).push(e.to); });
    var state = new Map();
    var reversed = new Set();
    function visit(u) {
      state.set(u, 1);
      var next = out.get(u);
      for (var i = 0; i < next.length; i++) {
        var v = next[i];
        var s = state.get(v) || 0;
        if (s === 1) reversed.add(u + '\u0000' + v);
        else if (s === 0) visit(v);
      }
      state.set(u, 2);
    }
    ids.forEach(function (id) { if (!state.get(id)) visit(id); });
    var dag = edges.map(function (e) {
      return reversed.has(e.from + '\u0000' + e.to) ? { id: e.id, from: e.to, to: e.from, back: true } : { id: e.id, from: e.from, to: e.to, back: false };
    });

    // 2. Longest-path layering (Kahn, input order for determinism).
    var indeg = new Map();
    var succ = new Map();
    ids.forEach(function (id) { indeg.set(id, 0); succ.set(id, []); });
    dag.forEach(function (e) { indeg.set(e.to, indeg.get(e.to) + 1); succ.get(e.from).push(e.to); });
    var layer = new Map();
    var queue = ids.filter(function (id) { return indeg.get(id) === 0; });
    queue.forEach(function (id) { layer.set(id, 0); });
    for (var qi = 0; qi < queue.length; qi++) {
      var u = queue[qi];
      var ss = succ.get(u);
      for (var si = 0; si < ss.length; si++) {
        var v = ss[si];
        layer.set(v, Math.max(layer.has(v) ? layer.get(v) : 0, layer.get(u) + 1));
        indeg.set(v, indeg.get(v) - 1);
        if (indeg.get(v) === 0) queue.push(v);
      }
    }
    ids.forEach(function (id) { if (!layer.has(id)) layer.set(id, 0); });

    // 3. Dummy vertices for edges that cross layers.
    var vertices = new Map();
    ids.forEach(function (id) { vertices.set(id, { key: id, real: true, layer: layer.get(id), order: 0, y: 0 }); });
    var chains = [];
    var adj = new Map();
    function ensureAdj(k) { if (!adj.has(k)) adj.set(k, { up: [], down: [] }); return adj.get(k); }
    dag.forEach(function (e) {
      var l0 = layer.get(e.from);
      var l1 = layer.get(e.to);
      var keys = [e.from];
      for (var l = l0 + 1; l < l1; l++) {
        var key = '\u0001' + e.id + '@' + l;
        vertices.set(key, { key: key, real: false, layer: l, order: 0, y: 0 });
        keys.push(key);
      }
      keys.push(e.to);
      for (var j = 0; j + 1 < keys.length; j++) { ensureAdj(keys[j]).down.push(keys[j + 1]); ensureAdj(keys[j + 1]).up.push(keys[j]); }
      chains.push({ keys: keys });
    });

    var vlayers = [];
    vertices.forEach(function (v) { vlayers.push(v.layer); });
    var layerCount = maxOf(vlayers, 0) + 1;
    var layers = [];
    for (var li0 = 0; li0 < (ids.length ? layerCount : 0); li0++) layers.push([]);
    vertices.forEach(function (v) { layers[v.layer].push(v.key); });
    // Initial order: real nodes in input order, dummies after the real nodes they leave.
    var inputIndex = new Map();
    ids.forEach(function (id, i) { inputIndex.set(id, i); });
    var creation = new Map();
    var ci = 0;
    vertices.forEach(function (v, k) { creation.set(k, ci++); });
    function rank(k) { return inputIndex.has(k) ? inputIndex.get(k) : ids.length + (creation.has(k) ? creation.get(k) : 0); }
    layers.forEach(function (l) { l.sort(function (a, b) { return rank(a) - rank(b); }); });
    function reindex() { layers.forEach(function (l) { l.forEach(function (k, i) { vertices.get(k).order = i; }); }); }
    reindex();

    // 4. Barycenter sweeps.
    function bary(k, side) {
      var a = adj.get(k);
      var ns = a ? a[side] : [];
      if (!ns.length) return vertices.get(k).order;
      var sum = 0;
      ns.forEach(function (n) { sum += vertices.get(n).order; });
      return sum / ns.length;
    }
    var layerIdx = layers.map(function (_, i) { return i; });
    for (var pass = 0; pass < 6; pass++) {
      var down = pass % 2 === 0;
      var range = down ? layerIdx.slice(1) : layerIdx.slice(0, -1).reverse();
      for (var ri = 0; ri < range.length; ri++) {
        var li = range[ri];
        var side = down ? 'up' : 'down';
        var keyed = layers[li].map(function (k, i) { return { k: k, b: bary(k, side), i: i }; });
        keyed.sort(function (a, b) { return (a.b - b.b) || (a.i - b.i); });
        layers[li] = keyed.map(function (x) { return x.k; });
        reindex();
      }
    }

    // 5. Coordinates: stack each layer, centre it, then relax toward neighbour averages keeping order and gaps.
    function slot(v) { return v.real ? nodeH : 8; }
    function gap(a, b) { return a.real && b.real ? gapY : Math.max(10, gapY / 2); }
    function stack(l) {
      var y = 0;
      l.forEach(function (k, i) {
        var v = vertices.get(k);
        if (i > 0) y += gap(vertices.get(l[i - 1]), v);
        v.y = y + slot(v) / 2;
        y += slot(v);
      });
      return y;
    }
    var heights = layers.map(stack);
    var maxH = maxOf(heights, 0);
    layers.forEach(function (l, i) { var shift = (maxH - heights[i]) / 2; l.forEach(function (k) { vertices.get(k).y += shift; }); });
    function relax(lix, sideName) {
      var l = layers[lix];
      var want = l.map(function (k) {
        var a = adj.get(k);
        var ns = a ? a[sideName] : [];
        if (!ns.length) return vertices.get(k).y;
        var sum = 0;
        ns.forEach(function (n) { sum += vertices.get(n).y; });
        return sum / ns.length;
      });
      // Place in order with minimum separation, as close to `want` as the order allows (two sweeps settle it).
      var ys = want.slice();
      var i;
      for (i = 1; i < l.length; i++) {
        var min = ys[i - 1] + slot(vertices.get(l[i - 1])) / 2 + gap(vertices.get(l[i - 1]), vertices.get(l[i])) + slot(vertices.get(l[i])) / 2;
        if (ys[i] < min) ys[i] = min;
      }
      for (i = l.length - 2; i >= 0; i--) {
        var max = ys[i + 1] - slot(vertices.get(l[i + 1])) / 2 - gap(vertices.get(l[i]), vertices.get(l[i + 1])) - slot(vertices.get(l[i])) / 2;
        if (ys[i] > max && want[i] <= max + 1e-6) ys[i] = max;
      }
      l.forEach(function (k, j) { vertices.get(k).y = ys[j]; });
    }
    for (var rp = 0; rp < 4; rp++) {
      for (var a1 = 1; a1 < layers.length; a1++) relax(a1, 'up');
      for (var a2 = layers.length - 2; a2 >= 0; a2--) relax(a2, 'down');
    }
    // Normalise so the top-most vertex sits at the padding.
    var minY = Infinity;
    var maxY = -Infinity;
    vertices.forEach(function (v) { minY = Math.min(minY, v.y - slot(v) / 2); maxY = Math.max(maxY, v.y + slot(v) / 2); });
    if (!isFinite(minY)) { minY = 0; maxY = 0; }
    vertices.forEach(function (v) { v.y += pad - minY; });

    var width = layers.length ? layers.length * nodeW + (layers.length - 1) * gapX + pad * 2 : pad * 2;
    var height = maxY - minY + pad * 2;
    function xOf(lix, w) {
      var x = pad + lix * (nodeW + gapX);
      return rtl ? width - x - w : x;
    }

    var nodes = ids.map(function (id) {
      var v = vertices.get(id);
      return { id: id, x: xOf(v.layer, nodeW), y: v.y - nodeH / 2, width: nodeW, height: nodeH, layer: v.layer, order: v.order };
    });
    var nodeIndex = new Map();
    nodes.forEach(function (n) { nodeIndex.set(n.id, n); });

    var placedEdges = edges.map(function (e, i) {
      var isBack = reversed.has(e.from + '\u0000' + e.to);
      var a = nodeIndex.get(e.from);
      var b = nodeIndex.get(e.to);
      var flip = rtl ? -1 : 1;
      var points;
      if (isBack) {
        // Against the flow: leave the top of the source, arc over, enter the top of the target.
        var top = Math.min(a.y, b.y) - 36;
        points = [{ x: a.x + a.width / 2, y: a.y }, { x: (a.x + b.x + a.width) / 2, y: top }, { x: b.x + b.width / 2, y: b.y }];
      } else {
        var keys = chains[i].keys;
        points = keys.map(function (k, j) {
          var v = vertices.get(k);
          if (v.real) {
            var n = nodeIndex.get(k);
            // Leave from the downstream edge of the source, enter at the upstream edge of the target.
            var leaving = j === 0;
            return { x: n.x + (leaving ? (flip > 0 ? n.width : 0) : (flip > 0 ? 0 : n.width)), y: n.y + n.height / 2 };
          }
          return { x: xOf(v.layer, nodeW) + nodeW / 2, y: v.y };
        });
      }
      return { id: e.id, from: e.from, to: e.to, points: points, back: isBack, mid: polylineMid(points), path: smoothPath(points, isBack) };
    });

    return {
      nodes: nodes, edges: placedEdges, width: width, height: height,
      layers: layers.map(function (l) { return l.filter(function (k) { return vertices.get(k).real; }); })
    };
  }

  function polylineMid(points) {
    var total = 0;
    var i;
    for (i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    var walk = total / 2;
    for (i = 1; i < points.length; i++) {
      var seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (walk <= seg && seg > 0) {
        var t = walk / seg;
        return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
      }
      walk -= seg;
    }
    return points[0] || { x: 0, y: 0 };
  }

  /** A smooth path through the points: horizontal tangents at each point (a quadratic for an arc over a node). */
  function smoothPath(points, arc) {
    if (points.length < 2) return '';
    function r(n) { return Math.round(n * 100) / 100; }
    if (arc && points.length === 3) {
      var a = points[0];
      var c = points[1];
      var b = points[2];
      return 'M' + r(a.x) + ',' + r(a.y) + ' Q' + r(a.x) + ',' + r(c.y) + ' ' + r(c.x) + ',' + r(c.y) + ' T' + r(b.x) + ',' + r(b.y);
    }
    var d = 'M' + r(points[0].x) + ',' + r(points[0].y);
    for (var i = 1; i < points.length; i++) {
      var p = points[i - 1];
      var q = points[i];
      var mx = (p.x + q.x) / 2;
      d += ' C' + r(mx) + ',' + r(p.y) + ' ' + r(mx) + ',' + r(q.y) + ' ' + r(q.x) + ',' + r(q.y);
    }
    return d;
  }

  /** The neighbours used for keyboard navigation, from the placed layout. */
  function neighbours(layout, id) {
    var downstream = [];
    var upstream = [];
    layout.edges.forEach(function (e) {
      if (e.from === id) downstream.push(e.to);
      if (e.to === id) upstream.push(e.from);
    });
    var me = null;
    for (var i = 0; i < layout.nodes.length; i++) if (layout.nodes[i].id === id) { me = layout.nodes[i]; break; }
    var sameLayer = me ? (layout.layers[me.layer] || []) : [];
    return { downstream: downstream, upstream: upstream, sameLayer: sameLayer };
  }

  /** 'ok' | 'warn' | 'error' | 'unknown': the explicit status, else derived from the error rate and the thresholds. */
  function healthOf(node, t) {
    if (node.status) return node.status;
    if (node.errorRate === undefined || node.errorRate === null) return 'unknown';
    if (node.errorRate >= t.error) return 'error';
    if (node.errorRate >= t.warn) return 'warn';
    return 'ok';
  }

  /** The viewport transform that fits a drawing of `w` x `h` into `width` x `height` with a margin. */
  function fitView(w, h, width, height, margin) {
    if (margin === undefined) margin = 16;
    if (w <= 0 || h <= 0 || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
    var k = Math.min(MAX_K, Math.max(MIN_K, Math.min((width - margin * 2) / w, (height - margin * 2) / h, 1.25)));
    return { k: k, x: (width - w * k) / 2, y: (height - h * k) / 2 };
  }

  function clampK(k) { return Math.min(MAX_K, Math.max(MIN_K, k)); }

  /** Text clipped to `max` characters with an ellipsis. */
  function clip(text, max) { return text.length > max ? text.slice(0, max - 1) + '…' : text; }

  /** Stroke width of an edge from its rate. */
  function edgeStrokeWidth(rate) { return 1 + Math.min(3, Math.log10(1 + (rate || 0)) * 0.9); }

  /** The SVG transform of the viewport group. */
  function viewTransform(v) { return 'translate(' + v.x + ' ' + v.y + ') scale(' + v.k + ')'; }

  var api = {
    NODE_W: NODE_W, NODE_H: NODE_H, MIN_K: MIN_K, MAX_K: MAX_K,
    layoutServiceMap: layoutServiceMap, neighbours: neighbours, healthOf: healthOf, fitView: fitView, clampK: clampK,
    clip: clip, edgeStrokeWidth: edgeStrokeWidth, viewTransform: viewTransform
  };
  global.KuiServiceMapModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
