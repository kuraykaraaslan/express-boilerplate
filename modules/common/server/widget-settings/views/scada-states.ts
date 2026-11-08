// Vendored from kui-react f7db139: modules/app/WidgetKit/views/scada-states.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The states layer of the process symbols (pure, no React): what a symbol can be besides idle, running, warning and
// critical. A part can be in a mode (manual, local, in maintenance, locked out, simulated), its reading can be stale,
// bad or lost, it can run at a share of its nominal speed or turn the other way, an alarm can wait for an operator,
// a valve can sit part way open, and a command sent from the symbol can be pending or have failed.
//
// Nothing here is drawn per symbol. `drawScada` and the scene's connections call `applyStates` on whatever the symbol
// drew: animation is retimed and reversed by walking the node tree, the look is dimmed, and small badges sit in the
// corners of the box (mode top right, data quality or an unacknowledged alarm top left, a command in flight bottom
// right, the opening along the bottom). The states come from columns of the row (`mode`, `quality`, `speed`,
// `direction`, `ack`, `position`, `pending`, `failed`), from the `status` word of a single symbol widget, or from the
// effects of a scene rule. Every colour is a theme token and every weight is on the pen's scale.

import type { Paint } from './scada-draw';
import { BASE, INK, METAL_OUT, MUTED, SURFACE, W } from './scada-draw';
import { el, r2, text, type SvgNode } from './svg-node';

export const SYMBOL_MODES = ['auto', 'manual', 'local', 'maintenance', 'lockout', 'simulation'] as const;
export type SymbolMode = (typeof SYMBOL_MODES)[number];
export const SYMBOL_QUALITIES = ['good', 'stale', 'bad', 'offline'] as const;
export type SymbolQuality = (typeof SYMBOL_QUALITIES)[number];

/** Everything the layer knows about one symbol. The defaults are "nothing special": a symbol with them is drawn untouched. */
export interface SymbolStates {
  mode: SymbolMode;
  quality: SymbolQuality;
  /** The share of nominal speed in percent: 100 = as drawn, 50 = half, 0 = stalled (it holds its colour but stands still). */
  speed: number;
  /** Rotation and flow run the other way. */
  reverse: boolean;
  /** `false`: an alarm nobody has acknowledged yet. `true`: acknowledged. `null`: not reported. */
  ack: boolean | null;
  /** How far open a valve, damper or door is, 0 to 100, or null. */
  position: number | null;
  /** A command sent from this symbol has not been answered yet. */
  pending: boolean;
  /** The last command sent from this symbol failed. */
  failed: boolean;
}

export const DEFAULT_STATES: SymbolStates = { mode: 'auto', quality: 'good', speed: 100, reverse: false, ack: null, position: null, pending: false, failed: false };

/** The columns of a row (and the effects of a rule) that carry states. */
export const STATE_COLUMNS = ['mode', 'quality', 'speed', 'direction', 'ack', 'position', 'pending', 'failed'] as const;

const MODE_WORDS: Record<string, SymbolMode> = {
  auto: 'auto', automatic: 'auto', remote: 'auto', manual: 'manual', hand: 'manual', local: 'local',
  maintenance: 'maintenance', service: 'maintenance', repair: 'maintenance',
  lockout: 'lockout', locked: 'lockout', 'locked out': 'lockout', tagout: 'lockout', loto: 'lockout',
  simulation: 'simulation', simulated: 'simulation', sim: 'simulation', test: 'simulation',
};
const QUALITY_WORDS: Record<string, SymbolQuality> = {
  good: 'good', ok: 'good', valid: 'good', stale: 'stale', old: 'stale', outdated: 'stale',
  bad: 'bad', uncertain: 'bad', invalid: 'bad', offline: 'offline', lost: 'offline', unreachable: 'offline', 'no signal': 'offline', disconnected: 'offline',
};

const word = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export const parseMode = (v: unknown): SymbolMode | null => MODE_WORDS[word(v)] ?? null;
export const parseQuality = (v: unknown): SymbolQuality | null => QUALITY_WORDS[word(v)] ?? null;

const flag = (v: unknown): boolean | null => {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const t = word(v);
  if (['true', '1', 'yes', 'on', 'acked', 'acknowledged', 'ack'].includes(t)) return true;
  if (['false', '0', 'no', 'off', 'unacked', 'unacknowledged', 'new'].includes(t)) return false;
  return null;
};

