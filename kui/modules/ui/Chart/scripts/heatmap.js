/*
 * modules/ui/Chart/scripts/heatmap.js
 *
 * Token-aware matrix heatmap. Mirrors kui-react's charts/HeatmapChart.tsx.
 * Sequential colour is `color` (default `var(--primary)`): alone, at a variable
 * opacity; with `colorLow`, mixed from `colorLow` (lowest) to `color`
 * (highest). `colorFor` switches to banded colours (the NAME of a global
 * function returning a colour, or nothing for the sequential scale).
 * A missing value is an empty cell, never 0.
 *
 * Options: cell gap and radius, cell value labels (hidden under 28 px cells,
 * their colour picked for contrast), legend position and value text, a banded
 * legend (`legendItems`), axis text style, `fill`, entrance animation.
 *
 * Mounted by KuiChart.autoInit() from `data-kui-chart-kind="heatmap"`. The
 * frame (legend side, fill) is laid out by Chart.ejs. Requires chart-helpers.js.
 */
(function (global) {
  'use strict';
  var K = global.KuiChart;
  if (!K || K.renderers.heatmap) return;

  var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };

  /** The sequential fill for an intensity t (0..1). */
  function seqFill(color, low, t) {
    if (low) return { fill: 'color-mix(in oklab, ' + color + ' ' + Math.round(t * 100) + '%, ' + low + ')' };
    return { fill: color, fillOpacity: 0.07 + 0.93 * t };
  }

  function render(host, cfg) {
    var canvas = host.querySelector('[data-kui-chart-canvas]');
    if (!canvas) return;
    var baseHeight = num(cfg.height, 240);
    var fill = !!cfg.fill;
    var color = cfg.color || 'var(--primary)';
    var low = cfg.colorLow || undefined;
    var locale = cfg.locale || undefined;
    var colorFor = K.resolveFn(cfg.colorFor, locale);
    var showTooltip = cfg.showTooltip !== false;
    var showValues = !!cfg.showValues;
    var valueLabel = cfg.valueLabel === undefined ? 'Value' : cfg.valueLabel;
    var legendPosition = cfg.legendPosition || 'bottom';
    var side = legendPosition === 'left' || legendPosition === 'right';
    var cellGap = num(cfg.cellGap, 2);
    var cellRadius = num(cfg.cellRadius, 3);
    var animate = cfg.animate !== false;
    var grid = K.buildHeatGrid(cfg.cells || []);
    var lo = typeof cfg.min === 'number' ? cfg.min : grid.min;
    var hi = typeof cfg.max === 'number' ? cfg.max : grid.max;
    var fmt = K.resolveFn(cfg.valueFormat, locale) || function (v) { return String(Math.round(v * 100) / 100); };
    var lfmt = K.resolveFn(cfg.legendFormat, locale) || fmt;
    var ta = K.axisTextAttrs(cfg.tickStyle);
    var fs = cfg.tickStyle && typeof cfg.tickStyle.fontSize === 'number' ? cfg.tickStyle.fontSize : 11;
    var padLeft = Math.max(24, K.labelWidth(grid.ys, fs) + 10);

    var svgEl = K.svg('svg', { role: 'img', 'aria-label': cfg.ariaLabel || 'Heatmap' });
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'visible';
    canvas.insertBefore(svgEl, canvas.firstChild);
    var tip = K.tooltip(canvas);
    var hover = null;
    var geo = null;
    var rects = [];
    var size = { width: 0, height: 0 };
    var played = false;

    function axisText(x, y, anchor, label) {
      var a = {};
      for (var k in ta) a[k] = ta[k];
      a.x = x; a.y = y; a['text-anchor'] = anchor;
      var t = K.svg('text', a);
      t.textContent = label;
      return t;
    }

    function paintHover() {
      rects.forEach(function (r) { r.el.setAttribute('stroke', hover && hover.xi === r.i && hover.yi === r.j ? 'var(--text-primary)' : 'none'); });
      if (!showTooltip || !hover || !geo) { tip.hide(); return; }
      var v = grid.values[hover.yi] ? grid.values[hover.yi][hover.xi] : null;
      if (v === null || v === undefined) { tip.hide(); return; }
      var tipColor = (colorFor && colorFor(v)) || seqFill(color, low, K.heatIntensity(v, lo, hi)).fill;
      tip.update(
        grid.ys[hover.yi] + ' · ' + grid.xs[hover.xi],
        [{ seriesId: 'v', seriesName: valueLabel, color: tipColor, y: v, valueLabel: fmt(v) }],
        geo.pad.left + geo.cw * (hover.xi + 0.5), geo.pad.top + geo.ch * (hover.yi + 0.5), geo.width
      );
    }

    function draw() {
      var width = size.width;
      if (width <= 0) return;
      var height = fill ? (size.height > 0 ? size.height : baseHeight) : baseHeight;
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      rects = [];
      svgEl.setAttribute('width', width);
      svgEl.setAttribute('height', height);
      var PAD = { top: 4, right: 4, bottom: 22 + Math.max(0, fs - 11), left: padLeft };
      var plotW = Math.max(0, width - PAD.left - PAD.right);
      var plotH = Math.max(0, height - PAD.top - PAD.bottom);
      var cw = grid.xs.length ? plotW / grid.xs.length : 0;
      var ch = grid.ys.length ? plotH / grid.ys.length : 0;
      var g = Math.min(cellGap, cw / 3, ch / 3);
      var xEvery = Math.max(1, Math.ceil((K.labelWidth(grid.xs, fs) + 10) / Math.max(1, cw)));
      var yEvery = Math.max(1, Math.ceil((fs + 3) / Math.max(1, ch)));
      var labelled = showValues && cw >= 28 && ch >= 14;
      geo = { pad: PAD, cw: cw, ch: ch, width: width };
      grid.ys.forEach(function (label, j) {
        if (j % yEvery === 0) svgEl.appendChild(axisText(PAD.left - 8, PAD.top + ch * (j + 0.5) + fs * 0.35, 'end', label));
      });
      grid.xs.forEach(function (label, i) {
        if (i % xEvery === 0) svgEl.appendChild(axisText(PAD.left + cw * (i + 0.5), height - 6, 'middle', label));
      });
      var enter = K.svg('g', {});
      grid.values.forEach(function (row, j) {
        row.forEach(function (v, i) {
          if (v === null) return;
          var band = colorFor ? colorFor(v) : undefined;
          var t = K.heatIntensity(v, lo, hi);
          var seq = band ? { fill: band } : seqFill(color, low, t);
          var strong = band ? true : low ? t > 0.5 : t > 0.55;
          var cell = K.svg('g', {});
          var r = K.svg('rect', {
            x: PAD.left + cw * i + g / 2, y: PAD.top + ch * j + g / 2,
            width: Math.max(0, cw - g), height: Math.max(0, ch - g), rx: Math.min(cellRadius, cw / 2, ch / 2),
            fill: seq.fill, 'fill-opacity': seq.fillOpacity, stroke: 'none', 'stroke-width': 1.5,
          });
          r.addEventListener('mouseenter', function () { if (showTooltip) { hover = { xi: i, yi: j }; paintHover(); } });
          cell.appendChild(r);
          rects.push({ el: r, i: i, j: j });
          if (labelled) {
            var ls = { fontSize: 10 };
            for (var k in (cfg.valueLabelStyle || {})) ls[k] = cfg.valueLabelStyle[k];
            var a = K.valueLabelAttrs(ls, strong);
            a['data-cell-label'] = '';
            a.x = PAD.left + cw * (i + 0.5);
            a.y = PAD.top + ch * (j + 0.5);
            a['text-anchor'] = 'middle';
            a['dominant-baseline'] = 'central';
            var tx = K.svg('text', a);
            tx.textContent = fmt(v);
            cell.appendChild(tx);
          }
          enter.appendChild(cell);
        });
      });
      svgEl.appendChild(enter);
      if (!played) { played = true; K.entrance(enter, 'grow', animate); }
      paintHover();
    }

    svgEl.addEventListener('mouseleave', function () { hover = null; paintHover(); });

    if (cfg.showLegend !== false) {
      var legend;
      var spacing = legendPosition === 'top' ? ' mb-2' : legendPosition === 'bottom' ? ' mt-2' : '';
      if (cfg.legendItems && cfg.legendItems.length) {
        legend = document.createElement('ul');
        legend.setAttribute('role', 'list');
        legend.setAttribute('data-heat-legend', 'bands');
        legend.className = 'flex text-xs text-text-secondary ' + (side ? 'shrink-0 flex-col justify-center gap-2' : 'flex-wrap items-center gap-x-4 gap-y-1.5') + spacing;
        if (!side) legend.style.paddingLeft = padLeft + 'px';
        cfg.legendItems.forEach(function (it) {
          var li = document.createElement('li');
          li.className = 'flex items-center gap-2';
          var dot = document.createElement('span');
          dot.setAttribute('aria-hidden', 'true');
          dot.className = 'inline-block size-2 rounded-full';
          dot.style.backgroundColor = it.color;
          var name = document.createElement('span');
          name.textContent = it.label;
          li.appendChild(dot); li.appendChild(name);
          legend.appendChild(li);
        });
      } else {
        legend = document.createElement('div');
        legend.setAttribute('aria-hidden', 'true');
        legend.setAttribute('data-heat-legend', 'scale');
        legend.className = 'flex items-center gap-2 text-xs text-text-secondary' + (side ? ' shrink-0 flex-col justify-center' : '') + spacing;
        if (!side) legend.style.paddingLeft = padLeft + 'px';
        if (!side && valueLabel) {
          var vl = document.createElement('span'); vl.className = 'mr-1'; vl.textContent = valueLabel;
          legend.appendChild(vl);
        }
        var a = document.createElement('span'); a.className = 'tabular-nums'; a.textContent = lfmt(side ? hi : lo);
        var bar = document.createElement('span');
        bar.className = 'rounded-full ' + (side ? 'w-2 flex-1' : 'h-2 w-full max-w-[200px] flex-1');
        if (side) bar.style.minHeight = '80px';
        bar.style.background = 'linear-gradient(to ' + (side ? 'top' : 'right') + ', ' + (low || 'color-mix(in srgb, ' + color + ' 7%, transparent)') + ', ' + color + ')';
        var b = document.createElement('span'); b.className = 'tabular-nums'; b.textContent = lfmt(side ? lo : hi);
        legend.appendChild(a); legend.appendChild(bar); legend.appendChild(b);
      }
      legend.setAttribute('data-kui-chart-legend', '');
      K.mountLegend(host, legend, legendPosition);
    }

    K.observeContainer(canvas, function (s) {
      if (s.width <= 0) return;
      size = s;
      draw();
    });
  }

  K.renderers.heatmap = render;
})(typeof window !== 'undefined' ? window : globalThis);
