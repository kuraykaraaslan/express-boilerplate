/*
 * modules/ui/Chart/scripts/series.js
 *
 * The one renderer behind `type: 'line' | 'area'`, band (category) and time
 * axis. Mirrors kui-react's charts/_SeriesChart.tsx one to one.
 *
 * mode 'band' places points by index on a category axis (stacking allowed);
 * mode 'time' places them by timestamp (uneven sampling, gaps, drag-to-zoom).
 * Zoom is a drag-to-select brush kept in this closure only: it never reaches
 * the page. Double-click or the "Reset zoom" button leaves it.
 *
 * With `rangeSelect: true` the same drag (a pointer: mouse, pen or touch)
 * selects a range FOR the page instead (on a band axis too, when
 * `categoryTimes` gives the instant of every category): on release the chart
 * raises the bubbling `kui:chart-range-select` event, detail
 * `{ range: { from, to } }` (epoch ms, from < to; on a band axis whole
 * categories, to the end of the last one's bucket); a double click, and
 * Escape while a band shows, raise it with `{ range: null }` (reset). The
 * plot is focusable: the arrow keys move the selection's end, Shift + arrows
 * its start, Enter reports it. The local zoom then stays out of the way, as
 * the page owns the window (kui-react's `onRangeSelect`).
 *
 * Mounted by KuiChart.autoInit() from `data-kui-chart-kind="series"` +
 * `data-kui-chart-config` (JSON). Requires chart-helpers.js. Functions travel
 * as the NAME of a global function (yFormat, y2Format, tooltipValueFormat,
 * series[].format) or as a plain-data spec (see KuiChart.resolveFn).
 */
