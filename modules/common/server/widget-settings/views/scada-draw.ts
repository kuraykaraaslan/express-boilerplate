// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-draw.ts). Kept when kui-react cut its SCADA library; NB changes it itself (docs/phases/07-dashboard/33-scada-and-3d-protection.md, 33.1).
// Shared drawing helpers for the process symbols (pure, no React): the paint a symbol is drawn with, the metal / ink
// colours, the pipe and wire builders every connected symbol uses, and the fan / blade rotation. The symbol files
// (`scada-water.ts`, `scada-energy.ts`) build node trees from these; `scada-logic.ts` picks one and turns it.
//
// Every symbol lives in a box 100 units high whose connections sit on the centre lines (y = 50 for left / right,
// x = 50 for top / bottom), so symbols placed on neighbouring grid cells of the same height join without a gap.
// Nothing here uses gradients or ids: a shared `<defs>` would break the other symbols of a page when one card goes
// away. Shading is layered flat shapes.

import { el, polar, r2, type SvgNode } from './svg-node';
import type { rangesToBands } from './gauge-logic';
import type { SymbolStates } from './scada-states';

export type ScadaState = 'idle' | 'running' | 'warning' | 'critical';

/** What every symbol is drawn with: the state, the reading and the colours resolved from the settings. */
export interface Paint {
  state: ScadaState;
  /** The state's colour (idle: the idle colour). */
  color: string;
  idle: string;
  running: boolean;
  animate: boolean;
  /** The first reading as a share of the scale (0..1), or null with no reading. */
  level: number | null;
  /** The liquid / charge colour. */
  fill: string;
  bands: ReturnType<typeof rangesToBands>;
  min: number;
  max: number;
  value: number | null;
  /** The second reading (a two-row meter), or null. */
  value2: number | null;
  ticks: boolean;
  /** The colour of what flows in a pipe (cold, hot, water, custom), or null for "the state decides". */
  medium: string | null;
  /**
   * Words a number for the symbol's own display (the unit included when the format says so). `'value2'`: the number is the second reading, another quantity
   * (an EC beside a moisture, T2 beside T1, a set-point beside a temperature), which the scene words without the first reading's unit and decimals.
   */
  fmt: (n: number, field?: 'value2') => string;
  /** Row names of the two-row meter. */
  rows: [string, string];
  /** How many cells long a straight pipe or wire is (1 to 3). */
  length: number;
  /** Draw flow-direction arrows on straight runs and on connections. */
  arrows: boolean;
  /** Mode, data quality, speed, direction, alarm acknowledgement, opening, command in flight (`scada-states.ts`). Always set by `scadaPaint`. */
  states?: SymbolStates;
}

export interface Drawn {
  nodes: SvgNode[];
  w: number;
  h: number;
}

// ─── The style every symbol shares (SCADA_STYLE.md) ──────────────────────────
// One pen: three line weights, three corner radii, one steel, one rule for where the state shows. `harmonize` snaps
// whatever a drawing asks for to this scale, and tests/scada-style.test.ts fails on anything outside it.

/** The line weights: a hairline (ticks), a detail line, a silhouette, a strong active line, a bold part. */
export const W = { hair: 1, detail: 1.5, out: 2.5, active: 3.5, bold: 5 } as const;
/** The corner radii of rectangles: small parts, housings, big cabinets. A pill (a radius of half the side) stays a pill. */
export const R = { sm: 3, md: 6, lg: 10 } as const;

const WEIGHTS: number[] = [W.hair, W.detail, W.out, W.active, W.bold];
const snapWeight = (w: number): number => (w <= 1.25 ? W.hair : w <= 2 ? W.detail : w <= 3 ? W.out : w <= 4 ? W.active : W.bold);
const snapRadius = (r: number): number => (r <= 4.5 ? R.sm : r <= 8 ? R.md : R.lg);

/**
 * Snaps the line weights (below 8: pipe walls, flows and hoses are wider and stay) and the rectangle radii of a tree to
 * the style scale. A pill (a radius of half its shortest side or more) and a circle are left alone.
 */
export function harmonize(nodes: SvgNode[]): SvgNode[] {
  return nodes.map((n) => {
    let a = n.a;
    if (a) {
      const next: Record<string, string | number> = { ...a };
      const sw = a['stroke-width'];
      if (typeof sw === 'number' && sw < 8) next['stroke-width'] = snapWeight(sw);
      if (n.t === 'rect' && typeof a.rx === 'number' && typeof a.width === 'number' && typeof a.height === 'number') {
        const half = Math.min(a.width, a.height) / 2;
        if (a.rx < half - 0.5) next.rx = Math.min(snapRadius(a.rx), half);
      }
      a = next;
    }
    return { ...n, ...(a ? { a } : {}), ...(n.c ? { c: harmonize(n.c) } : {}) };
  });
}

