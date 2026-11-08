// NB-owned, never re-vendored (phase 35.3 / 35.5b, docs/phases/07-dashboard/35-variables-rules-and-scene-scripts.md). NB changes it itself.
// The process scene's things and its scene patch (pure, no React): what `sceneModel` reads from the second table slot
// (`things`, one row = one object placed and drawn like an authored symbol, E5) and from a compute script's scene patch
// (E15: drawing instructions the host already validated and capped). Nothing here draws; `scada-scene-logic.ts` does.
//
// The patch shape is the kit's (`views/scene-patch.ts`, kui-react, phase 35.5b §B.5 "The scene patch", vendored since 47503e2):
// the view parses a patch with the kit's `parseScenePatch` and hands its `ScenePatch` on. `SceneModelPatch` below is the
// structural shape `sceneModel` reads (a `ScenePatch` is one), and every member is still read defensively (a malformed one is
// skipped), so a patch that only the host's own schema checked cannot break a draw either.

import type { SceneLinkSetting, SceneShapeSetting } from './scada-scene-logic';
import { MAX_SCENE_RULES, RULE_STATES, evaluateRules, type RuleState, type SceneEffects, type SceneRule } from './scene-rules-logic';
import { parseMode, parseQuality } from './scada-states';
import { cssColor } from '../settings/style';

type Row = Record<string, unknown>;

/** At most this many things are drawn; past it, the first ones and a problem count per row left out, never a blank. */
export const MAX_SCENE_THINGS = 500;
/** A patch adds at most this many connections and this many titles and zones on top of the authored ones. */
export const MAX_SCENE_PATCH_LINKS = 300;
export const MAX_SCENE_PATCH_SHAPES = 100;
/** A patch lists at most this many problems; each, like every label it sets, is plain text of at most `MAX_SCENE_TEXT` characters. */
export const MAX_SCENE_PATCH_PROBLEMS = 50;
export const MAX_SCENE_TEXT = 80;
/** A rule's or a patch's offset, in scene units, either way. */
export const MAX_SCENE_OFFSET = 4000;
/** A thing (or a patched view) is held inside this many scene units of the origin, so a wild row cannot blow up the view box. */
export const MAX_SCENE_COORD = 10_000;
/**
 * The id of a thing, and of anything a patch addresses: the scene's own id grammar (the same as a symbol gesture's element key).
 * It admits ids that start with a digit (numeric tag ids are common): such a thing is placed, ruled and clickable, but a
 * connection end keeps the port grammar (`parsePort`: an id that starts with a letter or `_`, as the kit's `scene-patch.ts`
 * reads it too), so a thing a connection ends on needs an id of that form. The template's connection help says so.
 */
export const SCENE_OBJECT_ID = /^[A-Za-z0-9_.-]{1,64}$/;
/** The rule target that means "every thing, and nothing authored" (`*` means every symbol, connection and thing). */
export const THINGS_TARGET = 'things:*';

export type SceneTurn = 0 | 90 | 180 | 270;

/** The `Things` settings group of `scada.scene` (template version 6). Every column has the default the template gives it. */
export type SceneThingsSettings = {
  thingsIdColumn?: string;
  thingsSymbolColumn?: string;
  /** One symbol key for every thing; empty = each row's symbol column. */
  thingsSymbol?: string;
  thingsXColumn?: string;
  thingsYColumn?: string;
  thingsTurnColumn?: string;
  thingsLabelColumn?: string;
  /** What a row's x and y are: scene units (default), or metres mapped through `thingsScale` and the origin. */
  thingsUnits?: 'scene' | 'metres' | string;
  /** Scene units per metre (default 50). */
  thingsScale?: number | null;
  /** Where 0 m sits on the canvas, in scene units (metres only). */
  thingsOriginX?: number | null;
  thingsOriginY?: number | null;
};

/** One thing as the scene places it: where (its centre, scene units), turned how, drawn as what, named what, and its row. */
export interface SceneThing {
  id: string;
  /** The key it is drawn as: a known key draws its symbol, anything else (or a locked piece's key) the registry's placeholder. */
  symbol: string;
  x: number;
  y: number;
  turn: SceneTurn;
  label?: string;
  /** The row as the source (or the patch) gave it: the state columns every symbol reads, and any other column a click may carry. */
  row: Row;
}

/** What the rules and a patch may decide for one object: the rule engine's effects plus the placement ones of 35.3. */
export interface SceneEffectsPlus extends SceneEffects {
  /** An offset in scene units (±`MAX_SCENE_OFFSET`). */
  dx?: number;
  dy?: number;
  /** A size factor on top of the symbol's own (0.2 to 4). */
  scale?: number;
  /** A quarter turn, `'0'` to `'270'` as in the element settings (the contract's type; `exactTurn` also reads a number). */
  turn?: '0' | '90' | '180' | '270';
  /** Another symbol key drawn in the same place; an unknown key, or one of a piece the tenant does not hold, draws the placeholder. */
  symbol?: string;
}

