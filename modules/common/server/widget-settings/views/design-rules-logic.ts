// Vendored from kui-react f7db139: modules/app/WidgetKit/views/design-rules-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The data-driven rules of the 3D design card (next-boilerplate phase 42.6, D42-11), pure and with no React. The engine is the
// shared one (`scene-rules-logic.ts`, the 2D diagram's and `viewer.model`'s): this file only gives it the design card's effect
// spec, the targets (the scene keys of the bound document), the translation of what the rules decided into kui-viewer 0.8.0's
// per-item `overrides` and `hidden`, the edits the Scene drawer's Rules step makes, and the checks the host's server repeats.
//
// A rule is one flat row, as in every other kind: `target` (a scene key of the document, or `*` for every one), `enabled`, `stop`,
// up to two conditions (`source`, `key`, `of`, `op`, `value`, `to`, then `join` and the same with a `2` suffix) and the effects
// `color`, `hidden`, `label` (with the tokens `{value}`, `{value2}`, `{condition}`, `{label}`, `{id}`, `{param:name}`), `pulse` and `highlight`.
// A condition reads a column of a row (the row of the target's own scene key, or of the key `of` names) or a board parameter.

import { asBoolean } from '../_ui/ControlTile/control-logic';
import { cssColor } from '../settings/style';
import { MAX_RULE_LABEL, MAX_SCENE_RULES, RULE_STATES, evaluateRules, validateRules, type EffectSpec, type RuleIssue } from './scene-rules-logic';

/** The effects a 3D design's rules offer: a tint, hiding, a text in place of the label, a pulse and an outline. */
export const DESIGN_RULE_EFFECTS: EffectSpec = {
  color: { kind: 'color' },
  hidden: { kind: 'flag' },
  label: { kind: 'label' },
  pulse: { kind: 'flag' },
  highlight: { kind: 'flag' },
};

/**
 * The rules of a stored 2D diagram's binding (phase 42.5.4, D42-11 for the `diagram` kind): the same flat row, with the effects the process scene's
 * own engine reads (`SCENE_RULE_EFFECTS`), a subset of them so one card draws what the Rules step offers: a state (`idle`, `running`, `warning`,
 * `critical`, `off`), a colour, hiding, a blink and a text in place of the label. The card lays them after the document's own rules, so there is no
 * second engine: a row of this dialect IS a scene rule.
 */
export const DIAGRAM_RULE_EFFECTS: EffectSpec = {
  state: { kind: 'enum', options: RULE_STATES, message: 'Choose a state' },
  color: { kind: 'color' },
  hidden: { kind: 'flag' },
  blink: { kind: 'flag' },
  label: { kind: 'label' },
};

/** The kind a rule row belongs to: the 3D card's (`design`, the default) or the stored 2D diagram's (`diagram`). */
export type RuleDialect = 'design' | 'diagram';

const CONTROL_FIELDS = ['target', 'enabled', 'stop', 'source', 'key', 'of', 'op', 'value', 'to', 'join', 'source2', 'key2', 'of2', 'op2', 'value2', 'to2'];

interface DialectSpec {
  effects: EffectSpec;
  fields: ReadonlySet<string>;
  flags: readonly string[];
  /** Whether a colour must be one kui-viewer takes (the 3D view), or any CSS colour the process scene draws. */
  viewerColors: boolean;
  /** "of the 3D card" in the message of a field the dialect does not have. */
  name: string;
}

const DIALECTS: Record<RuleDialect, DialectSpec> = {
  design: { effects: DESIGN_RULE_EFFECTS, fields: new Set([...CONTROL_FIELDS, ...Object.keys(DESIGN_RULE_EFFECTS)]), flags: ['enabled', 'stop', 'hidden', 'pulse', 'highlight'], viewerColors: true, name: 'the 3D card' },
  diagram: { effects: DIAGRAM_RULE_EFFECTS, fields: new Set([...CONTROL_FIELDS, ...Object.keys(DIAGRAM_RULE_EFFECTS)]), flags: ['enabled', 'stop', 'hidden', 'blink'], viewerColors: false, name: 'the 2D diagram' },
};

