// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-instruments.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The indicator symbols: a battery and a signal strength drawn from a level, and a compass drawn from a heading. Pure
// node trees (no React); see `scada-draw.ts` for the shared rules. A colour range of the symbol (the settings'
// `ranges`) colours the fill; the widget evaluates nothing else.

import { arcPath, el, polar, r2, text, type SvgNode } from './svg-node';
import { accent, BASE, INK, METAL_OUT, MUTED, SURFACE, type Drawn, type Paint } from './scada-draw';

/** The colour the ranges give a reading, else the state's colour, else green. */
function fillColor(p: Paint): string {
  if (p.value !== null) {
    let from = p.min;
    for (const band of p.bands) {
      const lo = band.from ?? from;
      from = band.to;
      if (band.color && p.value >= lo && p.value <= band.to) return band.color;
    }
  }
  return p.state === 'warning' || p.state === 'critical' ? p.color : 'var(--success)';
}

/** A battery: a body with a terminal and five segments that fill with the level. */
export function indicatorBattery(p: Paint): Drawn {
  const lit = p.level === null ? 0 : Math.ceil(Math.min(1, p.level) * 5 - 1e-9);
  const color = fillColor(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 10, y: 30, width: 72, height: 40, rx: 7, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('rect', { x: 82, y: 42, width: 8, height: 16, rx: 2.5, fill: METAL_OUT }),
      ...Array.from({ length: 5 }, (_, i) => el('rect', { x: 15 + i * 13.4, y: 35, width: 10.6, height: 30, rx: 2.5, fill: i < lit ? color : MUTED, 'fill-opacity': i < lit ? 0.92 : 0.16 })),
    ],
  };
}

/** Signal strength: five bars that rise, lit up to the level. */
export function indicatorSignal(p: Paint): Drawn {
  const lit = p.level === null ? 0 : Math.ceil(Math.min(1, p.level) * 5 - 1e-9);
  const color = fillColor(p);
  return {
    w: 100, h: 100,
    nodes: Array.from({ length: 5 }, (_, i) => {
      const h = 16 + i * 14;
      return el('rect', { x: 14 + i * 16, y: 84 - h, width: 11, height: h, rx: 3, fill: i < lit ? color : MUTED, 'fill-opacity': i < lit ? 0.92 : 0.18 });
    }),
  };
}

/** The eight points of the compass the heading falls nearest to (N, NE, E …). */
export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const compassPoint = (deg: number): (typeof COMPASS_POINTS)[number] => COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** A compass: a ring with ticks and N / E / S / W, and a needle that points where the heading says (degrees from north). */
export function compass(p: Paint): Drawn {
  const cx = 50; const cy = 50;
  const a = accent(p);
  const nodes: SvgNode[] = [
    el('circle', { cx, cy, r: 43, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    el('path', { d: arcPath(cx, cy, 37, -90, 269.9), fill: 'none', stroke: 'var(--border)', 'stroke-width': 1 }),
  ];
  for (let i = 0; i < 24; i += 1) {
    const [x1, y1] = polar(cx, cy, i % 6 === 0 ? 31 : 34, i * 15 - 90);
    const [x2, y2] = polar(cx, cy, 37, i * 15 - 90);
    nodes.push(el('line', { x1, y1, x2, y2, stroke: MUTED, 'stroke-width': i % 6 === 0 ? 1.8 : 1 }));
  }
  [['N', 50, 25], ['E', 76, 53.5], ['S', 50, 82], ['W', 24, 53.5]].forEach(([t, x, y]) => {
    nodes.push(text(x as number, y as number, t as string, { 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: t === 'N' ? 'var(--error)' : INK, 'font-family': 'inherit' }));
  });
  if (p.value !== null) {
    const deg = r2((((p.value % 360) + 360) % 360));
    nodes.push(el('g', { transform: `rotate(${deg} ${cx} ${cy})` }, [
      el('polygon', { points: `${cx},${cy - 27} ${cx + 5},${cy} ${cx - 5},${cy}`, fill: a, stroke: BASE, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
      el('polygon', { points: `${cx},${cy + 27} ${cx + 5},${cy} ${cx - 5},${cy}`, fill: MUTED, 'fill-opacity': 0.5, stroke: BASE, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    ]));
  }
  nodes.push(el('circle', { cx, cy, r: 3.4, fill: INK, stroke: BASE, 'stroke-width': 1 }));
  return { nodes, w: 100, h: 100 };
}