/**
 * Whether the kit's rule engine (the vendored `scene-rules-logic.ts`) emits the placement effects of 35.3. The template offers
 * `dx`, `dy`, `scale`, `turn` and `symbol` on a rule and `sceneModel` applies whatever the engine emits, but the engine is the
 * kit's. It emits them since kui-react 47503e2; were a vendor ever to go back, a rule's placement fields would be stored and do
 * nothing, and the template would say so on each field. Probed once, on a rule that always applies.
 */
export const RULE_PLACEMENT_LIVE: boolean = (() => {
  const fx = evaluateRules([{ target: 'probe', dx: 1, dy: 1, scale: 2, turn: '90', symbol: 'pump.motor' }], { rows: new Map(), targets: ['probe'] })
    .get('probe') as SceneEffectsPlus | undefined;
  return fx?.dx === 1 && fx.dy === 1 && fx.scale === 2 && exactTurn(fx.turn) === 90 && fx.symbol === 'pump.motor';
})();

/** A patch's object override: the effects plus a value drawn in place of the row's (the rules already read the row as loaded). */
export type ScenePatchEffects = SceneEffectsPlus & { value?: string | number | boolean | null };

/**
 * The scene patch as `sceneModel` reads it (§B.5): the host validated it already (the server-safe schema in the dashboard's
 * `transform-output.ts`, and the kit's `parseScenePatch` once vendored), so this is the structural shape, not a schema.
 */
export interface SceneModelPatch {
  /** Rows of the things contract (§B.4): they replace the things slot's rows (so a script can add, move and remove things). */
  things?: unknown[];
  /** Per symbol, connection or thing id: effects applied after the rules. */
  objects?: Record<string, unknown>;
  /** Connections added to the authored ones. */
  links?: unknown[];
  /** Titles, zones and dividers added to the authored ones. */
  shapes?: unknown[];
  /** What to fit: the content, the whole canvas, or a region of it. */
  view?: unknown;
  /** Shown in the diagram's problem list (and counted with its problems). */
  problems?: unknown[];
}

export type SceneView = 'content' | 'canvas' | { x0: number; y0: number; x1: number; y1: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A finite number, or a numeric string (a source may answer positions as text); null for anything else. */
export function sceneNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Plain text of at most `max` characters: control characters become spaces; a number is written out; anything else is undefined. */
export function plainText(v: unknown, max = MAX_SCENE_TEXT): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).slice(0, max) : undefined;
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** A quarter turn given exactly (`90`, `'180'`); anything else is undefined. What the element settings and a rule's `turn` hold. */
export function exactTurn(v: unknown): SceneTurn | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return n === 0 || n === 90 || n === 180 || n === 270 ? n : undefined;
}

/** Degrees snapped to the nearest quarter turn (a thing's heading: 0 = up, clockwise), or undefined when it is not a number. */
export function snapTurn(v: unknown): SceneTurn | undefined {
  const n = sceneNumber(v);
  if (n === null) return undefined;
  return ((((Math.round(n / 90) % 4) + 4) % 4) * 90) as SceneTurn;
}

const column = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const idOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * The things of a scene from rows (the `things` slot's, or a patch's that replace them), placed in scene units. A row is
 * left out, and counted as a problem, when its id is missing or outside the scene's grammar, repeats an earlier thing's, or
 * is one of `reserved` (an authored symbol's or connection's id: a thing never takes over an authored object), or when it
 * has no x or y. The symbol is the fixed one, else the row's symbol column, else its `kind` (the things contract's name for
 * it); the turn is the row's turn column, else its `heading`, snapped to a quarter turn.
 */
