// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/views/scada-scene-logic.ts). Kept when kui-react cut its SCADA library; NB changes it itself (docs/phases/07-dashboard/33-scada-and-3d-protection.md, 33.1).
// The pure logic of the process scene (no React): a canvas of process symbols placed by coordinates, joined by pipes,
// hoses, cables, signal wires and strip lines that route themselves between the symbols' ports. One bound table feeds
// every symbol and link: a row per `id` with the columns `value`, `value2`, `running`, `status`, `warning`, `critical`,
// `label` and `capacity`. The scene is an SVG node tree; `ScadaSceneView.tsx` draws it and kui-ejs vendors this file.
//
// Coordinates are scene units (the canvas is `width` x `height`). A symbol is drawn at `scale` (the scene's, times its
// own); every connection has the thickness of a symbol port at that scale, so a pipe leaving a pump matches it.

import type { SlotData } from '../kind';
import { arrow, flowColor, INK, MUTED, pipes, tinted, wire, type Paint, type ScadaState } from './scada-draw';
import { cablePath, hosePath, strip } from './scada-line';
import {
  canonicalSymbol, drawScada, isScadaSymbol, SCADA_SYMBOL_DEFS, scadaPaint, type ScadaSettings, type ScadaSymbol, type SymbolDef,
} from './scada-logic';
import { applyStates, isLocked, mergeStates, STATE_COLUMNS, type SymbolStates } from './scada-states';
import { evaluateRules, type SceneEffects, type RuleState } from './scene-rules-logic';
import { cssColor } from '../settings/style';
import { el, r2, text, type SvgNode } from './svg-node';
import {
  isScenePatch, exactTurn, patchEffects, patchLinks, patchProblems, patchShapes, patchView, placementEffects, readThings, splitRulesForThings,
  type SceneEffectsPlus, type SceneModelPatch, type SceneThingsSettings,
} from './scada-scene-things';

export {
  MAX_SCENE_THINGS, THINGS_TARGET, readThings, splitRulesForThings, patchEffects, patchView,
  type SceneModelPatch, type SceneThing, type SceneThingsSettings, type SceneEffectsPlus,
} from './scada-scene-things';

export type SceneLinkKind = 'pipe' | 'hose' | 'cable' | 'wire' | 'strip' | 'line' | 'sld';
export type SceneSide = 'l' | 'r' | 't' | 'b';

export type SceneElementSetting = {
  id?: string;
  symbol?: string;
  x?: number;
  y?: number;
  turn?: number | string;
  mirror?: boolean;
  length?: number | string;
  scale?: number | null;
  label?: string;
  medium?: string;
  mediumColor?: string;
  min?: number | null;
  max?: number | null;
  showValue?: boolean;
  /** Where the name sits: under the symbol (default), above it, or nowhere. */
  labelPos?: 'b' | 't' | 'n';
  /** Where the number of a level or dial sits: under the symbol (default) or beside it. */
  valuePos?: 'b' | 'r';
  /** Own colours and number words; empty = the scene's or the symbol's default. */
  fillColor?: string;
  idleColor?: string;
  runningColor?: string;
  warningColor?: string;
  criticalColor?: string;
  unit?: string;
  decimals?: number | null;
};

/** A drawing on the canvas that is not a process symbol: a title, a zone outline, a divider. Never takes a reading. */
export type SceneShapeSetting = {
  kind?: 'text' | 'zone' | 'divider' | string;
  /** text: the anchor point; zone and divider: the top-left corner. Scene units. */
  x?: number;
  y?: number;
  /** zone and divider: the size (a divider with a height of 0 or less is horizontal, with a width of 0 or less vertical). */
  w?: number;
  h?: number;
  /** text: the words; zone: its title. */
  text?: string;
  size?: 's' | 'm' | 'l';
  align?: 'start' | 'middle' | 'end';
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  dashed?: boolean;
};

export type SceneLinkSetting = {
  id?: string;
  from?: string;
  to?: string;
  kind?: SceneLinkKind | string;
  medium?: string;
  mediumColor?: string;
  mid?: number | null;
  arrows?: boolean;
};

export type SceneSettings = SceneThingsSettings & {
  width?: number;
  height?: number;
  scale?: number;
  background?: 'none' | 'dots' | 'panel';
  /** What an element's x and y mean: its centre (default) or its top-left corner. */
  anchor?: 'center' | 'corner';
  /** The view: the content with a margin (default), or the whole canvas. */
  fit?: 'content' | 'canvas';
  showLabels?: boolean;
  idColumn?: string;
  elements?: unknown;
  links?: unknown;
  shapes?: unknown;
  /** ISA-101 style: running parts are not green, only a warning or an alarm draws in colour. */
  calm?: boolean;
  animation?: boolean;
  idleColor?: string;
  runningColor?: string;
  warningColor?: string;
  criticalColor?: string;
  /** Data-driven rules (`scene-rules-logic.ts`). */
  rules?: unknown;
};

/** The height of a label line and the margin around the content, in scene units. */
const LABEL = 16;
const MARGIN = 20;
/** A label's letters: 14 units high, about 0.56 of that wide on average (the titles' estimate). */
const LABEL_SIZE = 14;
const LABEL_CHAR = LABEL_SIZE * 0.56;
/** The most lines a name wraps to; the last one ends in "…" when more is left. */
const LABEL_LINES = 3;
/** The space kept between a label and what stands beside it. */
const LABEL_GAP = 6;

/** One symbol's name and number under (or over) it, before the labels are laid out against their neighbours. */
export interface SceneLabelSpec {
  /** The symbol's box. */
  x: number; y: number; w: number; h: number;
  /** Its name ('' for none) and where it sits. */
  name: string;
  above: boolean;
  /** The number printed under the name, or beside the symbol. */
  value: { text: string; beside: boolean } | null;
}

