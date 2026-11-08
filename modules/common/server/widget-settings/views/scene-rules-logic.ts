// Vendored from kui-react f7db139: modules/app/WidgetKit/views/scene-rules-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The data-driven rules of the process scene, and of every other kind with rules (pure, no React): a rule names a
// target (a symbol id, a connection id, a marker or thing id, `*` for all of them, or `things:*` for every thing
// only), up to two conditions on the bound table or on a board parameter, and the effects to apply while they hold. Rules run top to bottom; every enabled rule that
// matches applies, a later rule overrides the same effect, and `stop` ends the evaluation for that target. The
// targets and the effects are data: a kind hands the engine its target ids and an `EffectSpec` naming the effect
// fields it reads (the process scene's is `SCENE_RULE_EFFECTS`, the default; the 3D viewer's lives with its logic).
// `sceneModel` and `applyViewerRules` apply the result; kui-ejs and KUInative vendor this file, and next-boilerplate
// keeps a server-safe copy of it.
//
// A rule is one flat row (the settings form has no nested lists):
//   target, enabled, stop
//   source ('column' | 'param'), key, of, op, value, to        (first condition)
//   join ('all' | 'any'), source2, key2, of2, op2, value2, to2 (second condition, used when op2 is set)
//   the effect fields of the kind's spec (empty = no change), e.g. the scene's
//   state, color, fillColor, dim, blink, hidden, label, medium, animate,
//   dx, dy (an offset in scene units), scale (a factor), turn, symbol (another drawing)

import { asBoolean, asNumber } from '../_ui/ControlTile/control-logic';
import { cssColor } from '../settings/style';

type Row = Record<string, unknown>;

export const MAX_SCENE_RULES = 200;
/** The longest label an effect can produce, in characters. */
export const MAX_RULE_LABEL = 80;

import { parseMode, parseQuality, SYMBOL_MODES, SYMBOL_QUALITIES, type SymbolMode, type SymbolQuality } from './scada-states';

export const RULE_STATES = ['idle', 'running', 'warning', 'critical', 'off'] as const;
export type RuleState = (typeof RULE_STATES)[number];
/** The quarter turns a symbol is drawn at, as the element settings store them. */
export const RULE_TURNS = ['0', '90', '180', '270'] as const;
export type RuleTurn = (typeof RULE_TURNS)[number];
/** A rule target that names every thing from data (and nothing authored). `*` names everything, things included. */
export const THINGS_TARGET = 'things:*';
/** How far an offset effect may move a target, in scene units, either way (the largest canvas). */
export const MAX_RULE_OFFSET = 4000;
export const RULE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'set', 'unset', 'true', 'false'] as const;
export type RuleOp = (typeof RULE_OPS)[number];
export type RuleSource = 'column' | 'param';

/**
 * How an effect field of a rule row is read: a yes / no flag, a colour (`cssColor`), a trimmed text, a number kept
 * within bounds, one of a list (an optional `parse` accepts the words the kind knows), or a label: a text with tokens,
 * filled in per target once the rules ran (`expandLabel`), capped at `MAX_RULE_LABEL`. Anything malformed is simply
 * not an effect.
 */
export type EffectKind =
  | { kind: 'flag' }
  | { kind: 'color' }
  | { kind: 'text' }
  | { kind: 'label' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'enum'; options: readonly string[]; parse?: (v: unknown) => string | null; message?: string };

/** The effects one kind of rules offers, by rule-row field: the engine reads and validates exactly these. */
export type EffectSpec = Record<string, EffectKind>;

/** A quarter turn from a rule row: `90` or `'90'` (the element settings' words); anything else is not a turn. */
export function parseTurn(v: unknown): RuleTurn | null {
  const n = asNumber(v);
  return n !== null && (RULE_TURNS as readonly string[]).includes(String(n)) ? (String(n) as RuleTurn) : null;
}