/** Whether a number is on the weight scale (for tests and tools). */
export const isWeight = (w: number): boolean => w >= 8 || WEIGHTS.includes(w);

export const METAL_OUT = 'var(--border-strong)';
/** How strongly any liquid (water, coating, mud, spray) shows: the same in every vessel. */
export const LIQUID = 0.6;
/** Hard steel (rams, coils, solenoid bodies): one tone everywhere. */
export const STEEL = { fill: 'var(--text-secondary)', 'fill-opacity': 0.8 } as const;
export const METAL = 'var(--surface-sunken)';
export const SURFACE = 'var(--surface-raised)';
export const BASE = 'var(--surface-base)';
export const INK = 'var(--text-primary)';
export const MUTED = 'var(--text-secondary)';

/** The colour of a part that shows the state: muted while idle. */
export const accent = (p: Paint): string => (p.state === 'idle' ? MUTED : p.color);

/** How much of a drawing rule's colour a housing takes (SCADA_STYLE.md 5a): enough to read across a plan, light enough for its parts. */
export const RULE_TINT = 35;

/**
 * A drawing rule's colour over a whole symbol (SCADA_STYLE.md 5a; next-boilerplate UI test 3 #16, #58, #121, #217: a rule's red reached only
 * a dock light, a needle or a rack's few lit marks). Every housing (`SURFACE`) takes a tint of the colour and every silhouette (a `METAL_OUT`
 * `INK` or `MUTED` stroke of `W.out` or more: a housing's outline, a cable's jacket, a wire, a single-line symbol's lines) the colour itself; the inner lines,
 * metal parts, steel, liquids and readouts keep theirs, and the lit parts already take the colour as their accent. One pass over the drawn
 * tree, the same for every symbol of the library.
 */
export function tinted(nodes: SvgNode[], color: string): SvgNode[] {
  const body = `color-mix(in srgb, ${color} ${RULE_TINT}%, ${SURFACE})`;
  return nodes.map((n) => {
    let a = n.a;
    const sw = a?.['stroke-width'];
    const silhouette = !!a && (a.stroke === METAL_OUT || a.stroke === INK || a.stroke === MUTED) && typeof sw === 'number' && sw >= W.out;
    if (a && (a.fill === SURFACE || silhouette)) {
      a = { ...a };
      if (a.fill === SURFACE) a.fill = body;
      if (silhouette) a.stroke = color;
    }
    return { ...n, ...(a ? { a } : {}), ...(n.c ? { c: tinted(n.c, color) } : {}) };
  });
}

/** Whether the part is in a warning or an alarm (the state shows even when nothing else of the symbol is lit). */
export const alarming = (p: Paint): boolean => p.state === 'warning' || p.state === 'critical';

/**
 * A signal lamp that appears only in a warning or an alarm, for a symbol whose other state parts are lit by a reading (a liquid, a
 * bar, a needle) and so show nothing when that reading is empty. Idle and running pictures do not have it.
 */
export const alarmLamp = (cx: number, cy: number, p: Paint, r = 3.5): SvgNode[] =>
  (alarming(p) ? [el('circle', { cx, cy, r, fill: p.color, stroke: BASE, 'stroke-width': 1.5 })] : []);

/**
 * How far open a valve, damper or door is, 0 to 1: fully open while it runs or as far as its `position` reading says,
 * whichever is larger (the 3D items read the two keys the same way). A symbol with neither reads 0, so its idle picture
 * is the shut one.
 */
export const opening = (p: Paint): number => Math.min(1, Math.max(p.running ? 1 : 0, (p.states?.position ?? 0) / 100));

/** The pipe walls and the flow: how thick, in box units (a cell is 100 high). */
export const PIPE_WALL = 28;
export const PIPE_BODY = 24;

/** What runs in the pipe: a warning or an alarm shows its colour, else the medium, else the state when running. */
export function flowColor(p: Paint): string | null {
  if (p.state === 'warning' || p.state === 'critical') return p.color;
  return p.medium ?? (p.running ? p.color : null);
}

const flowCore = (d: string, p: Paint): SvgNode[] => {
  const color = flowColor(p);
  if (!color) return [];
  const moving = p.running && p.animate;
  return [el('path', {
    d, fill: 'none', stroke: color, 'stroke-width': 8, 'stroke-linecap': 'butt',
    'stroke-opacity': p.running ? 0.9 : 0.35,
    ...(p.running ? { 'stroke-dasharray': '14 8' } : {}),
  }, moving ? [el('animate', { attributeName: 'stroke-dashoffset', from: 22, to: 0, dur: '0.9s', repeatCount: 'indefinite' })] : undefined)];
};