/** The estimated width of a label line. */
export const labelWidth = (line: string): number => line.length * LABEL_CHAR;

/** A text in lines of at most `chars` characters, broken between words; a word longer than a line is cut with "…", as is a last line with more left. */
export function wrapLabel(text: string, chars: number, lines = LABEL_LINES): string[] {
  const max = Math.max(3, Math.floor(chars));
  const cut = (w: string) => (w.length > max ? `${w.slice(0, max - 1)}…` : w);
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i += 1) {
    const w = words[i]!;
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= max) { line = `${line} ${w}`; continue; }
    out.push(cut(line));
    line = w;
    if (out.length === lines) break;
  }
  if (out.length < lines) { if (line) out.push(cut(line)); return out; }
  // more words than lines: the last line says so, cut between words where it can be
  const last = out[lines - 1]!;
  const space = last.lastIndexOf(' ');
  out[lines - 1] = last.endsWith('…') ? last : `${last.length + 1 <= max ? last : space > 0 ? last.slice(0, space) : last.slice(0, max - 1)}…`;
  return out;
}

/**
 * The names and numbers of a scene's symbols, laid out (phase 52.5.3, UI test 3 #58 label half, with D574 of phase 39 slice 39.19): a name is centred
 * on its symbol and keeps to the room it has, so a long one (a rule's label, up to 80 characters) never runs over its neighbour. The room is how far
 * the symbol's centre is from the nearest symbol standing beside the label's line (its box, or half the way to a neighbour whose own label shares the
 * line), less a small gap; a name wider than that wraps between words, at most three lines, and the number goes under its last line. A name with no
 * neighbour beside it keeps one line. Each laid-out label says how far it reaches (`grow`), so the view's frame holds it (#223: names at the drawing's
 * edges were cut). Pure.
 */
export function layoutLabels(specs: readonly SceneLabelSpec[]): { nodes: SvgNode[]; extents: Array<{ x0: number; y0: number; x1: number; y1: number }> } {
  const nodes: SvgNode[] = [];
  const extents: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const bandOf = (sp: SceneLabelSpec): [number, number] => (sp.above ? [sp.y - LABEL - 2, sp.y] : [sp.y + sp.h, sp.y + sp.h + LABEL + 2]);
  const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
  for (const sp of specs) {
    const cx = sp.x + sp.w / 2;
    let room = Infinity;
    if (sp.name) {
      const band = bandOf(sp);
      for (const o of specs) {
        if (o === sp) continue;
        const ocx = o.x + o.w / 2;
        const right = ocx >= cx;
        // a symbol standing beside the label's line: up to its box
        if (overlaps(band, [o.y, o.y + o.h])) {
          const d = right ? o.x - cx : cx - (o.x + o.w);
          if (d >= 0) room = Math.min(room, d - LABEL_GAP);
        }
        // a neighbour whose own name shares the line: half the way
        if (o.name && overlaps(band, bandOf(o))) room = Math.min(room, Math.abs(ocx - cx) / 2 - LABEL_GAP / 2);
      }
    }
    // a label may always be as wide as its own symbol
    const half = Math.max(sp.w / 2, room);
    const lines = !sp.name ? [] : labelWidth(sp.name) / 2 <= half ? [sp.name] : wrapLabel(sp.name, (half * 2) / LABEL_CHAR);
    let ty = sp.y + sp.h + LABEL_SIZE;
    lines.forEach((line, i) => {
      const y = sp.above ? sp.y - 7 - (lines.length - 1 - i) * LABEL : ty;
      nodes.push(text(r2(cx), r2(y), line, { 'text-anchor': 'middle', 'font-size': LABEL_SIZE, fill: MUTED, 'font-family': 'inherit' }));
      const wide = labelWidth(line) / 2;
      extents.push({ x0: cx - wide, y0: y - LABEL_SIZE, x1: cx + wide, y1: y + 4 });
      if (!sp.above) ty += LABEL;
    });
    if (sp.value) {
      const beside = sp.value.beside;
      const vx = beside ? sp.x + sp.w + 8 : cx;
      const vy = beside ? sp.y + sp.h / 2 + 5 : ty;
      nodes.push(text(r2(vx), r2(vy), sp.value.text, { 'text-anchor': beside ? 'start' : 'middle', 'font-size': LABEL_SIZE, 'font-weight': 600, fill: INK, 'font-family': 'inherit' }));
      const wide = labelWidth(sp.value.text);
      extents.push(beside ? { x0: vx, y0: vy - LABEL_SIZE, x1: vx + wide, y1: vy + 4 } : { x0: vx - wide / 2, y0: vy - LABEL_SIZE, x1: vx + wide / 2, y1: vy + 4 });
    }
  }
  return { nodes, extents };
}

export const MAX_SCENE_ELEMENTS = 200;
export const MAX_SCENE_LINKS = 300;
export const SCENE_COLUMNS = ['value', 'value2', 'running', 'status', 'warning', 'critical', 'label', 'capacity', ...STATE_COLUMNS] as const;

type Row = Record<string, unknown>;
type Pt = { x: number; y: number };
const DIR: Record<SceneSide, Pt> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } };

/** One row of the table as the slots a symbol reads. A missing column is a missing slot, never a zero. */
export function rowSlots(row: Row | undefined): Record<string, SlotData> {
  const out: Record<string, SlotData> = {};
  if (!row) return out;
  for (const key of SCENE_COLUMNS) {
    if (!Object.hasOwn(row, key)) continue;
    const v = row[key];
    out[key] = { shape: 'scalar', value: v === undefined ? null : (v as number | string | boolean | null) };
  }
  return out;
}

