// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-line.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The strip-line process symbols (a payoff and a rewind reel, rollers, a loop tower, an oven, a coater, a brush unit, a
// shear, a joiner, a quench, a steering unit, the strip itself) and the flexible connections (a ribbed hose and a
// jacketed cable). Pure node trees (no React); see `scada-draw.ts` for the shared rules. The strip enters and leaves on
// the centre line (y = 50) like a pipe does.

import { el, orient, polar, r2, type SvgNode } from './svg-node';
import { accent, LIQUID, blades, BASE, INK, METAL, METAL_OUT, MUTED, pipes, SURFACE, turning, type Drawn, type Paint } from './scada-draw';

const SUNKEN = 'var(--surface-sunken)';

/** The strip: a dark line, with bright marks that travel along it while the line runs. */
export function strip(d: string, p: Paint): SvgNode[] {
  const moving = p.running && p.animate;
  return [
    el('path', { d, fill: 'none', stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    ...(p.running ? [el('path', {
      d, fill: 'none', stroke: accent(p), 'stroke-width': 3, 'stroke-dasharray': '3 15', 'stroke-linecap': 'butt', 'stroke-linejoin': 'round',
    }, moving ? [el('animate', { attributeName: 'stroke-dashoffset', from: 18, to: 0, dur: '0.8s', repeatCount: 'indefinite' })] : undefined)] : []),
  ];
}

/** A roll: a rim, a hub and three spokes that turn while the line runs and take the state colour in a warning or an alarm too. */
function roll(cx: number, cy: number, r: number, p: Paint): SvgNode[] {
  return [
    el('circle', { cx, cy, r, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.2 }),
    el('circle', { cx, cy, r: r * 0.62, fill: SURFACE, stroke: 'var(--border)', 'stroke-width': 1 }),
    turning(cx, cy, 1.6, p, blades(cx, cy, 3, r * 0.58, 2, accent(p))),
    el('circle', { cx, cy, r: r * 0.18, fill: METAL_OUT }),
  ];
}

export function stripStraight(p: Paint): Drawn {
  const w = 100 * p.length;
  return { w, h: 100, nodes: strip(`M0 50 H${w}`, p) };
}

export function stripElbow(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: strip('M0 50 H36 Q50 50 50 64 V100', p) };
}

/** A coil on an arbor with its drive and a base; the strip leaves to the right. */
export function reel(p: Paint, rewind: boolean): Drawn {
  const a = accent(p);
  const cx = 48; const cy = 62; const level = p.level === null ? 0.7 : Math.min(1, Math.max(0.12, p.level));
  const outer = 14 + 22 * level;
  const nodes: SvgNode[] = [
    el('rect', { x: 8, y: 92, width: 124, height: 6, rx: 2, fill: METAL_OUT }),
    el('rect', { x: 96, y: 52, width: 34, height: 34, rx: 4, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
    ...[104, 112, 120].map((x) => el('line', { x1: x, y1: 57, x2: x, y2: 81, stroke: METAL_OUT, 'stroke-width': 2 })),
    el('rect', { x: 80, y: 64, width: 18, height: 10, fill: METAL_OUT }),
    el('circle', { cx, cy, r: outer, fill: 'var(--border)', stroke: METAL_OUT, 'stroke-width': 2.5 }),
    ...[0.78, 0.56].map((f) => el('circle', { cx, cy, r: r2(outer * f), fill: 'none', stroke: METAL_OUT, 'stroke-opacity': 0.55, 'stroke-width': 1.5 })),
    el('circle', { cx, cy, r: 10, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2 }),
    turning(cx, cy, 2.2, p, blades(cx, cy, 3, 8, 2.4, p.running ? a : MUTED)),
    el('circle', { cx, cy, r: 2.6, fill: a }),
    ...strip(`M${r2(cx + outer * 0.7)} ${r2(cy - outer * 0.7)} Q ${r2(cx + outer * 0.9)} 50 ${r2(cx + outer + 12)} 50 H140`, p),
  ];
  const placed = orient(nodes, 140, 100, 0, rewind);
  return { nodes: placed.nodes, w: placed.w, h: placed.h };
}

/** One deflector roll under the strip. */
export function roller(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: [...roll(50, 74, 24, p), ...strip('M0 50 H100', p)] };
}

/** A nip: two rolls with the strip pinched between them. */
export function rollerNip(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: [...roll(50, 30, 20, p), ...roll(50, 70, 20, p), ...strip('M0 50 H100', p)] };
}

/** An accumulator: rolls above and below with the strip looped between; the lower carriage rides with the level. */
export function loopTower(p: Paint): Drawn {
  const carriage = r2(88 - (p.level === null ? 0.5 : Math.min(1, Math.max(0, p.level))) * 44);
  const xs = [30, 46, 62, 78];
  const top = 22;
  let d = `M0 50 H14 V${carriage}`;
  xs.forEach((x, i) => {
    d += ` Q${x - 8} ${carriage + 9} ${x} ${carriage} V${top} Q${x + 8} ${top - 9} ${x + 16} ${top} V${carriage}`;
    void i;
  });
  d = `M0 50 H14 V${carriage} Q 22 ${carriage + 9} 30 ${carriage} V${top} Q 38 ${top - 9} 46 ${top} V${carriage} Q 54 ${carriage + 9} 62 ${carriage} V${top} Q 70 ${top - 9} 78 ${top} V${carriage} Q 86 ${carriage + 9} 94 ${carriage} V50 H100`;
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 8, y: 4, width: 84, height: 4, fill: METAL_OUT }),
      el('rect', { x: 8, y: 92, width: 84, height: 4, fill: METAL_OUT }),
      el('line', { x1: 10, y1: 8, x2: 10, y2: 92, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('line', { x1: 90, y1: 8, x2: 90, y2: 92, stroke: METAL_OUT, 'stroke-width': 3 }),
      ...[38, 70].flatMap((x) => [el('circle', { cx: x, cy: top, r: 7, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.8 })]),
      ...[22, 54, 86].flatMap((x) => [el('circle', { cx: x, cy: carriage, r: 7, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.8 })]),
      el('line', { x1: 14, y1: carriage + 8, x2: 94, y2: carriage + 8, stroke: accent(p), 'stroke-width': 3, 'stroke-opacity': 0.5 }),
      ...strip(d, p),
    ],
  };
}

