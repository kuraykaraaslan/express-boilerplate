// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-energy.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The energy-side process symbols: a solar array, a wind turbine, a battery rack, an inverter, a breaker, a
// transformer, a generator, a building, a two-row energy meter and dashed wires. Pure node trees (no React); see
// `scada-draw.ts` for the shared rules.

import { el, r2, text, type SvgNode } from './svg-node';
import { accent, BASE, INK, METAL, METAL_OUT, MUTED, SURFACE, turning, wire, type Drawn, type Paint } from './scada-draw';

const SUNKEN = 'var(--surface-sunken)';

/** Three panels on legs: the cells glow while the array produces. */
export function solarPanel(p: Paint): Drawn {
  const glow = p.state === 'warning' || p.state === 'critical' ? p.color : 'var(--info)';
  const nodes: SvgNode[] = [el('line', { x1: 2, y1: 88, x2: 138, y2: 88, stroke: METAL_OUT, 'stroke-width': 3, 'stroke-linecap': 'round' })];
  [4, 51, 98].forEach((x) => {
    nodes.push(
      el('line', { x1: x + 8, y1: 70, x2: x + 4, y2: 88, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('line', { x1: x + 30, y1: 70, x2: x + 34, y2: 88, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('rect', { x, y: 8, width: 38, height: 62, rx: 2, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    );
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        nodes.push(el('rect', { x: x + 4 + col * 10.6, y: 12 + row * 11.2, width: 9.4, height: 10, rx: 1, fill: p.running || p.state !== 'idle' ? glow : MUTED, 'fill-opacity': p.running || p.state !== 'idle' ? 0.55 : 0.18 }));
      }
    }
  });
  return { nodes, w: 140, h: 100 };
}

/** A tower with three blades that turn while the wind turbine runs. */
export function windTurbine(p: Paint): Drawn {
  const a = accent(p);
  const cx = 50; const cy = 38;
  const blade = (deg: number) => el('g', { transform: `rotate(${deg} ${cx} ${cy})` }, [
    el('polygon', { points: `${cx - 3.2},${cy - 3} ${cx + 3.2},${cy - 3} ${cx + 1},${cy - 36} ${cx - 0.8},${cy - 36}`, fill: SURFACE, stroke: p.running ? a : METAL_OUT, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
  ]);
  return {
    w: 100, h: 120,
    nodes: [
      el('polygon', { points: '46,44 54,44 58,108 42,108', fill: METAL, stroke: METAL_OUT, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      el('rect', { x: 34, y: 108, width: 32, height: 8, rx: 3, fill: METAL_OUT }),
      turning(cx, cy, 3.5, p, [0, 120, 240].map(blade)),
      el('circle', { cx, cy, r: 5.5, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('circle', { cx, cy, r: 2.2, fill: a }),
    ],
  };
}

/** Two stacked rack units: lamp, a segmented charge bar and terminals; the bar follows the reading. */
export function batteryBank(p: Paint): Drawn {
  const charge = p.state === 'warning' || p.state === 'critical' ? p.color : 'var(--success)';
  const lit = p.level === null ? 0 : Math.round(Math.min(1, p.level) * 10);
  const unit = (y: number): SvgNode[] => [
    el('rect', { x: 6, y, width: 148, height: 34, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    el('circle', { cx: 18, cy: y + 17, r: 4.5, fill: SURFACE, stroke: INK, 'stroke-width': 1.5 }),
    el('circle', { cx: 142, cy: y + 17, r: 4.5, fill: SURFACE, stroke: INK, 'stroke-width': 1.5 }),
    el('circle', { cx: 34, cy: y + 17, r: 3.2, fill: p.running || p.state !== 'idle' ? accent(p) : METAL_OUT }),
    ...Array.from({ length: 10 }, (_, i) => el('rect', { x: 48 + i * 8.6, y: y + 9, width: 6.6, height: 16, rx: 1.2, fill: i < lit ? charge : MUTED, 'fill-opacity': i < lit ? 0.9 : 0.16 })),
  ];
  return {
    w: 160, h: 100,
    nodes: [...unit(8), ...unit(56), el('path', { d: 'M142 25 H156 V73 H142', fill: 'none', stroke: INK, 'stroke-width': 1.5 })],
  };
}

/** An inverter / charger: status lamps, a display and a strip of terminals. */
export function inverter(p: Paint): Drawn {
  const shown = p.value === null ? '–' : p.fmt(p.value);
  const lamp = (i: number) => {
    const on = i === 0 ? p.running || p.state !== 'idle' : i === 2 ? p.state === 'warning' : i === 3 ? p.state === 'critical' : false;
    const color = i === 2 ? 'var(--warning)' : i === 3 ? 'var(--error)' : accent(p);
    return el('circle', { cx: 24 + i * 16, cy: 22, r: 3.6, fill: on ? color : MUTED, 'fill-opacity': on ? 1 : 0.28, stroke: METAL_OUT, 'stroke-width': 1 });
  };
  return {
    w: 160, h: 100,
    nodes: [
      el('rect', { x: 8, y: 8, width: 144, height: 68, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...[0, 1, 2, 3].map(lamp),
      el('rect', { x: 24, y: 36, width: 112, height: 28, rx: 2, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1 }),
      text(80, 56, shown, { 'text-anchor': 'middle', 'font-size': shown.length > 9 ? 11 : 15, 'font-weight': 600, fill: INK, 'font-family': 'inherit' }),
      el('rect', { x: 22, y: 76, width: 116, height: 12, fill: METAL_OUT }),
      ...Array.from({ length: 8 }, (_, i) => el('rect', { x: 26 + i * 14, y: 78, width: 10, height: 10, rx: 1, fill: METAL, stroke: MUTED, 'stroke-width': 1 })),
    ],
  };
}

/** A breaker / disconnect: a body with a slot and a lever (right when closed, left when open) between two terminals. */
export function breaker(p: Paint): Drawn {
  const closed = p.running;
  const lever = closed ? accent(p) : MUTED;
  return {
    w: 100, h: 100,
    nodes: [
      el('line', { x1: 13, y1: 50, x2: 30, y2: 50, stroke: INK, 'stroke-width': 2 }),
      el('line', { x1: 70, y1: 50, x2: 87, y2: 50, stroke: INK, 'stroke-width': 2 }),
      el('circle', { cx: 9, cy: 50, r: 5, fill: SURFACE, stroke: INK, 'stroke-width': 1.8 }),
      el('circle', { cx: 91, cy: 50, r: 5, fill: SURFACE, stroke: INK, 'stroke-width': 1.8 }),
      el('rect', { x: 30, y: 24, width: 40, height: 52, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 35, y: 38, width: 30, height: 24, rx: 2, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1 }),
      text(closed ? 44 : 56, 54, closed ? 'I' : 'O', { 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: INK, 'font-family': 'inherit' }),
      el('rect', { x: closed ? 53 : 36, y: 34, width: 11, height: 32, rx: 2, fill: lever, 'fill-opacity': closed ? 0.95 : 0.55, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ],
  };
}

/** A power transformer: three stacked insulators on a tank with a lightning sign. */
export function transformer(p: Paint): Drawn {
  const a = accent(p);
  const column = (x: number): SvgNode[] => [
    el('rect', { x: x - 3, y: 28, width: 6, height: 28, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ...[34, 42, 50].map((y) => el('ellipse', { cx: x, cy: y, rx: 9, ry: 3.4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 1.8 })),
    el('circle', { cx: x, cy: 24, r: 3.4, fill: a, stroke: METAL_OUT, 'stroke-width': 1.2 }),
  ];
  return {
    w: 90, h: 110,
    nodes: [
      ...[26, 45, 64].flatMap(column),
      el('rect', { x: 8, y: 102, width: 74, height: 6, rx: 2, fill: METAL_OUT }),
      el('rect', { x: 12, y: 56, width: 66, height: 46, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('circle', { cx: 45, cy: 80, r: 15, fill: a, 'fill-opacity': p.state === 'idle' ? 0.08 : 0.2, stroke: a, 'stroke-width': 2 }),
      el('polygon', { points: '48,68 39,82 45,82 42,92 52,77 46,77', fill: a, stroke: a, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    ],
  };
}

/** A generator set in a cabinet: a window door, a louvred door, a lamp and a skid. */
export function generator(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 170, h: 100,
    nodes: [
      el('rect', { x: 6, y: 90, width: 158, height: 7, rx: 2, fill: METAL_OUT }),
      el('rect', { x: 6, y: 8, width: 158, height: 80, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 20, y: 24, width: 54, height: 52, rx: 2, fill: 'none', stroke: METAL_OUT, 'stroke-width': 2 }),
      el('rect', { x: 28, y: 32, width: 38, height: 22, rx: 2, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1 }),
      el('line', { x1: 30, y1: 64, x2: 64, y2: 64, stroke: METAL_OUT, 'stroke-width': 2, 'stroke-linecap': 'round' }),
      el('rect', { x: 96, y: 24, width: 54, height: 52, rx: 2, fill: 'none', stroke: METAL_OUT, 'stroke-width': 2 }),
      ...[32, 39, 46, 53, 60, 67].map((y) => el('line', { x1: 104, y1: y, x2: 142, y2: y, stroke: METAL_OUT, 'stroke-width': 2.2, 'stroke-linecap': 'round' })),
      el('circle', { cx: 85, cy: 50, r: 4, fill: a, stroke: METAL_OUT, 'stroke-width': 1.2 }),
      el('circle', { cx: 15, cy: 16, r: 3.4, fill: a, stroke: METAL_OUT, 'stroke-width': 1 }),
    ],
  };
}

/** A house and a factory with a chimney: the windows are lit while there is consumption. */
export function building(p: Paint): Drawn {
  const lit = p.running || p.state !== 'idle';
  const glass = lit ? accent(p) : MUTED;
  const o = lit ? 0.6 : 0.2;
  const win = (x: number, y: number, w: number, h: number) => el('rect', { x, y, width: w, height: h, rx: 1, fill: glass, 'fill-opacity': o, stroke: METAL_OUT, 'stroke-width': 1 });
  return {
    w: 150, h: 100,
    nodes: [
      el('line', { x1: 2, y1: 90, x2: 148, y2: 90, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      // the factory
      el('rect', { x: 128, y: 14, width: 10, height: 30, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      el('rect', { x: 62, y: 42, width: 80, height: 48, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('polygon', { points: '62,42 62,28 82,42 82,28 102,42 102,28 122,42 122,28 142,42', fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
      ...[0, 1, 2].flatMap((i) => [win(70 + i * 22, 52, 14, 10), win(70 + i * 22, 68, 14, 10)]),
      // the house
      el('rect', { x: 8, y: 52, width: 42, height: 38, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('polygon', { points: '3,54 29,28 55,54', fill: METAL, stroke: METAL_OUT, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      win(14, 60, 11, 11),
      win(33, 60, 11, 11),
      el('rect', { x: 23, y: 74, width: 12, height: 16, fill: METAL_OUT }),
    ],
  };
}

/** A two-row meter: a name and a reading per row (T1 / T2). */
export function meterEnergy(p: Paint): Drawn {
  const row = (y: number, name: string, value: number | null, field?: 'value2'): SvgNode[] => {
    const shown = value === null ? '–' : p.fmt(value, field);
    return [
      text(50, y, name, { 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, fill: MUTED, 'font-family': 'inherit' }),
      el('rect', { x: 14, y: y + 4, width: 72, height: 20, rx: 3, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1 }),
      text(50, y + 18.5, shown, { 'text-anchor': 'middle', 'font-size': shown.length > 9 ? 9 : 12, 'font-weight': 600, fill: INK, 'font-family': 'inherit' }),
    ];
  };
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 8, y: 6, width: 84, height: 88, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...row(22, p.rows[0], p.value),
      ...row(58, p.rows[1], p.value2, 'value2'),
      el('circle', { cx: 82, cy: 14, r: 2.6, fill: accent(p) }),
    ],
  };
}

// ─── wires ───────────────────────────────────────────────────────────────────

export function wireStraight(p: Paint): Drawn {
  const w = 100 * p.length;
  return { w, h: 100, nodes: wire(`M0 50 H${w}`, p) };
}

export function wireElbow(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: wire('M0 50 H44 Q50 50 50 56 V100', p) };
}

export function wireTee(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: [...wire('M0 50 H100', p), ...wire('M50 50 V100', p), el('circle', { cx: 50, cy: 50, r: 3.6, fill: p.state === 'idle' && !p.running ? MUTED : accent(p) })] };
}

export function wireCross(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: [...wire('M0 50 H100', p), ...wire('M50 0 V100', p), el('circle', { cx: 50, cy: 50, r: 3.6, fill: p.state === 'idle' && !p.running ? MUTED : accent(p) })] };
}

/** `base` and `r2` are re-exported so a symbol file needs one import line. */
export { BASE, r2 };