/** The rows of the bound table by id. */
export function rowsById(slot: SlotData | undefined, idColumn = 'id'): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of slot?.rows ?? []) {
    const id = row[idColumn];
    if (id !== null && id !== undefined && id !== '' && !map.has(String(id))) map.set(String(id), row);
  }
  return map;
}

const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A placed symbol: where it is on the canvas, how big, and its drawing. */
export interface PlacedElement {
  id: string;
  symbol: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The scale it is drawn at (scene scale times its own). */
  k: number;
  /** Placed from a row of the `things` slot (or of a scene patch), not authored (35.3, E5). */
  from?: 'things';
}

/** `pump1.r`, `tank:b` or `pump1.t:0.26` (a fraction along the edge): an element, a side and where on it. */
export function parsePort(ref: unknown): { id: string; side: SceneSide; at: number } | null {
  if (typeof ref !== 'string') return null;
  const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*?)[.:]([lrtb])(?::(\d*\.?\d+))?\s*$/.exec(ref);
  if (!m) return null;
  const at = m[3] === undefined ? 0.5 : Math.min(1, Math.max(0, Number(m[3])));
  return { id: m[1], side: m[2] as SceneSide, at };
}

/** The point of a port on its element's box edge. */
export function portPoint(box: PlacedElement, side: SceneSide, at: number): Pt {
  if (side === 'l') return { x: box.x, y: r2(box.y + at * box.h) };
  if (side === 'r') return { x: r2(box.x + box.w), y: r2(box.y + at * box.h) };
  if (side === 't') return { x: r2(box.x + at * box.w), y: box.y };
  return { x: r2(box.x + at * box.w), y: r2(box.y + box.h) };
}

const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** Drops repeated points and the middle point of three on one line. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (out.length && same(out[out.length - 1], p)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i -= 1) {
    const a = out[i - 1]; const b = out[i]; const c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(i, 1);
  }
  return out;
}

/**
 * The route between two ports: out of each port by `stub`, then horizontal and vertical legs only. Two horizontal ports
 * meet in a Z through `mid` (an x), two vertical ones through `mid` (a y), a horizontal and a vertical one in an L.
 */
export function routeLink(a: Pt, sideA: SceneSide, b: Pt, sideB: SceneSide, mid?: number | null, stub = 16): Pt[] {
  const da = DIR[sideA]; const db = DIR[sideB];
  const as = { x: a.x + da.x * stub, y: a.y + da.y * stub };
  const bs = { x: b.x + db.x * stub, y: b.y + db.y * stub };
  const ha = sideA === 'l' || sideA === 'r';
  const hb = sideB === 'l' || sideB === 'r';
  let inner: Pt[];
  if (ha && hb) {
    const mx = typeof mid === 'number' ? mid : (as.x + bs.x) / 2;
    inner = [as, { x: mx, y: as.y }, { x: mx, y: bs.y }, bs];
  } else if (!ha && !hb) {
    const my = typeof mid === 'number' ? mid : (as.y + bs.y) / 2;
    inner = [as, { x: as.x, y: my }, { x: bs.x, y: my }, bs];
  } else if (ha) {
    inner = [as, { x: bs.x, y: as.y }, bs];
  } else {
    inner = [as, { x: as.x, y: bs.y }, bs];
  }
  return simplify([a, ...inner, b]);
}

