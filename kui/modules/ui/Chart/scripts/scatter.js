/*
 * modules/ui/Chart/scripts/scatter.js
 *
 * Renderer behind `type: 'scatter'`. Mirrors kui-react's charts/ScatterChart.tsx one to one: every
 * `data[].x` is a NUMBER on a linear x axis (from the data's extent unless `xMin` / `xMax` fix it), the
 * y axis spans the data (it need not reach zero), one mark per point (circle, square, diamond or triangle,
 * radius `pointRadius` or the series' `pointSize`, opacity `pointOpacity`), an optional dashed least-squares
 * trend line per series, thresholds (horizontal lines at y values), the shared cartesian surface (legend
 * position / values / toggling, fixed y bounds, axis titles, axis text style, grid style, entrance animation)
 * and a tooltip per hovered point (heading = its x).
 *
 * Mounted by KuiChart.autoInit() from `data-kui-chart-kind="scatter"`. Requires chart-helpers.js. Functions
 * travel as global function NAMES or plain-data specs (xFormat, yFormat, tooltipValueFormat, series[].format;
 * see KuiChart.resolveFn).
 */
(function (global) {
  'use strict';
  var K = global.KuiChart;
  if (!K || K.renderers.scatter) return;

  var seq = 0;
  var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var opt = function (v) { return typeof v === 'number' && isFinite(v) ? v : undefined; };
  var xOf = function (p) { return typeof p.x === 'number' ? p.x : Number(p.x); };

  function render(host, cfg) {
    var canvas = host.querySelector('[data-kui-chart-canvas]');
    if (!canvas) return;
    var uid = 'ks' + (++seq);
    var locale = cfg.locale || undefined;
    var baseHeight = num(cfg.height, 240);
    var fill = !!cfg.fill;
    var showLegend = cfg.showLegend !== false;
    var showGrid = cfg.showGrid !== false;
    var showTooltip = cfg.showTooltip !== false;
    var pointRadius = num(cfg.pointRadius, 4);
    var pointShape = cfg.pointShape || 'circle';
    var pointOpacity = num(cfg.pointOpacity, 0.85);
    var trendLine = !!cfg.trendLine;
    var yFormat = K.resolveFn(cfg.yFormat, locale);
    var fy = yFormat || K.defaultNumber;
    var fx = K.resolveFn(cfg.xFormat, locale) || K.defaultNumber;
    var tooltipValueFormat = K.resolveFn(cfg.tooltipValueFormat, locale);
    var legendPosition = cfg.legendPosition || 'bottom';
    var yTickCount = num(cfg.yTickCount, 4);
    var showXAxis = cfg.showXAxis !== false;
    var showYAxis = cfg.showYAxis !== false;
    var tooltipHeader = cfg.tooltipHeader !== false;
    var animate = cfg.animate !== false;
    var tipOn = showTooltip && cfg.tooltipMode !== 'none';
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

    var hover = null;
    var size = { width: 0, height: 0 };
    var played = false;
    var marks = [];
    var geo = null;

    var svgEl = K.svg('svg', { role: 'img', 'aria-label': cfg.ariaLabel || 'Scatter chart' });
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'visible';
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

    /** Hover changes only the marks' size and opacity and the tooltip (the marks stay under the pointer). */
    function paintHover() {
      marks.forEach(function (m) {
        var active = hover !== null && hover.si === m.si && hover.pi === m.pi;
        var r = active ? m.r + 2 : m.r;
        if (m.circle) m.el.setAttribute('r', r); else m.el.setAttribute('d', K.pointPath(m.shape, m.x, m.y, r));
        m.el.setAttribute('fill-opacity', hover === null || active ? pointOpacity : pointOpacity * 0.45);
        m.el.setAttribute('stroke-opacity', hover === null || active ? Math.min(1, pointOpacity + 0.15) : 0.3);
      });
      if (!tipOn || hover === null || !geo) { tip.hide(); return; }
      var m = marks.filter(function (q) { return q.si === hover.si && q.pi === hover.pi; })[0];
      if (!m) { tip.hide(); return; }
      var s = m.s;
      var p = s.data[m.pi];
      tip.update(tooltipHeader ? fx(xOf(p)) : '', [{
        seriesId: s.id, seriesName: s.name, color: s.color, y: p.y,
        valueLabel: tooltipValueFormat ? tooltipValueFormat(p.y, s) : K.valueText(s, p.y, p, yFormat),
      }], m.x, m.y, geo.width);
    }

    function draw() {
      var width = size.width;
      if (width <= 0) return;
      var height = fill ? (size.height > 0 ? size.height : baseHeight) : baseHeight;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      marks = [];
      svgEl.setAttribute('width', width);
      svgEl.setAttribute('height', height);

      var visible = colored.filter(function (s) { return !hidden[s.id]; });

      // The x extent across the visible series.
      var mn = Infinity;
      var mx = -Infinity;
      visible.forEach(function (s) {
        s.data.forEach(function (p) {
          var xv = xOf(p);
          if (!isFinite(xv)) return;
          if (xv < mn) mn = xv;
          if (xv > mx) mx = xv;
        });
      });
      if (!isFinite(mn)) mn = 0;
      if (!isFinite(mx)) mx = 1;
      if (mn === mx) { mn -= 1; mx += 1; }
      var X = K.resolveDomain({ min: mn, max: mx }, { min: opt(cfg.xMin), max: opt(cfg.xMax), count: 5 });

      // A scatter's value axis need not start at zero: it spans the data.
      var lo = Infinity;
      var hi = -Infinity;
      visible.forEach(function (s) {
        s.data.forEach(function (p) {
          if (typeof p.y !== 'number' || !isFinite(p.y)) return;
          if (p.y < lo) lo = p.y;
          if (p.y > hi) hi = p.y;
        });
      });
      var base = !isFinite(lo) ? { min: 0, max: 1 } : lo === hi ? { min: lo - 1, max: hi + 1 } : { min: lo, max: hi };
      var thresholds = cfg.thresholds || [];
      var Y = K.resolveDomain(base, { min: opt(cfg.yMin), max: opt(cfg.yMax), thresholds: thresholds, count: yTickCount });

      var yVals = K.niceTicks(Y.min, Y.max, yTickCount);
      var yLabels = yVals.map(fy);
      var pad = K.plotPadding({ yTickLabels: yLabels, xLabel: cfg.xLabel, yLabel: cfg.yLabel, tickStyle: cfg.tickStyle, showXAxis: showXAxis, showYAxis: showYAxis });
      pad.right = Math.max(pad.right, 16);
      var rect = {
        x: pad.left, y: pad.top,
        width: Math.max(0, width - pad.left - pad.right),
        height: Math.max(0, height - pad.top - pad.bottom),
      };
      var xVals = K.niceTicks(X.min, X.max, Math.max(2, Math.min(5, Math.floor(rect.width / 70))));
      var xScale = function (v) { return rect.x + ((v - X.min) / (X.max - X.min)) * rect.width; };
      var yPx = function (v) { return K.yScale(v, Y.min, Y.max, rect); };
      var yTicks = yVals.map(function (v, i) { return { position: yPx(v), label: yLabels[i] }; });
      var xTicks = xVals.map(function (v) { return { position: xScale(v), label: fx(v) }; });
      geo = { rect: rect, width: width };

      var defs = K.svg('defs', {});
      var clip = K.svg('clipPath', { id: uid + '-clip' });
      clip.appendChild(K.svg('rect', { x: rect.x - pointRadius, y: rect.y - pointRadius, width: rect.width + 2 * pointRadius, height: rect.height + 2 * pointRadius }));
      defs.appendChild(clip);
      svgEl.appendChild(defs);
      if (showGrid) svgEl.appendChild(K.grid(rect, yTicks.map(function (t) { return t.position; }), [], { color: cfg.gridColor, lineStyle: cfg.gridStyle }));
      svgEl.appendChild(K.axisY(yTicks, rect.x, rect.y, rect.y + rect.height, { textStyle: cfg.tickStyle, hideLine: true, tickMarks: false, showLabels: showYAxis }));
      svgEl.appendChild(K.axisX(xTicks, rect.y + rect.height, rect.x, rect.x + rect.width, { textStyle: cfg.tickStyle, tickMarks: false, showLabels: showXAxis }));
      var titles = K.axisTitles(rect, height, width, { xLabel: cfg.xLabel, yLabel: cfg.yLabel }, cfg.tickStyle);
      if (titles) svgEl.appendChild(titles);

      var enter = K.svg('g', {});
      var clipped = K.svg('g', { 'clip-path': 'url(#' + uid + '-clip)' });
      var tl = K.thresholds(thresholds, rect, yPx);
      if (tl) clipped.appendChild(tl);
      if (trendLine) {
        visible.forEach(function (s) {
          var pts = [];
          s.data.forEach(function (p) {
            var xv = xOf(p);
            if (p.y === null || p.y === undefined || !isFinite(xv)) return;
            pts.push({ x: xv, y: p.y });
          });
          var fit = K.linearRegression(pts);
          if (!fit) return;
          var xs = pts.map(function (p) { return p.x; });
          var x0 = Math.min.apply(null, xs);
          var x1 = Math.max.apply(null, xs);
          clipped.appendChild(K.svg('line', {
            'data-trend': s.id, x1: xScale(x0), y1: yPx(fit.intercept + fit.slope * x0), x2: xScale(x1), y2: yPx(fit.intercept + fit.slope * x1),
            stroke: cfg.trendColor || s.color, 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'stroke-linecap': 'round', opacity: 0.9,
          }));
        });
      }
      visible.forEach(function (s, si) {
        var g = K.svg('g', { 'data-series': s.id });
        var r = num(s.pointSize, pointRadius);
        var shape = s.pointShape || pointShape;
        s.data.forEach(function (p, pi) {
          if (p.y === null || p.y === undefined) return;
          var xv = xOf(p);
          if (!isFinite(xv)) return;
          var x = xScale(xv);
          var y = yPx(p.y);
          var color = p.color || s.color;
          var el = K.pointMark(shape, x, y, r, {
            fill: color, 'fill-opacity': pointOpacity, stroke: color, 'stroke-opacity': Math.min(1, pointOpacity + 0.15), 'stroke-width': 1,
          });
          if (animMs && shape === 'circle') el.style.transition = 'r ' + animMs + 'ms';
          el.addEventListener('mouseenter', function () { if (tipOn) { hover = { si: si, pi: pi }; paintHover(); } });
          el.addEventListener('mouseleave', function () { hover = null; paintHover(); });
          g.appendChild(el);
          marks.push({ el: el, s: s, si: si, pi: pi, x: x, y: y, r: r, shape: shape, circle: shape === 'circle' });
        });
        clipped.appendChild(g);
      });
      enter.appendChild(clipped);
      svgEl.appendChild(enter);
      if (!played) { played = true; K.entrance(enter, 'grow', animate); }
      paintHover();
    }

    drawLegend();
    K.observeContainer(canvas, function (s) {
      if (s.width <= 0) return;
      size = s;
      draw();
    });
  }

  K.renderers.scatter = render;
})(typeof window !== 'undefined' ? window : globalThis);