(function (global) {
  'use strict';
  var K = global.KuiChart;
  if (!K || K.renderers.series) return;

  var seq = 0;
  var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var opt = function (v) { return typeof v === 'number' && isFinite(v) ? v : undefined; };

  function render(host, cfg) {
    var canvas = host.querySelector('[data-kui-chart-canvas]');
    if (!canvas) return;
    var uid = 'kc' + (++seq);
    var variant = cfg.variant === 'area' ? 'area' : 'line';
    var isTime = cfg.mode === 'time';
    var baseHeight = num(cfg.height, 240);
    var fill = !!cfg.fill;
    var showLegend = cfg.showLegend !== false;
    var showGrid = cfg.showGrid !== false;
    var showTooltip = cfg.showTooltip !== false;
    var smooth = cfg.smooth !== false;
    var strokeWidth = num(cfg.strokeWidth, 2);
    var fillOpacity = num(cfg.fillOpacity, 0.2);
    var stacked = !!cfg.stacked;
    var locale = cfg.locale || undefined;
    var timeZone = cfg.timeZone || undefined;
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
    var showValues = !!cfg.showValues;
    var valueLabelPosition = cfg.valueLabelPosition === 'bottom' ? 'bottom' : 'top';
    var yIncludeZero = cfg.yIncludeZero !== false;
    var tipMode = showTooltip ? (cfg.tooltipMode || 'axis') : 'none';
    var resetBtn = host.querySelector('[data-kui-chart-reset]');
    var animMs = K.animationDuration();

    // Palette colour fixed by ORIGINAL index: hiding a series never recolours the rest.
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
    // A range for the page: on the time axis, or on a band axis whose every category has its instant.
    var selecting = cfg.rangeSelect === true && (isTime || (!!categoryTimes && categories.length > 0 && categoryTimes.length === categories.length));
    // The local zoom steps aside when the page takes the range.
    var zoomable = isTime && cfg.zoom !== false && !selecting;
    var dragOn = zoomable || selecting;

    var zoomDomain = null;
    var hover = null;
    var brush = null;
    // The keyboard selection ({ anchor, focus }: ms on a time axis, category indices on a band axis).
    var keySel = null;
    // Whether the pointer of the running drag is captured (the drag then survives leaving the plot).
    var captured = false;
    var size = { width: 0, height: 0 };
    var played = false;
    var geo = null;

    var svgEl = K.svg('svg', { role: 'img', 'aria-label': cfg.ariaLabel || (variant === 'area' ? 'Area chart' : 'Line chart') });
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'visible';
    if (isTime || selecting) {
      svgEl.style.touchAction = 'pan-y';
      svgEl.style.userSelect = 'none';
      if (dragOn) svgEl.style.cursor = 'crosshair';
    }
    if (selecting) {
      svgEl.setAttribute('tabindex', '0');
      svgEl.setAttribute('class', 'outline-none focus-visible:ring-2 focus-visible:ring-border-focus');
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
      var keys = isTime ? visible.map(function () { return null; }) : K.stackKeys(visible, stacked);
      var isStacked = keys.some(function (k) { return k !== null; });
      var curve = cfg.curve || (smooth && !isStacked ? 'smooth' : 'linear');
      var rows = isTime
        ? K.timePoints(visible)
        : visible.map(function (s) { return s.data.map(function (p, i) { return { t: i, y: p.y, label: p.label }; }); });
      var full = isTime ? K.timeExtent(visible) : [0, 1];
      var domain = zoomDomain && zoomDomain[1] > full[0] && zoomDomain[0] < full[1] ? zoomDomain : full;
      var zoomed = isTime && domain !== full;
      var span = domain[1] - domain[0];
      var stack = isTime ? null : K.groupedStackTops(visible, keys);

      // Two value axes: series on the right get their own domain, aligned to the left one's grid lines.
      var onRight = visible.map(function (s) { return s.yAxis === 'right'; });
      var hasRight = onRight.some(Boolean);
      var hasLeft = onRight.some(function (r) { return !r; }) || !hasRight;
      var extentOf = function (right) {
        var idx = [];
        visible.forEach(function (_, i) { if (onRight[i] === right) idx.push(i); });
        var zero = yIncludeZero || isStacked;
        if (isTime) return K.visibleYExtent(idx.map(function (i) { return rows[i]; }), domain, zero);
        return K.topsExtent(idx.map(function (i) { return stack.tops[i]; }), zero);
      };
      var thresholds = cfg.thresholds || [];
      var thrL = thresholds.filter(function (t) { return t.yAxis !== 'right'; });
      var thrR = thresholds.filter(function (t) { return t.yAxis === 'right'; });
      var L = hasLeft
        ? K.resolveDomain(extentOf(false), { min: yMin, max: yMax, thresholds: thrL, count: yTickCount })
        : K.resolveDomain(extentOf(true), { min: y2Min, max: y2Max, thresholds: thrR, count: yTickCount });
      var leftTicks = K.niceTicks(L.min, L.max, yTickCount);
      var R = null;
      if (hasRight && hasLeft) {
        var e = extentOf(true);
        thrR.forEach(function (t) { if (t.value < e.min) e.min = t.value; if (t.value > e.max) e.max = t.value; });
        R = K.alignedDomain(e, leftTicks.length - 1, { min: y2Min, max: y2Max });
      } else if (hasRight) {
        R = { min: L.min, max: L.max, ticks: leftTicks };
      }

      var yTickLabels = hasLeft ? leftTicks.map(fmt) : [];
      var y2TickLabels = R ? R.ticks.map(fmt2) : undefined;
      var pad = K.plotPadding({
        yTickLabels: yTickLabels, y2TickLabels: y2TickLabels, xLabel: cfg.xLabel, yLabel: cfg.yLabel,
        y2Label: R ? cfg.y2Label : undefined, tickStyle: cfg.tickStyle, showXAxis: showXAxis, showYAxis: showYAxis,
        minLeft: hasLeft ? 28 : 8,
      });
      var rect = {
        x: pad.left, y: pad.top,
        width: Math.max(0, width - pad.left - pad.right),
        height: Math.max(0, height - pad.top - pad.bottom),
      };
      var yPxL = function (v) { return K.yScale(v, L.min, L.max, rect); };
      var yPxR = R ? function (v) { return K.yScale(v, R.min, R.max, rect); } : yPxL;
      var scaleOf = function (si) { return onRight[si] && hasLeft ? yPxR : yPxL; };
      var xPx = function (k) { return isTime ? K.xTime(k, domain, rect) : K.bandCenter(k, categories.length, rect); };
      var yPixels = leftTicks.map(yPxL);
      var yTicks = hasLeft ? leftTicks.map(function (_, i) { return { position: yPixels[i], label: yTickLabels[i] }; }) : [];
      var y2Ticks = R ? R.ticks.map(function (v, i) { return { position: yPxR(v), label: y2TickLabels[i] }; }) : [];
      var xTicks = isTime
        ? K.timeTicks(domain, Math.max(2, Math.floor(rect.width / 90)), timeZone).map(function (t) {
          return { position: K.xTime(t, domain, rect), label: K.formatTick(t, span, locale, timeZone) };
        })
        : K.thinLabels(categories.map(function (label, i) { return { position: K.bandCenter(i, categories.length, rect), label: label }; }), rect.width);

      var plotY = function (si, j, y) {
        var v = isStacked && stack ? ((stack.tops[si] && stack.tops[si][j] !== null && stack.tops[si][j] !== undefined) ? stack.tops[si][j] : 0) : y;
        return scaleOf(si)(v);
      };
      var projected = visible.map(function (s, si) {
        var color = s.color;
        var w = num(s.strokeWidth, strokeWidth);
        var scale = scaleOf(si);
        var pts = rows[si].map(function (p, j) {
          return p.y === null || p.y === undefined ? null : { x: xPx(p.t), y: plotY(si, j, p.y), v: p.y, j: j };
        });
        var solid = pts.filter(Boolean);
        var opacity = variant === 'area' ? num(s.fillOpacity, fillOpacity) : num(s.fillOpacity, 0);
        var lo = onRight[si] && R ? R.min : L.min;
        var hi = onRight[si] && R ? R.max : L.max;
        var baselineY = scale(Math.min(hi, Math.max(lo, 0)));
        var areaPath = '';
        if (opacity > 0 && solid.length > 1) {
          var top = K.curvePath(solid, curve);
          var under = stack ? stack.below[si] : -1;
          if (isStacked && stack && under >= 0) {
            var lower = [];
            rows[si].forEach(function (p, j) {
              var b = stack.tops[under] ? stack.tops[under][j] : null;
              if (p.y !== null && p.y !== undefined && b !== null && b !== undefined) lower.push({ x: xPx(p.t), y: scale(b) });
            });
            areaPath = top + ' ' + K.continuePath(lower.reverse(), curve, 'before') + ' Z';
          } else {
            areaPath = top + ' L' + solid[solid.length - 1].x + ' ' + baselineY + ' L' + solid[0].x + ' ' + baselineY + ' Z';
          }
        }
        return {
          s: s, si: si, color: color, w: w, pts: pts, solid: solid, opacity: opacity, areaPath: areaPath,
          gradientId: s.fillGradient ? uid + '-grad-' + si : null,
          path: K.curvePath(pts, curve),
          solo: solid.length === 1 ? solid[0] : null,
          shape: s.pointShape || cfg.pointShape || 'circle',
          r: num(s.pointSize, num(cfg.pointSize, w + 1.5)),
        };
      });

      // Value labels: every k-th point so neighbouring labels never collide.
      var labelTexts = showValues ? projected.map(function (p) {
        return p.solid.map(function (q) { return K.valueText(p.s, q.v, rows[p.si][q.j], yFormat); });
      }) : [];
      var labelEvery = showValues ? projected.map(function (p, i) {
        if (p.solid.length < 2) return 1;
        var room = Math.abs(p.solid[p.solid.length - 1].x - p.solid[0].x) / (p.solid.length - 1);
        return Math.max(1, Math.ceil((K.labelWidth(labelTexts[i]) + 8) / Math.max(1, room)));
      }) : [];

      // Hover: band = the hovered index; time = the nearest sampled instant across the visible series.
      var anchor = null;
      var header = '';
      var tipRows = [];
      if (hover && tipMode !== 'none' && !brush) {
        if (isTime) {
          var seen = {};
          var allTimes = [];
          rows.forEach(function (pts) { pts.forEach(function (p) { if (!seen[p.t]) { seen[p.t] = true; allTimes.push(p.t); } }); });
          allTimes.sort(function (a, b) { return a - b; });
          var k = K.nearestIndex(allTimes, hover.key);
          anchor = k >= 0 ? allTimes[k] : null;
          if (anchor !== null) header = K.formatFull(anchor, span, locale, timeZone);
        } else if (hover.key >= 0 && hover.key < categories.length) {
          anchor = hover.key;
          header = categories[hover.key];
        }
        if (anchor !== null) {
          visible.forEach(function (s, si) {
            var j = -1;
            if (isTime) { for (var q = 0; q < rows[si].length; q++) if (rows[si][q].t === anchor) { j = q; break; } } else j = anchor;
            var p = rows[si][j];
            if (isTime && !p) return;
            var y = p && p.y !== undefined ? p.y : null;
            tipRows.push({
              seriesId: s.id, seriesName: s.name, color: s.color, y: y,
              valueLabel: y === null ? undefined : (tooltipValueFormat ? tooltipValueFormat(y, s) : K.valueText(s, y, p, yFormat)),
              py: y === null ? NaN : plotY(si, j, y),
            });
          });
          if (tipMode === 'point') {
            var near = tipRows.filter(function (d) { return d.y !== null; })
              .sort(function (a, b) { return Math.abs(a.py - hover.y) - Math.abs(b.py - hover.y); })[0];
            tipRows = near ? [near] : [];
          }
        }
      }
      var hoverX = anchor === null ? null : xPx(anchor);
      var total = tooltipTotal && isStacked && tipRows.length > 1
        ? { label: tooltipTotalLabel, value: fmt(tipRows.reduce(function (a, d) { return a + (d.y || 0); }, 0)) }
        : undefined;
      var step = categories.length ? rect.width / categories.length : 0;
      geo = { rect: rect, domain: domain, full: full, span: span, categories: categories.length, step: step };

      // ── SVG ──
      var defs = K.svg('defs', {});
      var clip = K.svg('clipPath', { id: uid + '-clip' });
      clip.appendChild(K.svg('rect', { x: rect.x - 4, y: rect.y - 4, width: rect.width + 8, height: rect.height + 8 }));
      defs.appendChild(clip);
      projected.forEach(function (p) {
        if (!p.gradientId) return;
        var lg = K.svg('linearGradient', { id: p.gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(K.svg('stop', { offset: '0%', 'stop-color': p.color, 'stop-opacity': Math.min(1, p.opacity * 1.6) }));
        lg.appendChild(K.svg('stop', { offset: '100%', 'stop-color': p.color, 'stop-opacity': 0 }));
        defs.appendChild(lg);
      });
      svgEl.appendChild(defs);
      if (showGrid) svgEl.appendChild(K.grid(rect, yPixels, [], { color: cfg.gridColor, lineStyle: cfg.gridStyle }));
      if (hasLeft) svgEl.appendChild(K.axisY(yTicks, rect.x, rect.y, rect.y + rect.height, { textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
      if (R) svgEl.appendChild(K.axisY(y2Ticks, rect.x + rect.width, rect.y, rect.y + rect.height, { side: 'right', textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
      svgEl.appendChild(K.axisX(xTicks, rect.y + rect.height, rect.x, rect.x + rect.width, { textStyle: cfg.tickStyle, tickMarks: false, showLabels: showXAxis }));
      var titles = K.axisTitles(rect, height, width, { xLabel: cfg.xLabel, yLabel: cfg.yLabel, y2Label: R ? cfg.y2Label : undefined }, cfg.tickStyle);
      if (titles) svgEl.appendChild(titles);
      if (tipMode !== 'none' && !brush && hoverX !== null) svgEl.appendChild(K.crosshair(rect, hoverX));

      var enter = K.svg('g', {});
      var clipped = K.svg('g', { 'clip-path': 'url(#' + uid + '-clip)' });
      projected.forEach(function (p) {
        var g = K.svg('g', { 'data-series': p.s.id });
        if (p.areaPath) {
          var area = K.svg('path', {
            d: p.areaPath, fill: p.gradientId ? 'url(#' + p.gradientId + ')' : p.color,
            opacity: p.gradientId ? undefined : p.opacity, 'data-area': '', 'data-fill': p.gradientId ? 'gradient' : 'opacity',
          });
          if (animMs) area.style.transition = 'opacity ' + animMs + 'ms';
          g.appendChild(area);
        }
        g.appendChild(K.svg('path', {
          d: p.path, fill: 'none', stroke: p.color, 'stroke-width': p.w, 'data-line': '',
          'stroke-dasharray': K.dashArray(p.s.lineStyle, p.w), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }));
        if (p.s.showPoints) {
          p.solid.forEach(function (q) {
            g.appendChild(K.pointMark(p.shape, q.x, q.y, p.r, { fill: p.color, 'data-point': '', stroke: 'var(--surface-raised)', 'stroke-width': 1 }));
          });
        } else if (p.solo) {
          g.appendChild(K.pointMark(p.shape, p.solo.x, p.solo.y, Math.max(3, p.r), { fill: p.color }));
        }
        clipped.appendChild(g);
      });
      var tl = hasLeft ? K.thresholds(thrL, rect, yPxL) : null;
      if (tl) clipped.appendChild(tl);
      var tr = R ? K.thresholds(hasLeft ? thrR : thresholds, rect, hasLeft ? yPxR : yPxL) : null;
      if (tr) clipped.appendChild(tr);
      enter.appendChild(clipped);
      if (showValues) {
        projected.forEach(function (p, pi) {
          var g = K.svg('g', { 'data-value-labels': p.s.id });
          var n = p.solid.length;
          p.solid.forEach(function (q, i) {
            var every = labelEvery[pi];
            if (!((i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every))) return;
            var anchorText = i === 0 && q.x - rect.x < 16 ? 'start' : i === n - 1 && rect.x + rect.width - q.x < 16 ? 'end' : 'middle';
            var attrs = K.valueLabelAttrs(cfg.valueLabelStyle);
            attrs['data-value-label'] = '';
            attrs.x = q.x;
            attrs.y = valueLabelPosition === 'bottom' ? q.y + p.r + 13 : q.y - p.r - 5;
            attrs['text-anchor'] = anchorText;
            var t = K.svg('text', attrs);
            t.textContent = labelTexts[pi][i];
            g.appendChild(t);
          });
          enter.appendChild(g);
        });
      }
      svgEl.appendChild(enter);
      if (!played) { played = true; K.entrance(enter, 'reveal-x', animate); }

      if (hoverX !== null) {
        tipRows.forEach(function (d) {
          if (!isFinite(d.py)) return;
          svgEl.appendChild(K.svg('circle', { cx: hoverX, cy: d.py, r: 4, fill: 'var(--surface-raised)', stroke: d.color, 'stroke-width': 2 }));
        });
      }
      // The selection for the page: a pointer band (px) snapped to whole categories on a band axis, or the keyed one.
      if (selecting) {
        var bandOf = function (i0, i1) { return { from: rect.x + Math.min(i0, i1) * step, to: rect.x + (Math.max(i0, i1) + 1) * step }; };
        var pointerBand = brush && !isTime
          ? bandOf(K.bandIndex(brush.from - rect.x, step, categories.length), K.bandIndex(brush.to - rect.x, step, categories.length))
          : brush;
        var keyBand = keySel
          ? (isTime ? { from: K.xTime(keySel.anchor, domain, rect), to: K.xTime(keySel.focus, domain, rect) } : bandOf(keySel.anchor, keySel.focus))
          : null;
        var band = pointerBand || keyBand;
        if (band) svgEl.appendChild(K.rangeBand(rect, band.from, band.to, false));
      }
      if (!selecting && brush && Math.abs(brush.to - brush.from) > 0) {
        svgEl.appendChild(K.svg('rect', {
          x: Math.min(brush.from, brush.to), y: rect.y, width: Math.abs(brush.to - brush.from), height: rect.height,
          fill: K.theme.crosshair, opacity: 0.2, 'pointer-events': 'none',
        }));
      }
      if (hoverX !== null && tipRows.length) tip.update(tooltipHeader ? header : '', tipRows, hoverX, rect.y + rect.height / 2, width, total);
      else tip.hide();
      if (resetBtn) resetBtn.hidden = !(zoomable && zoomed);
    }

    function local(e) {
      var b = svgEl.getBoundingClientRect();
      return { px: e.clientX - b.left, py: e.clientY - b.top };
    }
    function inPlot(px) { return geo && px >= geo.rect.x && px <= geo.rect.x + geo.rect.width; }
    function resetZoom() { zoomDomain = null; hover = null; brush = null; draw(); }

    /** Tell the page: the bubbling `kui:chart-range-select` event, `{ range: { from, to } | null }`. */
    function emit(range) {
      host.dispatchEvent(new CustomEvent('kui:chart-range-select', { bubbles: true, detail: { range: range } }));
    }
    // A click is not a brush, on either axis: the band must be at least MIN_BRUSH_PX wide.
    function reportBrush(px0, px1) {
      if (Math.abs(px1 - px0) < K.MIN_BRUSH_PX) return;
      var r = geo.rect;
      var range = isTime
        ? K.brushRange(px0, px1, geo.domain, geo.full, r)
        : K.bandRange(categoryTimes, K.bandIndex(px0 - r.x, geo.step, categories.length), K.bandIndex(px1 - r.x, geo.step, categories.length));
      if (range) { emit(range); hover = null; }
    }
    function reportKeys(sel) {
      var range = isTime ? K.keyedTimeRange(sel) : K.bandRange(categoryTimes, sel.anchor, sel.focus);
      if (range) emit(range);
    }
    function endDrag() { captured = false; brush = null; }

    svgEl.addEventListener('pointerdown', function (e) {
      if (!dragOn || e.button !== 0 || !geo) return;
      var px = local(e).px;
      if (!inPlot(px)) return;
      // Keep the drag through a pointer that leaves the plot.
      if (typeof svgEl.setPointerCapture === 'function') {
        try { svgEl.setPointerCapture(e.pointerId); captured = true; } catch (err) { captured = false; }
      }
      keySel = null;
      brush = { from: px, to: px };
      draw();
    });
    svgEl.addEventListener('pointermove', function (e) {
      if (!brush || !geo) return;
      brush = { from: brush.from, to: Math.min(geo.rect.x + geo.rect.width, Math.max(geo.rect.x, local(e).px)) };
      draw();
    });
    svgEl.addEventListener('pointerup', function () {
      if (!brush || !geo) return;
      var b = brush;
      endDrag();
      if (selecting) reportBrush(b.from, b.to);
      else {
        var next = K.brushDomain(b.from, b.to, geo.domain, geo.full, geo.rect);
        if (next) { zoomDomain = next; hover = null; }
      }
      draw();
    });
    svgEl.addEventListener('pointercancel', function () { endDrag(); draw(); });
    svgEl.addEventListener('mousemove', function (e) {
      if (!geo || tipMode === 'none') return;
      var l = local(e);
      if (!inPlot(l.px)) hover = null;
      else if (isTime) hover = { key: K.invTime(l.px, geo.domain, geo.rect), y: l.py };
      else if (geo.categories) hover = { key: K.bandIndex(l.px - geo.rect.x, geo.step, geo.categories), y: l.py };
      draw();
    });
    svgEl.addEventListener('mouseleave', function () { hover = null; if (!captured) brush = null; draw(); });
    svgEl.addEventListener('dblclick', function () {
      if (selecting) { keySel = null; emit(null); draw(); } else if (zoomable) resetZoom();
    });
    svgEl.addEventListener('keydown', function (e) {
      if (!selecting || !geo) return;
      if (e.key === 'Escape') {
        if (!brush && !keySel) return;
        e.preventDefault();
        endDrag();
        keySel = null;
        emit(null);
        draw();
      } else if (e.key === 'Enter') {
        if (keySel) { e.preventDefault(); reportKeys(keySel); }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        var dir = e.key === 'ArrowLeft' ? -1 : 1;
        keySel = isTime
          ? K.keyRange(keySel, dir, e.shiftKey, geo.domain[0], geo.domain[1], geo.span / 20)
          : K.keyRange(keySel, dir, e.shiftKey, 0, categories.length - 1, 1);
        draw();
      }
    });
    if (resetBtn) resetBtn.addEventListener('click', resetZoom);

    drawLegend();
    K.observeContainer(canvas, function (s) {
      if (s.width <= 0) return;
      size = s;
      draw();
    });
  }

  K.renderers.series = render;
})(typeof window !== 'undefined' ? window : globalThis);
