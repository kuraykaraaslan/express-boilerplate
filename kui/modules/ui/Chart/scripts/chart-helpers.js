/*
 * modules/ui/Chart/scripts/chart-helpers.js
 *
 * Pure browser helpers shared by every Chart renderer. Mirrors the scale,
 * tick, stack and time maths of kui-react's modules/ui/Chart/charts/_helpers.ts,
 * _time.ts, _heatmap.ts and _cartesian.tsx, plus its primitives (Axis, Grid,
 * AxisTitles, Thresholds, Legend, Tooltip, Crosshair, the point marks of
 * _marks.tsx), so the two stacks render the same output. Keep them in step.
 *
 * Globals exposed on `window.KuiChart`:
 *   - palette, theme, padding, paletteColor(i, override)
 *   - niceStep, niceTicks, resolveDomain, alignedDomain, labelWidth, thinLabels,
 *     defaultNumber, yScale, bandCenter, bandWidth, yExtent, xCategories
 *   - smoothPath, linePath, stepPath, curvePath, continuePath, dashArray, pointPath
 *   - stackedExtent, stackTops, stackKeys, groupedStackTops, topsExtent
 *   - seriesStats, valueText, legendValueTexts, plotPadding
 *   - buildHeatGrid(cells, maxAxis), heatIntensity(v, min, max)        (heatmap)
 *   - toTime, isTimeSeries, timeExtent, timePoints, inDomain, visibleYExtent,
 *     xTime, invTime, tickStep, zoneOffsetMs, timeTicks, clockText, dayMonthText,
 *     formatTick, formatFull, brushDomain, nearestIndex, MIN_ZOOM_MS, MIN_BRUSH_PX,
 *     brushRange, bandIndex, bandRange, keyRange, keyedTimeRange, rangeBand  (a range for the host)
 *   - svg(name, attrs), axisTextAttrs, axisX, axisY, grid, axisTitles,
 *     thresholds, crosshair, pointMark, valueLabelAttrs, tooltip, legend,
 *     mountLegend, entrance                                       (primitives)
 *   - observeContainer, animationDuration, polar, arcPath, resolveFn,
 *     formatValue, numberFormatter, bandColorFor, tooltipFormatter     (formatters as data)
 *   - linearRegression                                                (scatter trend line)
 *     renderers, autoInit
 */