const number = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(/%$/, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};

const REVERSE_WORDS = ['reverse', 'reversed', 'rev', 'backward', 'backwards', 'back', 'ccw', 'counterclockwise', 'negative', '-1'];

/**
 * The states a row (or any reader of named values) reports. `read(key)` returns the raw value of a column or undefined.
 * `status` is also looked at for a mode or quality word, so a single symbol widget (which has no more slots) can carry
 * `maintenance` or `stale` in its status.
 */
export function readStates(read: (key: string) => unknown): SymbolStates {
  const out: SymbolStates = { ...DEFAULT_STATES };
  const status = read('status');
  out.mode = parseMode(read('mode')) ?? parseMode(status) ?? 'auto';
  out.quality = parseQuality(read('quality')) ?? parseQuality(status) ?? 'good';
  const speed = number(read('speed'));
  if (speed !== null) {
    out.reverse = speed < 0;
    out.speed = Math.min(400, Math.abs(speed));
  }
  if (REVERSE_WORDS.includes(word(read('direction'))) || number(read('direction')) === -1) out.reverse = true;
  else if (['forward', 'fwd', 'cw', 'clockwise', 'normal', '1'].includes(word(read('direction'))) || number(read('direction')) === 1) out.reverse = false;
  out.ack = flag(read('ack'));
  const position = number(read('position'));
  out.position = position === null ? null : Math.min(100, Math.max(0, position));
  out.pending = flag(read('pending')) === true;
  out.failed = flag(read('failed')) === true;
  return out;
}

/** Whether anything differs from the defaults (the layer leaves a plain symbol alone). */
export const hasStates = (s: SymbolStates | undefined): s is SymbolStates =>
  !!s && (s.mode !== 'auto' || s.quality !== 'good' || s.speed !== 100 || s.reverse || s.ack !== null || s.position !== null || s.pending || s.failed);

/** A symbol that must not be operated: locked out. A host may refuse its commands. */
export const isLocked = (s: SymbolStates | undefined): boolean => !!s && s.mode === 'lockout';

// ── Retiming ─────────────────────────────────────────────────────────────────

const DUR = /^([0-9]*\.?[0-9]+)(s|ms)$/;

function scaleDur(dur: string, speed: number): string {
  const m = DUR.exec(dur);
  if (!m) return dur;
  const seconds = (m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1])) * (100 / speed);
  return `${r2(Math.min(120, Math.max(0.05, seconds)))}s`;
}

/**
 * The animation of a tree at another speed and, optionally, the other way round. Speed 0 removes every animation (the
 * part stands still but keeps its colour). Rotation and flow reverse; a back-and-forth motion (a piston, a flicker)
 * has no direction and only changes pace.
 */
