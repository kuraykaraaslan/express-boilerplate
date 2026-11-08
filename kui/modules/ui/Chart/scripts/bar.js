/*
 * modules/ui/Chart/scripts/bar.js
 *
 * Renderer behind `type: 'bar'`. Mirrors kui-react's charts/BarChart.tsx one
 * to one: grouped or stacked series (one stack, or several by `series[].stack`),
 * vertical (default) or horizontal bars, bar width / gap / end radius, value
 * labels (outside, inside or centred), a right value axis for series with
 * `yAxis: 'right'` (vertical bars), category ticks and markers (a histogram's
 * bin edges and mean), plus the shared cartesian options (legend position /
 * values / toggling, fixed value bounds, axis titles, thresholds, tooltip mode
 * and total, axis text style, entrance animation).
 *
 * With `rangeSelect: true` and `categoryTimes` (the instant of each category,
 * one per category) a pointer drag along the category axis selects whole bars
 * for the page as a time range: on release the chart raises the bubbling
 * `kui:chart-range-select` event, detail `{ range: { from, to } }` (epoch ms,
 * from the first chosen bar to the end of the last one's bucket); a double
 * click, and Escape while a band shows, raise it with `{ range: null }`. The
 * plot is focusable: the arrow keys move the selection's end, Shift + arrows
 * its start, Enter reports it (kui-react's `onRangeSelect`).
 *
 * Mounted by KuiChart.autoInit() from `data-kui-chart-kind="bar"`. Requires
 * chart-helpers.js. Functions travel as global function NAMES (yFormat,
 * y2Format, tooltipValueFormat, xTickFormat, series[].format) or plain-data specs.
 */
