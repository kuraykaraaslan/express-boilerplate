/*
 * modules/ui/TraceWaterfall/trace-model.js
 *
 * Pure model of a distributed trace: the span tree, the flattened visible rows, the critical path, the time
 * ruler, the bar boxes and the row window. A port of kui-react modules/ui/TraceWaterfall/model.ts and of the
 * fixed-height case of modules/ui/Virtual/useVirtualList.ts. No DOM. One source for both sides: the partial loads
 * it on the server through _observability/_load.ejs, the browser script is inlined after it, and
 * tests/trace-waterfall.test.ts runs it under Node. Times are milliseconds. window.KuiTraceModel.
 */
(function (global) {
  'use strict';
  if (global.KuiTraceModel) return;

  function safeDuration(s) { return isFinite(s.duration) && s.duration > 0 ? s.duration : 0; }
  function spanEnd(s) { return s.start + safeDuration(s); }

  /** Would attaching `child` under `parent` close a loop? (parent is already a descendant of child) */
  function reaches(parent, child, byId) {
    var cur = parent;
    var seen = new Set();
    while (cur) {
      if (cur === child) return true;
      if (seen.has(cur.span.id)) return true;
      seen.add(cur.span.id);
      var pid = cur.span.parentId;
      cur = pid != null ? byId.get(pid) : undefined;
    }
    return false;
  }

  /** The span tree. Orphans (unknown parent) become roots; a parent cycle is broken at the first repeat. */
  function buildTraceTree(spans) {
    var byId = new Map();
    spans.forEach(function (span) {
      if (!byId.has(span.id)) byId.set(span.id, { span: span, depth: 0, children: [], parent: null });
    });
    var roots = [];
    byId.forEach(function (node) {
      var pid = node.span.parentId;
      var parent = pid != null && pid !== node.span.id ? byId.get(pid) : undefined;
      if (parent && !reaches(parent, node, byId)) { node.parent = parent; parent.children.push(node); }
      else roots.push(node);
    });
    function order(a, b) {
      return (a.span.start - b.span.start) || (spanEnd(b.span) - spanEnd(a.span)) || localeCompare(a.span.id, b.span.id);
    }
    // String.prototype.localeCompare, like kui-react's.
    function localeCompare(a, b) { return String(a).localeCompare(String(b)); }
    function setDepth(n, depth) {
      n.depth = depth;
      n.children.sort(order);
      n.children.forEach(function (c) { setDepth(c, depth + 1); });
    }
    roots.sort(order);
    roots.forEach(function (r) { setDepth(r, 0); });
    var start = Infinity;
    var end = -Infinity;
    byId.forEach(function (n) { start = Math.min(start, n.span.start); end = Math.max(end, spanEnd(n.span)); });
    if (!isFinite(start)) { start = 0; end = 0; }
    return { roots: roots, byId: byId, start: start, end: end, duration: Math.max(0, end - start) };
  }

  /** Rows in display order: a depth-first walk that skips the children of collapsed spans. */
  function visibleRows(tree, collapsed) {
    var rows = [];
    function walk(nodes) {
      nodes.forEach(function (node, i) {
        rows.push({ node: node, posInSet: i + 1, setSize: nodes.length });
        if (node.children.length && !collapsed.has(node.span.id)) walk(node.children);
      });
    }
    walk(tree.roots);
    return rows;
  }

  /** Ids of every span that has children. */
  function expandableIds(tree) {
    var out = [];
    tree.byId.forEach(function (n) { if (n.children.length) out.push(n.span.id); });
    return out;
  }

  /**
   * The critical path: the chain of spans that decided when the trace finished (see kui-react model.ts).
   * Returns a Set of span ids.
   */
  function criticalPathIds(tree) {
    var out = new Set();
    if (!tree.roots.length) return out;
    var root = tree.roots.reduce(function (best, n) { return spanEnd(n.span) > spanEnd(best.span) ? n : best; });
    function walk(node, bound) {
      out.add(node.span.id);
      var cursor = Math.min(bound, spanEnd(node.span));
      var kids = node.children.slice().sort(function (a, b) { return (spanEnd(b.span) - spanEnd(a.span)) || (b.span.start - a.span.start); });
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid.span.start >= cursor) continue;
        walk(kid, Math.min(spanEnd(kid.span), cursor));
        cursor = kid.span.start;
      }
    }
    walk(root, spanEnd(root.span));
    return out;
  }

  /** Nice tick values (ms offsets from the trace start): about `target` ticks, 1/2/5 steps. */
  function rulerTicks(duration, target) {
    if (target === undefined) target = 5;
    if (!(duration > 0)) return [0];
    var raw = duration / Math.max(1, target);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var base = raw / pow;
    var step = (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * pow;
    var out = [];
    for (var t = 0; t <= duration + step * 1e-9; t += step) out.push(Number(t.toFixed(9)));
    return out;
  }

  // ── Labels that fit the track (kui-react model.ts) ────────────────────────────────────────────────
  // The ruler and duration labels are placed for the measured width of the time track. Their width is an estimate
  // from the number of characters (text-xs, a little wide on purpose) rather than a measurement, so kui-react and
  // the browser script place them the same way without measuring text.
  var LABEL_CHAR_PX = 7.5;
  var LABEL_PAD = 4;
  var LABEL_GAP = 8;

  /** Estimated width of a label, px. */
  function labelPx(text) { return Math.ceil(String(text).length * LABEL_CHAR_PX); }

  /**
   * The ruler of a time track `width` px wide: [{ t, text, side }], side 'after' | 'before' | null (the line only).
   * The ticks are the densest of rulerTicks(duration, 5..1) whose labels do not touch; each label sits after its
   * line, the last one before it when it would run past the end of the track (left out when it would then touch the
   * label before it). Without a width (not measured yet): rulerTicks(duration) with every label after its line.
   */
  function rulerLabels(duration, width, format) {
    if (!(width > 0) || !(duration > 0)) return rulerTicks(duration).map(function (t) { return { t: t, text: format(t), side: 'after' }; });
    var ticks = [0];
    for (var target = 5; target >= 1; target--) {
      var candidate = rulerTicks(duration, target);
      if (candidate.length < 2) { ticks = candidate; break; }
      var stepPx = ((candidate[1] - candidate[0]) / duration) * width;
      var widest = Math.max.apply(null, candidate.map(function (t) { return labelPx(format(t)); }));
      if (stepPx >= widest + LABEL_PAD + LABEL_GAP) { ticks = candidate; break; }
    }
    var out = ticks.map(function (t) { return { t: t, text: format(t), side: 'after' }; });
    var last = out[out.length - 1];
    var x = (last.t / duration) * width;
    if (last.t > 0 && x + LABEL_PAD + labelPx(last.text) > width) {
      var prev = out[out.length - 2];
      var prevEnd = prev ? (prev.t / duration) * width + LABEL_PAD + labelPx(prev.text) : -Infinity;
      last.side = x - LABEL_PAD - labelPx(last.text) >= prevEnd + LABEL_GAP ? 'before' : null;
    }
    return out;
  }

  /**
   * Which side of its bar a duration label goes ('after' | 'before'), for a time track `width` px wide. After the bar
   * unless the bar ends in the last third; but a label that would run past the end of the track goes before the
   * bar, and one that has no room before the bar goes after it when it fits there. Without a width: the thirds rule.
   */
  function durationLabelSide(box, text, width) {
    var preferAfter = box.left + box.width < 66;
    if (!(width > 0)) return preferAfter ? 'after' : 'before';
    var w = labelPx(text);
    var afterFits = ((box.left + box.width) / 100) * width + LABEL_PAD + w <= width;
    var beforeFits = (box.left / 100) * width - LABEL_PAD - w >= 0;
    if (preferAfter) return afterFits ? 'after' : 'before';
    return !beforeFits && afterFits ? 'after' : 'before';
  }

  /** Position and width of a span's bar as percentages of the trace duration. */
  function barBox(span, tree, minWidthPct) {
    if (minWidthPct === undefined) minWidthPct = 0.4;
    if (!(tree.duration > 0)) return { left: 0, width: 100 };
    var left = ((span.start - tree.start) / tree.duration) * 100;
    var width = Math.max(minWidthPct, (safeDuration(span) / tree.duration) * 100);
    return { left: Math.min(Math.max(left, 0), 100 - minWidthPct), width: Math.min(width, 100) };
  }

  /** Self time: the span's duration minus the union of its children's intervals (clipped to the span). */
  function selfTime(node) {
    var s = node.span.start;
    var e = spanEnd(node.span);
    var spans = node.children
      .map(function (c) { return [Math.max(s, c.span.start), Math.min(e, spanEnd(c.span))]; })
      .filter(function (p) { return p[1] > p[0]; })
      .sort(function (x, y) { return x[0] - y[0]; });
    var covered = 0;
    var curEnd = -Infinity;
    var curStart = 0;
    spans.forEach(function (p) {
      var a = p[0], b = p[1];
      if (a > curEnd) {
        if (curEnd > -Infinity) covered += curEnd - curStart;
        curStart = a;
        curEnd = b;
      } else if (b > curEnd) curEnd = b;
    });
    if (curEnd > -Infinity) covered += curEnd - curStart;
    return Math.max(0, safeDuration(node.span) - covered);
  }

  /**
   * The slice [start, end) of `count` fixed-height rows to draw (kui-react useVirtualList with a number row height).
   * `scrollTop` is the scroller's, `stickyTop` the height of the sticky ruler above the first row.
   */
  function windowFor(count, rowHeight, scrollTop, viewport, stickyTop, overscan) {
    if (overscan === undefined) overscan = 8;
    if (count <= 0) return { start: 0, end: 0 };
    function indexAt(offset) {
      if (offset <= 0) return 0;
      if (offset >= count * rowHeight) return count - 1;
      return Math.min(count - 1, Math.floor(offset / rowHeight));
    }
    var top = Math.max(0, scrollTop - stickyTop);
    return {
      start: Math.max(0, indexAt(top) - overscan),
      end: Math.min(count, indexAt(top + viewport) + 1 + overscan)
    };
  }

  var api = {
    spanEnd: spanEnd, buildTraceTree: buildTraceTree, visibleRows: visibleRows, expandableIds: expandableIds,
    criticalPathIds: criticalPathIds, rulerTicks: rulerTicks, barBox: barBox, selfTime: selfTime, windowFor: windowFor,
    labelPx: labelPx, rulerLabels: rulerLabels, durationLabelSide: durationLabelSide
  };
  global.KuiTraceModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
