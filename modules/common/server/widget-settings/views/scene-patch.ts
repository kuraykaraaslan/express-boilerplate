// Vendored from kui-react f7db139: modules/app/WidgetKit/views/scene-patch.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The scene patch (pure, no React): drawing instructions a compute script may return beside its slots for a
// `scada.scene` or a `viewer.model` card (next-boilerplate phase 35, E15). A patch adds, moves, turns, resizes,
// re-skins and removes things, overrides any authored symbol's, connection's, marker's or thing's look, adds
// connections and zones, sets the view and lists problems. It is data, never an action: nothing in it names a
// parameter write, a command, a page or a URL, and a field this file does not know is dropped, not passed on.
//
// The host validates a script's result before it reaches a card; the views parse it again here, because a view never
// trusts its props further than its own caps (`parseScenePatch`). The scene model applies a patch LAST: authored
// settings, then the rules, then the patch, so a script wins over a rule for the same effect. kui-ejs, KUInative and
// next-boilerplate vendor this file.

import {
  readEffects, MAX_RULE_LABEL, SCENE_RULE_EFFECTS,
  type EffectSpec, type RuleState, type RuleTurn,
} from './scene-rules-logic';
import type { SymbolMode, SymbolQuality } from './scada-states';

/** At most this many things in a 2D patch (the scene's own cap). The 3D viewer passes its own (`maxThings`). */
export const MAX_PATCH_THINGS = 500;
/** At most this many extra connections on top of the authored ones. */
export const MAX_PATCH_LINKS = 300;
/** At most this many extra titles and zones. */
export const MAX_PATCH_SHAPES = 100;
/** At most this many object overrides (every symbol, connection and thing of the largest scene, with room). */
export const MAX_PATCH_OBJECTS = 3000;
/** At most this many problems a patch lists. */
export const MAX_PATCH_PROBLEMS = 50;
/** The longest label, problem, title or text cell, in characters (plain text). */
export const MAX_PATCH_TEXT = MAX_RULE_LABEL;
/** At most this many columns in one thing row, and keys in one object's `params`. */
export const MAX_PATCH_COLUMNS = 32;
/** How far a patch may place anything, in scene units either way (well past the largest canvas). */
export const MAX_PATCH_COORD = 10_000;
/** At most this many problems the parser itself reports (the rest are counted in one line). */
const MAX_PARSE_PROBLEMS = 20;