export function retime(nodes: SvgNode[], speed: number, reverse: boolean): SvgNode[] {
  if (speed === 100 && !reverse) return nodes;
  const walk = (list: SvgNode[]): SvgNode[] => list.flatMap((n) => {
    if (n.t === 'animate' || n.t === 'animateTransform') {
      if (speed <= 0) return [];
      const a = { ...(n.a ?? {}) };
      if (typeof a.dur === 'string') a.dur = scaleDur(a.dur, speed);
      const flows = (n.t === 'animateTransform' && a.type === 'rotate') || (n.t === 'animate' && a.attributeName === 'stroke-dashoffset');
      if (reverse && flows && 'from' in a && 'to' in a) { const from = a.from; a.from = a.to; a.to = from; }
      return [{ ...n, a }];
    }
    return [n.c ? { ...n, c: walk(n.c) } : n];
  });
  return walk(nodes);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** How strongly a part shows through when its reading cannot be trusted. */
const QUALITY_OPACITY: Record<SymbolQuality, number> = { good: 1, stale: 0.7, bad: 0.55, offline: 0.35 };

const BADGE_R = 12;
const INFO = 'var(--info)';
const WARNING = 'var(--warning)';
const ERROR = 'var(--error)';

const badge = (cx: number, cy: number, ring: string, glyph: SvgNode[]): SvgNode[] => [
  el('circle', { cx: r2(cx), cy: r2(cy), r: BADGE_R, fill: SURFACE, stroke: ring, 'stroke-width': W.detail }),
  ...glyph,
];

const letter = (cx: number, cy: number, s: string, color: string): SvgNode =>
  text(r2(cx), r2(cy + 4.5), s, { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: color, 'font-family': 'inherit' });

const wrench = (cx: number, cy: number, color: string): SvgNode[] => [
  el('line', { x1: r2(cx - 5), y1: r2(cy + 5), x2: r2(cx + 2), y2: r2(cy - 2), stroke: color, 'stroke-width': W.out, 'stroke-linecap': 'round' }),
  el('circle', { cx: r2(cx + 4), cy: r2(cy - 4), r: 3.5, fill: 'none', stroke: color, 'stroke-width': W.detail }),
];

const padlock = (cx: number, cy: number, color: string): SvgNode[] => [
  el('path', { d: `M${r2(cx - 3)} ${r2(cy - 1)} v-3 a3 3 0 0 1 6 0 v3`, fill: 'none', stroke: color, 'stroke-width': W.detail, 'stroke-linecap': 'round' }),
  el('rect', { x: r2(cx - 5), y: r2(cy - 1), width: 10, height: 8, rx: 3, fill: color }),
];

const clock = (cx: number, cy: number, color: string): SvgNode[] => [
  el('circle', { cx: r2(cx), cy: r2(cy), r: 6.5, fill: 'none', stroke: color, 'stroke-width': W.detail }),
  el('path', { d: `M${r2(cx)} ${r2(cy - 4)} V${r2(cy)} L${r2(cx + 3)} ${r2(cy + 2)}`, fill: 'none', stroke: color, 'stroke-width': W.detail, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
];

const cross = (cx: number, cy: number, color: string): SvgNode[] => [
  el('line', { x1: r2(cx - 4), y1: r2(cy - 4), x2: r2(cx + 4), y2: r2(cy + 4), stroke: color, 'stroke-width': W.out, 'stroke-linecap': 'round' }),
  el('line', { x1: r2(cx + 4), y1: r2(cy - 4), x2: r2(cx - 4), y2: r2(cy + 4), stroke: color, 'stroke-width': W.out, 'stroke-linecap': 'round' }),
];

const bell = (cx: number, cy: number, color: string): SvgNode[] => [
  el('path', { d: `M${r2(cx - 5)} ${r2(cy + 3.5)} L${r2(cx + 5)} ${r2(cy + 3.5)} C${r2(cx + 3)} ${r2(cy + 2)} ${r2(cx + 3)} ${r2(cy - 1)} ${r2(cx + 3)} ${r2(cy - 2.5)} A3 3 0 0 0 ${r2(cx - 3)} ${r2(cy - 2.5)} C${r2(cx - 3)} ${r2(cy - 1)} ${r2(cx - 3)} ${r2(cy + 2)} ${r2(cx - 5)} ${r2(cy + 3.5)} Z`, fill: color }),
  el('circle', { cx: r2(cx), cy: r2(cy + 6), r: 1.6, fill: color }),
];

function modeBadge(mode: SymbolMode, cx: number, cy: number): SvgNode[] {
  if (mode === 'manual') return badge(cx, cy, INFO, [letter(cx, cy, 'M', INFO)]);
  if (mode === 'local') return badge(cx, cy, INFO, [letter(cx, cy, 'L', INFO)]);
  if (mode === 'simulation') return badge(cx, cy, INFO, [letter(cx, cy, 'S', INFO)]);
  if (mode === 'maintenance') return badge(cx, cy, WARNING, wrench(cx, cy, WARNING));
  if (mode === 'lockout') return badge(cx, cy, INK, padlock(cx, cy, INK));
  return [];
}

function qualityBadge(q: SymbolQuality, cx: number, cy: number): SvgNode[] {
  if (q === 'stale') return badge(cx, cy, MUTED, clock(cx, cy, MUTED));
  if (q === 'bad') return badge(cx, cy, MUTED, [letter(cx, cy, '?', MUTED)]);
  if (q === 'offline') return badge(cx, cy, ERROR, cross(cx, cy, ERROR));
  return [];
}

function pendingBadge(cx: number, cy: number, animate: boolean): SvgNode[] {
  const arc = el('path', { d: `M${r2(cx)} ${r2(cy - 6)} A6 6 0 1 1 ${r2(cx - 6)} ${r2(cy)}`, fill: 'none', stroke: INFO, 'stroke-width': W.out, 'stroke-linecap': 'round' },
    animate ? [el('animateTransform', { attributeName: 'transform', type: 'rotate', from: `0 ${r2(cx)} ${r2(cy)}`, to: `360 ${r2(cx)} ${r2(cy)}`, dur: '0.9s', repeatCount: 'indefinite' })] : undefined);
  return badge(cx, cy, INFO, [el('circle', { cx: r2(cx), cy: r2(cy), r: 6, fill: 'none', stroke: METAL_OUT, 'stroke-width': W.detail }), arc]);
}

function failedBadge(cx: number, cy: number): SvgNode[] {
  return [
    el('circle', { cx: r2(cx), cy: r2(cy), r: BADGE_R, fill: ERROR, stroke: SURFACE, 'stroke-width': W.detail }),
    text(r2(cx), r2(cy + 5), '!', { 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: BASE, 'font-family': 'inherit' }),
  ];
}

/** The opening along the bottom of the box: a track with a fill as long as the part is open. */
function positionBar(w: number, h: number, position: number, color: string): SvgNode[] {
  const width = Math.max(30, w * 0.6);
  const x = r2((w - width) / 2);
  const y = r2(h - 11);
  return [
    el('rect', { x, y, width: r2(width), height: 8, rx: 4, fill: SURFACE, stroke: METAL_OUT, 'stroke-width': W.hair }),
    ...(position > 0 ? [el('rect', { x: r2(x + 1.5), y: r2(y + 1.5), width: r2(Math.max(5, (width - 3) * (position / 100))), height: 5, rx: 2.5, fill: color })] : []),
  ];
}

/**
 * A drawing with the states layer on it. `badges` is false for straight runs (pipes, hoses, cables, wires, strip): they
 * only follow the speed, the direction and the dimming. `w` x `h` is the box the drawing sits in.
 */
export function applyStates(nodes: SvgNode[], w: number, h: number, paint: Paint, badges = true): SvgNode[] {
  const s = paint.states;
  if (!hasStates(s)) return nodes;
  let body = retime(nodes, s.speed, s.reverse);
  const opacity = QUALITY_OPACITY[s.quality];
  if (opacity < 1) body = [el('g', { opacity }, body)];
  if (!badges) return body;
  const out = [...body];
  const alarm = (paint.state === 'warning' || paint.state === 'critical');
  // An alarm nobody has acknowledged pulses a ring around the part; acknowledged, it simply stays coloured.
  const unacked = alarm && s.ack === false;
  if (unacked) {
    out.push(el('rect', { x: 2, y: 2, width: r2(w - 4), height: r2(h - 4), rx: 6, fill: 'none', stroke: paint.color, 'stroke-width': W.out, opacity: paint.animate ? 1 : 0.85 },
      paint.animate ? [el('animate', { attributeName: 'opacity', values: '1;0.15;1', dur: '1s', repeatCount: 'indefinite' })] : undefined));
  }
  // Data that cannot be trusted gets a dashed frame.
  if (s.quality !== 'good') {
    out.push(el('rect', { x: 1, y: 1, width: r2(w - 2), height: r2(h - 2), rx: 6, fill: 'none', stroke: MUTED, 'stroke-width': W.detail, 'stroke-dasharray': '4 4' }));
  }
  out.push(...modeBadge(s.mode, w - BADGE_R - 2, BADGE_R + 2));
  const topLeft = s.quality !== 'good' ? qualityBadge(s.quality, BADGE_R + 2, BADGE_R + 2) : unacked ? badge(BADGE_R + 2, BADGE_R + 2, paint.color, bell(BADGE_R + 2, BADGE_R + 2, paint.color)) : [];
  out.push(...topLeft);
  if (s.failed) out.push(...failedBadge(w - BADGE_R - 2, h - BADGE_R - 2));
  else if (s.pending) out.push(...pendingBadge(w - BADGE_R - 2, h - BADGE_R - 2, paint.animate));
  if (s.position !== null) out.push(...positionBar(w, h, s.position, alarm ? paint.color : paint.state === 'running' ? paint.color : MUTED));
  return out;
}

/** The states a rule effect forces over what the row reported (only the keys the rule set). */
export function mergeStates(base: SymbolStates | undefined, fx: Partial<SymbolStates>): SymbolStates {
  return { ...(base ?? DEFAULT_STATES), ...Object.fromEntries(Object.entries(fx).filter(([, v]) => v !== undefined)) } as SymbolStates;
}