/** The fields a rule row of a diagram binding may carry. */
export const DIAGRAM_RULE_FIELDS: readonly string[] = [...DIALECTS.diagram.fields];

/** What the rules that matched decided for one scene key. A missing field means "no rule said anything". */
export interface DesignEffects {
  color?: string;
  hidden?: boolean;
  /** The text with its tokens already filled in. */
  label?: string;
  pulse?: boolean;
  highlight?: boolean;
}

/** The fields a design rule row may carry: the controls, two conditions and the effects. Anything else is not a rule of this kind. */
export const DESIGN_RULE_FIELDS: readonly string[] = [
  'target', 'enabled', 'stop',
  'source', 'key', 'of', 'op', 'value', 'to',
  'join', 'source2', 'key2', 'of2', 'op2', 'value2', 'to2',
  ...Object.keys(DESIGN_RULE_EFFECTS),
];
const TEXT_FIELDS = ['target', 'source', 'key', 'of', 'op', 'join', 'source2', 'key2', 'of2', 'op2'] as const;

/** The columns a rule's condition is offered for a 3D design's rows (the standard parameters an item reads, and the row's own label). Any name may still be typed. */
export const DESIGN_RULE_COLUMNS: ReadonlyArray<{ key: string }> = ['value', 'status', 'running', 'position', 'speed', 'direction', 'warning', 'critical', 'label'].map((key) => ({ key }));

/** The target that names every scene key of the document. */
export const DESIGN_ALL_TARGET = '*';
/** The most scene keys one evaluation takes as targets (kui-viewer reads at most 3000 overrides). */
export const MAX_DESIGN_RULE_TARGETS = 3000;
/** The longest text a field of a rule row holds, in characters (a condition value, a key, a colour). */
export const MAX_DESIGN_RULE_TEXT = 200;
/** Names a plain object would answer for without owning them; never a target. */
const RESERVED: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const isScalar = (v: unknown): boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** Whether a stored row is a rule of the design card: a flat record of known fields holding scalars. */
export function isDesignRule(v: unknown, dialect: RuleDialect = 'design'): v is Rec {
  if (!isRec(v)) return false;
  const fields = DIALECTS[dialect].fields;
  for (const [k, val] of Object.entries(v)) {
    if (!fields.has(k) || !isScalar(val)) return false;
    if (typeof val === 'string' && val.length > MAX_DESIGN_RULE_TEXT) return false;
  }
  return true;
}

// ── Colours ───────────────────────────────────────────────────────────────────

/**
 * The kit's theme tokens as the literals kui-viewer takes. The viewer reads no kit token (its own are `--kuiviewer-color-*`), so a
 * rule that says `var(--error)` is turned into a colour here. The three status colours are the viewer's own status literals, so a rule's
 * red looks like the `status` parameter's alarm.
 */
export const RULE_COLOR_LITERALS: Readonly<Record<string, string>> = {
  'var(--error)': '#f87171',
  'var(--warning)': '#fbbf24',
  'var(--success)': '#4ade80',
  'var(--info)': '#06b6d4',
  'var(--primary)': '#3b82f6',
  'var(--secondary)': '#8b5cf6',
  'var(--text-secondary)': '#94a3b8',
};

const VIEWER_COLOR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^()]*\)|hsla?\([^()]*\))$/i;

/** A rule's colour as the viewer takes it (hex, `rgb()`, `hsl()`), or undefined when it has none to give (`transparent`, an unknown token). */
export function viewerColor(value: unknown): string | undefined {
  const c = cssColor(value);
  if (!c) return undefined;
  if (Object.hasOwn(RULE_COLOR_LITERALS, c)) return RULE_COLOR_LITERALS[c];
  return VIEWER_COLOR.test(c) ? c : undefined;
}

