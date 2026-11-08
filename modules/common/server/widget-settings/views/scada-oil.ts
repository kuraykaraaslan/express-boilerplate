// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-oil.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The oil-and-gas (drilling) symbols: a derrick with a travelling block, a drawworks, a volute pump, a blowout preventer,
// a drill bit, a scaled tank, a degasser and a depth gauge. Pure node trees (no React); see `scada-draw.ts` for the
// shared rules. The bottom of the derrick, the bit's top and the preventer's bore sit on x = centre.

import { el, polar, r2, text, type SvgNode } from './svg-node';
import { accent, alarmLamp, LIQUID, BASE, blades, INK, METAL, METAL_OUT, MUTED, pipes, shine, STEEL, SURFACE, turning, type Drawn, type Paint } from './scada-draw';

const SUNKEN = 'var(--surface-sunken)';

/** A drilling derrick: a braced tower with a crown block, a travelling block that rides with the reading and the floor. */
export function rigDerrick(p: Paint): Drawn {
  const a = accent(p);
  const block = r2(34 + (1 - (p.level === null ? 0.45 : Math.min(1, p.level))) * 70);
  const brace = (y1: number, y2: number): SvgNode[] => {
    const half = (y: number) => 9 + (y / 130) * 24;
    return [
      el('line', { x1: 40 - half(y1), y1, x2: 40 + half(y2), y2, stroke: METAL_OUT, 'stroke-width': 1.6 }),
      el('line', { x1: 40 + half(y1), y1, x2: 40 - half(y2), y2, stroke: METAL_OUT, 'stroke-width': 1.6 }),
      el('line', { x1: 40 - half(y2), y1: y2, x2: 40 + half(y2), y2, stroke: METAL_OUT, 'stroke-width': 1.6 }),
    ];
  };
  return {
    w: 80, h: 140,
    nodes: [
      el('polygon', { points: '31,22 49,22 66,124 14,124', fill: 'none', stroke: METAL_OUT, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
      ...brace(22, 48), ...brace(48, 74), ...brace(74, 100), ...brace(100, 124),
      el('rect', { x: 10, y: 124, width: 60, height: 8, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('rect', { x: 4, y: 132, width: 72, height: 4, rx: 1.5, fill: METAL_OUT }),
      el('circle', { cx: 40, cy: 12, r: 11, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.2 }),
      turning(40, 12, 3, p, blades(40, 12, 6, 8, 1.4, p.running ? a : MUTED)),
      el('line', { x1: 40, y1: 23, x2: 40, y2: 140, stroke: INK, 'stroke-width': 2 }),
      el('rect', { x: 33, y: block, width: 14, height: 9, rx: 2, fill: SURFACE, stroke: a, 'stroke-width': 2 }),
      el('path', { d: `M40 ${block + 9} v5 a4 4 0 1 0 4 4`, fill: 'none', stroke: a, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    ],
  };
}

/** A drawworks: a drum in a housing with its drive and a base. */
export function drawworks(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 130, h: 100,
    nodes: [
      el('rect', { x: 8, y: 90, width: 114, height: 6, rx: 2, fill: METAL_OUT }),
      el('rect', { x: 78, y: 28, width: 44, height: 60, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.4 }),
      ...[88, 96, 104, 112].map((x) => el('line', { x1: x, y1: 34, x2: x, y2: 82, stroke: METAL_OUT, 'stroke-width': 1.6 })),
      el('rect', { x: 14, y: 22, width: 70, height: 66, rx: 12, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.6 }),
      el('circle', { cx: 46, cy: 55, r: 24, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.4 }),
      el('circle', { cx: 46, cy: 55, r: 15, fill: SURFACE, stroke: 'var(--border)', 'stroke-width': 1 }),
      turning(46, 55, 2, p, blades(46, 55, 4, 12, 2.4, p.running ? a : MUTED)),
      el('circle', { cx: 46, cy: 55, r: 3, fill: a }),
    ],
  };
}

/** A mud pump: a volute casing with a curved-vane impeller, a scroll outlet and a base; the vanes take the state colour when it runs or is in a warning or an alarm. */
export function pumpVolute(p: Paint): Drawn {
  const a = accent(p);
  const cx = 52; const cy = 58;
  const vane = (deg: number): SvgNode => {
    const [x1, y1] = polar(cx, cy, 4, deg);
    const [x2, y2] = polar(cx, cy, 17, deg + 40);
    return el('path', { d: `M${x1} ${y1} Q ${polar(cx, cy, 12, deg)[0]} ${polar(cx, cy, 12, deg)[1]} ${x2} ${y2}`, fill: 'none', stroke: p.running || p.state !== 'idle' ? a : MUTED, 'stroke-width': 2.2, 'stroke-linecap': 'round' });
  };
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 20, y: 90, width: 66, height: 6, rx: 2, fill: METAL_OUT }),
      el('rect', { x: 30, y: 82, width: 40, height: 8, fill: METAL_OUT }),
      ...pipes(['M0 50 H24', 'M80 50 H100'], p, [[5, 50], [95, 50]]),
      el('path', { d: `M${cx} ${cy - 32} A32 32 0 1 0 ${cx + 32} ${cy} L 86 ${cy} L 86 ${cy - 16} L 76 ${cy - 16} A 22 22 0 0 0 ${cx} ${cy - 32} Z`, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      el('circle', { cx, cy, r: 22, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.6 }),
      turning(cx, cy, 1.1, p, [0, 120, 240].map(vane)),
      el('circle', { cx, cy, r: 4, fill: METAL_OUT }),
    ],
  };
}

/** A blowout preventer: a stack of ram bodies on a vertical bore; the ram lugs show the state (running, a warning or an alarm). */
export function bop(p: Paint): Drawn {
  const a = accent(p);
  const lit = p.running || p.state !== 'idle';
  const ram = (y: number): SvgNode[] => [
    el('polygon', { points: `10,${y + 6} 26,${y} 74,${y} 90,${y + 6} 90,${y + 18} 74,${y + 24} 26,${y + 24} 10,${y + 18}`, ...STEEL, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    el('rect', { x: 4, y: y + 8, width: 10, height: 8, rx: 2, fill: lit ? a : METAL_OUT }),
    el('rect', { x: 86, y: y + 8, width: 10, height: 8, rx: 2, fill: lit ? a : METAL_OUT }),
  ];
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M50 0 V100'], p, [[50, 5, true], [50, 95, true]]),
      ...ram(14),
      el('rect', { x: 34, y: 38, width: 32, height: 22, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      ...ram(60),
      shine(30, 20, 32),
    ],
  };
}

/** A tri-cone drill bit hanging from its string; the teeth take the state colour (running, a warning or an alarm). */
export function drillBit(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('line', { x1: 50, y1: 0, x2: 50, y2: 34, stroke: INK, 'stroke-width': 3 }),
      el('rect', { x: 38, y: 32, width: 24, height: 16, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...[[32, 66, 0], [68, 66, 0], [50, 74, 1]].map(([cx, cy, front]) => el('circle', { cx, cy, r: front ? 19 : 17, fill: front ? SURFACE : METAL, stroke: METAL_OUT, 'stroke-width': 2.5 })),
      ...[[44, 72], [56, 72], [50, 82], [30, 62], [70, 62]].map(([x, y]) => el('circle', { cx: x, cy: y, r: 1.8, fill: a })),
    ],
  };
}

/** A rounded tank with a numbered scale down its left side and the liquid in it; a warning or an alarm lights a lamp on the shoulder. */
export function tankScale(p: Paint): Drawn {
  const nodes: SvgNode[] = [
    el('rect', { x: 8, y: 6, width: 84, height: 88, rx: 22, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 3 }),
  ];
  if (p.level !== null && p.level > 0.005) {
    const h = 74 * Math.min(1, p.level);
    nodes.push(el('path', { d: `M12 ${r2(88 - h)} H88 V72 Q88 90 70 90 H30 Q12 90 12 72 Z`.replace(/V72/, `V${Math.max(72, r2(88 - h))}`), fill: p.fill, 'fill-opacity': LIQUID }));
  }
  for (let i = 0; i <= 10; i += 1) {
    const y = r2(88 - i * 7.4);
    nodes.push(el('line', { x1: 24, y1: y, x2: i % 2 === 0 ? 31 : 28, y2: y, stroke: MUTED, 'stroke-width': 0.9 }));
    if (i % 2 === 0) nodes.push(text(21.5, y + 1.6, String(r2(p.min + (p.max - p.min) * (i / 10))), { 'text-anchor': 'end', 'font-size': 4.6, fill: MUTED, 'font-family': 'inherit' }));
  }
  nodes.push(shine(20, 18, 80), ...alarmLamp(72, 16, p, 4));
  return { nodes, w: 100, h: 100 };
}

/** A degasser: a cup-shaped vessel with an inlet and an outlet on the centre line. */
export function degasser(p: Paint): Drawn {
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M0 50 H26', 'M74 50 H100'], p, [[5, 50], [95, 50]]),
      el('path', { d: 'M26 24 H74 L72 70 Q70 88 50 88 Q30 88 28 70 Z', fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }),
      el('rect', { x: 24, y: 18, width: 52, height: 8, rx: 3, fill: METAL_OUT }),
      el('path', { d: 'M32 56 H68 M34 66 H66', fill: 'none', stroke: p.fill, 'stroke-opacity': 0.55, 'stroke-width': 2, 'stroke-linecap': 'round' }),
      shine(34, 32, 70),
    ],
  };
}

/** A vertical depth gauge: a track, a pointer on the left and the reading's marker (it takes the state colour while the gauge runs or is in a warning or an alarm). */
export function meterDepth(p: Paint): Drawn {
  const top = 8; const bottom = 92;
  const y = r2(top + (p.level === null ? 0 : Math.min(1, p.level)) * (bottom - top));
  return {
    w: 60, h: 100,
    nodes: [
      el('rect', { x: 34, y: top, width: 10, height: bottom - top, rx: 2, fill: p.fill, 'fill-opacity': 0.28, stroke: METAL_OUT, 'stroke-width': 1.8 }),
      ...Array.from({ length: 11 }, (_, i) => el('line', { x1: 44, y1: r2(top + (i / 10) * (bottom - top)), x2: i % 5 === 0 ? 52 : 48, y2: r2(top + (i / 10) * (bottom - top)), stroke: MUTED, 'stroke-width': 1 })),
      ...(p.level !== null ? [
        el('polygon', { points: `22,${y - 5} 22,${y + 5} 32,${y}`, fill: accent(p), stroke: BASE, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
        el('rect', { x: 36, y: r2(y - 2), width: 6, height: 4, fill: INK }),
      ] : []),
    ],
  };
}

export { METAL, SUNKEN };
