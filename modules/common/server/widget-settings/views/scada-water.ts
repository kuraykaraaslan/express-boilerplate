// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-water.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The water-side process symbols: pipes, valves, a pump, a filter vessel, a strainer, a drain, tanks, a pool and the
// round instruments. Pure node trees (no React); see `scada-draw.ts` for the shared rules (a box 100 high, connections
// on the centre lines, flat layered shading, no ids).

import { arcPath, el, polar, r2, type SvgNode } from './svg-node';
import {
  accent, alarmLamp, LIQUID, BASE, blades, INK, METAL, METAL_OUT, MUTED, opening, pipes, powerGlyph, R, shine, STEEL, SURFACE, turning, type Drawn, type Paint,
} from './scada-draw';

// ─── pipes ───────────────────────────────────────────────────────────────────

export function pipeStraight(p: Paint): Drawn {
  const w = 100 * p.length;
  const joints: Array<[number, number]> = [[5, 50], [w - 5, 50], ...Array.from({ length: p.length - 1 }, (_, i): [number, number] => [100 * (i + 1), 50])];
  return { w, h: 100, nodes: pipes([`M0 50 H${w}`], p, joints, { x1: 0, x2: w, y: 43 }) };
}

/** Left to bottom; a turn gives the other three corners. */
export function pipeElbow(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: pipes(['M0 50 H30 Q50 50 50 70 V100'], p, [[5, 50], [50, 95, true]]) };
}

export function pipeTee(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: pipes(['M0 50 H100', 'M50 50 V100'], p, [[5, 50], [95, 50], [50, 95, true]], { x1: 0, x2: 100, y: 43 }) };
}

export function pipeCross(p: Paint): Drawn {
  return { w: 100, h: 100, nodes: pipes(['M0 50 H100', 'M50 0 V100'], p, [[5, 50], [95, 50], [50, 5, true], [50, 95, true]]) };
}

// ─── valves ──────────────────────────────────────────────────────────────────

const through = (p: Paint, rings: Array<[number, number, boolean?]> = [[5, 50], [95, 50]]) => pipes(['M0 50 H100'], p, rings);

/** Whether the opening is reported (it runs, or `position` says how far): only then does the valve show how far open it is. */
const opens = (p: Paint): boolean => p.running || (p.states?.position ?? null) !== null;

/**
 * A round actuator body on the pipe with the power glyph in its eye. Once it runs or reports its position, a pointer in the window above
 * the eye lies along the pipe when open and across it when shut (a quarter turn, as the item's actuator shows it).
 */
export function valveBall(p: Paint): Drawn {
  const a = accent(p);
  const turn = (1 - opening(p)) * (Math.PI / 2);
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 36, y: 14, width: 28, height: 72, rx: 14, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      shine(42, 24, 76),
      el('circle', { cx: 50, cy: 50, r: 11.5, fill: SURFACE, stroke: a, 'stroke-width': 3.5 }),
      ...powerGlyph(50, 51, 5.5, a),
      ...(opens(p) ? [
        el('circle', { cx: 50, cy: 27, r: 7, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 1.5 }),
        el('line', { x1: r2(50 - 5 * Math.cos(turn)), y1: r2(27 + 5 * Math.sin(turn)), x2: r2(50 + 5 * Math.cos(turn)), y2: r2(27 - 5 * Math.sin(turn)), stroke: INK, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      ] : []),
    ],
  };
}

/**
 * A gate valve in elevation: a body on the pipe, a bonnet, a stem and a handwheel seen edge-on. Once it runs or reports its position, a
 * mark on the wheel travels across it as the wheel turns (half a turn from shut to open, as the item's handwheel does).
 */