/** A furnace the strip crosses on a gentle sag; the zones glow with the temperature, and a lamp on the casing shows the state (running, a warning or an alarm). */
export function oven(p: Paint): Drawn {
  const heat = p.level === null ? (p.running ? 0.35 : 0) : Math.min(1, Math.max(0, p.level));
  const hot = p.state === 'warning' || p.state === 'critical' ? p.color : 'var(--error)';
  return {
    w: 200, h: 100,
    nodes: [
      el('rect', { x: 4, y: 20, width: 192, height: 60, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...[0, 1, 2, 3].flatMap((i) => [
        el('rect', { x: 10 + i * 46, y: 26, width: 42, height: 48, rx: 2, fill: hot, 'fill-opacity': r2(0.06 + 0.5 * heat), stroke: METAL_OUT, 'stroke-width': 1 }),
        el('rect', { x: 10 + i * 46, y: 26, width: 42, height: 5, fill: p.running || heat > 0 ? hot : MUTED, 'fill-opacity': 0.75 }),
        ...[18, 28, 38].map((x) => el('line', { x1: 10 + i * 46 + x, y1: 66, x2: 10 + i * 46 + x, y2: 72, stroke: METAL_OUT, 'stroke-width': 1.5 })),
      ]),
      el('rect', { x: 0, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      el('rect', { x: 192, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      ...strip('M0 50 H8 Q 100 72 192 50 H200', p),
      ...(p.state === 'idle' ? [] : [el('circle', { cx: 16, cy: 12, r: 5, fill: accent(p), stroke: BASE, 'stroke-width': 1.5 })]),
    ],
  };
}

/** A roll coater: a back-up roll over an applicator roll, with a pan of coating under them. */
export function coater(p: Paint): Drawn {
  const liquid = p.medium ?? p.fill;
  return {
    w: 140, h: 100,
    nodes: [
      el('line', { x1: 36, y1: 8, x2: 36, y2: 92, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('line', { x1: 104, y1: 8, x2: 104, y2: 92, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('path', { d: 'M40 80 H100 L94 94 H46 Z', fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      el('path', { d: 'M43 85 H97 L94 94 H46 Z', fill: liquid, 'fill-opacity': LIQUID }),
      ...roll(70, 31, 19, p),
      ...roll(70, 69, 19, p),
      el('circle', { cx: 70, cy: 69, r: 19, fill: liquid, 'fill-opacity': p.running ? 0.28 : 0.12 }),
      ...strip('M0 50 H140', p),
    ],
  };
}

/** A brush unit: two brush rolls above and below the strip, with spray. */
export function brushUnit(p: Paint): Drawn {
  const brush = (cy: number): SvgNode[] => [
    turning(70, cy, 1.4, p, Array.from({ length: 14 }, (_, i) => {
      const [x1, y1] = polar(70, cy, 11, i * (360 / 14));
      const [x2, y2] = polar(70, cy, 18, i * (360 / 14));
      return el('line', { x1, y1, x2, y2, stroke: MUTED, 'stroke-width': 1.6, 'stroke-linecap': 'round' });
    })),
    el('circle', { cx: 70, cy, r: 10, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
  ];
  const spray = p.medium ?? 'var(--info)';
  return {
    w: 140, h: 100,
    nodes: [
      el('rect', { x: 6, y: 8, width: 128, height: 84, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...brush(26),
      ...brush(74),
      ...(p.running ? [[40, 36], [100, 38], [42, 62], [98, 64]].map(([x, y]) => el('ellipse', { cx: x, cy: y, rx: 2.2, ry: 3.4, fill: spray, 'fill-opacity': 0.8 })) : []),
      el('rect', { x: 0, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      el('rect', { x: 132, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      ...strip('M0 50 H140', p),
    ],
  };
}

/** A shear: two blades that stand apart while idle and close while the shear runs. */
export function shear(p: Paint): Drawn {
  const a = accent(p);
  const gap = p.running ? 3 : 20;
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 18, y: 4, width: 64, height: 16, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 18, y: 80, width: 64, height: 16, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('polygon', { points: `22,20 78,20 78,${50 - gap} 22,${46 - gap}`, fill: SURFACE, stroke: a, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
      el('polygon', { points: `22,80 78,80 78,${50 + gap} 22,${54 + gap}`, fill: SURFACE, stroke: a, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
      ...strip('M0 50 H100', p),
    ],
  };
}

/** A joiner (splice press): a clamp bar above and a die below the strip. */
export function joiner(p: Paint): Drawn {
  const a = accent(p);
  const down = p.running ? 12 : 0;
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 14, y: 80, width: 72, height: 14, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 14, y: 4, width: 72, height: 12, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('line', { x1: 34, y1: 16, x2: 34, y2: 20 + down, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('line', { x1: 66, y1: 16, x2: 66, y2: 20 + down, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('rect', { x: 20, y: 20 + down, width: 60, height: 14, rx: 3, fill: SURFACE, stroke: a, 'stroke-width': 2.5 }),
      el('rect', { x: 20, y: 66, width: 60, height: 14, rx: 3, fill: SURFACE, stroke: a, 'stroke-width': 2.5 }),
      ...strip('M0 50 H100', p),
    ],
  };
}

/** A quench: spray bars over and under the strip and a pool below. */
export function quench(p: Paint): Drawn {
  const water = p.medium ?? 'var(--info)';
  const bar = (y: number): SvgNode[] => [
    el('line', { x1: 24, y1: y, x2: 116, y2: y, stroke: METAL_OUT, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    ...[32, 56, 80, 104].flatMap((x) => (p.running ? [el('line', { x1: x, y1: y + (y < 50 ? 3 : -3), x2: x, y2: y + (y < 50 ? 10 : -10), stroke: water, 'stroke-width': 2, 'stroke-dasharray': '2 3' })] : [])),
  ];
  return {
    w: 140, h: 100,
    nodes: [
      el('rect', { x: 6, y: 6, width: 128, height: 88, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 8, y: 80, width: 124, height: 12, fill: water, 'fill-opacity': p.running ? LIQUID : 0.25 }),
      ...bar(22),
      ...bar(76),
      el('rect', { x: 0, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      el('rect', { x: 132, y: 44, width: 8, height: 12, fill: METAL_OUT }),
      ...strip('M0 50 H140', p),
    ],
  };
}

/** A steering unit: a roll on a frame with a sideways double arrow. */
export function steering(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 12, y: 91, width: 76, height: 6, rx: 3, fill: METAL_OUT }),
      el('line', { x1: 22, y1: 91, x2: 22, y2: 68, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('line', { x1: 78, y1: 91, x2: 78, y2: 68, stroke: METAL_OUT, 'stroke-width': 3 }),
      ...roll(50, 70, 20, p),
      ...strip('M0 50 H100', p),
      el('path', { d: 'M28 22 H72 M35 15 L27 22 L35 29 M65 15 L73 22 L65 29', fill: 'none', stroke: a, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ],
  };
}

// ─── flexible connections ────────────────────────────────────────────────────

const HOSE_PATH = { straight: (w: number) => `M0 50 H${w}`, elbow: 'M0 50 H28 Q50 50 50 72 V100', sag: 'M0 50 H12 C 32 50 30 84 50 84 S 68 50 88 50 H100' };

/** A ribbed hose along `d`: a dark sleeve, light ribs across it and a ferrule at each end. */
export function hosePath(d: string, p: Paint, ferrules: Array<[number, number, boolean]>): SvgNode[] {
  const color = p.state === 'warning' || p.state === 'critical' ? p.color : p.medium ?? 'var(--text-secondary)';
  const moving = p.running && p.animate;
  return [
    el('path', { d, fill: 'none', stroke: METAL_OUT, 'stroke-width': 23, 'stroke-linejoin': 'round' }),
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 20, 'stroke-linejoin': 'round', 'stroke-opacity': 0.9 }),
    el('path', { d, fill: 'none', stroke: BASE, 'stroke-width': 20, 'stroke-linejoin': 'round', 'stroke-opacity': 0.34, 'stroke-dasharray': '2.4 5.6' },
      moving ? [el('animate', { attributeName: 'stroke-dashoffset', from: 16, to: 0, dur: '1.2s', repeatCount: 'indefinite' })] : undefined),
    ...ferrules.map(([x, y, v]) => (v
      ? el('rect', { x: r2(x - 15), y: r2(y - 5), width: 30, height: 10, rx: 2.5, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.6 })
      : el('rect', { x: r2(x - 5), y: r2(y - 15), width: 10, height: 30, rx: 2.5, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.6 }))),
  ];
}

export const hoseStraight = (p: Paint): Drawn => ({ w: 100 * p.length, h: 100, nodes: hosePath(HOSE_PATH.straight(100 * p.length), p, [[6, 50, false], [100 * p.length - 6, 50, false]]) });
export const hoseElbow = (p: Paint): Drawn => ({ w: 100, h: 100, nodes: hosePath(HOSE_PATH.elbow, p, [[6, 50, false], [50, 94, true]]) });
export const hoseSag = (p: Paint): Drawn => ({ w: 100, h: 100, nodes: hosePath(HOSE_PATH.sag, p, [[6, 50, false], [94, 50, false]]) });

/** A cable: a jacket with a glossy line down it and a terminal lug at each free end. */
export function cablePath(d: string, p: Paint, lugs: Array<[number, number, boolean]>, offsets: number[] = [0]): SvgNode[] {
  const live = p.state === 'warning' || p.state === 'critical' ? p.color : p.running ? p.color : null;
  const moving = p.running && p.animate;
  const jackets = ['var(--text-primary)', 'var(--primary)', 'var(--text-secondary)'];
  return [
    ...offsets.flatMap((dy, i) => {
      const path = dy === 0 ? d : d.replace(/(?<=[ML]\s?)(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${x} ${r2(Number(y) + dy)}`);
      return [
        el('path', { d: path, fill: 'none', stroke: jackets[i % jackets.length], 'stroke-width': offsets.length > 1 ? 4.4 : 6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-opacity': 0.92 }),
        el('path', { d: path, fill: 'none', stroke: BASE, 'stroke-width': 1.3, 'stroke-opacity': 0.4, 'stroke-linejoin': 'round' }),
        ...(live ? [el('path', { d: path, fill: 'none', stroke: live, 'stroke-width': 2.4, 'stroke-dasharray': '3 13', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
          moving ? [el('animate', { attributeName: 'stroke-dashoffset', from: 16, to: 0, dur: '0.7s', repeatCount: 'indefinite' })] : undefined)] : []),
      ];
    }),
    ...lugs.map(([x, y, v]) => (v
      ? el('rect', { x: r2(x - 6), y: r2(y - 4), width: 12, height: 8, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 })
      : el('rect', { x: r2(x - 4), y: r2(y - 6), width: 8, height: 12, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }))),
  ];
}

export const cableStraight = (p: Paint): Drawn => ({ w: 100 * p.length, h: 100, nodes: cablePath(`M0 50 H${100 * p.length}`, p, [[4, 50, false], [100 * p.length - 4, 50, false]]) });
export const cableElbow = (p: Paint): Drawn => ({ w: 100, h: 100, nodes: cablePath('M0 50 H36 Q50 50 50 64 V100', p, [[4, 50, false], [50, 96, true]]) });
export const cableTee = (p: Paint): Drawn => ({ w: 100, h: 100, nodes: [...cablePath('M0 50 H100', p, [[4, 50, false], [96, 50, false]]), ...cablePath('M50 50 V100', p, [[50, 96, true]])] });
/** Three conductors side by side (a bundle). */
export const cableMulti = (p: Paint): Drawn => ({ w: 100 * p.length, h: 100, nodes: cablePath(`M0 50 H${100 * p.length}`, p, [[4, 50, false], [100 * p.length - 4, 50, false]], [-9, 0, 9]) });

export { pipes };