/** A polyline as a path with rounded corners of at most `radius`. */
export function roundedPath(points: Pt[], radius: number): string {
  if (points.length < 2) return '';
  let d = `M${r2(points[0].x)} ${r2(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i]; const prev = points[i - 1]; const next = points[i + 1];
    const l1 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const l2 = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const s = { x: p.x + ((prev.x - p.x) / l1) * r, y: p.y + ((prev.y - p.y) / l1) * r };
    const e = { x: p.x + ((next.x - p.x) / l2) * r, y: p.y + ((next.y - p.y) / l2) * r };
    d += ` L${r2(s.x)} ${r2(s.y)} Q${r2(p.x)} ${r2(p.y)} ${r2(e.x)} ${r2(e.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${r2(last.x)} ${r2(last.y)}`;
}

/** The middle of the longest leg and its direction in degrees: where a flow arrow sits. */
export function arrowSpot(points: Pt[]): { x: number; y: number; deg: number } | null {
  let best = -1; let spot: { x: number; y: number; deg: number } | null = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]; const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) { best = len; spot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }; }
  }
  return spot;
}

const LINK_KINDS: ReadonlySet<string> = new Set(['pipe', 'hose', 'cable', 'wire', 'strip', 'line', 'sld']);
export const MAX_SCENE_SHAPES = 100;

const TONE: Record<string, string> = { neutral: 'var(--border-strong)', info: 'var(--info)', success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)' };
const TEXT_SIZE: Record<string, number> = { s: 12, m: 15, l: 22 };

/** The nodes of one connection along `points` (scene units), drawn at scale `k`. */
export function linkNodes(kind: SceneLinkKind, points: Pt[], paint: Paint, k: number, radius = 14): SvgNode[] {
  const unit = points.map((p) => ({ x: p.x / k, y: p.y / k }));
  const d = roundedPath(unit, radius / k);
  const first = unit[0]; const last = unit[unit.length - 1];
  const ends: Array<[number, number, boolean]> = [];
  const along = (from: Pt, to: Pt, inset: number): [number, number, boolean] => {
    const dx = to.x - from.x; const dy = to.y - from.y; const len = Math.hypot(dx, dy) || 1;
    return [r2(from.x + (dx / len) * inset), r2(from.y + (dy / len) * inset), Math.abs(dy) > Math.abs(dx)];
  };
  if (unit.length >= 2) {
    ends.push(along(first, unit[1], 6), along(last, unit[unit.length - 2], 6));
  }
  let inner: SvgNode[];
  if (kind === 'pipe') inner = pipes([d], paint, []);
  else if (kind === 'hose') inner = hosePath(d, paint, ends);
  else if (kind === 'cable') inner = cablePath(d, paint, ends.map(([x, y, v]) => [x, y, v]));
  else if (kind === 'wire') inner = wire(d, paint, [[first.x, first.y], [last.x, last.y]]);
  else if (kind === 'strip') inner = strip(d, paint);
  else if (kind === 'sld') inner = [el('path', { d, fill: 'none', stroke: paint.state === 'idle' ? INK : paint.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt' })];
  else inner = [el('path', { d, fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })];
  const spot = arrowSpot(unit);
  if (spot && (kind === 'line' || paint.arrows)) inner.push(arrow(spot.x, spot.y, spot.deg, kind === 'line' ? 13 : 11, kind === 'pipe' || kind === 'hose' ? flowColor(paint) ?? INK : INK));
  return [el('g', { transform: `scale(${r2(k * 1000) / 1000})` }, applyStates(inner, 0, 0, paint, false))];
}

/** The settings a symbol draws with, from the scene's colours, one element's own choices and what the rules decided. */
function symbolSettings(scene: SceneSettings, e: SceneElementSetting, link?: SceneLinkSetting, fx: SceneEffects = {}): ScadaSettings {
  return {
    symbol: e.symbol,
    length: e.length,
    min: typeof e.min === 'number' ? e.min : undefined,
    max: typeof e.max === 'number' ? e.max : undefined,
    // An `off` part carries nothing.
    medium: fx.state === 'off' ? 'none' : fx.medium ?? link?.medium ?? e.medium,
    mediumColor: link?.mediumColor ?? e.mediumColor,
    arrows: link?.arrows === true,
    animation: fx.animate === false ? false : scene.animation,
    fillColor: e.fillColor || undefined,
    idleColor: e.idleColor || scene.idleColor,
    runningColor: e.runningColor || (scene.calm === true ? 'var(--text-primary)' : scene.runningColor),
    warningColor: e.warningColor || scene.warningColor,
    criticalColor: e.criticalColor || scene.criticalColor,
  };
}

/** How much a passive (dimmed) part shows through. */
export const DIM_OPACITY = 0.4;

const slot = (value: SlotData['value']): SlotData => ({ shape: 'scalar', value });

/** The slots a symbol reads with a state the rules forced: the alarm columns are replaced, the table is not touched. */
function withState(slots: Record<string, SlotData>, state: RuleState): Record<string, SlotData> {
  const out = { ...slots };
  if (state === 'running') out.running = slot(true);
  else if (state === 'idle' || state === 'off') out.running = slot(false);
  out.status = slot(state === 'warning' || state === 'critical' ? state : null);
  out.warning = slot(false);
  out.critical = slot(false);
  return out;
}

/**
 * The accent replaces the state colour (and the liquid's, in an alarm); `fillColor` replaces the liquid's. Symbols draw
 * an idle part in the muted ink, so an accent, or an idle colour that is not the default, makes it a coloured part that
 * does not move (state `running`, `running` flag unchanged). A rule's own colour (`fx.color`) also colours the symbol's
 * body: `place` draws it through `tinted` (SCADA_STYLE.md 5a), housings tinted and silhouettes in the colour, so a rule's
 * red reads on any symbol, not only on its lit parts (UI test 3 #16, #58, #121, #217).
 */
function withColors(base: Paint, fx: SceneEffects): Paint {
  const paint = withStates(base, fx);
  const idle = paint.state === 'idle';
  const accent = fx.color ?? (idle && paint.idle !== MUTED ? paint.idle : undefined);
  if (!accent && !fx.fillColor) return paint;
  const alarm = paint.state === 'warning' || paint.state === 'critical';
  return { ...paint, state: accent && idle ? 'running' : paint.state, color: accent ?? paint.color, fill: fx.fillColor ?? (fx.color && alarm ? fx.color : paint.fill) };
}

/** The states the rules forced, over what the row reported. */
function withStates(paint: Paint, fx: SceneEffects): Paint {
  const forced: Partial<SymbolStates> = {};
  // A lockout is one-way (kui-react 47503e2): a rule or a scene patch may impose one, but never lift the one the row reports
  // (LOTO is set on the equipment, not drawn by a script), so the symbol keeps its padlock and its gestures stay off.
  if (fx.mode !== undefined && !(isLocked(paint.states) && fx.mode !== 'lockout')) forced.mode = fx.mode;
  if (fx.quality !== undefined) forced.quality = fx.quality;
  if (fx.speed !== undefined) forced.speed = fx.speed;
  if (fx.reverse !== undefined) forced.reverse = fx.reverse;
  if (fx.ack !== undefined) forced.ack = fx.ack;
  if (fx.position !== undefined) forced.position = fx.position;
  if (fx.pending !== undefined) forced.pending = fx.pending;
  if (fx.failed !== undefined) forced.failed = fx.failed;
  return Object.keys(forced).length ? { ...paint, states: mergeStates(paint.states, forced) } : paint;
}

/** A passive look and a blink around a drawing. The blink only runs where motion is allowed (`paint.animate`). */
function dressed(nodes: SvgNode[], paint: Paint, fx: SceneEffects): SvgNode[] {
  let out = nodes;
  if (fx.dim ?? fx.state === 'off') out = [el('g', { opacity: DIM_OPACITY }, out)];
  if (fx.blink === true && paint.animate) {
    out = [el('g', undefined, [...out, el('animate', { attributeName: 'opacity', values: '1;0.2;1', dur: '1.2s', repeatCount: 'indefinite' })])];
  }
  return out;
}

/** A number as text; a symbol's own `unit` and `decimals` ask the host's formatter for them. */
export type SceneFormat = (n: number, own?: { unit?: string; decimals?: number }) => string;

/** A cell as the rules engine reads a number (a number, or a numeric text), else NaN (which equals nothing). */
const numberOf = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);

/** The unit a row carries for its reading (`unit`: from the reading's profile, E12), or undefined. */
export const rowUnit = (row: Row | undefined): string | undefined =>
  typeof row?.unit === 'string' && row.unit.trim() && row.unit.length <= 32 ? row.unit.trim() : undefined;
/** The decimals a row carries for its reading (`decimals`, a whole 0..6, E12), or undefined. */
export const rowDecimals = (row: Row | undefined): number | undefined =>
  typeof row?.decimals === 'number' && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 6 ? row.decimals : undefined;

const defaultFormat: SceneFormat = (n, own) => {
  const t = typeof own?.decimals === 'number' ? n.toFixed(own.decimals) : String(r2(n));
  return own?.unit ? `${t} ${own.unit}` : t;
};

export interface SceneModelInput {
  /** Reduced motion off = animated. */
  animate?: boolean;
  /** The host's number words (unit included). */
  format?: SceneFormat;
  /** The effective board parameters, for rules that read a parameter. */
  params?: Record<string, unknown>;
  /** The host's words of an on / off reading, for a rule label's `{condition}` (the state card's `stat.on` / `stat.off`); default On / Off (phase 52.6.1, as kui-react 158b55b9). */
  onOff?: { on: string; off: string };
  /**
   * A compute script's scene patch (35.5b, E15), already validated and capped by the host (the view parses it first). Applied
   * LAST: authored settings, then rules, then the patch. Its `things` are data (they replace the things slot's rows, so the
   * rules reach them); its `objects` override the effects the rules decided, per id; its `links` and `shapes` are drawn on top
   * of the authored ones; its `view` says what to fit; its `problems` join the problem list.
   */
  patch?: SceneModelPatch | null;
}

/**
 * A clickable box: a symbol's or a thing's, its name, whether it is locked out, and where it came from. The kit's editor reads
 * it (the things layer, the read-only link ends), so its shape is the kit's (`SceneHit`, kui-react 47503e2).
 */
export interface SceneHit {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  /** Placed by a row of the things slot (or a scene patch); absent for an authored symbol. */
  from?: 'things';
  /**
   * What the symbol shows, for a host that names it to a screen reader (41-ui-fixes/18 5.1): its state as the data says it (an
   * alarm, else running or idle; a colour a rule or an accent lays on it is not a state), and a command from it that is out or
   * just failed.
   */
  state?: ScadaState;
  pending?: boolean;
  failed?: boolean;
}

/** Everything the scene draws, decided once. `problems` counts what could not be placed or joined. */
export function sceneModel(s: SceneSettings, data: Record<string, SlotData | undefined>, o: SceneModelInput = {}) {
  const width = Math.min(4000, Math.max(200, finite(s.width, 1200)));
  const height = Math.min(4000, Math.max(200, finite(s.height, 700)));
  const scale = Math.min(2, Math.max(0.2, finite(s.scale, 0.6)));
  const rows = rowsById(data.points, s.idColumn || 'id');
  const list = (Array.isArray(s.elements) ? (s.elements as SceneElementSetting[]) : []).filter((e) => e && typeof e === 'object').slice(0, MAX_SCENE_ELEMENTS);
  const patch: SceneModelPatch | null = isScenePatch(o.patch) ? o.patch : null;
  const ownLinks = (Array.isArray(s.links) ? (s.links as SceneLinkSetting[]) : []).filter((l) => l && typeof l === 'object').slice(0, MAX_SCENE_LINKS);
  // A patch's connections are drawn on top of the authored ones (capped on their own), never instead of them.
  const patchLinkList = patch ? patchLinks(patch.links) : [];
  const links = [...ownLinks, ...patchLinkList];
  const baseFormat: SceneFormat = o.format ?? defaultFormat;
  // A symbol's own unit and decimals, when it has them; else the ones its row carries from the reading's profile (next-boilerplate e2e run 1, E12:
  // `unit` / `decimals` of the row); every other number follows the host. A whole number is drawn whole ("2", never "2,0" for a floor) unless the
  // symbol asks for decimals of its own. The row's unit and decimals are its `value`'s: the second reading (`field` 'value2', another quantity: an EC
  // beside a moisture, T2 beside T1, a set-point) is worded as before E12, with the symbol's own unit and decimals, else the card's.
  const fmtOf = (e: SceneElementSetting | undefined, row?: Row): ((n: number, field?: 'value2') => string) => {
    const ownUnit = typeof e?.unit === 'string' && e.unit.trim() ? e.unit.trim() : undefined;
    const ownDecimals = typeof e?.decimals === 'number' && Number.isFinite(e.decimals) ? Math.min(6, Math.max(0, Math.round(e.decimals))) : undefined;
    const unit = ownUnit ?? rowUnit(row);
    const decimals = ownDecimals ?? rowDecimals(row);
    return (n, field) => {
      if (field === 'value2') return ownUnit === undefined && ownDecimals === undefined ? baseFormat(n) : baseFormat(n, { unit: ownUnit, decimals: ownDecimals });
      const d = ownDecimals === undefined && Number.isInteger(n) ? 0 : decimals;
      return unit === undefined && d === undefined ? baseFormat(n) : baseFormat(n, { ...(unit !== undefined ? { unit } : {}), ...(d !== undefined ? { decimals: d } : {}) });
    };
  };
  const linkIdsOf = (ls: SceneLinkSetting[]) => ls.map((l) => (typeof l.id === 'string' ? l.id : '')).filter(Boolean);
  const ownLinkIds = linkIdsOf(ownLinks);
  const placeable = list.filter((e) => typeof e.id === 'string' && e.id && isScadaSymbol(e.symbol));
  const byId = new Map<string, SceneElementSetting>();
  for (const e of placeable) if (!byId.has(e.id as string)) byId.set(e.id as string, e);
  let problems = 0;

  // Things (35.3, E5): one object per row of the `things` slot, or of the patch's `things`, which replace the slot's rows. A
  // thing never takes an authored symbol's or connection's id (it is left out and counted). Its row joins the table the rules
  // and the connections read, under its own id.
  const reserved = new Set<string>([
    ...list.map((e) => (typeof e.id === 'string' ? e.id : '')).filter(Boolean), ...ownLinkIds, ...linkIdsOf(patchLinkList),
  ]);
  const thingRead = readThings(s, patch && Array.isArray(patch.things) ? patch.things : data.things?.rows, reserved);
  const things = thingRead.things;
  problems += thingRead.problems;
  for (const t of things) rows.set(t.id, t.row);

  // What the rules decided, by symbol, connection and thing id. The engine is the kit's; it runs twice, once over the authored
  // targets and once over the things (`splitRulesForThings`: `*` reaches both, `things:*` the things alone, an id its object).
  const effects = new Map<string, SceneEffectsPlus>();
  const { authored: authoredRules, things: thingRules } = splitRulesForThings(s.rules);
  // A rule's `{value}` and `{value2}` reach the formatter as (target, number) alone (the kit's engine): the number that is the row's `value`, and not its
  // `value2` as well, is worded with the row's unit and decimals; any other (`{value2}`, or both readings equal, which cannot be told apart) as the second
  // reading is, so `{value2}` never takes `value`'s unit (E12 review)
  const ruleFormat = (id: string, n: number): string => {
    const row = rows.get(id);
    return fmtOf(byId.get(id), row)(n, numberOf(row?.value) === n && numberOf(row?.value2) !== n ? undefined : 'value2');
  };
  const ruleContext = { rows, params: o.params ?? {}, format: ruleFormat, ...(o.onOff ? { onOff: o.onOff } : {}) };
  if (authoredRules.length) {
    for (const [id, fx] of evaluateRules(authoredRules, { ...ruleContext, targets: [...byId.keys(), ...ownLinkIds] })) effects.set(id, fx);
  }
  if (thingRules.length && things.length) {
    for (const [id, fx] of evaluateRules(thingRules, { ...ruleContext, targets: things.map((t) => t.id) })) effects.set(id, fx);
  }
  // The patch goes last (35.5b): an object override wins over every rule for the same effect, and a patched value is drawn
  // in place of the row's (the rules have already read the row as it was loaded).
  for (const [id, raw] of Object.entries(patch?.objects && typeof patch.objects === 'object' ? patch.objects : {})) {
    const { value, ...fx } = patchEffects(raw);
    if (Object.keys(fx).length) effects.set(id, { ...effects.get(id), ...fx });
    if (value !== undefined) rows.set(id, { ...(rows.get(id) ?? {}), value });
  }
  const boxes = new Map<string, PlacedElement>();
  const settingsOf = new Map<string, SceneElementSetting>();
  // A symbol on a line takes the medium of the first connection that touches it, so a pipe and the valve in it agree.
  const touching = new Map<string, string>();
  for (const l of links) {
    if (typeof l.medium !== 'string' || l.medium === 'none') continue;
    for (const ref of [l.from, l.to]) {
      const port = parsePort(ref);
      if (port && !touching.has(port.id)) touching.set(port.id, l.medium);
    }
  }
  const centred = s.anchor !== 'corner';
  let bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    bounds = bounds ? { x0: Math.min(bounds.x0, x0), y0: Math.min(bounds.y0, y0), x1: Math.max(bounds.x1, x1), y1: Math.max(bounds.y1, y1) } : { x0, y0, x1, y1 };
  };
  const elementNodes: SvgNode[] = [];
  const labelSpecs: SceneLabelSpec[] = [];
  const hidden = new Set<string>();
  const locked = new Set<string>();
  const spoken = new Map<string, Pick<SceneHit, 'state' | 'pending' | 'failed'>>();

  /**
   * Places and draws one symbol: an authored element (`from` undefined) or a thing (`from: 'things'`, always placed by its
   * centre, named by its label column). The rules' and the patch's placement effects apply to both: `dx` / `dy` move it,
   * `scale` multiplies its own size, `turn` replaces its turn, `symbol` draws another key in its place (a key the library
   * lacks, or one whose piece the tenant does not hold and whose pack is therefore never served, draws the placeholder).
   */
  const place = (e: SceneElementSetting & { id: string }, from?: 'things') => {
    const fx = effects.get(e.id) ?? {};
    const move = placementEffects(fx);
    const asKey = move.symbol ?? (e.symbol as string);
    // A symbol that was merged into another one draws as the kept one; a key the library lacks goes to the registry as it is.
    const symbolKey = isScadaSymbol(asKey) ? canonicalSymbol(asKey) : asKey;
    const def = SCADA_SYMBOL_DEFS[symbolKey as ScadaSymbol] as SymbolDef | undefined;
    const k = scale * (typeof e.scale === 'number' && e.scale > 0 ? e.scale : 1) * move.scale;
    const row = rows.get(e.id);
    const drawnAs = asKey === e.symbol ? e : { ...e, symbol: asKey };
    const own = drawnAs.medium && drawnAs.medium !== 'none' ? drawnAs : { ...drawnAs, medium: touching.get(e.id) ?? 'none' };
    const fmtE = fmtOf(e, row);
    const paint = withColors(scadaPaint(symbolSettings(s, own, undefined, fx), fx.state ? withState(rowSlots(row), fx.state) : rowSlots(row), { animate: o.animate, format: fmtE }), fx);
    if (isLocked(paint.states)) locked.add(e.id);
    spoken.set(e.id, {
      state: paint.state === 'warning' || paint.state === 'critical' ? paint.state : paint.running ? 'running' : 'idle',
      ...(paint.states?.pending ? { pending: true } : {}),
      ...(paint.states?.failed ? { failed: true } : {}),
    });
    const drawn = drawScada(symbolKey, paint, move.turn ?? exactTurn(e.turn) ?? 0, e.mirror === true);
    const w = r2(drawn.w * k); const h = r2(drawn.h * k);
    const byCentre = from === 'things' || centred;
    const x = r2(finite(e.x, 0) + move.dx - (byCentre ? w / 2 : 0)); const y = r2(finite(e.y, 0) + move.dy - (byCentre ? h / 2 : 0));
    const box: PlacedElement = { id: e.id, symbol: asKey, x, y, w, h, k, ...(from ? { from } : {}) };
    boxes.set(e.id, box);
    settingsOf.set(e.id, e);
    // An authored symbol is named by its row's label, else its own; a thing by its label column (already in `e.label`).
    const rowLabel = from ? undefined : typeof row?.label === 'string' && row.label ? row.label : undefined;
    const named = s.showLabels !== false && (!!e.label || !!fx.label || !!rowLabel) && e.labelPos !== 'n';
    grow(x - 2, y - (named && e.labelPos === 't' ? LABEL : 2), x + w + (e.valuePos === 'r' ? 56 : 2), y + h + (s.showLabels !== false && e.labelPos !== 'n' ? LABEL * 2 + 2 : 2));
    // A hidden symbol keeps its box (connections still join it and the view does not jump), but draws nothing.
    if (fx.hidden === true) { hidden.add(e.id); return; }
    // a rule's own colour colours the symbol's body too (SCADA_STYLE.md 5a), the same pass for every symbol
    const body = fx.color ? tinted(drawn.nodes, fx.color) : drawn.nodes;
    elementNodes.push(el('g', { transform: `translate(${x} ${y}) scale(${r2(k * 1000) / 1000})`, ...(from ? { 'data-thing': e.id } : {}) }, dressed(body, paint, fx)));
    if (s.showLabels !== false) {
      // laid out once every symbol stands (`layoutLabels`): a name keeps to the room beside it and the view's frame holds it (phase 52.5.3)
      const name = fx.label ?? rowLabel ?? e.label ?? '';
      const showValue = def?.valueUnder === true && e.showValue !== false && paint.value !== null;
      labelSpecs.push({
        x, y, w: box.w, h: box.h, name: e.labelPos !== 'n' ? name : '', above: e.labelPos === 't',
        value: showValue ? { text: fmtE(paint.value as number), beside: e.valuePos === 'r' } : null,
      });
    }
  };

  for (const e of list) {
    if (typeof e.id !== 'string' || !e.id || boxes.has(e.id) || !isScadaSymbol(e.symbol)) { problems += 1; continue; }
    place(e as SceneElementSetting & { id: string });
  }
  // Things are drawn over the authored symbols, in row order: one placed element each, ruled, joined and clickable alike.
  for (const t of things) place({ id: t.id, symbol: t.symbol, x: t.x, y: t.y, turn: t.turn, ...(t.label ? { label: t.label } : {}) }, 'things');
  const labels = layoutLabels(labelSpecs);
  for (const g of labels.extents) grow(g.x0 - 2, g.y0 - 2, g.x1 + 2, g.y1 + 2);
  const labelNodes = labels.nodes;

  // Shapes: zones and dividers sit under everything, titles on top. They widen the content box like a symbol does. A patch's
  // titles and zones come after the authored ones (capped on their own).
  const shapes = [
    ...(Array.isArray(s.shapes) ? (s.shapes as SceneShapeSetting[]) : []).filter((h) => h && typeof h === 'object').slice(0, MAX_SCENE_SHAPES),
    ...(patch ? patchShapes(patch.shapes) : []),
  ];
  const shapeUnder: SvgNode[] = [];
  const shapeOver: SvgNode[] = [];
  for (const h of shapes) {
    const x = finite(h.x, 0); const y = finite(h.y, 0);
    const color = TONE[h.tone ?? 'neutral'] ?? TONE.neutral;
    if (h.kind === 'zone') {
      const w = Math.max(20, finite(h.w, 200)); const hh = Math.max(20, finite(h.h, 120));
      grow(x - 2, y - 2, x + w + 2, y + hh + 2);
      shapeUnder.push(el('rect', { x, y, width: w, height: hh, rx: 10, fill: color, 'fill-opacity': h.tone && h.tone !== 'neutral' ? 0.08 : 0.04, stroke: color, 'stroke-width': 1.5, ...(h.dashed === false ? {} : { 'stroke-dasharray': '6 5' }) }));
      if (typeof h.text === 'string' && h.text) shapeOver.push(text(r2(x + 12), r2(y + 20), h.text, { 'font-size': 13, 'font-weight': 600, fill: MUTED, 'font-family': 'inherit' }));
    } else if (h.kind === 'divider') {
      const vertical = finite(h.w, 0) <= 0 && finite(h.h, 0) > 0;
      const len = Math.max(20, vertical ? finite(h.h, 100) : finite(h.w, 200));
      grow(x - 2, y - 2, vertical ? x + 2 : x + len + 2, vertical ? y + len + 2 : y + 2);
      shapeUnder.push(el('line', { x1: x, y1: y, x2: vertical ? x : x + len, y2: vertical ? y + len : y, stroke: color, 'stroke-width': 1.5, ...(h.dashed === true ? { 'stroke-dasharray': '6 5' } : {}) }));
    } else if (h.kind === 'text' && typeof h.text === 'string' && h.text) {
      const size = TEXT_SIZE[h.size ?? 'm'] ?? TEXT_SIZE.m;
      const anchor = h.align === 'start' || h.align === 'end' ? h.align : 'middle';
      const approx = h.text.length * size * 0.56;
      grow(anchor === 'start' ? x : anchor === 'end' ? x - approx : x - approx / 2, y - size, anchor === 'start' ? x + approx : anchor === 'end' ? x : x + approx / 2, y + 4);
      shapeOver.push(text(x, y, h.text, { 'text-anchor': anchor, 'font-size': size, 'font-weight': size >= 22 ? 700 : 600, fill: h.tone && h.tone !== 'neutral' ? color : size >= 15 ? INK : MUTED, 'font-family': 'inherit' }));
    } else problems += 1;
  }

  const linkNodeList: SvgNode[] = [];
  for (const l of links) {
    const a = parsePort(l.from); const b = parsePort(l.to);
    const ba = a && boxes.get(a.id); const bb = b && boxes.get(b.id);
    if (!a || !b || !ba || !bb) { problems += 1; continue; }
    const kind = (typeof l.kind === 'string' && LINK_KINDS.has(l.kind) ? l.kind : 'pipe') as SceneLinkKind;
    const stateId = typeof l.id === 'string' && l.id ? l.id : a.id;
    // A connection with its own id answers its own rules; without one it follows its "from" symbol's state, colours
    // and motion (an `off` symbol's line is passive too; never its hidden, dim, blink, label or medium).
    const own = typeof l.id === 'string' && l.id ? effects.get(l.id) : undefined;
    const fromFx = effects.get(a.id);
    const fx: SceneEffects = own ?? (!(typeof l.id === 'string' && l.id) && fromFx
      ? { state: fromFx.state, color: fromFx.color, fillColor: fromFx.fillColor, animate: fromFx.animate, speed: fromFx.speed, reverse: fromFx.reverse }
      : {});
    if (fx.hidden === true) continue;
    const slots = rowSlots(rows.get(stateId));
    const paint = withColors(scadaPaint(symbolSettings(s, settingsOf.get(a.id) ?? {}, l, fx), fx.state ? withState(slots, fx.state) : slots, { animate: o.animate, format: fmtOf(settingsOf.get(a.id), rows.get(stateId)) }), fx);
    const pa = portPoint(ba, a.side, a.at); const pb = portPoint(bb, b.side, b.at);
    const route = routeLink(pa, a.side, pb, b.side, l.mid ?? null);
    for (const pt of route) grow(pt.x - 8, pt.y - 8, pt.x + 8, pt.y + 8);
    linkNodeList.push(...dressed(linkNodes(kind, route, paint, scale), paint, fx));
  }

  // The view: the content with a margin, or the whole canvas, or (a patch's view only) a region of it.
  const view = patch ? patchView(patch.view) : undefined;
  const fit = typeof view === 'string' ? view : s.fit;
  const box = typeof view === 'object' ? view
    : (fit === 'canvas' || !bounds) ? { x0: 0, y0: 0, x1: width, y1: height }
      : { x0: Math.floor((bounds as { x0: number }).x0 - MARGIN), y0: Math.floor((bounds as { y0: number }).y0 - MARGIN), x1: Math.ceil((bounds as { x1: number }).x1 + MARGIN), y1: Math.ceil((bounds as { y1: number }).y1 + MARGIN) };
  const vw = box.x1 - box.x0; const vh = box.y1 - box.y0;
  const background: SvgNode[] = [];
  if (s.background === 'dots') {
    let d = '';
    for (let yy = Math.ceil(box.y0 / 50) * 50 + 25; yy < box.y1; yy += 50) for (let xx = Math.ceil(box.x0 / 50) * 50 + 25; xx < box.x1; xx += 50) d += `M${xx} ${yy}h0`;
    background.push(el('path', { d, stroke: 'var(--border)', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }));
  } else if (s.background === 'panel') {
    background.push(el('rect', { x: box.x0, y: box.y0, width: vw, height: vh, rx: 8, fill: 'var(--surface-raised)', stroke: 'var(--border)', 'stroke-width': 2 }));
  }

  // Each symbol's box and name, for a host that makes symbols clickable (the view draws a hit area where a symbol has an action).
  // A thing's hit says so (`from: 'things'`): the host looks its row up in the things rows, not in the symbols' table.
  const hits = [...boxes.values()].filter((b) => !hidden.has(b.id)).map((b): SceneHit => {
    const e = settingsOf.get(b.id);
    const row = rows.get(b.id);
    const rowLabel = b.from ? undefined : typeof row?.label === 'string' && row.label ? row.label : undefined;
    const name = effects.get(b.id)?.label || rowLabel || e?.label || b.id;
    return { id: b.id, name, x: b.x, y: b.y, w: b.w, h: b.h, locked: locked.has(b.id), ...(b.from ? { from: b.from } : {}), ...spoken.get(b.id) };
  });
  // A patch's problems are shown with the diagram's own (and counted with them).
  const problemTexts = patch ? patchProblems(patch.problems) : [];
  problems += problemTexts.length;

  return {
    width: vw, height: vh, scale, problems, problemTexts, hits,
    viewBox: `${box.x0} ${box.y0} ${vw} ${vh}`,
    empty: boxes.size === 0,
    things: things.length,
    nodes: [...background, ...shapeUnder, ...linkNodeList, ...elementNodes, ...labelNodes, ...shapeOver],
  };
}

export type SceneModel = ReturnType<typeof sceneModel>;