/** The viewer's `status` words a colour stands for: red alarm, amber warn, green ok; any other colour none. */
export type DesignStatus = 'alarm' | 'warn' | 'ok';

/** The `status` an older viewer is given for a colour (the fallback of a viewer without overrides). */
export function statusOfColor(value: unknown): DesignStatus | undefined {
  const c = viewerColor(value);
  if (!c) return undefined;
  const rgb = toRgb(c);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((n) => n / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.15 || max < 0.35) return undefined;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 340) return 'alarm';
  if (h < 75) return 'warn';
  if (h >= 80 && h < 165) return 'ok';
  return undefined;
}

function toRgb(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (hex) {
    const d = hex[1]!;
    if (d.length <= 4) return [0, 1, 2].map((i) => parseInt(d[i]! + d[i]!, 16)) as [number, number, number];
    return [0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i.exec(c);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/i.exec(c);
  if (hsl) {
    const h = Number(hsl[1]); const s = Number(hsl[2]) / 100; const l = Number(hsl[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min((n + h / 30) % 12 - 3, Math.min(9 - ((n + h / 30) % 12), 1)))) * 255);
    return [f(0), f(8), f(4)];
  }
  return null;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export interface DesignRuleContext {
  /** The rows of the scene, each under its scene key in `id` (what the card hands the viewer). The last row of a key wins. */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** The scene keys the rules may target: the document's keys (a keyed design), or its item ids (an unkeyed one). */
  keys: Iterable<string>;
  /** The effective board parameters. */
  params?: Record<string, unknown>;
  /** A number as text for `{value}` and `{value2}`. */
  format?: (key: string, n: number) => string;
  /** The host's words of an on / off reading in `{condition}`; default On / Off. */
  onOff?: { on: string; off: string };
}

/**
 * What the rules decided per scene key. A rule whose target is not one of `keys` (a stale key, a deleted item) does nothing; so does one
 * that is disabled or malformed; `null` or no rules is an empty map. Prototype-named keys are never targets.
 */
export function designRuleEffects(rules: unknown, ctx: DesignRuleContext): Map<string, DesignEffects> {
  if (!Array.isArray(rules) || rules.length === 0) return new Map();
  const rows = new Map<string, Rec>();
  for (const r of ctx.rows) {
    const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    if (id && !RESERVED.has(id)) rows.set(id, r);
  }
  const targets: string[] = [];
  for (const k of ctx.keys) {
    if (targets.length >= MAX_DESIGN_RULE_TARGETS) break;
    if (typeof k === 'string' && k !== '' && !RESERVED.has(k)) targets.push(k);
  }
  if (targets.length === 0) return new Map();
  return evaluateRules<DesignEffects>(rules, {
    rows, params: ctx.params ?? {}, targets, effects: DESIGN_RULE_EFFECTS, ...(ctx.format ? { format: ctx.format } : {}), ...(ctx.onOff ? { onOff: ctx.onOff } : {}),
  });
}

/** One item's override as kui-viewer 0.8.0 takes it (`ItemOverride`). */
export interface DesignOverride {
  color?: string;
  highlight?: boolean;
  label?: string;
  pulse?: boolean;
}

export interface DesignRuleResult {
  /** By scene key: only the keys with an effect to draw. Never has a prototype name as a key. */
  overrides: Record<string, DesignOverride>;
  /** The keys a rule hides, in order. */
  hidden: string[];
  /** The `status` an older viewer is given instead, by key (red alarm, amber warn, green ok; a pulse alone is an alarm). */
  statuses: Record<string, DesignStatus>;
}

/** The effects of the rules as overrides, hidden keys and, for an older viewer, statuses. */
export function designResult(effects: ReadonlyMap<string, DesignEffects>): DesignRuleResult {
  const overrides: Array<[string, DesignOverride]> = [];
  const statuses: Array<[string, DesignStatus]> = [];
  const hidden: string[] = [];
  for (const [key, fx] of effects) {
    if (RESERVED.has(key)) continue;
    if (fx.hidden === true) hidden.push(key);
    const color = fx.color === undefined ? undefined : viewerColor(fx.color);
    const o: DesignOverride = {
      ...(color ? { color } : {}),
      ...(fx.highlight === true ? { highlight: true } : {}),
      ...(fx.pulse === true ? { pulse: true } : {}),
      ...(fx.label ? { label: fx.label } : {}),
    };
    if (Object.keys(o).length > 0) overrides.push([key, o]);
    const status = fx.color === undefined ? undefined : statusOfColor(fx.color);
    if (status) statuses.push([key, status]);
    else if (fx.pulse === true) statuses.push([key, 'alarm']);
  }
  return { overrides: Object.fromEntries(overrides), hidden, statuses: Object.fromEntries(statuses) };
}

/** `designRuleEffects` and `designResult` in one. */
export function designRules(rules: unknown, ctx: DesignRuleContext): DesignRuleResult {
  return designResult(designRuleEffects(rules, ctx));
}

// ── Checks ────────────────────────────────────────────────────────────────────

/**
 * What is wrong with a rules list for the design card: the engine's own checks (operators, values, label length, the cap) and the shape
 * of every row (a flat record of known fields). The targets are NOT judged here, only the document knows them: `staleReferences`.
 * The server repeats this function, so what the drawer accepts the route accepts.
 */
export function designRuleIssues(rules: unknown, dialect: RuleDialect = 'design'): RuleIssue[] {
  const spec = DIALECTS[dialect];
  const list = Array.isArray(rules) ? rules : [];
  const issues: RuleIssue[] = [];
  if (list.length > MAX_SCENE_RULES) issues.push({ path: 'rules', message: `At most ${MAX_SCENE_RULES} rules` });
  list.forEach((r, i) => {
    const at = (f: string) => `rules.${i}.${f}`;
    if (!isRec(r)) {
      issues.push({ path: `rules.${i}`, message: 'A rule is a flat row of fields' });
      return;
    }
    for (const [k, v] of Object.entries(r)) {
      if (!spec.fields.has(k)) issues.push({ path: at(k), message: `"${k}" is not a field of a rule of ${spec.name}` });
      else if (!isScalar(v)) issues.push({ path: at(k), message: `${k} must be a text, a number or yes / no` });
      else if (typeof v === 'string' && v.length > MAX_DESIGN_RULE_TEXT) issues.push({ path: at(k), message: `${k} is at most ${MAX_DESIGN_RULE_TEXT} characters` });
    }
    for (const f of spec.flags) {
      const v = r[f];
      if (v !== undefined && v !== '' && asBoolean(v) === null) issues.push({ path: at(f), message: `${f} is yes or no` });
    }
    for (const f of TEXT_FIELDS) {
      if (r[f] !== undefined && typeof r[f] !== 'string') issues.push({ path: at(f), message: `${f} must be text` });
    }
    const c = r.color;
    if (c !== undefined && c !== '' && !cssColor(c)) issues.push({ path: at('color'), message: 'The colour is not a colour' });
    else if (spec.viewerColors && typeof c === 'string' && c !== '' && !viewerColor(c)) issues.push({ path: at('color'), message: 'The 3D view takes a hex, rgb or hsl colour or one of the theme colours' });
    if (text(r.target) === '') issues.push({ path: at('target'), message: 'Choose a scene key or *', ruleCode: 'target-missing' });
    else if (RESERVED.has(text(r.target))) issues.push({ path: at('target'), message: 'A key may not be __proto__, constructor or prototype' });
  });
  // the engine's checks on the rows that have the shape of a rule, reported at their place in the list
  const rows = list.map((r) => (isRec(r) ? r : {}));
  for (const i of validateRules(rows, { elementIds: [], fromData: true }, spec.effects)) {
    if (!/\.target$/.test(i.path) && !issues.some((x) => x.path === i.path)) issues.push(i);
  }
  return issues;
}

export interface StaleReference {
  /** The rule's place in the list. */
  index: number;
  field: 'target' | 'of' | 'of2';
  /** The key the rule names that the document does not have. */
  name: string;
}

/**
 * The names the rules use that the document has no scene key for: a `target` (not `*`) and an `of` / `of2` row. Reported, never dropped:
 * the rule is kept and does nothing while the key is missing (a design edited since, a key renamed), and the author is told.
 */
export function staleReferences(rules: unknown, keys: Iterable<string>): StaleReference[] {
  const known = new Set(keys);
  const out: StaleReference[] = [];
  (Array.isArray(rules) ? rules : []).forEach((r, index) => {
    if (!isRec(r)) return;
    for (const field of ['target', 'of', 'of2'] as const) {
      const name = text(r[field]);
      if (name && name !== DESIGN_ALL_TARGET && !known.has(name)) out.push({ index, field, name });
    }
  });
  return out;
}

// ── Edits (the drawer's Rules step) ───────────────────────────────────────────

export interface RulesEdit {
  rules: unknown[];
  /** The place of the rule the edit added or moved. */
  index?: number;
  /** Why nothing changed. */
  refused?: string;
}

const refuse = (rules: unknown[], why: string): RulesEdit => ({ rules, refused: why });

/** A field's value as it is stored, or why it cannot be (an empty one removes an optional field). */
function normalise(field: string, v: unknown, dialect: RuleDialect): { value: unknown } | string {
  const spec = DIALECTS[dialect];
  if (!spec.fields.has(field)) return `"${field}" is not a rule field`;
  if (v === undefined || v === null || v === '') return { value: undefined };
  if (spec.flags.includes(field)) {
    const b = asBoolean(v);
    return b === null ? `${field} is yes or no` : { value: b };
  }
  if (typeof v !== 'string' && typeof v !== 'number') return `${field} must be text`;
  const s = String(v);
  if (s.length > MAX_DESIGN_RULE_TEXT) return `${field} is at most ${MAX_DESIGN_RULE_TEXT} characters`;
  if (field === 'label' && s.length > MAX_RULE_LABEL) return `label is at most ${MAX_RULE_LABEL} characters`;
  return { value: s };
}

function patched(rule: Rec, patch: Rec, dialect: RuleDialect): Rec | string {
  const next: Rec = { ...rule };
  for (const [k, v] of Object.entries(patch)) {
    const r = normalise(k, v, dialect);
    if (typeof r === 'string') return r;
    if (r.value === undefined) delete next[k];
    else next[k] = r.value;
  }
  return next;
}

/** A new rule: on, aimed at `seed.target` if given, with whatever else `seed` says. */
export function newDesignRule(seed: Rec = {}, dialect: RuleDialect = 'design'): Rec {
  const row = patched({ enabled: true }, seed, dialect);
  return typeof row === 'string' ? { enabled: true } : row;
}

/** Adds a rule at `at` (default last). Refused past the cap or for a bad field. */
export function addDesignRule(rules: readonly unknown[], seed: Rec = {}, at?: number, dialect: RuleDialect = 'design'): RulesEdit {
  const list = [...rules];
  if (list.length >= MAX_SCENE_RULES) return refuse(list, `A scene holds at most ${MAX_SCENE_RULES} rules`);
  const row = patched({ enabled: true }, seed, dialect);
  if (typeof row === 'string') return refuse(list, row);
  const index = at === undefined ? list.length : Math.min(list.length, Math.max(0, Math.trunc(at)));
  list.splice(index, 0, row);
  return { rules: list, index };
}

/** Writes some fields of one rule; an empty value removes the field. Nothing changes (the same list comes back) when nothing differs. */
export function updateDesignRule(rules: readonly unknown[], index: number, patch: Rec, dialect: RuleDialect = 'design'): RulesEdit {
  const list = [...rules];
  const rule = list[index];
  if (!isRec(rule)) return refuse(list, 'No such rule');
  const next = patched(rule, patch, dialect);
  if (typeof next === 'string') return refuse(list, next);
  if (JSON.stringify(next) === JSON.stringify(rule)) return { rules: list, index };
  list[index] = next;
  return { rules: list, index };
}

/** Removes one rule (a row this kind does not read included). */
export function removeDesignRule(rules: readonly unknown[], index: number): RulesEdit {
  if (index < 0 || index >= rules.length) return refuse([...rules], 'No such rule');
  return { rules: rules.filter((_, i) => i !== index) };
}

/** Moves a rule one place earlier or later; at either end nothing changes. */
export function moveDesignRule(rules: readonly unknown[], index: number, dir: 'up' | 'down'): RulesEdit {
  const list = [...rules];
  if (index < 0 || index >= list.length) return refuse(list, 'No such rule');
  const to = index + (dir === 'up' ? -1 : 1);
  if (to < 0 || to >= list.length) return { rules: list, index };
  const [moved] = list.splice(index, 1);
  list.splice(to, 0, moved);
  return { rules: list, index: to };
}

/** A copy of a rule right after it. Refused past the cap. */
export function duplicateDesignRule(rules: readonly unknown[], index: number): RulesEdit {
  const list = [...rules];
  const rule = list[index];
  if (!isRec(rule)) return refuse(list, 'No such rule');
  if (list.length >= MAX_SCENE_RULES) return refuse(list, `A scene holds at most ${MAX_SCENE_RULES} rules`);
  list.splice(index + 1, 0, { ...rule });
  return { rules: list, index: index + 1 };
}

// ── The sentence ──────────────────────────────────────────────────────────────

/** The words a rule is read in. The drawer's messages carry them in the host's language; `DEFAULT_DESIGN_RULE_WORDS` is English. */
export interface DesignRuleWords {
  when: string;
  always: string;
  and: string;
  or: string;
  off: string;
  /** "parameter {name}" */
  param: string;
  ofThis: string;
  /** "of {id}" */
  of: string;
  /** "For {target}" */
  forTarget: string;
  forEvery: string;
  ops: { eq: string; ne: string; gt: string; gte: string; lt: string; lte: string; between: string; in: string; set: string; unset: string; true: string; false: string };
  /** "colour it {color}" */
  color: string;
  hide: string;
  show: string;
  /** "show '{label}'" */
  label: string;
  pulseOn: string;
  pulseOff: string;
  highlightOn: string;
  highlightOff: string;
  /** The 2D diagram's effects (phase 42.5.4): "set it {state}", a blink on or off. */
  stateIs: string;
  blinkOn: string;
  blinkOff: string;
  stop: string;
  nothing: string;
}

export const DEFAULT_DESIGN_RULE_WORDS: DesignRuleWords = {
  when: 'When', always: 'Always', and: 'and', or: 'or', off: '(off)', param: 'parameter {name}', ofThis: 'of this item', of: 'of {id}',
  forTarget: 'For {target}', forEvery: 'For every item',
  ops: {
    eq: 'is {value}', ne: 'is not {value}', gt: 'is above {value}', gte: 'is at least {value}', lt: 'is below {value}', lte: 'is at most {value}',
    between: 'is between {value} and {to}', in: 'is one of {list}', set: 'is set', unset: 'is not set', true: 'is on', false: 'is off',
  },
  color: 'colour it {color}', hide: 'hide it', show: 'show it', label: "show '{label}'", pulseOn: 'pulse', pulseOff: 'not pulse',
  highlightOn: 'outline it', highlightOff: 'not outline it', stateIs: 'set it {state}', blinkOn: 'blink', blinkOff: 'not blink', stop: 'then stop', nothing: 'change nothing',
};

const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);

const COLOUR_WORDS: Record<string, string> = {
  'var(--error)': 'red', 'var(--warning)': 'amber', 'var(--success)': 'green', 'var(--info)': 'cyan', 'var(--primary)': 'blue',
  'var(--secondary)': 'purple', 'var(--text-secondary)': 'grey',
};

export interface DescribeDesignOptions {
  /** Start with "For pump1:". */
  withTarget?: boolean;
  /** A column or parameter as the author knows it (default: the key). */
  columnLabel?: (key: string) => string | undefined;
  paramLabel?: (key: string) => string | undefined;
}

function condition(r: Rec, n: '' | '2', words: DesignRuleWords, o: DescribeDesignOptions): string {
  const op = text(n ? r.op2 : r.op);
  if (!op) return '';
  const param = (n ? r.source2 : r.source) === 'param';
  const key = text(n ? r.key2 : r.key) || '...';
  const of = text(n ? r.of2 : r.of);
  const name = param ? fill(words.param, { name: o.paramLabel?.(key) ?? key }) : o.columnLabel?.(key) ?? key;
  const where = param ? '' : ` ${of ? fill(words.of, { id: of }) : words.ofThis}`;
  const phrase = (words.ops as Record<string, string>)[op];
  const v = text(n ? r.value2 : r.value);
  const says = phrase === undefined ? op : fill(phrase, { value: v, to: text(n ? r.to2 : r.to), list: v.split(',').map((x) => x.trim()).filter(Boolean).join(', ') });
  return `${name}${where} ${says}`;
}

const list = (parts: string[], and: string) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}` : parts[0] ?? '');

/** A rule as a sentence: "When Value of this item is above 80, colour it red and pulse". */
export function describeDesignRule(rule: unknown, words: DesignRuleWords = DEFAULT_DESIGN_RULE_WORDS, o: DescribeDesignOptions = {}): string {
  if (!isRec(rule)) return '';
  const first = condition(rule, '', words, o);
  const second = first ? condition(rule, '2', words, o) : '';
  const when = !first ? words.always : `${words.when} ${first}${second ? ` ${rule.join === 'any' ? words.or : words.and} ${second}` : ''}`;
  const fx: string[] = [];
  const colour = text(rule.color);
  if (colour) fx.push(fill(words.color, { color: COLOUR_WORDS[colour] ?? colour }));
  const yes = (v: unknown) => (v === undefined || v === '' ? undefined : asBoolean(v) ?? undefined);
  const hidden = yes(rule.hidden); if (hidden !== undefined) fx.push(hidden ? words.hide : words.show);
  if (text(rule.label)) fx.push(fill(words.label, { label: text(rule.label) }));
  const state = text(rule.state);
  if (state) fx.unshift(fill(words.stateIs, { state }));
  const pulse = yes(rule.pulse); if (pulse !== undefined) fx.push(pulse ? words.pulseOn : words.pulseOff);
  const blink = yes(rule.blink); if (blink !== undefined) fx.push(blink ? words.blinkOn : words.blinkOff);
  const highlight = yes(rule.highlight); if (highlight !== undefined) fx.push(highlight ? words.highlightOn : words.highlightOff);
  const stop = rule.stop === true || rule.stop === 'true' ? `, ${words.stop}` : '';
  const target = text(rule.target);
  const lead = o.withTarget ? `${target === DESIGN_ALL_TARGET ? words.forEvery : fill(words.forTarget, { target: target || '...' })}: ` : '';
  const sentence = `${lead}${when}, ${list(fx, words.and) || words.nothing}${stop}`;
  return rule.enabled === false || rule.enabled === 'false' ? `${sentence} ${words.off}` : sentence;
}