export function valveWheel(p: Paint): Drawn {
  const a = accent(p);
  const markX = r2(50 + 20 * Math.cos(opening(p) * Math.PI));
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 42, y: 26, width: 16, height: 14, rx: R.sm, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('line', { x1: 50, y1: 26, x2: 50, y2: 18, stroke: METAL_OUT, 'stroke-width': 3.5 }),
      el('rect', { x: 32, y: 34, width: 36, height: 32, rx: R.md, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      shine(40, 40, 60),
      el('rect', { x: 26, y: 8, width: 48, height: 10, rx: 5, fill: a, 'fill-opacity': p.state === 'idle' ? 0.55 : 0.95, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...(opens(p) ? [el('line', { x1: markX, y1: 10, x2: markX, y2: 16, stroke: INK, 'stroke-width': 1.5, 'stroke-linecap': 'round' })] : []),
      el('circle', { cx: 50, cy: 50, r: 7, fill: SURFACE, stroke: a, 'stroke-width': 3.5 }),
    ],
  };
}

/** A solenoid valve: a dark body on the pipe, a coil above it and a lamp on the coil. */
export function valveSolenoid(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 32, y: 38, width: 36, height: 28, rx: 6, ...STEEL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 40, y: 8, width: 20, height: 32, rx: 3, ...STEEL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...[16, 22, 28, 34].map((y) => el('line', { x1: 41, y1: y, x2: 59, y2: y, stroke: BASE, 'stroke-opacity': 0.5, 'stroke-width': 1.5 })),
      el('circle', { cx: 50, cy: 52, r: 5, fill: a, stroke: BASE, 'stroke-width': 1.5 }),
      el('rect', { x: 46, y: 66, width: 8, height: 10, rx: 3, ...STEEL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ],
  };
}

/**
 * The plain two-triangle gate symbol with a stem and a handle. Reads `running` and `position` (the larger wins, as the 3D valve reads them):
 * the gate fills and the stem and handle rise as it opens.
 */
export function valveGate(p: Paint): Drawn {
  const a = accent(p);
  const open = opening(p);
  // the gate fills as it opens and the stem and handle rise with it (6 units fully open)
  const tri = (pts: number[][]) => el('polygon', {
    points: pts.map(([x, y]) => `${x},${y}`).join(' '), fill: a, 'fill-opacity': r2(0.3 + 0.6 * open), stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round',
  });
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      tri([[24, 33], [24, 67], [50, 50]]),
      tri([[76, 33], [76, 67], [50, 50]]),
      el('line', { x1: 50, y1: 50, x2: 50, y2: r2(22 - 6 * open), stroke: METAL_OUT, 'stroke-width': 3 }),
      el('rect', { x: 38, y: r2(11 - 6 * open), width: 24, height: 10, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
    ],
  };
}

// ─── pump, filter, strainer, drain ───────────────────────────────────────────

/** A centrifugal pump on a base: inlet left, outlet up, a finned motor to the right. */
export function pumpMotor(p: Paint): Drawn {
  const a = accent(p);
  const cx = 52; const cy = 50;
  return {
    w: 200, h: 100,
    nodes: [
      el('rect', { x: 34, y: 84, width: 160, height: 10, rx: 3, fill: METAL_OUT }),
      el('rect', { x: 40, y: 78, width: 22, height: 8, fill: METAL_OUT }),
      el('rect', { x: 118, y: 74, width: 60, height: 12, fill: METAL_OUT }),
      ...pipes([`M0 ${cy} H${cx}`, `M${cx} 0 V${cy}`], p, [[5, cy], [cx, 6, true]]),
      el('rect', { x: 84, y: 42, width: 16, height: 16, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      el('rect', { x: 96, y: 26, width: 92, height: 48, rx: 9, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      ...[106, 114, 122, 130, 138, 146, 154, 162, 170].map((x) => el('line', { x1: x, y1: 32, x2: x, y2: 68, stroke: METAL_OUT, 'stroke-width': 2 })),
      el('rect', { x: 188, y: 36, width: 8, height: 28, rx: 3, fill: a, 'fill-opacity': p.state === 'idle' ? 0.5 : 0.9, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      el('circle', { cx, cy, r: 32, fill: a, 'fill-opacity': p.state === 'idle' ? 0.1 : 0.22, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('circle', { cx, cy, r: 23, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      turning(cx, cy, 1.2, p, blades(cx, cy, 3, 18, 3.5, p.running ? a : MUTED)),
      el('circle', { cx, cy, r: 4, fill: METAL_OUT }),
    ],
  };
}

/** A sand filter: a vessel with a domed top, a multiport valve on it and ports left and right. */
export function filterSand(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M0 50 H26', 'M74 50 H100'], p, [[5, 50], [95, 50]]),
      el('rect', { x: 18, y: 86, width: 64, height: 9, rx: 3, fill: METAL_OUT }),
      el('path', { d: 'M24 34 Q24 22 50 22 Q76 22 76 34 V86 H24 Z', fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      el('rect', { x: 24, y: 58, width: 52, height: 28, fill: a, 'fill-opacity': p.state === 'idle' ? 0.1 : 0.22 }),
      el('line', { x1: 24, y1: 58, x2: 76, y2: 58, stroke: a, 'stroke-opacity': 0.8, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }),
      shine(34, 38, 80),
      el('rect', { x: 39, y: 10, width: 22, height: 13, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('rect', { x: 43, y: 3, width: 14, height: 7, rx: 2, fill: a, 'fill-opacity': p.state === 'idle' ? 0.55 : 0.95, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ],
  };
}

/** A strainer: a pot with a lid hanging from the pipe. */
export function strainer(p: Paint): Drawn {
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 33, y: 46, width: 34, height: 44, rx: 7, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      shine(40, 54, 82),
      ...[56, 64, 72].map((y) => el('line', { x1: 47, y1: y, x2: 61, y2: y, stroke: METAL_OUT, 'stroke-width': 1.5, 'stroke-opacity': 0.7 })),
      el('rect', { x: 29, y: 38, width: 42, height: 10, rx: 3, fill: METAL_OUT }),
      el('circle', { cx: 50, cy: 94, r: 3.5, fill: METAL_OUT }),
    ],
  };
}

/** The open end of a pipe above a splash; while it discharges, streaks fall to the splash at the pace `speed` gives (a reverse direction makes them rise). */
export function drain(p: Paint): Drawn {
  const water = p.medium ?? 'var(--info)';
  const o = p.running ? 0.95 : 0.35;
  // while it discharges, streaks fall from the mouth to the splash (speed paces them, a reverse direction makes them rise)
  const streaks = p.running && p.animate
    ? [40, 50, 60].map((x) => el('line', { x1: x, y1: 80, x2: x, y2: 93, stroke: water, 'stroke-width': 2.5, 'stroke-dasharray': '3 5', 'stroke-opacity': 0.9 },
      [el('animate', { attributeName: 'stroke-dashoffset', from: 8, to: 0, dur: '0.7s', repeatCount: 'indefinite' })]))
    : [];
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M0 50 H34 Q50 50 50 66 V76'], p, [[5, 50]]),
      el('rect', { x: 36, y: 74, width: 28, height: 6, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      ...streaks,
      el('ellipse', { cx: 40, cy: 86, rx: 3, ry: 4.5, fill: water, 'fill-opacity': o }),
      el('ellipse', { cx: 50, cy: 90, rx: 3, ry: 4.5, fill: water, 'fill-opacity': o }),
      el('ellipse', { cx: 60, cy: 86, rx: 3, ry: 4.5, fill: water, 'fill-opacity': o }),
      el('ellipse', { cx: 50, cy: 96, rx: 24, ry: 3, fill: water, 'fill-opacity': o * 0.6 }),
    ],
  };
}

// ─── tanks and the pool ──────────────────────────────────────────────────────

/**
 * A vessel in elevation: a rounded body of `w` x `h` with a lid, the liquid in it and level marks on the right edge. Reads `value` (the level)
 * and `status` (the liquid takes the state's colour, and a lamp on the lid lights in a warning or an alarm even when the tank is empty).
 */
export function tank(w: number, h: number, p: Paint): Drawn {
  const x0 = 10; const x1 = x0 + w; const top = 12; const bottom = top + h;
  const r = R.lg;
  const nodes: SvgNode[] = [
    el('rect', { x: x0 + w / 2 - 8, y: 4, width: 16, height: 9, rx: R.sm, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    el('rect', { x: x0, y: top, width: w, height: h, rx: r, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
  ];
  if (p.level !== null && p.level > 0.005) {
    const ly = r2(bottom - 2 - Math.min(1, p.level) * (h - 4));
    const lx0 = x0 + 2; const lx1 = x1 - 2; const rr = r - 2;
    const d = bottom - 2 - ly > rr
      ? `M${lx0} ${ly} H${lx1} V${bottom - 2 - rr} Q${lx1} ${bottom - 2} ${lx1 - rr} ${bottom - 2} H${lx0 + rr} Q${lx0} ${bottom - 2} ${lx0} ${bottom - 2 - rr} Z`
      : `M${lx0 + (rr - Math.sqrt(Math.max(0, rr * rr - (rr - (bottom - 2 - ly)) ** 2)))} ${ly} H${lx1 - (rr - Math.sqrt(Math.max(0, rr * rr - (rr - (bottom - 2 - ly)) ** 2)))} Q${lx1} ${bottom - 2} ${lx1 - rr} ${bottom - 2} H${lx0 + rr} Q${lx0} ${bottom - 2} ${lx0 + (rr - Math.sqrt(Math.max(0, rr * rr - (rr - (bottom - 2 - ly)) ** 2)))} ${ly} Z`;
    nodes.push(
      el('path', { d, fill: p.fill, 'fill-opacity': LIQUID }),
      el('line', { x1: lx0 + 4, y1: ly + 0.75, x2: lx1 - 4, y2: ly + 0.75, stroke: BASE, 'stroke-opacity': 0.6, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
    );
  }
  nodes.push(shine(x0 + 8, top + r, bottom - r));
  // a warning or an alarm lights a lamp on the lid, so an empty tank shows it too (the liquid only turns the state's colour)
  nodes.push(...alarmLamp(x0 + w / 2, 8.5, p, 3.5));
  if (p.ticks) {
    for (const f of [0.25, 0.5, 0.75]) {
      const y = r2(bottom - 2 - f * (h - 4));
      nodes.push(el('line', { x1: x1 - 9, y1: y, x2: x1 - 2, y2: y, stroke: METAL_OUT, 'stroke-width': 1.5 }));
    }
  }
  return { nodes, w: w + 20, h: bottom + 6 };
}

/** An open basin (a pool, a reservoir) seen from the side: a rim, water with a wavy top, level marks and, in a warning or an alarm, a lamp on the rim. */
export function tankOpen(p: Paint): Drawn {
  const x0 = 6; const x1 = 194; const top = 14; const bottom = 97;
  const nodes: SvgNode[] = [el('rect', { x: x0, y: top, width: x1 - x0, height: bottom - top, rx: 3, fill: SURFACE })];
  if (p.level !== null && p.level > 0.005) {
    const y = r2(bottom - Math.min(1, p.level) * (bottom - top));
    const wave = `M${x0} ${y} q 11.75 -5 23.5 0 t 23.5 0 t 23.5 0 t 23.5 0 t 23.5 0 t 23.5 0 t 23.5 0 t 23.5 0 V${bottom} H${x0} Z`;
    nodes.push(
      el('path', { d: wave, fill: p.fill, 'fill-opacity': LIQUID }),
      ...(bottom - y > 14 ? [el('path', { d: `M18 ${y + 9} q 8 -3 16 0 t 16 0 M96 ${y + 15} q 8 -3 16 0 t 16 0 M148 ${y + 8} q 8 -3 16 0 t 16 0`, fill: 'none', stroke: BASE, 'stroke-opacity': 0.5, 'stroke-width': 1.5, 'stroke-linecap': 'round' })] : []),
    );
  }
  nodes.push(
    el('path', { d: `M${x0} ${top - 6} V${bottom} H${x1} V${top - 6}`, fill: 'none', stroke: METAL_OUT, 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    el('line', { x1: x0 - 2, y1: top - 6, x2: x0 + 12, y2: top - 6, stroke: METAL_OUT, 'stroke-width': 3.5 }),
    el('line', { x1: x1 - 12, y1: top - 6, x2: x1 + 2, y2: top - 6, stroke: METAL_OUT, 'stroke-width': 3.5 }),
    ...alarmLamp(x0 + 8, top - 10, p, 3.5),
  );
  return { nodes, w: 200, h: 100 };
}

// ─── instruments ─────────────────────────────────────────────────────────────

/** 150° (lower left) at the minimum to 390° (lower right) at the maximum, as `arcPath` degrees. */
const dial = (value: number, min: number, max: number) => 150 + Math.min(1, Math.max(0, (value - min) / (max - min))) * 240;

/** A round dial: a 240° scale with coloured bands, tick marks and a needle. */
export function meterDial(p: Paint): Drawn {
  const cx = 50; const cy = 50; const r = 29;
  const nodes: SvgNode[] = [
    el('circle', { cx, cy, r: 42, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    el('circle', { cx, cy, r: 37, fill: 'none', stroke: 'var(--border)', 'stroke-width': 1 }),
    el('path', { d: arcPath(cx, cy, r, 150, 390), fill: 'none', stroke: 'var(--border)', 'stroke-width': 6 }),
  ];
  let from = p.min;
  for (const band of p.bands) {
    const lo = Math.max(p.min, band.from ?? from);
    const hi = Math.min(p.max, band.to);
    from = hi;
    if (!(hi > lo) || !band.color) continue;
    nodes.push(el('path', { d: arcPath(cx, cy, r, dial(lo, p.min, p.max), dial(hi, p.min, p.max)), fill: 'none', stroke: band.color, 'stroke-width': 6 }));
  }
  for (let i = 0; i <= 8; i += 1) {
    const [x1, y1] = polar(cx, cy, 33, 150 + i * 30);
    const [x2, y2] = polar(cx, cy, 36, 150 + i * 30);
    nodes.push(el('line', { x1, y1, x2, y2, stroke: MUTED, 'stroke-width': i % 2 === 0 ? 1.8 : 1 }));
  }
  if (p.value !== null) {
    const [x, y] = polar(cx, cy, 25, dial(p.value, p.min, p.max));
    nodes.push(el('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: p.state === 'idle' ? INK : p.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  }
  nodes.push(el('circle', { cx, cy, r: 4.5, fill: INK }));
  return { nodes, w: 100, h: 100 };
}

/** An inline flow meter: a round body on the pipe with a small display and a flow arrow. */
export function meterFlow(p: Paint): Drawn {
  const a = accent(p);
  // the reading is printed under the symbol, as every other meter's (run 3 #30: 10.5 units of 100 in the lens could not be read at drawing scale)
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('circle', { cx: 50, cy: 50, r: 31, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('circle', { cx: 50, cy: 50, r: 26, fill: 'none', stroke: 'var(--border)', 'stroke-width': 1 }),
      el('rect', { x: 28, y: 38, width: 44, height: 17, rx: 3, fill: 'var(--surface-sunken)', stroke: METAL_OUT, 'stroke-width': 1 }),
      el('path', { d: 'M38 66 H62 M56 61 L62 66 L56 71', fill: 'none', stroke: a, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ],
  };
}

/** A heat-pump unit: a casing with a fan behind a round grille and a status lamp. */
export function heatPump(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 6, y: 6, width: 88, height: 88, rx: 10, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 14, y: 90, width: 14, height: 5, fill: METAL_OUT }),
      el('rect', { x: 72, y: 90, width: 14, height: 5, fill: METAL_OUT }),
      el('circle', { cx: 50, cy: 50, r: 35, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('circle', { cx: 50, cy: 50, r: 25, fill: SURFACE, stroke: 'var(--border)', 'stroke-width': 1 }),
      turning(50, 50, 1.4, p, blades(50, 50, 5, 23, 7, p.running ? a : MUTED)),
      el('circle', { cx: 50, cy: 50, r: 6, fill: p.running ? a : METAL_OUT, stroke: BASE, 'stroke-width': 1.5 }),
      el('circle', { cx: 50, cy: 50, r: 35, fill: 'none', stroke: METAL_OUT, 'stroke-width': 1, 'stroke-dasharray': '2 3' }),
      el('circle', { cx: 82, cy: 82, r: 4.5, fill: a, stroke: BASE, 'stroke-width': 1.5 }),
    ],
  };
}