(function (global) {
  'use strict';
  if (global.KuiChart) return;

  var DEFAULT_PALETTE = [
    'var(--primary)',
    'var(--secondary)',
    'var(--success)',
    'var(--warning)',
    'var(--error)',
    'var(--info)',
    'var(--primary-active)',
    'var(--text-secondary)',
  ];

  var THEME = {
    background: 'transparent',
    axisStroke: 'var(--border)',
    axisText: 'var(--text-secondary)',
    gridStroke: 'var(--border)',
    tooltipBg: 'var(--surface-raised)',
    tooltipBorder: 'var(--border)',
    tooltipText: 'var(--text-primary)',
    tooltipMutedText: 'var(--text-secondary)',
    crosshair: 'var(--border-strong)',
    legendSwatchBorder: 'var(--border)',
    fontSize: { axis: 11, tooltip: 12, legend: 12 },
  };

  function paletteColor(i, override) {
    if (override) return override;
    return DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
  }

  // ── Value axis: round steps and bounds (kui-react charts/_helpers.ts) ────

  /** A readable step for about `count` intervals over `range`: 1, 2, 2.5 or 5 times a power of ten. */
  function niceStep(range, count) {
    if (count === undefined) count = 4;
    if (!(range > 0) || !isFinite(range)) return 1;
    var raw = range / Math.max(1, count);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / pow;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return m * pow;
  }

  /** Decimals a step needs to print exactly (0.25 -> 2, 50 -> 0). */
  function stepDecimals(step) {
    return Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (String(step).indexOf('25') >= 0 && step < 1 ? 1 : 0));
  }

  /**
   * Tick values at a readable step between `lo` and `hi`, both ends included when they fall on the
   * step (a domain from `resolveDomain` always does). Never a value like 263.25 on a 0-351 axis.
   */
  function niceTicks(lo, hi, count) {
    if (count === undefined) count = 4;
    if (lo === hi) {
      if (lo === 0) return [0, 0.25, 0.5, 0.75, 1];
      var pad = Math.abs(lo) * 0.5 || 1;
      lo -= pad;
      hi += pad;
    }
    if (lo > hi) { var sw = lo; lo = hi; hi = sw; }
    var step = niceStep(hi - lo, count);
    var d = Math.min(10, stepDecimals(step) + 1);
    var out = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9 && out.length < 50; v += step) {
      out.push(Number(v.toFixed(d)));
    }
    return out.length >= 2 ? out : [lo, hi];
  }

  /** The value domain after fixed bounds and thresholds: `min`/`max` win; thresholds widen an automatic end. */
  function resolveDomain(base, opts) {
    opts = opts || {};
    var min = base.min;
    var max = base.max;
    (opts.thresholds || []).forEach(function (t) {
      if (!t || typeof t.value !== 'number' || !isFinite(t.value)) return;
      if (t.value < min) min = t.value;
      if (t.value > max) max = t.value;
    });
    var pinnedMin = typeof opts.min === 'number' && isFinite(opts.min);
    var pinnedMax = typeof opts.max === 'number' && isFinite(opts.max);
    if (pinnedMin) min = opts.min;
    if (pinnedMax) max = opts.max;
    if (!(max > min)) {
      if (typeof opts.max === 'number' && typeof opts.min !== 'number') min = max - 1;
      else max = min + 1;
    }
    // Widen to readable bounds (0-351 kW -> 0-400 kW) unless the author pinned that end; repeat
    // until the step is stable so the ticks run exactly from one end to the other.
    var count = opts.count === undefined ? 4 : opts.count;
    var lo0 = min;
    var hi0 = max;
    var step = niceStep(max - min, count);
    for (var i = 0; i < 4; i++) {
      min = pinnedMin ? lo0 : Math.floor(lo0 / step + 1e-9) * step;
      max = pinnedMax ? hi0 : Math.ceil(hi0 / step - 1e-9) * step;
      var next = niceStep(max - min, count);
      if (Math.abs(next - step) < step * 1e-9) break;
      step = next;
    }
    return { min: min, max: max };
  }

  /** A rough pixel width for a tick label, so the plot leaves room for long ones. */
  function labelWidth(labels, fontSize) {
    var fs = fontSize === undefined ? 11 : fontSize;
    var longest = 0;
    labels.forEach(function (l) { longest = Math.max(longest, String(l).length); });
    return Math.ceil(longest * fs * 0.6);
  }

  /**
   * Category labels along an x axis, every k-th one kept so they never overlap. Positions stay;
   * skipped ticks keep their place with an empty label.
   */
  function thinLabels(ticks, widthPx, fontSize) {
    if (ticks.length < 2 || widthPx <= 0) return ticks;
    var per = labelWidth(ticks.map(function (t) { return t.label; }), fontSize) + 12;
    var fit = Math.max(1, Math.floor(widthPx / per));
    var k = Math.ceil(ticks.length / fit);
    if (k <= 1) return ticks;
    return ticks.map(function (t, i) {
      if (i % k === 0) return t;
      var o = {};
      for (var key in t) o[key] = t[key];
      o.label = '';
      return o;
    });
  }

  /** Default number text for ticks and tooltips. */
  function defaultNumber(v) { return String(Math.round(v * 100) / 100); }

  /**
   * A second value axis that shares the first one's grid lines: the same number of intervals, at a
   * round step, covering `base` (pinned ends are kept as given and the step follows them).
   */
  function alignedDomain(base, intervals, opts) {
    opts = opts || {};
    var n = Math.max(1, Math.round(intervals));
    var pinnedMin = typeof opts.min === 'number' && isFinite(opts.min);
    var pinnedMax = typeof opts.max === 'number' && isFinite(opts.max);
    var lo = pinnedMin ? opts.min : base.min;
    var hi = pinnedMax ? opts.max : base.max;
    var i;
    if (!(hi > lo)) hi = lo + 1;
    if (pinnedMin && pinnedMax) {
      var st = (hi - lo) / n;
      var t0 = [];
      for (i = 0; i <= n; i++) t0.push(lo + st * i);
      return { min: lo, max: hi, ticks: t0 };
    }
    var step = niceStep(hi - lo, n);
    for (var guard = 0; guard < 40; guard++) {
      var start = pinnedMin ? lo : pinnedMax ? hi - n * step : Math.floor(lo / step + 1e-9) * step;
      if (start + n * step >= hi - 1e-9 && start <= lo + 1e-9) { lo = start; break; }
      step = niceStep(step * 1.01 * n, n);
    }
    var d = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 2));
    var ticks = [];
    for (i = 0; i <= n; i++) ticks.push(Number((lo + step * i).toFixed(d)));
    return { min: ticks[0], max: ticks[n], ticks: ticks };
  }

  function yScale(value, min, max, rect) {
    if (max === min) return rect.y + rect.height / 2;
    var t = (value - min) / (max - min);
    return rect.y + rect.height - t * rect.height;
  }

  function bandCenter(i, n, rect) {
    if (n <= 0) return rect.x;
    var step = rect.width / n;
    return rect.x + step * (i + 0.5);
  }

  function bandWidth(n, rect, padding) {
    if (n <= 0) return 0;
    if (padding === undefined) padding = 0.2;
    var step = rect.width / n;
    return step * (1 - padding);
  }

  function yExtent(series) {
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < series.length; i++) {
      var data = series[i].data || [];
      for (var j = 0; j < data.length; j++) {
        var y = data[j].y;
        if (y === null || y === undefined) continue;
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    return { min: min, max: max };
  }

  function xCategories(series) {
    if (!series.length) return [];
    return (series[0].data || []).map(function (p) {
      return String(p.x);
    });
  }

  // ── Paths ───────────────────────────────────────────────────────────────

  function smoothPath(points) {
    var d = '';
    var prev = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) {
        prev = null;
        continue;
      }
      if (!prev) {
        d += 'M' + p.x + ' ' + p.y + ' ';
      } else {
        var cx = (prev.x + p.x) / 2;
        d += 'C' + cx + ' ' + prev.y + ' ' + cx + ' ' + p.y + ' ' + p.x + ' ' + p.y + ' ';
      }
      prev = p;
    }
    return d.trim();
  }

  function linePath(points) {
    var d = '';
    var has = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) {
        has = false;
        continue;
      }
      d += (has ? 'L' : 'M') + p.x + ' ' + p.y + ' ';
      has = true;
    }
    return d.trim();
  }

  /**
   * Step path (value held until the next point). `after` draws horizontal-then-vertical, `before`
   * vertical-then-horizontal: tracing the same points in reverse with `before` retraces an `after` path.
   */
  function stepPath(points, mode) {
    var m = mode || 'after';
    var d = '';
    var prev = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) { prev = null; continue; }
      if (!prev) d += 'M' + p.x + ' ' + p.y + ' ';
      else d += m === 'after' ? 'H' + p.x + ' V' + p.y + ' ' : 'V' + p.y + ' H' + p.x + ' ';
      prev = p;
    }
    return d.trim();
  }

  /** The path for a curve type: 'smooth' (default) | 'linear' | 'step'. */
  function curvePath(points, curve, stepMode) {
    var c = curve || 'smooth';
    if (c === 'step') return stepPath(points, stepMode || 'after');
    return c === 'linear' ? linePath(points) : smoothPath(points);
  }

  /** `curvePath` without the leading move: continues an open path (a stacked area's lower edge). */
  function continuePath(points, curve, stepMode) {
    if (!points.length) return '';
    return ('L' + points[0].x + ' ' + points[0].y + ' ' + curvePath(points, curve, stepMode).replace(/^M[^A-Z]*/, '')).trim();
  }

  /** SVG dash pattern for a stroke style at a width (undefined = solid). Dotted relies on a round cap. */
  function dashArray(style, width) {
    var w = width === undefined ? 2 : width;
    if (style === 'dashed') return Math.max(4, w * 3) + ' ' + Math.max(3, w * 2);
    if (style === 'dotted') return '0 ' + Math.max(3, w * 2);
    return undefined;
  }

  /** SVG path for a point mark of radius `r` centred on (x, y); circles are drawn as <circle> instead. */
  function pointPath(shape, x, y, r) {
    var h;
    if (shape === 'square') {
      h = r * 0.9;
      return 'M' + (x - h) + ' ' + (y - h) + 'H' + (x + h) + 'V' + (y + h) + 'H' + (x - h) + 'Z';
    }
    if (shape === 'diamond') {
      h = r * 1.25;
      return 'M' + x + ' ' + (y - h) + 'L' + (x + h) + ' ' + y + 'L' + x + ' ' + (y + h) + 'L' + (x - h) + ' ' + y + 'Z';
    }
    h = r * 1.2;
    return 'M' + x + ' ' + (y - h) + 'L' + (x + h * 0.95) + ' ' + (y + h * 0.65) + 'L' + (x - h * 0.95) + ' ' + (y + h * 0.65) + 'Z';
  }

  // ── Stacks ──────────────────────────────────────────────────────────────

  /** y extent of one stack: 0 .. the tallest column sum. Negative values count as 0. */
  function stackedExtent(series) {
    var n = 0;
    series.forEach(function (s) { n = Math.max(n, (s.data || []).length); });
    var max = 0;
    for (var i = 0; i < n; i++) {
      var sum = 0;
      for (var j = 0; j < series.length; j++) {
        var d = (series[j].data || [])[i];
        var y = d ? d.y : undefined;
        if (typeof y === 'number' && y > 0) sum += y;
      }
      if (sum > max) max = sum;
    }
    return { min: 0, max: max || 1 };
  }

  /** tops[si][i] is where series `si` ends at category `i` in one stack (null when it has no number there). */
  function stackTops(series) {
    var n = 0;
    series.forEach(function (s) { n = Math.max(n, (s.data || []).length); });
    var running = [];
    for (var k = 0; k < n; k++) running.push(0);
    return series.map(function (s) {
      var row = [];
      for (var i = 0; i < n; i++) {
        var d = (s.data || [])[i];
        var y = d ? d.y : undefined;
        if (typeof y !== 'number') { row.push(null); continue; }
        running[i] += Math.max(0, y);
        row.push(running[i]);
      }
      return row;
    });
  }

  /** The stack each series belongs to: its own `stack`, the shared one when the chart is `stacked`, or none (null). */
  function stackKeys(series, stacked) {
    return series.map(function (s) {
      var axis = s.yAxis === 'right' ? 'r' : 'l';
      if (s.stack) return axis + ':' + s.stack;
      return stacked ? axis + ':\u0000all' : null;
    });
  }

  /**
   * Per-series tops for grouped stacking: `tops[si][i]` is where series `si` ends at category `i`
   * within its own stack (a series outside any stack ends at its value), and `below[si]` the series it
   * sits on (-1 = baseline).
   */
  function groupedStackTops(series, keys) {
    var n = 0;
    series.forEach(function (s) { n = Math.max(n, (s.data || []).length); });
    var running = {};
    var last = {};
    var below = [];
    var tops = series.map(function (s, si) {
      var key = keys[si];
      var data = s.data || [];
      var row = [];
      var i;
      if (key === null) {
        below.push(-1);
        for (i = 0; i < n; i++) row.push(data[i] && typeof data[i].y === 'number' ? data[i].y : null);
        return row;
      }
      below.push(Object.prototype.hasOwnProperty.call(last, key) ? last[key] : -1);
      last[key] = si;
      if (!running[key]) { running[key] = []; for (i = 0; i < n; i++) running[key].push(0); }
      var run = running[key];
      for (i = 0; i < n; i++) {
        var y = data[i] ? data[i].y : undefined;
        if (typeof y !== 'number') { row.push(null); continue; }
        run[i] += Math.max(0, y);
        row.push(run[i]);
      }
      return row;
    });
    return { tops: tops, below: below };
  }

  /** The value extent of grouped-stack tops (including zero unless `includeZero` is false). */
  function topsExtent(tops, includeZero) {
    var zero = includeZero !== false;
    var min = zero ? 0 : Infinity;
    var max = zero ? 0 : -Infinity;
    tops.forEach(function (row) {
      (row || []).forEach(function (v) {
        if (v === null || v === undefined) return;
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    if (!isFinite(min)) return { min: 0, max: 1 };
    return { min: min, max: max > min ? max : min + 1 };
  }

  // ── Series text (kui-react charts/_cartesian.tsx) ───────────────────────

  /** The latest / min / max / avg / total of a series' non-null values; null when it has none. */
  function seriesStats(series) {
    var ys = (series.data || []).map(function (p) { return p.y; }).filter(function (y) { return typeof y === 'number' && isFinite(y); });
    if (!ys.length) return null;
    var total = ys.reduce(function (a, b) { return a + b; }, 0);
    return { latest: ys[ys.length - 1], min: Math.min.apply(null, ys), max: Math.max.apply(null, ys), avg: total / ys.length, total: total };
  }

  /** The text a series prints for a value: its point label, its own format, the chart's, or the default. */
  function valueText(s, y, point, yFormat) {
    if (point && point.label !== undefined && point.label !== null) return point.label;
    var own = s && (typeof s.format === 'function' ? s.format : resolveFn(s.format));
    if (own) return own(y);
    return (yFormat || defaultNumber)(y);
  }

  var LEGEND_WORD = { latest: '', min: 'min ', max: 'max ', avg: 'avg ', total: 'total ' };

  /** Legend values per series id, e.g. "21.4 °C · max 24 °C". */
  function legendValueTexts(series, values, yFormat) {
    if (!values || !values.length) return undefined;
    var out = {};
    series.forEach(function (s) {
      var st = seriesStats(s);
      if (!st) return;
      out[s.id] = values.map(function (v) { return LEGEND_WORD[v] + valueText(s, st[v], undefined, yFormat); }).join(' · ');
    });
    return out;
  }

  function fontPx(style) { return style && typeof style.fontSize === 'number' ? style.fontSize : 11; }

  /**
   * Plot padding: room for the longest y tick label (left, and right for a second axis), the x tick
   * labels and the axis titles. A hidden axis keeps only a small margin.
   */
  function plotPadding(o) {
    var fs = fontPx(o.tickStyle);
    var showY = o.showYAxis !== false;
    var right = o.y2TickLabels && o.y2TickLabels.length
      ? (showY ? labelWidth(o.y2TickLabels, fs) + 12 : 8) + (o.y2Label ? 18 : 0)
      : 12;
    return {
      top: 10,
      right: right,
      bottom: (o.showXAxis === false ? 6 : 24 + (fs > 11 ? fs - 11 : 0)) + (o.xLabel ? 16 : 0),
      left: (showY ? Math.max(o.minLeft === undefined ? 28 : o.minLeft, labelWidth(o.yTickLabels, fs) + 12) : 8) + (o.yLabel ? 18 : 0),
    };
  }

  // ── Containers and motion ───────────────────────────────────────────────

  function observeContainer(el, onResize) {
    if (!el) return function () {};
    if (typeof ResizeObserver === 'undefined') {
      var rect = el.getBoundingClientRect();
      onResize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      return function () {};
    }
    var last = null;
    function emit(w, h) {
      var next = { width: Math.max(0, Math.floor(w)), height: Math.max(0, Math.floor(h)) };
      if (last && last.width === next.width && last.height === next.height) return;
      last = next;
      onResize(next);
    }
    var ro = new ResizeObserver(function (entries) {
      var r = entries[0] && entries[0].contentRect;
      if (r) emit(r.width, r.height);
    });
    ro.observe(el);
    var box = el.getBoundingClientRect();
    emit(box.width, box.height);
    return function () {
      ro.disconnect();
    };
  }

  function animationDuration(base) {
    var b = typeof base === 'number' ? base : 250;
    if (typeof window === 'undefined') return b;
    var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    return mq && mq.matches ? 0 : b;
  }

  var FRAMES = {
    'reveal-x': [{ clipPath: 'inset(-8px 100% -8px -8px)' }, { clipPath: 'inset(-8px -8px -8px -8px)' }],
    'reveal-x-reverse': [{ clipPath: 'inset(-8px -8px -8px 100%)' }, { clipPath: 'inset(-8px -8px -8px -8px)' }],
    'reveal-y': [{ clipPath: 'inset(100% -8px -8px -8px)' }, { clipPath: 'inset(-8px -8px -8px -8px)' }],
    grow: [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
  };

  /** Play the entrance animation once on `el` (Web Animations API; honours reduced motion). */
  function entrance(el, kind, enabled) {
    if (!el || enabled === false || typeof el.animate !== 'function' || animationDuration(1) === 0) return;
    if (kind === 'grow') {
      el.style.transformBox = 'fill-box';
      el.style.transformOrigin = 'center';
    }
    el.animate(FRAMES[kind], { duration: kind === 'grow' ? 500 : 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  /** Standard plot padding of the sparkline-era charts (kept for callers of KuiChart.padding). */
  var PADDING = { top: 12, right: 16, bottom: 28, left: 40 };

  /** Polar (cx, cy, r, angle°) -> cartesian. Used by Pie + Donut. */
  function polar(cx, cy, r, deg) {
    var rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  var DEG = 180 / Math.PI;

  /**
   * An annular wedge (r0 = 0: a pie slice) with an even `gap` px to its neighbours: both straight
   * edges move inward by gap / 2, so the gap is parallel-sided like a cut, not a tapering wedge.
   */
  function arcPath(cx, cy, r0, r1, a0, a1, gap) {
    if (a1 - a0 >= 359.999) {
      if (r0 <= 0) return 'M' + cx + ' ' + (cy - r1) + ' A' + r1 + ' ' + r1 + ' 0 1 1 ' + cx + ' ' + (cy + r1) + ' A' + r1 + ' ' + r1 + ' 0 1 1 ' + cx + ' ' + (cy - r1) + ' Z';
      return arcPath(cx, cy, r0, r1, a0, a0 + 180) + ' ' + arcPath(cx, cy, r0, r1, a0 + 180, a1 - 0.001);
    }
    var half = (gap || 0) / 2;
    var sweep = a1 - a0;
    var d1 = half > 0 ? Math.asin(Math.min(1, half / r1)) * DEG : 0;
    if (sweep - 2 * d1 <= 0.2) return '';
    var o0 = a0 + d1;
    var o1 = a1 - d1;
    var large = o1 - o0 > 180 ? 1 : 0;
    var p0 = polar(cx, cy, r1, o0);
    var p1 = polar(cx, cy, r1, o1);
    if (r0 <= 0) {
      var halfRad = (sweep / 2) / DEG;
      var apexR = half > 0 && sweep < 180 ? half / Math.sin(halfRad) : 0;
      var ap = apexR > 0 ? polar(cx, cy, Math.min(apexR, r1 * 0.5), (a0 + a1) / 2) : [cx, cy];
      return 'M' + ap[0] + ' ' + ap[1] + ' L' + p0[0] + ' ' + p0[1] + ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + p1[0] + ' ' + p1[1] + ' Z';
    }
    var d0 = half > 0 ? Math.asin(Math.min(1, half / r0)) * DEG : 0;
    var i0 = a0 + d0;
    var i1 = a1 - d0;
    var p2 = polar(cx, cy, r0, Math.max(i0, i1));
    var p3 = polar(cx, cy, r0, Math.min(i0, i1));
    var largeIn = Math.abs(i1 - i0) > 180 ? 1 : 0;
    return 'M' + p0[0] + ' ' + p0[1] + ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + p1[0] + ' ' + p1[1]
      + ' L' + p2[0] + ' ' + p2[1] + ' A' + r0 + ' ' + r0 + ' 0 ' + largeIn + ' 0 ' + p3[0] + ' ' + p3[1] + ' Z';
  }

  // ── Heatmap grid (kui-react charts/_heatmap.ts) ─────────────────────────

  var MAX_AXIS = 200;

  /**
   * Cells (long format {x, y, value}) -> a dense grid. Axis order is first
   * appearance, except an all-numeric axis is sorted numerically. A repeated
   * (x, y) keeps the LAST value; a non-finite value is an empty cell (null).
   */
  function buildHeatGrid(cells, maxAxis) {
    cells = cells || [];
    var cap = maxAxis || MAX_AXIS;
    function order(get) {
      var seen = {};
      var keys = [];
      cells.forEach(function (c) {
        var key = String(get(c));
        if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = true; keys.push(key); }
      });
      var numeric = keys.length > 0 && keys.every(function (k) { return k.trim() !== '' && isFinite(Number(k)); });
      if (numeric) keys.sort(function (a, b) { return Number(a) - Number(b); });
      return keys.slice(0, cap);
    }
    var xs = order(function (c) { return c.x; });
    var ys = order(function (c) { return c.y; });
    var xi = {}; xs.forEach(function (k, i) { xi[k] = i; });
    var yi = {}; ys.forEach(function (k, i) { yi[k] = i; });
    var values = ys.map(function () { return xs.map(function () { return null; }); });
    cells.forEach(function (c) {
      var i = xi[String(c.x)];
      var j = yi[String(c.y)];
      if (i === undefined || j === undefined) return;
      values[j][i] = typeof c.value === 'number' && isFinite(c.value) ? c.value : null;
    });
    var min = Infinity;
    var max = -Infinity;
    values.forEach(function (row) {
      row.forEach(function (v) {
        if (v === null) return;
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    if (!isFinite(min)) { min = 0; max = 1; }
    return { xs: xs, ys: ys, values: values, min: min, max: max };
  }

  /** 0..1 position of v in [min, max]; a flat range maps to 1. */
  function heatIntensity(v, min, max) {
    if (max <= min) return 1;
    return Math.min(1, Math.max(0, (v - min) / (max - min)));
  }

  // ── Time axis (kui-react charts/_time.ts) ───────────────────────────────

  /** A series x as epoch ms: a number is taken as ms, a string must parse as a date; else null. */
  function toTime(x) {
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (typeof x !== 'string') return null;
    // A date-only string is a calendar DAY in local time, not UTC midnight.
    var day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
    var t = Date.parse(x);
    return isNaN(t) ? null : t;
  }

  /** True when EVERY point of EVERY series has a time-like x (and there is at least one point). */
  function isTimeSeries(series) {
    var any = false;
    for (var i = 0; i < series.length; i++) {
      var data = series[i].data || [];
      for (var j = 0; j < data.length; j++) {
        if (toTime(data[j].x) === null) return false;
        any = true;
      }
    }
    return any;
  }

  /** Full time extent. A single instant is widened by 30 minutes each side. */
  function timeExtent(series) {
    var lo = Infinity;
    var hi = -Infinity;
    series.forEach(function (s) {
      (s.data || []).forEach(function (p) {
        var t = toTime(p.x);
        if (t === null) return;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      });
    });
    if (!isFinite(lo)) return [0, 1];
    if (lo === hi) return [lo - 30 * 60000, hi + 30 * 60000];
    return [lo, hi];
  }

  /** Per series: [{ t, y, label }] sorted by time; points without a parsable x are dropped. */
  function timePoints(series) {
    return series.map(function (s) {
      var out = [];
      (s.data || []).forEach(function (p) {
        var t = toTime(p.x);
        if (t !== null) out.push({ t: t, y: p.y, label: p.label });
      });
      return out.sort(function (a, b) { return a.t - b.t; });
    });
  }

  function inDomain(points, domain) {
    return points.filter(function (p) { return p.t >= domain[0] && p.t <= domain[1]; });
  }

  /** y extent over the visible points; includes zero unless `includeZero` is false. */
  function visibleYExtent(all, domain, includeZero) {
    var min = Infinity;
    var max = -Infinity;
    all.forEach(function (pts) {
      inDomain(pts, domain).forEach(function (p) {
        if (p.y === null || p.y === undefined) return;
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      });
    });
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (includeZero !== false) {
      if (min > 0) min = 0;
      if (max < 0) max = 0;
    }
    return { min: min, max: max };
  }

  function xTime(t, domain, rect) {
    if (domain[1] === domain[0]) return rect.x + rect.width / 2;
    return rect.x + ((t - domain[0]) / (domain[1] - domain[0])) * rect.width;
  }

  function invTime(px, domain, rect) {
    if (rect.width <= 0) return domain[0];
    return domain[0] + ((px - rect.x) / rect.width) * (domain[1] - domain[0]);
  }

  var SECOND = 1000;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  var STEPS = [
    SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
    MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
    HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
    DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY, 182 * DAY, 365 * DAY,
  ];

  /** Tick step (ms) for a span, giving at most about `target` ticks. */
  function tickStep(span, target) {
    var want = Math.max(1, target);
    for (var i = 0; i < STEPS.length; i++) if (span / STEPS[i] <= want) return STEPS[i];
    return STEPS[STEPS.length - 1];
  }

  /** The offset of `timeZone` from UTC at an instant, in ms (east is positive); none = the browser's. */
  function zoneOffsetMs(ms, timeZone) {
    if (!timeZone) return -new Date(ms).getTimezoneOffset() * MINUTE;
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(ms));
      var get = function (type) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return Number(parts[i].value);
        return NaN;
      };
      var asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
      return asUtc - Math.floor(ms / 1000) * 1000;
    } catch (e) {
      return -new Date(ms).getTimezoneOffset() * MINUTE;
    }
  }

  /** Ticks aligned to the step in the axis zone (the browser's, or `timeZone`): day ticks land on midnight. */
  function timeTicks(domain, target, timeZone) {
    var lo = domain[0];
    var hi = domain[1];
    if (!(hi > lo)) return [lo];
    var step = tickStep(hi - lo, target === undefined ? 6 : target);
    var off = -zoneOffsetMs(lo, timeZone);
    var out = [];
    for (var t = Math.ceil((lo - off) / step) * step + off; t <= hi; t += step) out.push(t);
    return out.length ? out : [lo, hi];
  }

  /** `HH:mm` (24 h), with seconds when asked. */
  function clockText(ms, locale, timeZone, seconds) {
    var o = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (seconds) o.second = '2-digit';
    if (timeZone) o.timeZone = timeZone;
    return new Date(ms).toLocaleTimeString(locale, o);
  }

  /** `d MMM` (6 Oct), with the year (`d MMM yyyy`) when asked; the month name follows the locale. */
  function dayMonthText(ms, locale, timeZone, year) {
    try {
      var o = { day: 'numeric', month: 'short' };
      if (year) o.year = 'numeric';
      if (timeZone) o.timeZone = timeZone;
      var parts = new Intl.DateTimeFormat(locale, o).formatToParts(new Date(ms));
      var get = function (type) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
        return '';
      };
      return [get('day'), get('month').replace(/\.$/, ''), year ? get('year') : ''].filter(Boolean).join(' ');
    } catch (e) {
      return new Date(ms).toDateString();
    }
  }

  /** Compact tick label for the visible span (`HH:mm`, `d MMM`, `MMM yy`), in `timeZone` when given. */
  function formatTick(ms, span, locale, timeZone) {
    if (span <= 10 * MINUTE) return clockText(ms, locale, timeZone, true);
    if (span <= 2 * DAY) return clockText(ms, locale, timeZone);
    if (span <= 7 * DAY) return dayMonthText(ms, locale, timeZone) + ' ' + clockText(ms, locale, timeZone);
    if (span <= 400 * DAY) return dayMonthText(ms, locale, timeZone);
    var o = { year: '2-digit', month: 'short' };
    if (timeZone) o.timeZone = timeZone;
    return new Date(ms).toLocaleDateString(locale, o);
  }

  /** Full label for the tooltip header (`d MMM yyyy`, or `d MMM HH:mm`), in `timeZone` when given. */
  function formatFull(ms, span, locale, timeZone) {
    return span > 2 * DAY
      ? dayMonthText(ms, locale, timeZone, true)
      : dayMonthText(ms, locale, timeZone) + ' ' + clockText(ms, locale, timeZone, span <= 10 * MINUTE);
  }

  var MIN_ZOOM_MS = 1000;
  var MIN_BRUSH_PX = 8;

  /** The domain a brush from px0 to px1 selects, clamped to `full`; null when too small. */
  function brushDomain(px0, px1, domain, full, rect) {
    if (Math.abs(px1 - px0) < MIN_BRUSH_PX) return null;
    var a = invTime(Math.min(px0, px1), domain, rect);
    var b = invTime(Math.max(px0, px1), domain, rect);
    var lo = Math.max(full[0], a);
    var hi = Math.min(full[1], b);
    return hi - lo < MIN_ZOOM_MS ? null : [lo, hi];
  }

  // ── A range the viewer selects for the host (kui-react _time.ts; dashboard phase 35: a brush that moves the board window) ──

  /** The range ({ from, to }, epoch ms) a time-axis brush from px0 to px1 reports (the zoom rules: MIN_BRUSH_PX wide, MIN_ZOOM_MS long). */
  function brushRange(px0, px1, domain, full, rect) {
    var d = brushDomain(px0, px1, domain, full, rect);
    return d ? { from: d[0], to: d[1] } : null;
  }

  /** The category index under `along` px from the start of a band axis of `count` categories `step` px wide (clamped). */
  function bandIndex(along, step, count) {
    if (count <= 0 || !(step > 0)) return 0;
    return Math.min(count - 1, Math.max(0, Math.floor(along / step)));
  }

  /**
   * The time range of the categories i0 to i1 (either order) of a band axis whose categories are instants: from the first
   * one's instant to the END of the last one's bucket (the next category's instant, or the last gap carried past the end).
   * Null without a second instant to size a bucket from.
   */
  function bandRange(times, i0, i1) {
    if (!times || times.length < 2) return null;
    var a = Math.max(0, Math.min(i0, i1));
    var b = Math.min(times.length - 1, Math.max(i0, i1));
    if (!(b >= a)) return null;
    var from = times[a];
    var to = b + 1 < times.length ? times[b + 1] : times[b] + (times[b] - times[b - 1]);
    return isFinite(from) && isFinite(to) && to > from ? { from: from, to: to } : null;
  }

  /**
   * The keyboard selection ({ anchor, focus }, data units) after an arrow key: the arrows move its end (focus) by `step`,
   * Shift + arrows move its start (anchor); both stay inside lo..hi and the start never passes the end. The first key
   * starts both at lo.
   */
  function keyRange(sel, dir, shift, lo, hi, step) {
    var cur = sel || { anchor: lo, focus: lo };
    var clamp = function (v) { return Math.min(hi, Math.max(lo, v)); };
    if (shift) {
      var anchor = clamp(cur.anchor + dir * step);
      return { anchor: Math.min(anchor, cur.focus), focus: cur.focus };
    }
    var focus = clamp(cur.focus + dir * step);
    return { anchor: Math.min(cur.anchor, focus), focus: focus };
  }

  /** The range a keyboard selection on a time axis reports (too short = nothing). */
  function keyedTimeRange(sel) {
    return sel.focus - sel.anchor >= MIN_ZOOM_MS ? { from: sel.anchor, to: sel.focus } : null;
  }

  /**
   * The selection band for the host, drawn under nothing that takes the pointer: a tinted rectangle (when it has a size)
   * and an edge line at each end (a single edge is the keyboard cursor). `vertical` = the category axis runs down (a
   * horizontal bar chart): the band spans the plot's width instead of its height.
   */
  function rangeBand(rect, from, to, vertical) {
    var g = svg('g', { 'data-range-band': '', 'aria-hidden': 'true', 'pointer-events': 'none' });
    var size = Math.abs(to - from);
    if (size > 0) {
      g.appendChild(svg('rect', vertical
        ? { x: rect.x, y: Math.min(from, to), width: rect.width, height: size, fill: 'var(--primary)', opacity: 0.12 }
        : { x: Math.min(from, to), y: rect.y, width: size, height: rect.height, fill: 'var(--primary)', opacity: 0.12 }));
    }
    [from, to].forEach(function (at) {
      g.appendChild(svg('line', vertical
        ? { x1: rect.x, x2: rect.x + rect.width, y1: at, y2: at, stroke: 'var(--primary)', 'stroke-width': 1 }
        : { x1: at, x2: at, y1: rect.y, y2: rect.y + rect.height, stroke: 'var(--primary)', 'stroke-width': 1 }));
    });
    return g;
  }

  /** Index of the time in the sorted `times` nearest to t (ties go to the earlier one). */
  function nearestIndex(times, t) {
    if (!times.length) return -1;
    var lo = 0;
    var hi = times.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1;
    return lo;
  }

  // ── Shared SVG / HTML primitives (kui-react primitives/*) ───────────────

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
    return el;
  }

  function text(attrs, content) {
    var t = svg('text', attrs);
    t.textContent = content;
    return t;
  }

  /** SVG text attributes for an axis text style { color, fontSize, fontWeight, fontFamily, fontStyle }. */
  function axisTextAttrs(style) {
    var s = style || {};
    return {
      'font-size': s.fontSize !== undefined ? s.fontSize : THEME.fontSize.axis,
      fill: s.color || THEME.axisText,
      'font-weight': s.fontWeight,
      'font-family': s.fontFamily,
      'font-style': s.fontStyle,
    };
  }

  function merge(a, b) {
    var o = {};
    var k;
    for (k in a) o[k] = a[k];
    for (k in b) o[k] = b[k];
    return o;
  }

  /**
   * <XAxis>: axis line, tick marks and a label per tick. ticks = [{ position, label }].
   * opts: { hideLine, textStyle, tickMarks (true), showLabels (true) }.
   */
  function axisX(ticks, y, xStart, xEnd, opts) {
    var o = opts || {};
    var g = svg('g', { 'aria-hidden': 'true' });
    var ta = axisTextAttrs(o.textStyle);
    if (!o.hideLine) g.appendChild(svg('line', { x1: xStart, x2: xEnd, y1: y, y2: y, stroke: THEME.axisStroke, 'stroke-width': 1 }));
    ticks.forEach(function (t) {
      if (o.tickMarks !== false) g.appendChild(svg('line', { x1: t.position, x2: t.position, y1: y, y2: y + 4, stroke: THEME.axisStroke, 'stroke-width': 1 }));
      if (o.showLabels !== false && t.label) g.appendChild(text(merge({ x: t.position, y: y + 16, 'text-anchor': 'middle' }, ta), t.label));
    });
    return g;
  }

  /** <YAxis>. opts: { hideLine, textStyle, tickMarks (true), showLabels (true), side ('left' | 'right') }. */
  function axisY(ticks, x, yStart, yEnd, opts) {
    var o = opts || {};
    var g = svg('g', { 'aria-hidden': 'true' });
    var ta = axisTextAttrs(o.textStyle);
    var dir = o.side === 'right' ? 1 : -1;
    if (!o.hideLine) g.appendChild(svg('line', { x1: x, x2: x, y1: yStart, y2: yEnd, stroke: THEME.axisStroke, 'stroke-width': 1 }));
    ticks.forEach(function (t) {
      if (o.tickMarks !== false) g.appendChild(svg('line', { x1: x + dir * 4, x2: x, y1: t.position, y2: t.position, stroke: THEME.axisStroke, 'stroke-width': 1 }));
      if (o.showLabels !== false && t.label) {
        g.appendChild(text(merge({ x: x + dir * 8, y: t.position + 4, 'text-anchor': o.side === 'right' ? 'start' : 'end' }, ta), t.label));
      }
    });
    return g;
  }

  var GRID_DASH = { dashed: '3 4', dotted: '1 3', solid: undefined };

  /** <Grid>: horizontal (and optional vertical) lines. opts: { color, lineStyle ('dashed' | 'dotted' | 'solid') }. */
  function grid(rect, yTicks, xTicks, opts) {
    var o = opts || {};
    var style = o.lineStyle || 'dashed';
    var dash = GRID_DASH[style];
    var color = o.color || THEME.gridStroke;
    var g = svg('g', { 'aria-hidden': 'true', 'data-grid': style });
    yTicks.forEach(function (y) {
      g.appendChild(svg('line', { x1: rect.x, x2: rect.x + rect.width, y1: y, y2: y, stroke: color, 'stroke-dasharray': dash, 'stroke-width': 1 }));
    });
    (xTicks || []).forEach(function (x) {
      g.appendChild(svg('line', { x1: x, x2: x, y1: rect.y, y2: rect.y + rect.height, stroke: color, 'stroke-dasharray': dash, 'stroke-width': 1 }));
    });
    return g;
  }

  /** <AxisTitles>: y title up the left edge, y2 down the right edge, x title centred under the ticks. */
  function axisTitles(rect, height, width, labels, style) {
    var l = labels || {};
    if (!l.xLabel && !l.yLabel && !l.y2Label) return null;
    var ta = axisTextAttrs(style);
    var cy = rect.y + rect.height / 2;
    var g = svg('g', { 'aria-hidden': 'true' });
    if (l.yLabel) g.appendChild(text(merge({ x: 12, y: cy, transform: 'rotate(-90 12 ' + cy + ')', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, ta), l.yLabel));
    if (l.y2Label && width !== undefined) {
      g.appendChild(text(merge({ x: width - 12, y: cy, transform: 'rotate(90 ' + (width - 12) + ' ' + cy + ')', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, ta), l.y2Label));
    }
    if (l.xLabel) g.appendChild(text(merge({ x: rect.x + rect.width / 2, y: height - 4, 'text-anchor': 'middle' }, ta), l.xLabel));
    return g;
  }

  /** <Thresholds>: reference lines at fixed values, with an optional tinted label pill. */
  function thresholds(lines, rect, scale, orientation) {
    if (!lines || !lines.length) return null;
    var horizontal = orientation !== 'vertical';
    var g = svg('g', { 'data-chart-thresholds': '' });
    lines.forEach(function (t) {
      if (!t || typeof t.value !== 'number' || !isFinite(t.value)) return;
      var p = scale(t.value);
      var inside = horizontal ? p >= rect.y - 0.5 && p <= rect.y + rect.height + 0.5 : p >= rect.x - 0.5 && p <= rect.x + rect.width + 0.5;
      if (!inside) return;
      var color = t.color || 'var(--warning)';
      var width = t.width === undefined ? 1 : t.width;
      var row = svg('g', { 'data-threshold': t.value });
      var line = horizontal ? { x1: rect.x, x2: rect.x + rect.width, y1: p, y2: p } : { x1: p, x2: p, y1: rect.y, y2: rect.y + rect.height };
      row.appendChild(svg('line', merge(line, { stroke: color, 'stroke-width': width, 'stroke-dasharray': dashArray(t.style || 'dashed', width), 'stroke-linecap': 'round' })));
      if (t.label) {
        var w = Math.ceil(t.label.length * 6.2) + 12;
        var h = 16;
        var px = horizontal ? rect.x + rect.width - w : p + 4;
        var py = horizontal ? (p - h - 3 < rect.y ? p + 3 : p - h - 3) : rect.y;
        var lg = svg('g', { 'data-threshold-label': '' });
        lg.appendChild(svg('rect', { x: px, y: py, width: w, height: h, rx: 4, fill: 'color-mix(in srgb, ' + color + ' 14%, var(--surface-raised))' }));
        lg.appendChild(text({ x: px + w / 2, y: py + h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': THEME.fontSize.axis, 'font-weight': 500, fill: color }, t.label));
        row.appendChild(lg);
      }
      g.appendChild(row);
    });
    return g;
  }

  /** <Crosshair>: a dashed vertical guide. */
  function crosshair(rect, x) {
    var g = svg('g', { 'aria-hidden': 'true' });
    g.appendChild(svg('line', { x1: x, x2: x, y1: rect.y, y2: rect.y + rect.height, stroke: THEME.crosshair, 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    return g;
  }

  /** One point mark (`_marks.tsx` PointMark): a circle is a <circle>, the other shapes are paths. */
  function pointMark(shape, x, y, r, attrs) {
    if (!shape || shape === 'circle') return svg('circle', merge({ cx: x, cy: y, r: r }, attrs || {}));
    return svg('path', merge({ d: pointPath(shape, x, y, r) }, attrs || {}));
  }

  /**
   * SVG text attributes for a value label: the axis text look, a halo so it reads over grid and
   * marks. On a filled mark (`onFill`) the text takes the surface colour.
   */
  function valueLabelAttrs(style, onFill) {
    var s = style || {};
    var a = axisTextAttrs(s);
    a['font-size'] = s.fontSize !== undefined ? s.fontSize : 11;
    a['font-weight'] = s.fontWeight !== undefined ? s.fontWeight : 500;
    a.fill = s.color || (onFill ? 'var(--surface-base)' : 'var(--text-primary)');
    if (!onFill) {
      a.stroke = 'var(--surface-raised)';
      a['stroke-width'] = 3;
      a['paint-order'] = 'stroke';
      a['stroke-linejoin'] = 'round';
    }
    a['pointer-events'] = 'none';
    return a;
  }

  /**
   * <ChartTooltip>: an HTML overlay inside the (relatively positioned) canvas.
   * Returns { update(label, data, x, y, containerWidth, footer), hide(), el }.
   * data rows: { seriesId, seriesName, color, y, valueLabel? }; footer: { label, value }.
   */
  function tooltip(container) {
    var el = document.createElement('div');
    el.setAttribute('role', 'tooltip');
    el.className = 'pointer-events-none absolute z-10 min-w-[140px] max-w-[260px] rounded-lg border px-3 py-2 shadow-md';
    el.style.backgroundColor = THEME.tooltipBg;
    el.style.borderColor = THEME.tooltipBorder;
    el.style.color = THEME.tooltipText;
    el.style.fontSize = THEME.fontSize.tooltip + 'px';
    el.hidden = true;
    container.appendChild(el);
    return {
      el: el,
      hide: function () { el.hidden = true; },
      update: function (label, data, x, y, containerWidth, footer) {
        if (!data.length) { el.hidden = true; return; }
        var flip = x > containerWidth - 160;
        el.style.left = (flip ? x - 12 : x + 12) + 'px';
        el.style.top = y + 'px';
        el.style.transform = flip ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
        el.textContent = '';
        if (label) {
          var head = document.createElement('div');
          head.className = 'mb-1.5 text-[11px] font-medium';
          head.style.color = THEME.tooltipMutedText;
          head.textContent = label;
          el.appendChild(head);
        }
        var ul = document.createElement('ul');
        ul.className = 'space-y-1';
        data.forEach(function (d) {
          var li = document.createElement('li');
          li.className = 'flex items-center gap-2';
          var sw = document.createElement('span');
          sw.setAttribute('aria-hidden', 'true');
          sw.className = 'inline-block size-2 shrink-0 rounded-full';
          sw.style.backgroundColor = d.color;
          var name = document.createElement('span');
          name.className = 'min-w-0 truncate';
          name.style.color = THEME.tooltipMutedText;
          name.textContent = d.seriesName;
          var val = document.createElement('span');
          val.className = 'ml-auto pl-3 font-semibold tabular-nums';
          val.textContent = d.valueLabel !== undefined && d.valueLabel !== null ? d.valueLabel : (d.y === null || d.y === undefined ? '—' : String(d.y));
          li.appendChild(sw); li.appendChild(name); li.appendChild(val);
          ul.appendChild(li);
        });
        el.appendChild(ul);
        if (footer) {
          var f = document.createElement('div');
          f.className = 'mt-1.5 flex items-center gap-2 border-t pt-1.5';
          f.style.borderColor = THEME.tooltipBorder;
          f.setAttribute('data-tooltip-total', '');
          var fl = document.createElement('span');
          fl.style.color = THEME.tooltipMutedText;
          fl.textContent = footer.label;
          var fv = document.createElement('span');
          fv.className = 'ml-auto pl-3 font-semibold tabular-nums';
          fv.textContent = footer.value;
          f.appendChild(fl); f.appendChild(fv);
          el.appendChild(f);
        }
        el.hidden = false;
      },
    };
  }

  var LEGEND_SPACING = {
    top: 'mb-2 flex-row flex-wrap gap-x-4 gap-y-1.5',
    bottom: 'mt-2 flex-row flex-wrap gap-x-4 gap-y-1.5',
    left: 'flex-col justify-center gap-2',
    right: 'flex-col justify-center gap-2',
  };

  /**
   * <Legend>: 8px dots, 12px text. opts: { series: [{ id, name, color }], position ('bottom'),
   * hidden ({ id: true }), onToggle(id) (entries become aria-pressed buttons), values ({ id: text }),
   * style ({ cssProp: value }), layout ('wrap' | 'grid') }.
   */
  function legend(opts) {
    var series = opts.series || [];
    if (!series.length) return null;
    var position = opts.position || 'bottom';
    var side = position === 'left' || position === 'right';
    var isGrid = opts.layout === 'grid' && !side;
    var hidden = opts.hidden || {};
    var values = opts.values || {};
    var ul = document.createElement('ul');
    ul.setAttribute('role', 'list');
    ul.setAttribute('data-kui-chart-legend', '');
    ul.className = 'kui-chart-legend '
      + (isGrid ? 'grid gap-x-5 gap-y-1.5 ' + (position === 'top' ? 'mb-2' : 'mt-2') : 'flex ' + (side ? 'shrink-0 ' : 'items-center ') + LEGEND_SPACING[position])
      + (side ? ' max-w-[45%] min-w-0' : '');
    ul.style.fontSize = THEME.fontSize.legend + 'px';
    ul.style.lineHeight = '16px';
    if (isGrid) ul.style.gridTemplateColumns = 'repeat(auto-fill, minmax(min(100%, 124px), 1fr))';
    if (opts.style) for (var k in opts.style) ul.style[k] = opts.style[k];
    series.forEach(function (s, i) {
      var color = paletteColor(i, s.color);
      var off = !!hidden[s.id];
      var stretch = isGrid || side;
      var li = document.createElement('li');
      li.className = 'flex min-w-0 items-center gap-2 text-text-secondary' + (off ? ' opacity-60' : '');
      var holder = li;
      if (opts.onToggle) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', off ? 'false' : 'true');
        btn.className = 'flex min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus' + (stretch ? ' w-full' : '');
        btn.addEventListener('click', function () { opts.onToggle(s.id); });
        li.appendChild(btn);
        holder = btn;
      }
      var dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.className = 'inline-block size-2 shrink-0 rounded-full';
      dot.style.backgroundColor = off ? 'transparent' : color;
      if (off) dot.style.boxShadow = 'inset 0 0 0 1.5px ' + color;
      var name = document.createElement('span');
      name.className = 'min-w-0' + (stretch ? ' truncate' : '') + (off ? ' line-through' : '');
      name.textContent = s.name;
      holder.appendChild(dot);
      holder.appendChild(name);
      if (values[s.id]) {
        var v = document.createElement('span');
        v.className = 'shrink-0 tabular-nums font-medium text-text-primary' + (stretch ? ' ml-auto pl-2' : '');
        v.textContent = values[s.id];
        holder.appendChild(v);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  /**
   * Put a legend in the chart frame (<ChartFrame>): before the plot for top / left, after it for
   * bottom / right. The frame layout itself is rendered by Chart.ejs. Keeps focus on a re-render.
   */
  function mountLegend(host, el, position) {
    var plot = host.querySelector('[data-kui-chart-plot]');
    if (!plot) return;
    var old = host.querySelector(':scope > [data-kui-chart-legend]');
    var focusIndex = -1;
    if (old) {
      var buttons = old.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) if (buttons[i] === document.activeElement) focusIndex = i;
      old.parentNode.removeChild(old);
    }
    if (!el) return;
    if (position === 'top' || position === 'left') host.insertBefore(el, plot);
    else plot.parentNode.insertBefore(el, plot.nextSibling);
    if (focusIndex >= 0) {
      var next = el.querySelectorAll('button')[focusIndex];
      if (next) next.focus();
    }
  }

  // ── Formatters as data (WidgetKit) ────────────────────────────────────────
  // A function cannot travel in the JSON config. Besides the NAME of a global function, a formatter option can be
  // a plain-data spec that this file turns into the function. The number spec is a JS twin of the vendored
  // `numberFormatter` / `formatValue` (src/widget-kit/views/chart-data.ts, settings/style.ts); keep them in step
  // (tests/widget-kit-chart-formatters.test.ts compares them on the golden cases).
  //   { base, override?, mode? }   → number formatter ('plain' | 'tick' | 'compact' | 'round' | 'round2')
  //   { fallback, bySeries }       → tooltip value formatter (value, series) → text, by series id
  //   { bands, edges }             → colour of a value by colour bands ({ from?, to?, color }), undefined = none

  var numberFormats = {};
  function intl(locale, opts) {
    var key = (locale || '') + '|' + opts.notation + '|' + opts.minimumFractionDigits + '|' + opts.maximumFractionDigits;
    if (!numberFormats[key]) numberFormats[key] = new Intl.NumberFormat(locale, opts);
    return numberFormats[key];
  }
  function either(a, b) { return a !== undefined && a !== null ? a : b; }

  /** `formatValue(value, base, override, locale)`: the number as text, the unit placed as configured. */
  function formatValue(value, base, override, locale) {
    base = base || {}; override = override || {};
    var n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!isFinite(n)) return value === null || value === undefined || value === '' ? '\u2014' : String(value);
    var decimals = either(override.decimals, base.decimals);
    var unit = either(either(override.unit, base.unit), '');
    var opts = { notation: base.notation === 'compact' ? 'compact' : 'standard' };
    if (typeof decimals === 'number') {
      opts.minimumFractionDigits = decimals;
      opts.maximumFractionDigits = decimals;
    } else if (opts.notation !== 'compact') {
      opts.maximumFractionDigits = Math.floor(n) === n ? 0 : 2;
    }
    var text = intl(locale, opts).format(n);
    if (!unit) return text;
    return base.unitPosition === 'before' ? unit + ' ' + text : text + ' ' + unit;
  }

  /** The function a number spec describes (`numberFormatter(spec, locale)`). */
  function numberFormatter(spec, locale) {
    var base = spec.base || {};
    var override = spec.override || {};
    var mode = spec.mode || 'plain';
    if (mode === 'round') return function (v) { return String(Math.round(v)); };
    if (mode === 'round2') return function (v) { return String(Math.round(v * 100) / 100); };
    if (mode === 'tick') {
      return function (v) {
        var whole = Math.floor(v) === v && base.notation !== 'compact';
        return formatValue(v, base, whole ? { unit: override.unit, decimals: 0 } : override, locale);
      };
    }
    if (mode === 'compact') {
      return function (v) {
        var b = {};
        for (var k in base) b[k] = base[k];
        b.notation = 'compact';
        b.decimals = Math.floor(v) === v ? undefined : base.decimals;
        return formatValue(v, b, {}, locale);
      };
    }
    return function (v) { return formatValue(v, base, override, locale); };
  }

  /** The colour of the first band the value falls in (`rangeFor` + the colour), `edges` 'from' (from <= v < to) or 'to'. */
  function bandColorFor(spec) {
    var bands = spec.bands || [];
    var edges = spec.edges === 'to' ? 'to' : 'from';
    return function (value) {
      if (value === null || value === undefined || value === '') return undefined;
      var n = typeof value === 'number' ? value : Number(value);
      if (!isFinite(n)) return undefined;
      for (var i = 0; i < bands.length; i++) {
        var r = bands[i];
        if (!r || typeof r !== 'object') continue;
        var from = typeof r.from === 'number' ? r.from : undefined;
        var to = typeof r.to === 'number' ? r.to : undefined;
        var above = from === undefined || (edges === 'from' ? n >= from : n > from);
        var below = to === undefined || (edges === 'from' ? n < to : n <= to);
        if (above && below) return r.color || undefined;
      }
      return undefined;
    };
  }

  /** The tooltip value text of `{ fallback, bySeries }` specs: (value, series) → text, by the series id. */
  function tooltipFormatter(spec, locale) {
    var by = {};
    for (var id in (spec.bySeries || {})) by[id] = numberFormatter(spec.bySeries[id], locale);
    var fallback = spec.fallback ? numberFormatter(spec.fallback, locale) : null;
    return function (v, s) {
      var f = (s && by[s.id]) || fallback;
      return f ? f(v) : String(v);
    };
  }

  /** Least-squares line through points ({ x, y }); null with fewer than 2 distinct x values (kui-react linearRegression). */
  function linearRegression(points) {
    var n = points.length;
    if (n < 2) return null;
    var sx = 0; var sy = 0; var sxx = 0; var sxy = 0;
    points.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    var slope = (n * sxy - sx * sy) / den;
    return { slope: slope, intercept: (sy - slope * sx) / n };
  }

  /**
   * A formatter option as a function, else null: a global function by NAME (config can only carry JSON), or a spec
   * object (see above; `locale` is the chart's).
   */
  function resolveFn(name, locale) {
    if (name && typeof name === 'object') {
      if (name.base) return numberFormatter(name, locale);
      if (name.bands) return bandColorFor(name);
      if (name.fallback || name.bySeries) return tooltipFormatter(name, locale);
      return null;
    }
    if (typeof name !== 'string' || !name) return null;
    var fn = global[name];
    return typeof fn === 'function' ? fn : null;
  }

  /** Renderers register here: KuiChart.renderers.series / .bar / .pie / .heatmap = function (host, cfg). */
  var renderers = {};

  /** Mount every not-yet-mounted [data-kui-chart-config] under `root` (default: document). */
  function autoInit(root) {
    var scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return;
    var hosts = scope.querySelectorAll('[data-kui-chart-config]');
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (host.__kuiChartMounted) continue;
      var kind = host.getAttribute('data-kui-chart-kind');
      var render = renderers[kind];
      if (!render) continue;
      var cfg;
      try { cfg = JSON.parse(host.getAttribute('data-kui-chart-config')); } catch (e) { continue; }
      host.__kuiChartMounted = true;
      render(host, cfg);
    }
  }

  global.KuiChart = {
    palette: DEFAULT_PALETTE,
    theme: THEME,
    padding: PADDING,
    paletteColor: paletteColor,
    niceStep: niceStep,
    niceTicks: niceTicks,
    resolveDomain: resolveDomain,
    alignedDomain: alignedDomain,
    labelWidth: labelWidth,
    thinLabels: thinLabels,
    defaultNumber: defaultNumber,
    yScale: yScale,
    bandCenter: bandCenter,
    bandWidth: bandWidth,
    yExtent: yExtent,
    xCategories: xCategories,
    smoothPath: smoothPath,
    linePath: linePath,
    stepPath: stepPath,
    curvePath: curvePath,
    continuePath: continuePath,
    dashArray: dashArray,
    pointPath: pointPath,
    stackedExtent: stackedExtent,
    stackTops: stackTops,
    stackKeys: stackKeys,
    groupedStackTops: groupedStackTops,
    topsExtent: topsExtent,
    seriesStats: seriesStats,
    valueText: valueText,
    legendValueTexts: legendValueTexts,
    plotPadding: plotPadding,
    observeContainer: observeContainer,
    animationDuration: animationDuration,
    entrance: entrance,
    polar: polar,
    arcPath: arcPath,
    buildHeatGrid: buildHeatGrid,
    heatIntensity: heatIntensity,
    toTime: toTime,
    isTimeSeries: isTimeSeries,
    timeExtent: timeExtent,
    timePoints: timePoints,
    inDomain: inDomain,
    visibleYExtent: visibleYExtent,
    xTime: xTime,
    invTime: invTime,
    tickStep: tickStep,
    zoneOffsetMs: zoneOffsetMs,
    timeTicks: timeTicks,
    clockText: clockText,
    dayMonthText: dayMonthText,
    formatTick: formatTick,
    formatFull: formatFull,
    brushDomain: brushDomain,
    brushRange: brushRange,
    bandIndex: bandIndex,
    bandRange: bandRange,
    keyRange: keyRange,
    keyedTimeRange: keyedTimeRange,
    rangeBand: rangeBand,
    nearestIndex: nearestIndex,
    MIN_ZOOM_MS: MIN_ZOOM_MS,
    MIN_BRUSH_PX: MIN_BRUSH_PX,
    svg: svg,
    axisTextAttrs: axisTextAttrs,
    axisX: axisX,
    axisY: axisY,
    grid: grid,
    axisTitles: axisTitles,
    thresholds: thresholds,
    crosshair: crosshair,
    pointMark: pointMark,
    valueLabelAttrs: valueLabelAttrs,
    tooltip: tooltip,
    legend: legend,
    mountLegend: mountLegend,
    resolveFn: resolveFn,
    formatValue: formatValue,
    numberFormatter: numberFormatter,
    bandColorFor: bandColorFor,
    tooltipFormatter: tooltipFormatter,
    linearRegression: linearRegression,
    renderers: renderers,
    autoInit: autoInit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