/** The process scene's effects (what `SceneEffects` types and `sceneModel` applies). The default spec. */
export const SCENE_RULE_EFFECTS: EffectSpec = {
  state: { kind: 'enum', options: RULE_STATES, message: 'Choose a state' },
  color: { kind: 'color' },
  fillColor: { kind: 'color' },
  dim: { kind: 'flag' },
  blink: { kind: 'flag' },
  hidden: { kind: 'flag' },
  animate: { kind: 'flag' },
  reverse: { kind: 'flag' },
  ack: { kind: 'flag' },
  pending: { kind: 'flag' },
  failed: { kind: 'flag' },
  mode: { kind: 'enum', options: SYMBOL_MODES, parse: parseMode, message: 'Choose a mode' },
  quality: { kind: 'enum', options: SYMBOL_QUALITIES, parse: parseQuality, message: 'Choose a data quality' },
  speed: { kind: 'number', min: 0, max: 400 },
  position: { kind: 'number', min: 0, max: 100 },
  label: { kind: 'label' },
  medium: { kind: 'text' },
  // Where and how big (phase 35): an offset from the authored place, a size factor over the symbol's own, a quarter
  // turn instead of its own, and another drawing. `sceneModel` draws the placeholder for a symbol key it cannot draw.
  dx: { kind: 'number', min: -MAX_RULE_OFFSET, max: MAX_RULE_OFFSET },
  dy: { kind: 'number', min: -MAX_RULE_OFFSET, max: MAX_RULE_OFFSET },
  scale: { kind: 'number', min: 0.2, max: 4 },
  turn: { kind: 'enum', options: RULE_TURNS, parse: parseTurn, message: 'Choose 0, 90, 180 or 270' },
  symbol: { kind: 'text' },
};

export interface SceneRule {
  enabled?: boolean;
  /** A symbol id, a connection id, a thing id, `*` (every symbol, connection and thing) or `things:*` (every thing). */
  target?: string;
  stop?: boolean;
  source?: RuleSource | string;
  /** The column of the table, or the name of the board parameter. */
  key?: string;
  /** The id of the row the column is read from (empty = the target's own row). */
  of?: string;
  op?: RuleOp | string;
  value?: string | number;
  /** The upper end of `between`. */
  to?: string | number;
  join?: 'all' | 'any' | string;
  source2?: RuleSource | string;
  key2?: string;
  of2?: string;
  op2?: RuleOp | string;
  value2?: string | number;
  to2?: string | number;
  state?: RuleState | string;
  color?: string;
  fillColor?: string;
  dim?: boolean | string;
  blink?: boolean | string;
  hidden?: boolean | string;
  label?: string;
  medium?: string;
  animate?: boolean | string;
  /** States layer (`scada-states.ts`): mode, data quality, speed in percent, direction, alarm acknowledgement, opening, command in flight. */
  mode?: string;
  quality?: string;
  speed?: number | string;
  reverse?: boolean | string;
  ack?: boolean | string;
  position?: number | string;
  pending?: boolean | string;
  failed?: boolean | string;
  /** Moves the target by this many scene units (clamped to ±`MAX_RULE_OFFSET`); connections follow it. */
  dx?: number | string;
  dy?: number | string;
  /** Draws the target this many times its own size (0.2 to 4). */
  scale?: number | string;
  /** Draws the target at this quarter turn instead of its own (`'0'`, `'90'`, `'180'`, `'270'`). */
  turn?: number | string;
  /** Draws the target as another symbol (a SCADA symbol key; an unknown or locked one draws the placeholder). */
  symbol?: string;
  /** The effect fields of another kind's spec (the 3D viewer's `pulse`, `size`, `dz`). */
  [effect: string]: unknown;
}

/** What the rules that matched decided for one target. A missing key means "no rule said anything". */
export interface SceneEffects {
  state?: RuleState;
  /** The accent: replaces the state colour. */
  color?: string;
  fillColor?: string;
  dim?: boolean;
  blink?: boolean;
  hidden?: boolean;
  /** The text with its tokens already filled in. */
  label?: string;
  medium?: string;
  /** `false` stops the motion of the target. */
  animate?: boolean;
  mode?: SymbolMode;
  quality?: SymbolQuality;
  /** Percent of nominal speed (0 = stalled). */
  speed?: number;
  reverse?: boolean;
  ack?: boolean;
  position?: number;
  pending?: boolean;
  failed?: boolean;
  /** An offset from the authored place, scene units. */
  dx?: number;
  dy?: number;
  /** A factor over the target's own size. */
  scale?: number;
  /** The quarter turn that replaces the target's own. */
  turn?: RuleTurn;
  /** The symbol key drawn instead of the target's own. */
  symbol?: string;
}

