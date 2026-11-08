// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-network.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// The water-distribution symbols (an elevated tower, a ground reservoir, a borehole, a pump station, a chlorinator,
// pressure-reducing / check / butterfly valves, a hydrant, a telemetry cabinet, a pressure transmitter, a level gauge,
// a clarifier). Pure node trees (no React); see `scada-draw.ts` for the shared rules.

import { arcPath, el, polar, r2, type SvgNode } from './svg-node';
import { accent, alarmLamp, LIQUID, BASE, blades, INK, METAL, METAL_OUT, MUTED, opening, pipes, powerGlyph, R, shine, STEEL, SURFACE, turning, type Drawn, type Paint } from './scada-draw';

const SUNKEN = 'var(--surface-sunken)';
const through = (p: Paint) => pipes(['M0 50 H100'], p, [[5, 50], [95, 50]]);

/** An elevated tank on a braced frame with a riser down to the ground; a warning or an alarm lights a beacon on the roof. */
export function towerWater(p: Paint): Drawn {
  const nodes: SvgNode[] = [
    el('line', { x1: 2, y1: 96, x2: 98, y2: 96, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    ...[[30, 70], [70, 30]].map(([a, b]) => el('line', { x1: a, y1: 62, x2: b, y2: 88, stroke: METAL_OUT, 'stroke-width': 1.6 })),
    ...[[34, 44], [66, 56]].map(([x1, x2]) => el('line', { x1, y1: 46, x2, y2: 88, stroke: METAL_OUT, 'stroke-width': 3 })),
    el('line', { x1: 34, y1: 46, x2: 28, y2: 96, stroke: METAL_OUT, 'stroke-width': 3 }),
    el('line', { x1: 66, y1: 46, x2: 72, y2: 96, stroke: METAL_OUT, 'stroke-width': 3 }),
    el('rect', { x: 22, y: 6, width: 56, height: 40, rx: 16, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
  ];
  if (p.level !== null && p.level > 0.005) {
    const h = 34 * Math.min(1, p.level);
    nodes.push(el('path', { d: `M26 ${r2(43 - h)} H74 V${r2(40)} Q74 43 62 43 H38 Q26 43 26 40 Z`, fill: p.fill, 'fill-opacity': LIQUID }));
  }
  // a warning or an alarm lights the beacon on the roof, so an empty tank shows it too (the water only turns the state's colour)
  nodes.push(shine(32, 14, 34), ...alarmLamp(50, 5, p, 3.5), ...pipes(['M50 46 V100'], p, [[50, 95, true]]));
  return { nodes, w: 100, h: 100 };
}

/** A covered ground reservoir with a vent, an inlet on the left and an outlet on the right; a warning or an alarm lights a lamp on the roof corner. */
export function reservoirGround(p: Paint): Drawn {
  const nodes: SvgNode[] = [
    ...pipes(['M0 50 H12', 'M128 50 H140'], p, [[5, 50], [135, 50]]),
    el('rect', { x: 10, y: 22, width: 120, height: 66, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 3 }),
  ];
  if (p.level !== null && p.level > 0.005) {
    const h = 58 * Math.min(1, p.level);
    nodes.push(
      el('rect', { x: 13, y: r2(85 - h), width: 114, height: r2(h), fill: p.fill, 'fill-opacity': LIQUID }),
      el('path', { d: `M13 ${r2(85 - h)} q 9 -4 19 0 t 19 0 t 19 0 t 19 0 t 19 0 t 19 0`, fill: 'none', stroke: BASE, 'stroke-opacity': 0.55, 'stroke-width': 1.5 }),
    );
  }
  nodes.push(
    el('rect', { x: 6, y: 16, width: 128, height: 8, rx: 2, fill: METAL_OUT }),
    el('path', { d: 'M92 16 V8 H104 V16', fill: 'none', stroke: METAL_OUT, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
    el('rect', { x: 28, y: 8, width: 14, height: 9, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ...[0.25, 0.5, 0.75].map((f) => el('line', { x1: 122, y1: r2(85 - f * 58), x2: 127, y2: r2(85 - f * 58), stroke: METAL_OUT, 'stroke-width': 1.4 })),
    // a warning or an alarm lights a lamp on the roof corner, so an empty reservoir shows it too (the water only turns the state's colour)
    ...alarmLamp(16, 11, p, 3.5),
  );
  return { nodes, w: 140, h: 100 };
}

/** A borehole: a casing into the ground, a motor on top and the discharge to the right. */
export function wellBore(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('line', { x1: 4, y1: 62, x2: 96, y2: 62, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      ...[10, 22, 34, 66, 78, 90].map((x) => el('line', { x1: x, y1: 62, x2: x - 5, y2: 69, stroke: METAL_OUT, 'stroke-width': 1.5 })),
      el('rect', { x: 42, y: 30, width: 16, height: 66, rx: 2, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.2 }),
      el('rect', { x: 45, y: 72, width: 10, height: 22, fill: p.fill, 'fill-opacity': LIQUID }),
      ...pipes(['M58 50 H100'], p, [[95, 50]]),
      el('rect', { x: 36, y: 6, width: 28, height: 26, rx: 4, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      ...[43, 50, 57].map((x) => el('line', { x1: x, y1: 11, x2: x, y2: 27, stroke: METAL_OUT, 'stroke-width': 1.6 })),
      el('circle', { cx: 50, cy: 42, r: 5, fill: a, stroke: BASE, 'stroke-width': 1.5 }),
    ],
  };
}

/** A pump station: a building with a roof, the main line through it and two pumps on the line. */
export function stationPump(p: Paint): Drawn {
  const a = accent(p);
  const pump = (cx: number): SvgNode[] => [
    el('circle', { cx, cy: 50, r: 21, fill: a, 'fill-opacity': p.state === 'idle' ? 0.1 : 0.22, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    el('circle', { cx, cy: 50, r: 14, fill: SURFACE, stroke: 'var(--border)', 'stroke-width': 1 }),
    turning(cx, 50, 1.2, p, blades(cx, 50, 3, 11, 2.6, p.running ? a : MUTED)),
    el('circle', { cx, cy: 50, r: 2.6, fill: METAL_OUT }),
  ];
  return {
    w: 160, h: 100,
    nodes: [
      el('rect', { x: 8, y: 22, width: 144, height: 68, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('polygon', { points: '2,24 18,8 142,8 158,24', fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      ...pipes(['M0 50 H160'], p, [[5, 50], [155, 50]]),
      ...pump(52),
      ...pump(108),
      el('rect', { x: 66, y: 72, width: 28, height: 14, rx: 2, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1.2 }),
      el('circle', { cx: 80, cy: 79, r: 3, fill: a }),
    ],
  };
}

/** A chlorinator: a dosing tank and pump that inject into the pipe through a dashed line. */
export function chlorinator(p: Paint): Drawn {
  const a = accent(p);
  const dose = 'var(--warning)';
  const nodes: SvgNode[] = [
    ...through(p),
    el('rect', { x: 12, y: 6, width: 30, height: 38, rx: 5, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.2 }),
    el('rect', { x: 18, y: 2, width: 18, height: 6, rx: 2, fill: METAL_OUT }),
    shine(18, 14, 36),
  ];
  const level = p.level === null ? 0.6 : Math.min(1, p.level);
  nodes.push(
    el('rect', { x: 14.5, y: r2(42 - 34 * level), width: 25, height: r2(34 * level), rx: 2, fill: dose, 'fill-opacity': LIQUID }),
    el('circle', { cx: 66, cy: 22, r: 11, fill: a, 'fill-opacity': p.state === 'idle' ? 0.1 : 0.22, stroke: METAL_OUT, 'stroke-width': 2.5 }),
    turning(66, 22, 1.2, p, blades(66, 22, 3, 7, 2, p.running ? a : MUTED)),
    el('path', { d: 'M42 26 H55 M77 22 H84 V38', fill: 'none', stroke: dose, 'stroke-width': 2.4, 'stroke-dasharray': p.running ? '4 3' : undefined, 'stroke-opacity': p.running ? 1 : 0.5, 'stroke-linejoin': 'round' } as Record<string, string | number>),
    el('polygon', { points: '79,36 89,36 84,44', fill: dose, 'fill-opacity': p.running ? 1 : 0.5 }),
  );
  return { nodes, w: 100, h: 100 };
}

/** A pressure-reducing valve: a diaphragm dome over the body, a pilot line and a flow arrow. */
export function valvePrv(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 32, y: 40, width: 36, height: 24, rx: 4, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('path', { d: 'M34 40 A16 16 0 0 1 66 40 Z', fill: a, 'fill-opacity': p.state === 'idle' ? 0.35 : 0.8, stroke: METAL_OUT, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      el('path', { d: 'M66 36 H80 V50', fill: 'none', stroke: METAL_OUT, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
      el('polygon', { points: '42,48 58,52 42,56', fill: INK, 'fill-opacity': 0.7 }),
    ],
  };
}

/** A check valve: a round body with a flap and a flow arrow. */
export function valveCheck(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('circle', { cx: 50, cy: 50, r: 21, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.2 }),
      el('path', { d: p.running ? 'M40 38 L58 50' : 'M42 36 L42 64', fill: 'none', stroke: a, 'stroke-width': 4, 'stroke-linecap': 'round' }),
      el('circle', { cx: 40, cy: 38, r: 2.6, fill: METAL_OUT }),
      el('path', { d: 'M46 74 H62 M57 69 L62 74 L57 79', fill: 'none', stroke: MUTED, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ],
  };
}

/** A butterfly valve: the disc lies along the pipe when open and across it when closed, and part way between at a part opening; an actuator on top. */
export function valveButterfly(p: Paint): Drawn {
  const a = accent(p);
  const open = opening(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...through(p),
      el('rect', { x: 38, y: 32, width: 24, height: 36, rx: 3, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2 }),
      el('ellipse', { cx: 50, cy: 50, rx: r2(3.2 + 13.8 * open), ry: r2(15 - 11.8 * open), fill: a, 'fill-opacity': r2(0.55 + 0.35 * open) }),
      el('line', { x1: 50, y1: 32, x2: 50, y2: 26, stroke: METAL_OUT, 'stroke-width': 3 }),
      el('rect', { x: 40, y: 6, width: 20, height: 20, rx: 6, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...powerGlyph(50, 16.5, 4.5, a),
    ],
  };
}

/** A fire hydrant on a riser: a body with two nozzles and a cap. */
export function hydrant(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M50 74 V100'], p, [[50, 95, true]]),
      el('rect', { x: 41, y: 38, width: 18, height: 40, rx: 3, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('path', { d: 'M40 38 A10 10 0 0 1 60 38 Z', fill: a, 'fill-opacity': p.state === 'idle' ? 0.55 : 0.95, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      el('rect', { x: 28, y: 50, width: 14, height: 10, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.8 }),
      el('rect', { x: 58, y: 50, width: 14, height: 10, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.8 }),
      el('rect', { x: 36, y: 74, width: 28, height: 8, rx: 2, fill: METAL_OUT }),
      el('circle', { cx: 50, cy: 22, r: 2.6, fill: METAL_OUT }),
      shine(46, 44, 70),
    ],
  };
}

/** A telemetry cabinet (RTU) with an antenna; the lamp shows the state and the signal arcs show life. */
export function rtu(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 14, y: 92, width: 72, height: 6, rx: 3, fill: METAL_OUT }),
      el('rect', { x: 20, y: 32, width: 60, height: 60, rx: R.md, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 27, y: 40, width: 46, height: 26, rx: R.sm, fill: SUNKEN, stroke: METAL_OUT, 'stroke-width': 1.5 }),
      ...[0, 1, 2].map((i) => el('circle', { cx: 34 + i * 14, cy: 79, r: 3.5, fill: i === 0 ? a : MUTED, 'fill-opacity': i === 0 ? 1 : 0.3 })),
      el('line', { x1: 50, y1: 32, x2: 50, y2: 12, stroke: METAL_OUT, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      el('circle', { cx: 50, cy: 10, r: 3.5, fill: a }),
      ...[8, 14].map((r) => el('path', { d: arcPath(50, 10, r, -140, -40), fill: 'none', stroke: a, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-opacity': p.running ? 0.9 : 0.25 })),
    ],
  };
}

/** A pressure transmitter on a stub: a body with a lamp and a gland. */
export function sensorPressure(p: Paint): Drawn {
  const a = accent(p);
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M50 58 V100'], p, [[50, 95, true]]),
      el('rect', { x: 42, y: 54, width: 16, height: 8, rx: R.sm, fill: METAL_OUT }),
      el('rect', { x: 32, y: 14, width: 36, height: 40, rx: R.md, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('circle', { cx: 50, cy: 33, r: 11, fill: SUNKEN, stroke: a, 'stroke-width': 3.5 }),
      el('line', { x1: 50, y1: 33, x2: r2(50 + 8 * Math.cos(-0.9)), y2: r2(33 + 8 * Math.sin(-0.9)), stroke: INK, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      el('rect', { x: 45, y: 4, width: 10, height: 10, rx: R.sm, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 }),
    ],
  };
}

/** A level gauge: a glass tube with a scale and a float that rides on the liquid. */
export function sensorLevel(p: Paint): Drawn {
  const top = 10; const bottom = 90;
  const lv = p.level === null ? 0 : Math.min(1, p.level);
  const y = r2(bottom - lv * (bottom - top));
  return {
    w: 100, h: 100,
    nodes: [
      el('rect', { x: 40, y: top, width: 20, height: bottom - top, rx: 6, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      ...(lv > 0.005 ? [el('rect', { x: 42.5, y, width: 15, height: r2(bottom - y - 2.5), rx: 3, fill: p.fill, 'fill-opacity': LIQUID })] : []),
      ...(p.level !== null ? [el('rect', { x: 43, y: r2(Math.min(bottom - 8, y - 2)), width: 14, height: 6, rx: 3, fill: accent(p), stroke: BASE, 'stroke-width': 1 })] : []),
      shine(44, 18, 82),
      ...[0, 0.25, 0.5, 0.75, 1].map((f) => el('line', { x1: 64, y1: r2(bottom - f * (bottom - top)), x2: f % 0.5 === 0 ? 74 : 70, y2: r2(bottom - f * (bottom - top)), stroke: MUTED, 'stroke-width': 1.4 })),
    ],
  };
}

/** A circular settling basin in elevation: a low tank of water, a bridge across it, a centre pier and a scraper arm. */
export function basinClarifier(p: Paint): Drawn {
  const a = accent(p);
  // while it runs the scraper arm sweeps round the pier: seen from the side its tip travels from one side of the basin to the other
  const sweep = p.running && p.animate
    ? [el('animate', { attributeName: 'x2', values: '80;52;24;52;80', dur: '8s', repeatCount: 'indefinite' })]
    : undefined;
  return {
    w: 100, h: 100,
    nodes: [
      ...pipes(['M0 50 H10'], p, [[5, 50]]),
      el('rect', { x: 10, y: 42, width: 84, height: 48, rx: R.md, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('rect', { x: 12, y: 54, width: 80, height: 34, rx: R.md, fill: p.fill, 'fill-opacity': LIQUID }),
      el('line', { x1: 14, y1: 54.75, x2: 90, y2: 54.75, stroke: BASE, 'stroke-opacity': 0.6, 'stroke-width': 1.5 }),
      el('rect', { x: 44, y: 26, width: 16, height: 30, rx: R.sm, fill: METAL, stroke: METAL_OUT, 'stroke-width': 2.5 }),
      el('line', { x1: 8, y1: 26, x2: 96, y2: 26, stroke: METAL_OUT, 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
      el('line', { x1: 52, y1: 56, x2: 80, y2: 78, stroke: a, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, sweep),
      el('circle', { cx: 52, cy: 56, r: 5, fill: SURFACE, stroke: a, 'stroke-width': 3.5 }),
      shine(18, 62, 84),
    ],
  };
}