/** A flow arrowhead at (x, y) pointing along `deg` (0 = right, 90 = down), `size` long. */
export function arrow(x: number, y: number, deg: number, size = 11, color: string = INK): SvgNode {
  const tip = polar(x, y, size / 2, deg);
  const l = polar(x, y, size / 2, deg + 150);
  const r = polar(x, y, size / 2, deg - 150);
  return el('polygon', { points: `${tip[0]},${tip[1]} ${l[0]},${l[1]} ${r[0]},${r[1]}`, fill: color, stroke: BASE, 'stroke-width': 1, 'stroke-linejoin': 'round' });
}

/** A coupling ring across a pipe at (x, y); `vertical` pipes get a ring that lies across them. */
export const ring = (x: number, y: number, vertical = false): SvgNode =>
  vertical
    ? el('rect', { x: r2(x - 17), y: r2(y - 4), width: 34, height: 8, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 })
    : el('rect', { x: r2(x - 4), y: r2(y - 17), width: 8, height: 34, rx: 2, fill: METAL, stroke: METAL_OUT, 'stroke-width': 1.5 });

/**
 * Pipes along the given paths: outline, body, a light highlight on straight horizontal ones, the flow, then the
 * rings. Outlines of all paths come first, so branches merge into one body at a tee or a cross.
 */
export function pipes(paths: string[], p: Paint, rings: Array<[number, number, boolean?]> = [], highlight?: { x1: number; x2: number; y: number }): SvgNode[] {
  return [
    ...paths.map((d) => el('path', { d, fill: 'none', stroke: METAL_OUT, 'stroke-width': PIPE_WALL, 'stroke-linejoin': 'round' })),
    ...paths.map((d) => el('path', { d, fill: 'none', stroke: METAL, 'stroke-width': PIPE_BODY, 'stroke-linejoin': 'round' })),
    ...(highlight ? [el('line', { x1: highlight.x1, y1: highlight.y, x2: highlight.x2, y2: highlight.y, stroke: BASE, 'stroke-opacity': 0.55, 'stroke-width': 3, 'stroke-linecap': 'round' })] : []),
    ...paths.flatMap((d) => flowCore(d, p)),
    ...rings.map(([x, y, v]) => ring(x, y, v === true)),
  ];
}

/** A wire along `d`: a thin dashed line that runs (moves) when it carries current. */
export function wire(d: string, p: Paint, terminals: Array<[number, number]> = []): SvgNode[] {
  const color = p.state === 'warning' || p.state === 'critical' ? p.color : p.medium ?? (p.running ? p.color : MUTED);
  const moving = p.running && p.animate;
  return [
    el('path', {
      d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-dasharray': '5 4', 'stroke-linecap': 'butt', 'stroke-linejoin': 'round',
      'stroke-opacity': p.running || p.medium ? 1 : 0.7,
    }, moving ? [el('animate', { attributeName: 'stroke-dashoffset', from: 9, to: 0, dur: '0.7s', repeatCount: 'indefinite' })] : undefined),
    ...terminals.map(([x, y]) => el('circle', { cx: x, cy: y, r: 4.5, fill: SURFACE, stroke: INK, 'stroke-width': 1.5 })),
  ];
}

/** `turning(cx, cy, seconds, children)`: children that spin about a point while the part runs. */
export function turning(cx: number, cy: number, seconds: number, p: Paint, children: SvgNode[]): SvgNode {
  return el('g', undefined, [
    ...children,
    ...(p.running && p.animate
      ? [el('animateTransform', { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `360 ${cx} ${cy}`, dur: `${seconds}s`, repeatCount: 'indefinite' })]
      : []),
  ]);
}

/** `blades(cx, cy, count, length, width, color)`: round-ended blades from the hub. */
export function blades(cx: number, cy: number, count: number, length: number, width: number, color: string, from = -90): SvgNode[] {
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = polar(cx, cy, length, from + (360 / count) * i);
    return el('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' });
  });
}

/** The power glyph (a ring with a gap at the top and a bar) centred at (cx, cy). */
export function powerGlyph(cx: number, cy: number, radius: number, color: string): SvgNode[] {
  const start = polar(cx, cy, radius, -55);
  const end = polar(cx, cy, radius, 235);
  return [
    el('path', { d: `M${start[0]} ${start[1]} A${radius} ${radius} 0 1 1 ${end[0]} ${end[1]}`, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
    el('line', { x1: cx, y1: r2(cy - radius - 1), x2: cx, y2: r2(cy - 1), stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
  ];
}

/** A pale vertical shine on a body, so a flat shape reads as round metal. */
export const shine = (x: number, y1: number, y2: number): SvgNode =>
  el('line', { x1: x, y1, x2: x, y2, stroke: BASE, 'stroke-opacity': 0.55, 'stroke-width': 3, 'stroke-linecap': 'round' });