export interface RuleContext {
  /** The rows of the bound table by id. */
  rows: Map<string, Row>;
  /** The effective board parameters. */
  params?: Record<string, unknown>;
  /** What `*` stands for (the ids of the symbols and connections, or of the markers and things). Default: the ids of `rows`. */
  targets?: Iterable<string>;
  /**
   * The ids of the things from data among the targets: what `things:*` stands for. A thing id is a target even when
   * `targets` leaves it out (so `*` and an id name it too). Absent = no things, and `things:*` names nothing.
   */
  thingIds?: Iterable<string>;
  /** A number as text for `{value}` and `{value2}` (the host's words, unit included); default: the number itself. */
  format?: (targetId: string, n: number) => string;
  /**
   * The words an on / off reading prints in `{condition}`: the host's, as its state card words one (`stat.on` / `stat.off`; "Açık" / "Kapalı" in a
   * Turkish workspace). Default "On" / "Off", never the data's `true` / `false` (next-boilerplate phase 52.6.1).
   */
  onOff?: { on: string; off: string };
  /** The effect fields this kind of rules reads. Default: the process scene's (`SCENE_RULE_EFFECTS`). */
  effects?: EffectSpec;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const isOp = (v: unknown): v is RuleOp => typeof v === 'string' && (RULE_OPS as readonly string[]).includes(v);
const scalar = (v: unknown): string | number | boolean | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  return typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
};

// ── Conditions ────────────────────────────────────────────────────────────────

/** Two values equal: numbers numerically, a boolean through the controls' coercion, anything else as text, case-insensitive. */
function equal(actual: string | number | boolean, expected: unknown): boolean {
  const a = asNumber(actual); const b = asNumber(expected);
  if (a !== null && b !== null) return a === b;
  if (typeof actual === 'boolean') {
    const e = asBoolean(expected);
    return e !== null && e === actual;
  }
  return String(actual).trim().toLowerCase() === String(expected ?? '').trim().toLowerCase();
}

/** One operator on one reading. A missing reading (`undefined`) matches only `unset`. */
export function compare(op: string, actual: unknown, value: unknown, to?: unknown): boolean {
  const have = scalar(actual);
  if (op === 'unset') return have === undefined;
  if (have === undefined) return false;
  switch (op) {
    case 'set': return true;
    case 'true': return asBoolean(have) === true;
    case 'false': return asBoolean(have) === false;
    case 'eq': return equal(have, value);
    case 'ne': return !equal(have, value);
    case 'in': return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean).some((item) => equal(have, item));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = asNumber(have); const b = asNumber(value);
      if (a === null || b === null) return false;
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
    }
    case 'between': {
      const a = asNumber(have); const lo = asNumber(value); const hi = asNumber(to);
      if (a === null || lo === null || hi === null) return false;
      return a >= Math.min(lo, hi) && a <= Math.max(lo, hi);
    }
    default: return false;
  }
}

/** The reading a condition looks at: a column of a row, or a board parameter. `undefined` when it is not there. */
function reading(source: unknown, key: string, of: string, target: string, ctx: RuleContext): unknown {
  if (!key) return undefined;
  if (source === 'param') return ctx.params && Object.hasOwn(ctx.params, key) ? ctx.params[key] : undefined;
  const row = ctx.rows.get(of || target);
  return row && Object.hasOwn(row, key) ? row[key] : undefined;
}

/** Whether a rule's conditions hold for a target. No operator on the first condition = always. */
export function ruleMatches(rule: SceneRule, target: string, ctx: RuleContext): boolean {
  const op = text(rule.op);
  if (!op) return true;
  const first = compare(op, reading(rule.source, text(rule.key), text(rule.of), target, ctx), rule.value, rule.to);
  const op2 = text(rule.op2);
  if (!op2) return first;
  const second = compare(op2, reading(rule.source2, text(rule.key2), text(rule.of2), target, ctx), rule.value2, rule.to2);
  return rule.join === 'any' ? first || second : first && second;
}

// ── Labels ────────────────────────────────────────────────────────────────────

const DASH = '—';