export function readThings(s: SceneThingsSettings, rows: unknown, reserved: ReadonlySet<string>): { things: SceneThing[]; problems: number } {
  const list = (Array.isArray(rows) ? rows : []).filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r));
  let problems = Math.max(0, list.length - MAX_SCENE_THINGS);
  const idColumn = column(s.thingsIdColumn, 'id');
  const symbolColumn = column(s.thingsSymbolColumn, 'symbol');
  const xColumn = column(s.thingsXColumn, 'x');
  const yColumn = column(s.thingsYColumn, 'y');
  const turnColumn = column(s.thingsTurnColumn, 'turn');
  const labelColumn = column(s.thingsLabelColumn, 'label');
  const fixed = typeof s.thingsSymbol === 'string' ? s.thingsSymbol.trim() : '';
  const metres = s.thingsUnits === 'metres';
  const perMetre = clamp(sceneNumber(s.thingsScale) ?? 50, 0.01, 1000);
  const ox = metres ? sceneNumber(s.thingsOriginX) ?? 0 : 0;
  const oy = metres ? sceneNumber(s.thingsOriginY) ?? 0 : 0;
  const seen = new Set<string>();
  const things: SceneThing[] = [];
  const read = (row: Row, key: string): unknown => (Object.hasOwn(row, key) ? row[key] : undefined);
  for (const row of list.slice(0, MAX_SCENE_THINGS)) {
    const id = idOf(read(row, idColumn));
    if (!SCENE_OBJECT_ID.test(id) || seen.has(id) || reserved.has(id)) { problems += 1; continue; }
    const x = sceneNumber(read(row, xColumn));
    const y = sceneNumber(read(row, yColumn));
    if (x === null || y === null) { problems += 1; continue; }
    seen.add(id);
    const own = read(row, symbolColumn);
    const symbol = fixed || (typeof own === 'string' && own.trim() ? own.trim() : typeof row.kind === 'string' ? row.kind.trim() : '');
    const turnRaw = read(row, turnColumn);
    const label = plainText(read(row, labelColumn));
    things.push({
      id,
      symbol,
      x: r2(clamp(metres ? ox + x * perMetre : x, -MAX_SCENE_COORD, MAX_SCENE_COORD)),
      y: r2(clamp(metres ? oy + y * perMetre : y, -MAX_SCENE_COORD, MAX_SCENE_COORD)),
      turn: snapTurn(turnRaw ?? read(row, 'heading')) ?? 0,
      ...(label ? { label } : {}),
      row,
    });
  }
  return { things, problems };
}

/**
 * The rules list split for the two passes `sceneModel` evaluates (the rule ENGINE is the kit's `evaluateRules`; this only
 * chooses what each pass sees). A target's effects depend only on the rules that reach it, in order, so the authored objects
 * and the things can be evaluated apart: the authored pass sees every rule with `things:*` switched off; the things pass sees
 * every rule with `things:*` read as `*` (its targets are the things alone, so `*` reaches every thing, and an id reaches the
 * thing of that id). Both keep every rule at its index, cut at `MAX_SCENE_RULES` first, so the cap means what it says.
 */
export function splitRulesForThings(rules: unknown): { authored: unknown[]; things: unknown[] } {
  const list = (Array.isArray(rules) ? rules : []).slice(0, MAX_SCENE_RULES);
  const forThings = (r: unknown) => !!r && typeof r === 'object' && typeof (r as SceneRule).target === 'string' && ((r as SceneRule).target as string).trim() === THINGS_TARGET;
  return {
    authored: list.map((r) => (forThings(r) ? { ...(r as SceneRule), enabled: false } : r)),
    things: list.map((r) => (forThings(r) ? { ...(r as SceneRule), target: '*' } : r)),
  };
}

const STATES: ReadonlySet<string> = new Set(RULE_STATES);
const FLAGS = ['dim', 'blink', 'hidden', 'animate', 'reverse', 'ack', 'pending', 'failed'] as const;

/** A finite number from a rule or a patch, held inside `[lo, hi]`; undefined when it is not one. */
function bounded(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : undefined;
}

/** The placement effects (`dx`, `dy`, `scale`, `turn`, `symbol`) of a rule's or a patch's effects, normalised; the rest untouched. */
export function placementEffects(fx: SceneEffectsPlus): { dx: number; dy: number; scale: number; turn?: SceneTurn; symbol?: string } {
  const symbol = typeof fx.symbol === 'string' && fx.symbol.trim() ? fx.symbol.trim().slice(0, 100) : undefined;
  return {
    dx: bounded(fx.dx, -MAX_SCENE_OFFSET, MAX_SCENE_OFFSET) ?? 0,
    dy: bounded(fx.dy, -MAX_SCENE_OFFSET, MAX_SCENE_OFFSET) ?? 0,
    scale: bounded(fx.scale, 0.2, 4) ?? 1,
    ...(exactTurn(fx.turn) !== undefined ? { turn: exactTurn(fx.turn) } : {}),
    ...(symbol ? { symbol } : {}),
  };
}

/**
 * One object override of a patch as effects. Anything malformed is simply not an effect (the host's schema refused it
 * already; this is the second line). A `value` (a number, a word, a flag or null) is drawn in place of the row's.
 */