(function (global) {
  'use strict';
  var K = global.KuiChart;
  if (!K || K.renderers.bar) return;

  var seq = 0;
  var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var opt = function (v) { return typeof v === 'number' && isFinite(v) ? v : undefined; };

  /** A bar with only its far end rounded: `dir` is where the bar grows (up, down, right, left). */
  function barPath(x, y, w, h, r, dir) {
    var vertical = dir === 'up' || dir === 'down';
    var rr = Math.max(0, Math.min(r, (vertical ? w : h) / 2, vertical ? h : w));
    if (rr <= 0) return 'M' + x + ' ' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z';
    if (dir === 'up') return 'M' + x + ' ' + (y + h) + 'V' + (y + rr) + 'Q' + x + ' ' + y + ' ' + (x + rr) + ' ' + y + 'H' + (x + w - rr) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rr) + 'V' + (y + h) + 'Z';
    if (dir === 'down') return 'M' + x + ' ' + y + 'V' + (y + h - rr) + 'Q' + x + ' ' + (y + h) + ' ' + (x + rr) + ' ' + (y + h) + 'H' + (x + w - rr) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w) + ' ' + (y + h - rr) + 'V' + y + 'Z';
    if (dir === 'right') return 'M' + x + ' ' + y + 'H' + (x + w - rr) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rr) + 'V' + (y + h - rr) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - rr) + ' ' + (y + h) + 'H' + x + 'Z';
    return 'M' + (x + w) + ' ' + y + 'H' + (x + rr) + 'Q' + x + ' ' + y + ' ' + x + ' ' + (y + rr) + 'V' + (y + h - rr) + 'Q' + x + ' ' + (y + h) + ' ' + (x + rr) + ' ' + (y + h) + 'H' + (x + w) + 'Z';
  }

  function render(host, cfg) {
    var canvas = host.querySelector('[data-kui-chart-canvas]');
    if (!canvas) return;
    var uid = 'kb' + (++seq);
    var baseHeight = num(cfg.height, 240);
    var locale = cfg.locale || undefined;
    var fill = !!cfg.fill;
    var showLegend = cfg.showLegend !== false;
    var showGrid = cfg.showGrid !== false;
    var showTooltip = cfg.showTooltip !== false;
    var radius = num(cfg.radius, 4);
    var stacked = !!cfg.stacked;
    var horizontal = cfg.orientation === 'horizontal';
    var showValues = !!cfg.showValues;
    var valueLabelPosition = cfg.valueLabelPosition === 'inside' || cfg.valueLabelPosition === 'center' ? cfg.valueLabelPosition : 'outside';
    var barWidth = num(cfg.barWidth, 0.75);
    var barGap = num(cfg.barGap, 2);
    var categoryTicks = cfg.categoryTicks;
    var xTickFormat = K.resolveFn(cfg.xTickFormat, locale);
    var markers = cfg.markers || [];
    var yFormat = K.resolveFn(cfg.yFormat, locale);
    var fmt = yFormat || K.defaultNumber;
    var fmt2 = K.resolveFn(cfg.y2Format, locale) || fmt;
    var tooltipValueFormat = K.resolveFn(cfg.tooltipValueFormat, locale);
    var legendPosition = cfg.legendPosition || 'bottom';
    var yMin = opt(cfg.yMin);
    var yMax = opt(cfg.yMax);
    var y2Min = opt(cfg.y2Min);
    var y2Max = opt(cfg.y2Max);
    var yTickCount = num(cfg.yTickCount, 4);
    var showXAxis = cfg.showXAxis !== false;
    var showYAxis = cfg.showYAxis !== false;
    var tooltipHeader = cfg.tooltipHeader !== false;
    var tooltipTotal = !!cfg.tooltipTotal;
    var tooltipTotalLabel = typeof cfg.tooltipTotalLabel === 'string' ? cfg.tooltipTotalLabel : 'Total';
    var animate = cfg.animate !== false;
    var tipMode = showTooltip ? (cfg.tooltipMode || 'axis') : 'none';
    var tickFs = cfg.tickStyle && typeof cfg.tickStyle.fontSize === 'number' ? cfg.tickStyle.fontSize : 11;
    var animMs = K.animationDuration();

    var colored = (cfg.series || []).map(function (s, i) {
      var o = {};
      for (var k in s) o[k] = s[k];
      o.color = K.paletteColor(i, s.color);
      o.data = s.data || [];
      if (s.format && typeof s.format === 'object') o.format = K.resolveFn(s.format, locale);
      return o;
    });
    var hidden = {};
    colored.forEach(function (s) { if (s.hidden) hidden[s.id] = true; });
    var toggleable = typeof cfg.legendToggle === 'boolean' ? cfg.legendToggle : colored.some(function (s) { return s.hidden; });
    var categories = K.xCategories(colored);
    var categoryTimes = Array.isArray(cfg.categoryTimes) ? cfg.categoryTimes : null;
    var selecting = cfg.rangeSelect === true && !!categoryTimes && categories.length > 0 && categoryTimes.length === categories.length;

    var hover = null;
    // A range selection for the page: the pointer band in px along the category axis, and the keyed one in indices.
    var brush = null;
    var keySel = null;
    var captured = false;
    var size = { width: 0, height: 0 };
    var played = false;
    var geo = null;

    var svgEl = K.svg('svg', { role: 'img', 'aria-label': cfg.ariaLabel || 'Bar chart' });
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'visible';
    if (selecting) {
      svgEl.setAttribute('tabindex', '0');
      svgEl.setAttribute('class', 'outline-none focus-visible:ring-2 focus-visible:ring-border-focus');
      svgEl.style.touchAction = horizontal ? 'pan-x' : 'pan-y';
      svgEl.style.cursor = 'crosshair';
      svgEl.style.userSelect = 'none';
    }
    canvas.insertBefore(svgEl, canvas.firstChild);
    var tip = K.tooltip(canvas);

    function drawLegend() {
      if (!showLegend || !colored.length) { K.mountLegend(host, null); return; }
      K.mountLegend(host, K.legend({
        series: colored, position: legendPosition, hidden: hidden, style: cfg.legendStyle,
        values: K.legendValueTexts(colored, cfg.legendValues, yFormat),
        onToggle: toggleable ? function (id) {
          if (hidden[id]) delete hidden[id]; else hidden[id] = true;
          hover = null;
          drawLegend();
          draw();
        } : undefined,
      }), legendPosition);
    }

    function draw() {
      var width = size.width;
      if (width <= 0) return;
      var height = fill ? (size.height > 0 ? size.height : baseHeight) : baseHeight;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      svgEl.setAttribute('width', width);
      svgEl.setAttribute('height', height);

      var visible = colored.filter(function (s) { return !hidden[s.id]; });
      // Horizontal bars have one value axis: a right-axis series is drawn on it like the others.
      var axisSeries = horizontal ? visible.map(function (s) {
        var o = {};
        for (var k in s) o[k] = s[k];
        o.yAxis = undefined;
        return o;
      }) : visible;
      var keys = K.stackKeys(axisSeries, stacked);
      var isStacked = keys.some(function (k) { return k !== null; });
      var stack = K.groupedStackTops(axisSeries, keys);
      var order = [];
      var slotAt = keys.map(function (k, si) {
        var id = k !== null ? k : '\u0000solo:' + axisSeries[si].id;
        var at = order.indexOf(id);
        if (at < 0) { order.push(id); at = order.length - 1; }
        return at;
      });
      var slots = Math.max(1, order.length);

      var onRight = axisSeries.map(function (s) { return s.yAxis === 'right'; });
      var hasRight = onRight.some(Boolean);
      var hasLeft = onRight.some(function (r) { return !r; }) || !hasRight;
      var extentOf = function (right) { return K.topsExtent(stack.tops.filter(function (_, i) { return onRight[i] === right; })); };
      var thresholds = cfg.thresholds || [];
      var thrL = thresholds.filter(function (t) { return t.yAxis !== 'right' || horizontal; });
      var thrR = horizontal ? [] : thresholds.filter(function (t) { return t.yAxis === 'right'; });
      var L = hasLeft
        ? K.resolveDomain(extentOf(false), { min: yMin, max: yMax, thresholds: thrL, count: yTickCount })
        : K.resolveDomain(extentOf(true), { min: y2Min, max: y2Max, thresholds: thrR, count: yTickCount });
      var valueTicks = K.niceTicks(L.min, L.max, yTickCount);
      var R = null;
      if (hasRight && hasLeft) {
        var e = extentOf(true);
        thrR.forEach(function (t) { if (t.value < e.min) e.min = t.value; if (t.value > e.max) e.max = t.value; });
        R = K.alignedDomain(e, valueTicks.length - 1, { min: y2Min, max: y2Max });
      } else if (hasRight) {
        R = { min: L.min, max: L.max, ticks: valueTicks };
      }

      var valueLabels = hasLeft ? valueTicks.map(fmt) : [];
      var y2Labels = R ? R.ticks.map(fmt2) : undefined;
      var catLabels = categories.map(function (c, i) { return xTickFormat ? xTickFormat(c, i) : c; });
      // The left axis carries values (vertical) or category names (horizontal).
      var pad;
      if (horizontal) {
        pad = K.plotPadding({ yTickLabels: catLabels, xLabel: cfg.xLabel, yLabel: cfg.yLabel, tickStyle: cfg.tickStyle, showXAxis: showYAxis, showYAxis: showXAxis });
        pad.right = 12 + (showValues && valueLabelPosition === 'outside' ? K.labelWidth(valueTicks.map(fmt)) : 0);
      } else {
        pad = K.plotPadding({
          yTickLabels: valueLabels, y2TickLabels: y2Labels, xLabel: cfg.xLabel, yLabel: cfg.yLabel,
          y2Label: R ? cfg.y2Label : undefined, tickStyle: cfg.tickStyle, showXAxis: showXAxis, showYAxis: showYAxis,
          minLeft: hasLeft ? 28 : 8,
        });
      }
      if (!horizontal && showValues && valueLabelPosition === 'outside') pad.top = Math.max(pad.top, 18);
      if (horizontal) pad.left = Math.min(pad.left, Math.max(40, width * 0.4));
      var rect = {
        x: pad.left, y: pad.top,
        width: Math.max(0, width - pad.left - pad.right),
        height: Math.max(0, height - pad.top - pad.bottom),
      };
      var lin = function (lo, hi) {
        return horizontal
          ? function (v) { return hi === lo ? rect.x : rect.x + ((v - lo) / (hi - lo)) * rect.width; }
          : function (v) { return K.yScale(v, lo, hi, rect); };
      };
      var vPxL = lin(L.min, L.max);
      var vPxR = R ? lin(R.min, R.max) : vPxL;
      var scaleOf = function (si) { return onRight[si] && hasLeft ? vPxR : vPxL; };
      var catRect = horizontal ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect;
      var step = categories.length ? catRect.width / categories.length : 0;
      var cPx = function (i) { return K.bandCenter(i, categories.length, catRect); };
      var valuePixels = valueTicks.map(vPxL);
      var valueAxis = hasLeft ? valueTicks.map(function (_, i) { return { position: valuePixels[i], label: valueLabels[i] }; }) : [];
      var y2Axis = R ? R.ticks.map(function (v, i) { return { position: vPxR(v), label: y2Labels[i] }; }) : [];
      var catAxis = catLabels.map(function (label, i) { return { position: cPx(i), label: label }; });
      var catAxisX = K.thinLabels(
        categoryTicks ? categoryTicks.map(function (t) { return { position: catRect.x + t.at * step, label: t.label }; }) : catAxis,
        rect.width, tickFs,
      );

      var groupWidth = step * Math.min(1, Math.max(0.05, barWidth));
      var gap = slots > 1 ? Math.min(barGap, groupWidth / slots / 2) : 0;
      var thick = Math.max(1, (groupWidth - gap * (slots - 1)) / slots);

      var bars = axisSeries.map(function (s, si) {
        return s.data.map(function (p, i) {
          if (p.y === null || p.y === undefined || i >= categories.length) return null;
          var vPx = scaleOf(si);
          var lo = onRight[si] && R ? R.min : L.min;
          var hi = onRight[si] && R ? R.max : L.max;
          var zero = vPx(Math.min(hi, Math.max(lo, 0)));
          var inStack = keys[si] !== null;
          var start = cPx(i) - groupWidth / 2 + slotAt[si] * (thick + gap);
          var topV = inStack ? (stack.tops[si] && stack.tops[si][i] !== null && stack.tops[si][i] !== undefined ? stack.tops[si][i] : 0) : p.y;
          var a = inStack ? vPx(topV - Math.max(0, p.y)) : zero;
          var b = vPx(topV);
          var low = Math.min(a, b);
          var len = Math.abs(b - a);
          // The far end is rounded only on the top segment of a stack.
          var topOfStack = !inStack || !axisSeries.some(function (o, oi) {
            return oi > si && keys[oi] === keys[si] && o.data[i] && typeof o.data[i].y === 'number' && o.data[i].y > 0;
          });
          var negative = p.y < 0;
          var dir = horizontal ? (negative ? 'left' : 'right') : (negative ? 'down' : 'up');
          var x = horizontal ? low : start;
          var yy = horizontal ? start : low;
          var w = horizontal ? len : thick;
          var h = horizontal ? thick : len;
          return {
            i: i, y: p.y, label: K.valueText(s, p.y, p, yFormat), from: a, end: b, mid: (a + b) / 2, negative: negative,
            x: x, yy: yy, w: w, h: h, centre: start + thick / 2, d: barPath(x, yy, w, h, topOfStack ? radius : 0, dir), len: len,
          };
        });
      });

      // Value labels: thinned to every k-th category when they would collide.
      var longest = 0;
      if (showValues) bars.forEach(function (row) { row.forEach(function (b) { if (b) longest = Math.max(longest, b.label.length); }); });
      var labelEvery = !showValues || horizontal || isStacked ? 1 : Math.max(1, Math.ceil((longest * 6.6 + 6) / Math.max(1, slots > 1 ? thick + gap : step)));

      var tipRows = [];
      if (hover && tipMode !== 'none' && !brush) {
        tipRows = visible.map(function (s) {
          var p = s.data[hover.index];
          var y = p && p.y !== undefined ? p.y : null;
          return {
            seriesId: s.id, seriesName: s.name, color: s.color, y: y,
            valueLabel: y === null ? undefined : (tooltipValueFormat ? tooltipValueFormat(y, s) : K.valueText(s, y, p, yFormat)),
          };
        });
        if (tipMode === 'point') {
          var k = -1;
          for (var si = 0; si < visible.length; si++) {
            var b = bars[si][hover.index];
            if (!b) continue;
            var alongOk = hover.along >= b.centre - thick / 2 - gap / 2 && hover.along <= b.centre + thick / 2 + gap / 2;
            var posOk = hover.pos >= Math.min(b.from, b.end) - 1 && hover.pos <= Math.max(b.from, b.end) + 1;
            if (keys[si] !== null ? alongOk && posOk : alongOk) { k = si; break; }
          }
          tipRows = k >= 0 && k < tipRows.length && tipRows[k].y !== null ? [tipRows[k]] : [];
        }
      }
      var hoverC = hover === null ? null : cPx(hover.index);
      var total = tooltipTotal && isStacked && tipRows.length > 1
        ? { label: tooltipTotalLabel, value: fmt(tipRows.reduce(function (a, d) { return a + (d.y || 0); }, 0)) }
        : undefined;
      var header = hover ? (categories[hover.index] || '') : '';
      var onFill = valueLabelPosition !== 'outside' || isStacked;
      geo = { rect: rect, catRect: catRect, step: step };
      // The selection for the page, as whole categories: the pointer band snapped, or the keyed one.
      var sel = !selecting ? null
        : brush ? { i0: K.bandIndex(brush.from, step, categories.length), i1: K.bandIndex(brush.to, step, categories.length) }
          : keySel ? { i0: keySel.anchor, i1: keySel.focus } : null;
      var bandPx = sel ? { from: catRect.x + Math.min(sel.i0, sel.i1) * step, to: catRect.x + (Math.max(sel.i0, sel.i1) + 1) * step } : null;

      // ── SVG ──
      var defs = K.svg('defs', {});
      var clip = K.svg('clipPath', { id: uid + '-clip' });
      clip.appendChild(K.svg('rect', {
        x: rect.x - (showValues ? 24 : 1), y: rect.y - (showValues ? 18 : 1),
        width: rect.width + (showValues ? (horizontal ? 84 : 48) : 2), height: rect.height + (showValues ? 19 : 2),
      }));
      defs.appendChild(clip);
      svgEl.appendChild(defs);
      if (hoverC !== null && tipRows.length && !brush) {
        svgEl.appendChild(K.svg('rect', {
          'aria-hidden': 'true',
          x: horizontal ? rect.x : hoverC - step / 2,
          y: horizontal ? hoverC - step / 2 : rect.y,
          width: horizontal ? rect.width : step,
          height: horizontal ? step : rect.height,
          fill: 'var(--text-secondary)', opacity: 0.08, rx: 4,
        }));
      }
      if (bandPx) svgEl.appendChild(K.rangeBand(rect, bandPx.from, bandPx.to, horizontal));
      if (showGrid) {
        svgEl.appendChild(horizontal
          ? K.grid(rect, [], valuePixels, { color: cfg.gridColor, lineStyle: cfg.gridStyle })
          : K.grid(rect, valuePixels, [], { color: cfg.gridColor, lineStyle: cfg.gridStyle }));
      }
      if (horizontal) {
        svgEl.appendChild(K.axisY(catAxis, rect.x, rect.y, rect.y + rect.height, { textStyle: cfg.tickStyle, tickMarks: false, showLabels: showXAxis }));
        svgEl.appendChild(K.axisX(valueAxis, rect.y + rect.height, rect.x, rect.x + rect.width, { textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
      } else {
        if (hasLeft) svgEl.appendChild(K.axisY(valueAxis, rect.x, rect.y, rect.y + rect.height, { textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
        if (R) svgEl.appendChild(K.axisY(y2Axis, rect.x + rect.width, rect.y, rect.y + rect.height, { side: 'right', textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
        svgEl.appendChild(K.axisX(catAxisX, rect.y + rect.height, rect.x, rect.x + rect.width, { textStyle: cfg.tickStyle, tickMarks: false, showLabels: showXAxis }));
      }
      var titles = K.axisTitles(rect, height, width, { xLabel: cfg.xLabel, yLabel: cfg.yLabel, y2Label: R ? cfg.y2Label : undefined }, cfg.tickStyle);
      if (titles) svgEl.appendChild(titles);

      var enter = K.svg('g', {});
      var clipped = K.svg('g', { 'clip-path': 'url(#' + uid + '-clip)' });
      axisSeries.forEach(function (s, si) {
        var g = K.svg('g', { 'data-series': s.id });
        bars[si].forEach(function (b) {
          if (!b) return;
          var path = K.svg('path', {
            d: b.d, 'data-bar': '', 'data-x': b.x, 'data-y': b.yy, 'data-w': b.w, 'data-h': b.h,
            fill: s.color, opacity: hover === null || hover.index === b.i ? 1 : 0.55,
          });
          if (animMs) path.style.transition = 'opacity ' + animMs + 'ms';
          g.appendChild(path);
        });
        if (showValues) {
          bars[si].forEach(function (b) {
            if (!b || b.i % labelEvery !== 0) return;
            var inside = valueLabelPosition === 'inside';
            var center = valueLabelPosition === 'center' || (isStacked && valueLabelPosition === 'outside');
            if ((inside || center) && b.len < (horizontal ? b.label.length * 6.6 + 8 : 16)) return;
            var sign = b.negative ? -1 : 1;
            var tx;
            var ty;
            var anchor = 'middle';
            if (horizontal) {
              ty = b.centre + 4;
              if (center) tx = b.mid;
              else if (inside) { tx = b.end - sign * 6; anchor = b.negative ? 'start' : 'end'; }
              else { tx = b.end + sign * 5; anchor = b.negative ? 'end' : 'start'; }
            } else {
              tx = b.centre;
              if (center) ty = b.mid + 4;
              else if (inside) ty = b.end + (b.negative ? -6 : 14);
              else ty = b.end + (b.negative ? 13 : -5);
            }
            var attrs = K.valueLabelAttrs(cfg.valueLabelStyle, onFill);
            attrs['data-value-label'] = '';
            attrs.x = tx;
            attrs.y = ty;
            attrs['text-anchor'] = anchor;
            var t = K.svg('text', attrs);
            t.textContent = b.label;
            g.appendChild(t);
          });
        }
        clipped.appendChild(g);
      });
      var tl = hasLeft ? K.thresholds(thrL, rect, vPxL, horizontal ? 'vertical' : 'horizontal') : null;
      if (tl) clipped.appendChild(tl);
      var tr = R && hasLeft ? K.thresholds(thrR, rect, vPxR) : null;
      if (tr) clipped.appendChild(tr);
      enter.appendChild(clipped);
      svgEl.appendChild(enter);
      if (!played) { played = true; K.entrance(enter, horizontal ? 'reveal-x' : 'reveal-y', animate); }

      if (!horizontal) {
        markers.forEach(function (m, k) {
          var x = catRect.x + m.at * step;
          if (!isFinite(x) || x < rect.x - 0.5 || x > rect.x + rect.width + 0.5) return;
          var color = m.color || 'var(--text-primary)';
          var w = num(m.width, 1.5);
          var right = x < rect.x + rect.width - 70;
          var g = K.svg('g', { 'data-marker': m.label !== undefined ? m.label : k, 'aria-hidden': 'true' });
          g.appendChild(K.svg('line', {
            x1: x, x2: x, y1: rect.y + (m.label ? 4 : 0), y2: rect.y + rect.height, stroke: color, 'stroke-width': w,
            'stroke-dasharray': K.dashArray(m.style || 'dashed', w), 'stroke-linecap': 'round',
          }));
          if (m.label) {
            var attrs = K.valueLabelAttrs({ color: color, fontSize: K.theme.fontSize.axis });
            attrs.x = x + (right ? 5 : -5);
            attrs.y = rect.y + 8 + k * 14;
            attrs['text-anchor'] = right ? 'start' : 'end';
            var t = K.svg('text', attrs);
            t.textContent = m.label;
            g.appendChild(t);
          }
          svgEl.appendChild(g);
        });
      }

      if (tipRows.length && hoverC !== null) {
        tip.update(tooltipHeader ? header : '', tipRows,
          horizontal ? rect.x + rect.width / 2 : hoverC + step / 2,
          horizontal ? hoverC : rect.y + rect.height / 2,
          width, total);
      } else tip.hide();
    }

    /** Where a pointer is along the category axis (px from its start) and across it. */
    function alongOf(e) {
      var bounds = svgEl.getBoundingClientRect();
      return {
        along: horizontal ? e.clientY - bounds.top - geo.rect.y : e.clientX - bounds.left - geo.rect.x,
        across: horizontal ? e.clientX - bounds.left : e.clientY - bounds.top,
      };
    }
    /** Tell the page: the bubbling `kui:chart-range-select` event, `{ range: { from, to } | null }`. */
    function emit(range) {
      host.dispatchEvent(new CustomEvent('kui:chart-range-select', { bubbles: true, detail: { range: range } }));
    }
    function report(i0, i1) {
      var range = K.bandRange(categoryTimes, i0, i1);
      if (range) { emit(range); hover = null; }
    }
    function endDrag() { captured = false; brush = null; }

    svgEl.addEventListener('pointerdown', function (e) {
      if (!selecting || e.button !== 0 || !geo) return;
      var along = alongOf(e).along;
      if (along < 0 || along > geo.catRect.width) return;
      // Keep the drag through a pointer that leaves the plot.
      if (typeof svgEl.setPointerCapture === 'function') {
        try { svgEl.setPointerCapture(e.pointerId); captured = true; } catch (err) { captured = false; }
      }
      keySel = null;
      brush = { from: along, to: along };
      draw();
    });
    svgEl.addEventListener('pointermove', function (e) {
      if (!brush || !geo) return;
      brush = { from: brush.from, to: Math.min(geo.catRect.width, Math.max(0, alongOf(e).along)) };
      draw();
    });
    svgEl.addEventListener('pointerup', function () {
      if (!brush || !geo) return;
      var b = brush;
      endDrag();
      // A click is not a brush: the band must be at least MIN_BRUSH_PX long.
      if (Math.abs(b.to - b.from) >= K.MIN_BRUSH_PX) report(K.bandIndex(b.from, geo.step, categories.length), K.bandIndex(b.to, geo.step, categories.length));
      draw();
    });
    svgEl.addEventListener('pointercancel', function () { endDrag(); draw(); });
    svgEl.addEventListener('mousemove', function (e) {
      if (tipMode === 'none' || !categories.length || !geo) return;
      var at = alongOf(e);
      if (at.along < 0 || at.along > geo.catRect.width) hover = null;
      else hover = { index: K.bandIndex(at.along, geo.step, categories.length), along: geo.catRect.x + at.along, pos: at.across };
      draw();
    });
    svgEl.addEventListener('mouseleave', function () { hover = null; if (!captured) brush = null; draw(); });
    svgEl.addEventListener('dblclick', function () { if (selecting) { keySel = null; emit(null); draw(); } });
    svgEl.addEventListener('keydown', function (e) {
      if (!selecting) return;
      if (e.key === 'Escape') {
        if (!brush && !keySel) return;
        e.preventDefault();
        endDrag();
        keySel = null;
        emit(null);
        draw();
      } else if (e.key === 'Enter') {
        if (keySel) { e.preventDefault(); report(keySel.anchor, keySel.focus); }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        keySel = K.keyRange(keySel, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey, 0, categories.length - 1, 1);
        draw();
      }
    });

    drawLegend();
    K.observeContainer(canvas, function (s) {
      if (s.width <= 0) return;
      size = s;
      draw();
    });
  }

  K.renderers.bar = render;
})(typeof window !== 'undefined' ? window : globalThis);