/**
 * The token for the value the rule's own condition reads (next-boilerplate D584, UI test 3 #32: a valve's label "{value}" printed the valve's own
 * reading, "—", where the author wanted the hold temperature the rule tests): `{condition}`, or `{koşul}` as a Turkish workspace writes it. `{value}`
 * stays the target's own reading.
 */
export const CONDITION_TOKENS = ['{condition}', '{koşul}'] as const;

/**
 * Fills `{value}`, `{value2}`, `{label}`, `{id}`, `{param:name}` and, given the rule, `{condition}` (`{koşul}`: what its first condition reads, of the
 * symbol it names or a board parameter, worded as `{value}` is, an on / off reading in the host's words (`onOff`); "—" when it is not there); control
 * characters go, the length is capped.
 */
export function expandLabel(template: string, target: string, ctx: RuleContext, rule?: SceneRule): string {
  const row = ctx.rows.get(target);
  const fmt = (n: number, of = target) => (ctx.format ? ctx.format(of, n) : String(Math.round(n * 100) / 100));
  const num = (key: string) => {
    const v = row && Object.hasOwn(row, key) ? row[key] : undefined;
    const n = asNumber(v);
    if (n !== null) return fmt(n);
    return typeof v === 'string' && v ? v : DASH;
  };
  const condition = () => {
    if (!rule) return DASH;
    const of = text(rule.of);
    const v = scalar(reading(rule.source, text(rule.key), of, target, ctx));
    if (v === undefined) return DASH;
    if (typeof v === 'boolean') return v ? (ctx.onOff?.on || 'On') : (ctx.onOff?.off || 'Off');
    const n = asNumber(v);
    return n !== null && rule.source !== 'param' ? fmt(n, of || target) : String(v);
  };
  const out = template.replace(/\{(value2?|label|id|condition|koşul|param:[^{}]{1,64})\}/g, (_m, token: string) => {
    if (token === 'value' || token === 'value2') return num(token);
    if (token === 'condition' || token === 'koşul') return condition();
    if (token === 'id') return target;
    if (token === 'label') return row && typeof row.label === 'string' ? row.label : '';
    const name = token.slice(6).trim();
    const v = ctx.params && Object.hasOwn(ctx.params, name) ? scalar(ctx.params[name]) : undefined;
    return v === undefined ? DASH : String(v);
  });
   
  return out.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_RULE_LABEL);
}

// ── Evaluation ────────────────────────────────────────────────────────────────

const flag = (v: unknown): boolean | undefined => asBoolean(v) ?? undefined;

/** One of an enum effect's options: through the kind's own words (`parse`) when it has them, else the option itself. */
const enumOf = (e: Extract<EffectKind, { kind: 'enum' }>, v: unknown): string | null =>
  (e.parse ? e.parse(v) : typeof v === 'string' && e.options.includes(v) ? v : null);

/**
 * The effects one rule asks for under a spec (the label as its raw template). Anything malformed is simply not an
 * effect. Exported for the scene patch (`scene-patch.ts`), which reads its per-object overrides the same way.
 */
export function readEffects(rule: SceneRule | Record<string, unknown>, spec: EffectSpec): { fx: Record<string, unknown>; labelTemplate?: string } {
  const fx: Record<string, unknown> = {};
  let labelTemplate: string | undefined;
  for (const [key, e] of Object.entries(spec)) {
    const v = rule[key];
    if (e.kind === 'flag') {
      const b = flag(v);
      if (b !== undefined) fx[key] = b;
    } else if (e.kind === 'color') {
      const c = cssColor(v);
      if (c) fx[key] = c;
    } else if (e.kind === 'text') {
      if (typeof v === 'string' && v.trim()) fx[key] = v.trim();
    } else if (e.kind === 'label') {
      if (typeof v === 'string' && v.trim()) labelTemplate = v;
    } else if (e.kind === 'number') {
      const n = asNumber(v);
      if (n !== null && v !== '') fx[key] = Math.min(e.max ?? Infinity, Math.max(e.min ?? -Infinity, n));
    } else {
      const o = enumOf(e, v);
      if (o) fx[key] = o;
    }
  }
  return { fx, labelTemplate };
}