export function patchEffects(raw: unknown): ScenePatchEffects {
  const out: ScenePatchEffects = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  const own = (k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
  const state = own('state');
  if (typeof state === 'string' && STATES.has(state)) out.state = state as RuleState;
  const color = cssColor(own('color')); if (color) out.color = color;
  const fill = cssColor(own('fillColor')); if (fill) out.fillColor = fill;
  for (const k of FLAGS) { const b = own(k); if (typeof b === 'boolean') out[k] = b; }
  const label = plainText(own('label')); if (label !== undefined) out.label = label;
  const medium = own('medium'); if (typeof medium === 'string' && medium.trim()) out.medium = medium.trim().slice(0, 32);
  const mode = parseMode(own('mode')); if (mode) out.mode = mode;
  const quality = parseQuality(own('quality')); if (quality) out.quality = quality;
  const speed = bounded(own('speed'), 0, 400); if (speed !== undefined) out.speed = speed;
  const position = bounded(own('position'), 0, 100); if (position !== undefined) out.position = position;
  const dx = bounded(own('dx'), -MAX_SCENE_OFFSET, MAX_SCENE_OFFSET); if (dx !== undefined) out.dx = dx;
  const dy = bounded(own('dy'), -MAX_SCENE_OFFSET, MAX_SCENE_OFFSET); if (dy !== undefined) out.dy = dy;
  const scale = bounded(own('scale'), 0.2, 4); if (scale !== undefined) out.scale = scale;
  const turn = exactTurn(own('turn')); if (turn !== undefined) out.turn = String(turn) as NonNullable<SceneEffectsPlus['turn']>;
  const symbol = own('symbol'); if (typeof symbol === 'string' && symbol.trim()) out.symbol = symbol.trim().slice(0, 100);
  if (Object.hasOwn(o, 'value')) {
    const v = o.value;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out.value = v as null | boolean | number;
    else if (typeof v === 'string') out.value = v.slice(0, 200);
  }
  return out;
}

/** The patch's view: `content`, `canvas`, or a region (finite, held inside the coordinate bound, at least 20 units each way). */
export function patchView(v: unknown): SceneView | undefined {
  if (v === 'content' || v === 'canvas') return v;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;
  const [x0, y0, x1, y1] = [b.x0, b.y0, b.x1, b.y1].map((n) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, -MAX_SCENE_COORD, MAX_SCENE_COORD) : NaN));
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 20 || y1 - y0 < 20) return undefined;
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
}

const objects = (v: unknown, max: number): Row[] =>
  (Array.isArray(v) ? v : []).filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r)).slice(0, max);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -MAX_SCENE_COORD, MAX_SCENE_COORD) : undefined);

/** The patch's extra connections, as connection settings (from, to, kind, medium, id), at most `MAX_SCENE_PATCH_LINKS`. */
export function patchLinks(v: unknown): SceneLinkSetting[] {
  return objects(v, MAX_SCENE_PATCH_LINKS).map((l) => {
    const id = str(l.id, 64);
    return {
      from: str(l.from, 80), to: str(l.to, 80), kind: str(l.kind, 16) ?? 'pipe',
      ...(str(l.medium, 32) ? { medium: str(l.medium, 32) } : {}),
      ...(id && SCENE_OBJECT_ID.test(id) ? { id } : {}),
    };
  });
}

/** The patch's extra titles, zones and dividers, as shape settings, at most `MAX_SCENE_PATCH_SHAPES`; their words plain text. */
export function patchShapes(v: unknown): SceneShapeSetting[] {
  return objects(v, MAX_SCENE_PATCH_SHAPES).map((h) => {
    const text = plainText(h.text);
    const out: SceneShapeSetting = { kind: str(h.kind, 16), x: num(h.x), y: num(h.y), w: num(h.w), h: num(h.h) };
    if (text) out.text = text;
    if (h.size === 's' || h.size === 'm' || h.size === 'l') out.size = h.size;
    if (h.align === 'start' || h.align === 'middle' || h.align === 'end') out.align = h.align;
    if (typeof h.tone === 'string' && ['neutral', 'info', 'success', 'warning', 'error'].includes(h.tone)) out.tone = h.tone as SceneShapeSetting['tone'];
    if (typeof h.dashed === 'boolean') out.dashed = h.dashed;
    return out;
  });
}

/** The patch's problems: plain text, non-empty, at most `MAX_SCENE_PATCH_PROBLEMS`. */
export function patchProblems(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).map((p) => plainText(p)).filter((p): p is string => !!p).slice(0, MAX_SCENE_PATCH_PROBLEMS);
}

/** Whether a patch was given at all (an object). Anything else is no patch. */
export const isScenePatch = (v: unknown): v is SceneModelPatch => !!v && typeof v === 'object' && !Array.isArray(v);