export const PATCH_LINK_KINDS = ['pipe', 'hose', 'cable', 'wire', 'strip', 'line', 'sld'] as const;
export type PatchLinkKind = (typeof PATCH_LINK_KINDS)[number];
export const CAMERA_PRESETS = ['iso', 'top', 'front'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

/** A plain cell of a thing row or of an object's `params`. */
export type PatchScalar = string | number | boolean | null;

/** One row of the `things` contract (next-boilerplate phase 35 §B.4): `id`, a symbol or kind, x, y, state, label… */
export type PatchThing = Record<string, PatchScalar>;

/** What a patch may change on one object, by its id. A missing key means "the patch says nothing". */
export interface ObjectPatch {
  // The 2D scene's effects (as `SceneEffects`), plus the reading itself.
  state?: RuleState;
  color?: string;
  fillColor?: string;
  hidden?: boolean;
  dim?: boolean;
  blink?: boolean;
  /** Plain text, at most `MAX_PATCH_TEXT` characters (no tokens: a script writes the words it means). */
  label?: string;
  medium?: string;
  animate?: boolean;
  mode?: SymbolMode;
  quality?: SymbolQuality;
  speed?: number;
  reverse?: boolean;
  ack?: boolean;
  position?: number;
  pending?: boolean;
  failed?: boolean;
  dx?: number;
  dy?: number;
  scale?: number;
  turn?: RuleTurn;
  symbol?: string;
  /** Replaces the object's `value` reading. */
  value?: PatchScalar;
  // The 3D viewer's (markers and things).
  pulse?: boolean;
  /** px for a marker, metres for a thing. */
  size?: number;
  /** A lift, metres. */
  dz?: number;
  /** A designer item's own parameters (next-boilerplate 35.7); read by no view yet. */
  params?: Record<string, PatchScalar>;
}

/** An extra connection: ends in the scene's grammar (`pump1.r`, `cow7.l:0.3`; a thing's id works like a symbol's). */
export interface PatchLink {
  from: string;
  to: string;
  kind: PatchLinkKind;
  medium?: string;
  /** The row (or thing) whose state tints it, and its name for the objects' overrides. */
  id?: string;
}

/** An extra title or zone, in scene units. */
export interface PatchShape {
  kind: 'text' | 'zone';
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  size?: 's' | 'm' | 'l';
  align?: 'start' | 'middle' | 'end';
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  dashed?: boolean;
}

/** 2D: what to fit (the content, the whole canvas, or a region); 3D: a camera preset, or a target and a distance. */
export type PatchView =
  | 'content' | 'canvas' | { x0: number; y0: number; x1: number; y1: number }
  | { preset: CameraPreset } | { target: [number, number, number]; distance: number };

/** next-boilerplate phase 35 §B.5 "The scene patch". Every part is optional. */
export interface ScenePatch {
  /** Replaces the things slot's rows (add, move, remove); read with the card's own thing columns. */
  things?: PatchThing[];
  /** By symbol, connection, marker or thing id. */
  objects?: Record<string, ObjectPatch>;
  links?: PatchLink[];
  shapes?: PatchShape[];
  view?: PatchView;
  /** Shown in the card's problem list. */
  problems?: string[];
}

export interface ParsedScenePatch {
  /** The valid part (null when there was no patch, or it was not an object). */
  patch: ScenePatch | null;
  /** What was dropped and why, as plain text (at most `MAX_PATCH_TEXT` characters each). */
  problems: string[];
}

// ── Plain values ─────────────────────────────────────────────────────────────

const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/;
/** The scene's own id grammar (a symbol id, a connection id, a column name). */
const SCENE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
/** A port as the scene parses it (`scada-scene-logic.ts` `parsePort`): an id, a side, optionally where along it. */
const PORT = /^\s*([A-Za-z_][A-Za-z0-9_.-]*?)[.:]([lrtb])(?::(\d*\.?\d+))?\s*$/;
// Control characters and the bidirectional overrides that could make a label read as something else (counted
// by code point, not matched by a pattern: nothing here needs a control character in a regular expression).
// The zero-width characters (space, joiners, word joiner, byte-order mark) draw nothing, so `pump1` and `pump1` with
// one of them would look the same in the inspector and the data list but be two ids: they count as unseen too.
const isZeroWidth = (c: number): boolean => (c >= 0x200b && c <= 0x200d) || c === 0x2060 || c === 0xfeff;
const isUnseen = (c: number): boolean =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || isZeroWidth(c);
// In a text a control character becomes a space and a zero-width one is dropped (it stood for no space).
const withoutUnseen = (s: string): string => {
  let o = '';
  for (const ch of s) { const c = ch.codePointAt(0) ?? 0; o += isZeroWidth(c) ? '' : isUnseen(c) ? ' ' : ch; }
  return o;
};
const hasUnseen = (s: string): boolean => { for (const ch of s) if (isUnseen(ch.codePointAt(0) ?? 0)) return true; return false; };

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Text as a person reads it: no control or direction characters, runs of space as one, trimmed, capped. */
export function plainText(v: unknown, max = MAX_PATCH_TEXT): string {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return withoutUnseen(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * An id of an object or a thing: a short text (or a finite number) with nothing unseen in it, never a prototype key
 * and never with a `*` in it (`*` and `things:*` are the rule wildcards, and the host's `*` gesture entry). It is
 * looser than the scene's own id grammar on purpose (a feed's ids are often numbers, or carry a space or a colon):
 * such a thing is placed, ruled and clickable, but a connection end follows the port grammar (`parsePort`), so a
 * thing a connection ends on needs an id that starts with a letter or `_` and holds only letters, digits, `_`, `.`, `-`.
 */
export function patchId(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return !s || s.length > 64 || hasUnseen(s) || s.includes('*') || UNSAFE_KEY.test(s) ? null : s;
}

const isSceneKey = (v: unknown): v is string => typeof v === 'string' && SCENE_KEY.test(v) && !UNSAFE_KEY.test(v);
const finiteIn = (v: unknown, lo: number, hi: number): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

/** A plain cell: a finite number, a yes / no, null, or a short plain text. Anything else is not a cell. */
function scalar(v: unknown): PatchScalar | undefined {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return plainText(v);
  return undefined;
}

/** A name for a problem line: the key as plain text, short. */
const named = (k: string): string => plainText(k, 24) || '?';

// ── The parts ────────────────────────────────────────────────────────────────

/** The 2D and 3D effects an object patch reads (the label is plain text, read on its own). */
const OBJECT_EFFECTS: EffectSpec = (() => {
  const { label: _label, ...scene } = SCENE_RULE_EFFECTS;
  return {
    ...scene,
    pulse: { kind: 'flag' },
    size: { kind: 'number', min: 0, max: 10_000 },
    dz: { kind: 'number', min: -100_000, max: 100_000 },
  };
})();
const OBJECT_KEYS = new Set([...Object.keys(OBJECT_EFFECTS), 'label', 'value', 'params']);

function parseObject(id: string, raw: unknown, problem: (text: string) => void): ObjectPatch | null {
  if (!isPlain(raw)) { problem(`objects.${named(id)} is not an object`); return null; }
  const { fx } = readEffects(raw, OBJECT_EFFECTS);
  const out: ObjectPatch = fx as ObjectPatch;
  for (const [key, v] of Object.entries(raw)) {
    if (v === undefined || (v === null && key !== 'value')) continue;
    if (!OBJECT_KEYS.has(key)) { problem(`objects.${named(id)}: unknown field ${named(key)} dropped`); continue; }
    if (key === 'label') {
      const label = plainText(v);
      if (label) out.label = label; else if (v !== '') problem(`objects.${named(id)}.label is not text`);
    } else if (key === 'value') {
      const cell = scalar(v);
      if (cell === undefined) problem(`objects.${named(id)}.value is not a plain value`); else out.value = cell;
    } else if (key === 'params') {
      if (!isPlain(v)) { problem(`objects.${named(id)}.params is not an object`); continue; }
      const params: Record<string, PatchScalar> = {};
      let n = 0;
      for (const [pk, pv] of Object.entries(v)) {
        const cell = scalar(pv);
        if (!isSceneKey(pk) || cell === undefined || n >= MAX_PATCH_COLUMNS) { problem(`objects.${named(id)}.params.${named(pk)} dropped`); continue; }
        params[pk] = cell;
        n += 1;
      }
      if (n) out.params = params;
    } else if (v !== '' && !Object.hasOwn(fx, key)) problem(`objects.${named(id)}.${named(key)} is not valid`);
  }
  // A symbol key and a medium are words of the scene's grammar, not free text.
  if (out.symbol !== undefined && !isSceneKey(out.symbol)) { delete out.symbol; problem(`objects.${named(id)}.symbol is not a symbol key`); }
  if (out.medium !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(out.medium)) { delete out.medium; problem(`objects.${named(id)}.medium is not a medium`); }
  return Object.keys(out).length ? out : null;
}

function parseThing(raw: unknown, at: number, seen: Set<string>, problem: (text: string) => void, dropped: { cells: number }): PatchThing | null {
  if (!isPlain(raw)) { problem(`things.${at} is not an object`); return null; }
  const row: PatchThing = {};
  let n = 0;
  for (const [key, v] of Object.entries(raw)) {
    const cell = scalar(v);
    if (!isSceneKey(key) || cell === undefined || n >= MAX_PATCH_COLUMNS) { dropped.cells += 1; continue; }
    row[key] = cell;
    n += 1;
  }
  // The contract's own `id` (another id column may stand in, so a row without one is kept): a bad one drops the row.
  if (Object.hasOwn(raw, 'id')) {
    const id = patchId(raw.id);
    if (id === null) { problem(`things.${at}: the id is not usable`); return null; }
    if (seen.has(id)) { problem(`things.${at}: the id ${named(id)} repeats`); return null; }
    seen.add(id);
    row.id = typeof raw.id === 'number' ? raw.id : id;
  }
  return row;
}

const LINK_KEYS = new Set(['from', 'to', 'kind', 'medium', 'id']);

function parseLink(raw: unknown, at: number, problem: (text: string) => void): PatchLink | null {
  if (!isPlain(raw)) { problem(`links.${at} is not an object`); return null; }
  const from = typeof raw.from === 'string' && PORT.test(raw.from) ? raw.from.trim() : null;
  const to = typeof raw.to === 'string' && PORT.test(raw.to) ? raw.to.trim() : null;
  if (!from || !to) { problem(`links.${at}: an end is not an id and a side (pump1.r)`); return null; }
  const out: PatchLink = { from, to, kind: 'pipe' };
  if (raw.kind !== undefined) {
    if (typeof raw.kind === 'string' && (PATCH_LINK_KINDS as readonly string[]).includes(raw.kind)) out.kind = raw.kind as PatchLinkKind;
    else problem(`links.${at}.kind is not a connection kind`);
  }
  if (raw.medium !== undefined) {
    if (typeof raw.medium === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(raw.medium)) out.medium = raw.medium;
    else problem(`links.${at}.medium is not a medium`);
  }
  if (raw.id !== undefined) {
    if (isSceneKey(raw.id)) out.id = raw.id;
    else problem(`links.${at}.id is not an id`);
  }
  for (const key of Object.keys(raw)) if (!LINK_KEYS.has(key)) problem(`links.${at}: unknown field ${named(key)} dropped`);
  return out;
}

const SHAPE_KEYS = new Set(['kind', 'x', 'y', 'w', 'h', 'text', 'size', 'align', 'tone', 'dashed']);
const SIZES = ['s', 'm', 'l'] as const;
const ALIGNS = ['start', 'middle', 'end'] as const;
const TONES = ['neutral', 'info', 'success', 'warning', 'error'] as const;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

function parseShape(raw: unknown, at: number, problem: (text: string) => void): PatchShape | null {
  if (!isPlain(raw)) { problem(`shapes.${at} is not an object`); return null; }
  const kind = raw.kind === 'text' || raw.kind === 'zone' ? raw.kind : null;
  const x = finiteIn(raw.x, -MAX_PATCH_COORD, MAX_PATCH_COORD); const y = finiteIn(raw.y, -MAX_PATCH_COORD, MAX_PATCH_COORD);
  if (!kind) { problem(`shapes.${at}: the kind is not text or zone`); return null; }
  if (x === null || y === null) { problem(`shapes.${at}: x and y must be numbers`); return null; }
  const out: PatchShape = { kind, x, y };
  const bad = (key: string) => problem(`shapes.${at}.${key} is not valid`);
  for (const key of ['w', 'h'] as const) {
    if (raw[key] === undefined) continue;
    const n = finiteIn(raw[key], 0, 4000);
    if (n === null) bad(key); else out[key] = n;
  }
  if (raw.text !== undefined) { const t = plainText(raw.text); if (t) out.text = t; else bad('text'); }
  if (raw.size !== undefined) { const v = oneOf(SIZES, raw.size); if (v) out.size = v; else bad('size'); }
  if (raw.align !== undefined) { const v = oneOf(ALIGNS, raw.align); if (v) out.align = v; else bad('align'); }
  if (raw.tone !== undefined) { const v = oneOf(TONES, raw.tone); if (v) out.tone = v; else bad('tone'); }
  if (raw.dashed !== undefined) { if (typeof raw.dashed === 'boolean') out.dashed = raw.dashed; else bad('dashed'); }
  if (kind === 'text' && !out.text) { problem(`shapes.${at}: a title has no words`); return null; }
  for (const key of Object.keys(raw)) if (!SHAPE_KEYS.has(key)) problem(`shapes.${at}: unknown field ${named(key)} dropped`);
  return out;
}

function parseView(raw: unknown, problem: (text: string) => void): PatchView | null {
  if (raw === 'content' || raw === 'canvas') return raw;
  if (isPlain(raw)) {
    const keys = Object.keys(raw).sort().join(',');
    if (keys === 'x0,x1,y0,y1') {
      const [x0, y0, x1, y1] = [raw.x0, raw.y0, raw.x1, raw.y1].map((v) => finiteIn(v, -MAX_PATCH_COORD, MAX_PATCH_COORD));
      if (x0 !== null && y0 !== null && x1 !== null && y1 !== null && x1 > x0 && y1 > y0) return { x0, y0, x1, y1 };
      problem('view: the region needs x0 < x1 and y0 < y1');
      return null;
    }
    if (keys === 'preset') {
      const preset = oneOf(CAMERA_PRESETS, raw.preset);
      if (preset) return { preset };
      problem('view.preset is not iso, top or front');
      return null;
    }
    if (keys === 'distance,target') {
      const t = Array.isArray(raw.target) && raw.target.length === 3 ? raw.target.map((v) => finiteIn(v, -1e7, 1e7)) : null;
      const distance = finiteIn(raw.distance, 0, 1e6);
      if (t && t.every((v) => v !== null) && distance !== null && distance > 0) return { target: t as [number, number, number], distance };
      problem('view: the target needs three numbers and a distance above 0');
      return null;
    }
  }
  problem('view is not one of the views a scene knows');
  return null;
}

// ── The patch ────────────────────────────────────────────────────────────────

const TOP_KEYS = new Set(['things', 'objects', 'links', 'shapes', 'view', 'problems']);

/**
 * A scene patch from anything (a script's result as the host passed it): the valid part, capped, and what was dropped.
 * `maxThings` is the card's own cap (500 for a 2D scene, the default; the 3D viewer passes its 2 000); past a cap the
 * first ones are kept and the rest counted in one problem, never a blank. Nothing that is not plain data survives.
 */
export function parseScenePatch(raw: unknown, { maxThings = MAX_PATCH_THINGS }: { maxThings?: number } = {}): ParsedScenePatch {
  if (raw === undefined || raw === null) return { patch: null, problems: [] };
  if (!isPlain(raw)) return { patch: null, problems: ['The scene patch is not an object'] };
  const all: string[] = [];
  const problem = (text: string) => { all.push(plainText(text)); };
  const patch: ScenePatch = {};
  const capped = (part: string, total: number, cap: number) => { if (total > cap) problem(`${part}: ${total} given, only the first ${cap} are used`); };

  for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) problem(`Unknown field ${named(key)} dropped`);

  if (raw.things !== undefined) {
    if (!Array.isArray(raw.things)) problem('things is not a list');
    else {
      const cap = Math.max(0, Math.floor(maxThings));
      capped('things', raw.things.length, cap);
      const seen = new Set<string>();
      const dropped = { cells: 0 };
      const things: PatchThing[] = [];
      raw.things.slice(0, cap).forEach((t, i) => { const row = parseThing(t, i, seen, problem, dropped); if (row) things.push(row); });
      if (dropped.cells) problem(`things: ${dropped.cells} cells that are not plain values were dropped`);
      patch.things = things;
    }
  }

  if (raw.objects !== undefined) {
    if (!isPlain(raw.objects)) problem('objects is not an object');
    else {
      const entries = Object.entries(raw.objects);
      capped('objects', entries.length, MAX_PATCH_OBJECTS);
      const objects: Record<string, ObjectPatch> = {};
      for (const [rawId, v] of entries.slice(0, MAX_PATCH_OBJECTS)) {
        const id = patchId(rawId);
        if (id === null || id !== rawId) { problem(`objects: the id ${named(rawId)} is not usable`); continue; }
        const o = parseObject(id, v, problem);
        if (o) objects[id] = o;
      }
      if (Object.keys(objects).length) patch.objects = objects;
    }
  }

  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) problem('links is not a list');
    else {
      capped('links', raw.links.length, MAX_PATCH_LINKS);
      const links = raw.links.slice(0, MAX_PATCH_LINKS).map((l, i) => parseLink(l, i, problem)).filter((l): l is PatchLink => !!l);
      if (links.length) patch.links = links;
    }
  }

  if (raw.shapes !== undefined) {
    if (!Array.isArray(raw.shapes)) problem('shapes is not a list');
    else {
      capped('shapes', raw.shapes.length, MAX_PATCH_SHAPES);
      const shapes = raw.shapes.slice(0, MAX_PATCH_SHAPES).map((h, i) => parseShape(h, i, problem)).filter((h): h is PatchShape => !!h);
      if (shapes.length) patch.shapes = shapes;
    }
  }

  if (raw.view !== undefined) {
    const view = parseView(raw.view, problem);
    if (view) patch.view = view;
  }

  if (raw.problems !== undefined) {
    if (!Array.isArray(raw.problems)) problem('problems is not a list');
    else {
      capped('problems', raw.problems.length, MAX_PATCH_PROBLEMS);
      const list = raw.problems.slice(0, MAX_PATCH_PROBLEMS).map((p) => plainText(p)).filter(Boolean);
      if (list.length) patch.problems = list;
    }
  }

  const problems = all.length > MAX_PARSE_PROBLEMS
    ? [...all.slice(0, MAX_PARSE_PROBLEMS - 1), `${all.length - MAX_PARSE_PROBLEMS + 1} more problems in the scene patch`]
    : all;
  return { patch, problems };
}

/** The ids of a patch's things under the card's id column (rows without a usable id are left out). */
export function patchThingIds(patch: ScenePatch | null | undefined, idColumn = 'id'): string[] {
  const out: string[] = [];
  for (const row of patch?.things ?? []) {
    const id = patchId(row[idColumn]);
    if (id !== null) out.push(id);
  }
  return out;
}