/**
 * The effects per target id, under the context's spec (the scene's by default; `T` is what that spec decides, e.g.
 * `SceneEffects`). A target that no rule touched is not in the map. A disabled rule never applies; a rule whose
 * target is not one of the targets does nothing (`validateRules` reports it). The filled-in label lands under the
 * spec's label field (`label`).
 */
export function evaluateRules<T extends object = SceneEffects>(rules: unknown, ctx: RuleContext): Map<string, T> {
  const out = new Map<string, T>();
  const list = (Array.isArray(rules) ? (rules as SceneRule[]) : []).filter((r) => r && typeof r === 'object').slice(0, MAX_SCENE_RULES);
  if (!list.length) return out;
  const spec = ctx.effects ?? SCENE_RULE_EFFECTS;
  const labelKey = Object.keys(spec).find((k) => spec[k].kind === 'label') ?? 'label';
  const things = new Set(ctx.thingIds ?? []);
  const all = [...new Set([...(ctx.targets ?? ctx.rows.keys()), ...things])];
  const known = new Set(all);
  const onlyThings = all.filter((id) => things.has(id));
  const parsed = list.map((r) => ({ r, ...readEffects(r, spec) }));
  const templates = new Map<string, { tpl: string; rule: SceneRule }>();
  const stopped = new Set<string>();
  for (const { r, fx, labelTemplate } of parsed) {
    if (r.enabled === false) continue;
    const target = text(r.target);
    if (!target) continue;
    const ids = target === '*' ? all : target === THINGS_TARGET ? onlyThings : known.has(target) ? [target] : [];
    for (const id of ids) {
      if (stopped.has(id) || !ruleMatches(r, id, ctx)) continue;
      if (Object.keys(fx).length) out.set(id, { ...out.get(id), ...fx } as T);
      if (labelTemplate !== undefined) templates.set(id, { tpl: labelTemplate, rule: r });
      if (r.stop === true) stopped.add(id);
    }
  }
  for (const [id, { tpl, rule }] of templates) {
    const label = expandLabel(tpl, id, ctx, rule);
    if (label) out.set(id, { ...out.get(id), [labelKey]: label } as T);
  }
  return out;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * What is wrong with a rule, as a code a host words in its language (`RulesMessages.issues`; next-boilerplate e2e round 5, V1-B4: every problem was
 * English in a Turkish workspace), as `RuleIssue.ruleCode`. `message` stays the English sentence (the server's answer and the templates' checks), `n`
 * the number it names.
 */
export type RuleIssueCode =
  | 'too-many' | 'target-row' | 'target-missing' | 'target-unknown' | 'source-invalid' | 'of-unknown' | 'op-invalid' | 'param-missing' | 'column-missing'
  | 'value-missing' | 'value-number' | 'low-number' | 'high-number' | 'list-empty' | 'first-missing' | 'join-invalid' | 'choice' | 'number' | 'label-long';

export interface RuleIssue { path: string; message: string; ruleCode?: RuleIssueCode; n?: number }

/** The English sentence of each code (what `message` holds). */
export const RULE_ISSUE_TEXT: Record<RuleIssueCode, (n?: number) => string> = {
  'too-many': (n) => `At most ${n} rules`,
  'target-row': () => 'Name a row id or *',
  'target-missing': () => 'Choose a symbol, a connection or *',
  'target-unknown': () => 'No symbol or connection has this id',
  'source-invalid': () => 'The source is a column or a parameter',
  'of-unknown': () => 'No symbol or connection has this id',
  'op-invalid': () => 'Choose one of the operators',
  'param-missing': () => 'Name the board parameter',
  'column-missing': () => 'Name the column',
  'value-missing': () => 'This operator needs a value',
  'value-number': () => 'This operator compares numbers: the value must be a number',
  'low-number': () => 'The lower end must be a number',
  'high-number': () => 'The upper end must be a number',
  'list-empty': () => 'List at least one value, separated by commas',
  'first-missing': () => 'Set the first condition before the second',
  'join-invalid': () => 'Join with all or any',
  choice: () => 'Choose one of the options',
  number: () => 'Use a number',
  'label-long': (n) => `At most ${n} characters`,
};

const issue = (path: string, code: RuleIssueCode, n?: number, message?: string): RuleIssue =>
  ({ path, message: message ?? RULE_ISSUE_TEXT[code](n), ruleCode: code, ...(n !== undefined ? { n } : {}) });

const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const NEEDS_VALUE = new Set(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'between']);

/**
 * Problems with a rules list against the ids of the scene and the effects of the kind (the same checks the settings
 * form shows). With `fromData` the targets are row ids the data brings (the 3D viewer's markers and things): any
 * non-empty target or `of` is then accepted, as the settings cannot know the rows. With `things` the scene may have
 * things from data besides its authored ids: an id that names no symbol or connection may be a thing's, so it is
 * accepted too (the settings cannot know those rows either); `thingIds` are things known now (an editor that holds
 * the data), accepted by name. `things:*` is always a valid target: with no things it simply names nothing.
 */
export function validateRules(
  rules: unknown,
  ids: { elementIds: Iterable<string>; linkIds?: Iterable<string>; fromData?: boolean; things?: boolean; thingIds?: Iterable<string> },
  effects: EffectSpec = SCENE_RULE_EFFECTS,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const list = Array.isArray(rules) ? (rules as SceneRule[]) : [];
  if (list.length > MAX_SCENE_RULES) issues.push(issue('rules', 'too-many', MAX_SCENE_RULES));
  const elements = new Set(ids.elementIds);
  const known = new Set([...elements, ...(ids.linkIds ?? []), ...(ids.thingIds ?? [])]);
  const fromData = ids.fromData === true || ids.things === true;
  const idOk = (v: unknown) => fromData || text(v) === '' || known.has(text(v));
  list.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const at = (f: string) => `rules.${i}.${f}`;
    const target = text(r.target);
    if (!target) issues.push(issue(at('target'), ids.fromData === true ? 'target-row' : 'target-missing'));
    else if (!fromData && target !== '*' && target !== THINGS_TARGET && !known.has(target)) issues.push(issue(at('target'), 'target-unknown'));
    const condition = (n: '' | '2') => {
      const op = text(n ? r.op2 : r.op); const source = n ? r.source2 : r.source;
      const key = text(n ? r.key2 : r.key); const of = n ? r.of2 : r.of;
      const value = n ? r.value2 : r.value; const to = n ? r.to2 : r.to;
      const f = (name: string) => at(`${name}${n}`);
      if (source !== undefined && source !== '' && source !== 'column' && source !== 'param') issues.push(issue(f('source'), 'source-invalid'));
      if (!idOk(of)) issues.push(issue(f('of'), 'of-unknown'));
      if (!op) return;
      if (!isOp(op)) { issues.push(issue(f('op'), 'op-invalid')); return; }
      if (!key) issues.push(issue(f('key'), source === 'param' ? 'param-missing' : 'column-missing'));
      if (NEEDS_VALUE.has(op) && text(value) === '') issues.push(issue(f('value'), 'value-missing'));
      else if (NUMERIC_OPS.has(op) && asNumber(value) === null) issues.push(issue(f('value'), 'value-number'));
      if (op === 'between') {
        if (asNumber(value) === null) issues.push(issue(f('value'), 'low-number'));
        if (asNumber(to) === null) issues.push(issue(f('to'), 'high-number'));
      }
      if (op === 'in' && !String(value ?? '').split(',').some((s) => s.trim())) issues.push(issue(f('value'), 'list-empty'));
    };
    condition('');
    if (text(r.op2) && !text(r.op)) issues.push(issue(at('op'), 'first-missing'));
    if (text(r.op2)) {
      condition('2');
      if (r.join !== undefined && r.join !== '' && r.join !== 'all' && r.join !== 'any') issues.push(issue(at('join'), 'join-invalid'));
    }
    // The effects, as the spec reads them: a choice must be one of its options, a number a number, a label short enough.
    for (const [key, e] of Object.entries(effects)) {
      const v = r[key];
      if (v === undefined || v === '') continue;
      if (e.kind === 'enum' && !enumOf(e, v)) issues.push(issue(at(key), 'choice', undefined, e.message));
      else if (e.kind === 'number' && asNumber(v) === null) issues.push(issue(at(key), 'number'));
      else if (e.kind === 'label' && typeof v === 'string' && v.length > MAX_RULE_LABEL) issues.push(issue(at(key), 'label-long', MAX_RULE_LABEL));
    }
  });
  return issues;
}
