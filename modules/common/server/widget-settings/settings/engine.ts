// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/engine.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The settings-template engine: migrate, validate, layer defaults, prune, stamp.
//
// Rules (next-boilerplate phase 21, D-21.6):
//  - every template migrates on its own, from the stored version to the current one, in order;
//  - steps are pure and sparse-safe (they never assume a key exists);
//  - an absent stamp is the baseline v1 (D-21.3: there is no pre-template data to lift);
//  - data written by a NEWER version than the code knows is never downgraded: it is reported in
//    `newer` and the caller renders best-effort, opens it read-only and refuses to save it;
//  - only the server stamps `$v`.

import { isColor } from './style';
import { shouldShow, type FieldSchema } from '../_app/SchemaForm/types';
import type {
  Issue, IssueCode, IssueParams, MigrationOp, SettingsStamp, SettingsTemplate, Sparse, TemplateId, WidgetCaps,
} from './types';

export const STAMP_KEY = '$v';

const isObj = (v: unknown): v is Sparse => !!v && typeof v === 'object' && !Array.isArray(v);

// ── Namespaces ────────────────────────────────────────────────────────────────

/** The part of a settings object one template owns. */
export function readNamespace(settings: Sparse | null | undefined, template: SettingsTemplate): Sparse {
  const s = isObj(settings) ? settings : {};
  if (template.namespace === '') {
    const out: Sparse = {};
    for (const [k, v] of Object.entries(s)) if (!k.startsWith('$')) out[k] = v;
    return out;
  }
  const ns = s[template.namespace];
  return isObj(ns) ? { ...ns } : {};
}

/** Put one template's part back into a settings object (empty parts are left out). */
export function writeNamespace(settings: Sparse, template: SettingsTemplate, values: Sparse): Sparse {
  if (template.namespace === '') {
    const out: Sparse = {};
    for (const [k, v] of Object.entries(settings)) if (k.startsWith('$')) out[k] = v;
    return { ...out, ...values };
  }
  const out = { ...settings };
  if (Object.keys(values).length) out[template.namespace] = values;
  else delete out[template.namespace];
  return out;
}

export function readStamp(settings: Sparse | null | undefined): SettingsStamp {
  const v = isObj(settings) ? settings[STAMP_KEY] : undefined;
  if (!isObj(v)) return {};
  const out: SettingsStamp = {};
  for (const [id, n] of Object.entries(v)) if (Number.isInteger(n) && (n as number) >= 1) out[id as TemplateId] = n as number;
  return out;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Each field's declared default (`value`). */
export function templateDefaults(template: SettingsTemplate): Sparse {
  const out: Sparse = {};
  for (const [k, f] of Object.entries(template.fields)) if (f.value !== undefined) out[k] = f.value;
  return out;
}

/** Layer defaults (lowest first) and the stored values into the effective values. */
export function effective(template: SettingsTemplate, ...layers: Array<Sparse | null | undefined>): Sparse {
  let out = templateDefaults(template);
  for (const l of layers) if (isObj(l)) out = { ...out, ...l };
  return out;
}

// ── Migration ─────────────────────────────────────────────────────────────────

// Own keys only: a stored value or a key named like an Object.prototype member (`toString`, `__proto__`)
// must never match an inherited one through `in`.
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

function applyOp(values: Sparse, op: MigrationOp): Sparse {
  const v = { ...values };
  switch (op.op) {
    case 'rename':
      if (has(v, op.from)) {
        if (!has(v, op.to)) v[op.to] = v[op.from];
        delete v[op.from];
      }
      return v;
    case 'mapValue': {
      if (!has(v, op.key)) return v;
      const key = String(v[op.key]);
      if (has(op.map, key)) v[op.key] = op.map[key];
      else if ('else' in op) v[op.key] = op.else;
      return v;
    }
    case 'materializeDefault':
      if (!has(v, op.key)) v[op.key] = op.value;
      return v;
    case 'clamp': {
      const n = v[op.key];
      if (typeof n === 'number') v[op.key] = Math.min(op.max ?? n, Math.max(op.min ?? n, n));
      return v;
    }
    case 'drop':
      delete v[op.key];
      return v;
    case 'each':
      if (Array.isArray(v[op.key])) {
        v[op.key] = (v[op.key] as unknown[]).map((item) => (isObj(item) ? op.ops.reduce(applyOp, item) : item));
      }
      return v;
    case 'filterList': {
      const list = v[op.key];
      if (!Array.isArray(list) || !list.length) return v;
      const remove = new Set(op.remove ?? []);
      const keep = op.keep ? new Set(op.keep) : null;
      const kept = list.filter((item) => !remove.has(String(item)) && (!keep || keep.has(String(item))));
      if (kept.length) v[op.key] = kept;
      else delete v[op.key];
      return v;
    }
    default: {
      // A stored op this code does not know (e.g. written by a newer version): leave the values be.
      const unknownOp: never = op;
      void unknownOp;
      return v;
    }
  }
}

export interface MigrateResult {
  values: Sparse;
  /** The version the values are at now (the current one, unless they were newer). */
  version: number;
  applied: Array<{ from: number; to: number; note: string }>;
  /** Set when the stored data is newer than this template: values are returned untouched. */
  newer?: { stored: number; known: number };
}

/** Bring one template's values from `storedVersion` up to the template's current version. */
export function migrate(template: SettingsTemplate, values: Sparse, storedVersion = 1): MigrateResult {
  if (storedVersion > template.version) {
    return { values, version: storedVersion, applied: [], newer: { stored: storedVersion, known: template.version } };
  }
  let out = values;
  const applied: MigrateResult['applied'] = [];
  for (let v = Math.max(1, storedVersion); v < template.version; v++) {
    const step = template.migrations[v - 1];
    if (!step || step.from !== v || step.to !== v + 1) throw new Error(`${template.id}: no migration step ${v} -> ${v + 1}`);
    if (step.ops) out = step.ops.reduce(applyOp, out);
    if (step.up) out = step.up(out);
    applied.push({ from: step.from, to: step.to, note: step.note });
  }
  return { values: out, version: template.version, applied };
}

// ── Validation ────────────────────────────────────────────────────────────────

const ICON_RE = /^(fa[srbld]?|fa-(solid|regular|brands|light|duotone))( fa-[a-z0-9-]+)+$|^[a-z][a-z0-9:-]{0,63}$/;
// A data key is only ever a lookup (a column key, a record key or a series name such as "CPU (2)"):
// any text without control characters, at most 128 long.
const KEY_RE = /^[^\u0000-\u001f\u007f]{1,128}$/;
const optionValues = (f: FieldSchema) =>
  (f.options ?? []).map((o) => (typeof o === 'string' ? o : o.value));

/** One value against one field. Returns the cleaned value, or `undefined` to drop it, plus issues. */
function checkField(field: FieldSchema, value: unknown, path: string, issues: Issue[]): unknown {
  if (value === undefined || value === null) return undefined;
  const bad = (code: IssueCode, message: string, params: Omit<IssueParams, 'label'> = {}) => {
    issues.push({ path, message: `${field.label}: ${message}`, code, params: { label: field.label, ...params } });
    return undefined;
  };
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : bad('boolean', 'must be on or off');
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad('number', 'must be a number');
      if (field.min !== undefined && value < field.min) return bad('min', `must be at least ${field.min}`, { min: field.min });
      if (field.max !== undefined && value > field.max) return bad('max', `must be at most ${field.max}`, { max: field.max });
      return value;
    }
    case 'select': {
      if (typeof value !== 'string') return bad('option', 'must be one of the options');
      const allowed = optionValues(field);
      if (value === '' && !field.required) return undefined;
      return allowed.length && !allowed.includes(value) ? bad('notOption', 'is not one of the options') : value;
    }
    case 'multi-select': {
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) return bad('optionList', 'must be a list of options');
      const allowed = optionValues(field);
      const unknownOpt = allowed.length ? (value as string[]).find((x) => !allowed.includes(x)) : undefined;
      return unknownOpt !== undefined ? bad('unknownOption', `"${unknownOpt}" is not one of the options`, { option: unknownOpt }) : [...new Set(value as string[])];
    }
    case 'color':
    case 'color-token':
      if (value === '') return undefined;
      return isColor(value) ? (value as string).trim() : bad('color', 'is not a colour (use #hex, rgb(), hsl() or a theme colour)');
    case 'icon':
      if (value === '') return undefined;
      return typeof value === 'string' && ICON_RE.test(value) ? value : bad('icon', 'is not an icon name');
    case 'data-key':
      if (field.multiple) {
        if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !KEY_RE.test(x))) return bad('dataKeys', 'must be a list of data keys');
        return field.max !== undefined && value.length > field.max ? bad('maxKeys', `at most ${field.max} keys`, { max: field.max }) : value;
      }
      if (value === '') return undefined;
      return typeof value === 'string' && (KEY_RE.test(value) || value === '*') ? value : bad('dataKey', 'is not a data key');
    case 'font': {
      if (!isObj(value)) return bad('font', 'is not a font');
      const out: Sparse = {};
      const { size, unit, weight, style, family, lineHeight } = value;
      if (typeof size === 'number' && size >= 1 && size <= 400) out.size = size;
      if (unit === 'px' || unit === 'rem' || unit === 'em') out.unit = unit;
      if ([300, 400, 500, 600, 700, 800].includes(weight as number)) out.weight = weight;
      if (style === 'normal' || style === 'italic') out.style = style;
      if (['inherit', 'sans', 'serif', 'mono'].includes(family as string)) out.family = family;
      if (typeof lineHeight === 'number' && lineHeight >= 0.5 && lineHeight <= 4) out.lineHeight = lineHeight;
      return Object.keys(out).length ? out : undefined;
    }
    case 'repeater': {
      if (!Array.isArray(value)) return bad('list', 'must be a list');
      const cap = field.max ?? 50;
      if (value.length > cap) return bad('maxItems', `at most ${cap} items`, { max: cap });
      const sub = field.fields ?? {};
      return value.map((item, i) => {
        const row: Sparse = {};
        const src = isObj(item) ? item : {};
        for (const [k, f] of Object.entries(sub)) {
          const v = checkField(f, src[k] === '' && f.type !== 'text' && f.type !== 'textarea' ? undefined : src[k], `${path}.${i}.${k}`, issues);
          if (v !== undefined) row[k] = v;
          // Items are sparse like the rest: a required field with a default may be left out.
          else if (f.required && f.value === undefined) issues.push({ path: `${path}.${i}.${k}`, message: `${f.label} is required`, code: 'required', params: { label: f.label } });
        }
        return row;
      });
    }
    case 'json':
    case 'link':
    case 'background':
    case 'media':
      return value;
    default: {
      // text, textarea, url, rich-text, img, date, datetime, symbol, remote-select
      if (typeof value !== 'string') return bad('text', 'must be text');
      const cap = field.maxLength ?? (field.type === 'textarea' || field.type === 'rich-text' ? 20000 : 500);
      if (value.length > cap) return bad('maxLength', `at most ${cap} characters`, { max: cap });
      if (field.type === 'url' && value && !/^(https?:\/\/|\/(?!\/))/i.test(value)) return bad('url', 'must be an https/http address or an internal path');
      return value;
    }
  }
}

export interface ValidateResult {
  /** The values that passed, unknown and deprecated-then-dropped keys removed. */
  values: Sparse;
  issues: Issue[];
}

/**
 * Validate one template's values deeply (repeater items, colours, fonts, enums, lengths) and run
 * its cross-field rules. Unknown keys are dropped; a bad value is dropped and reported.
 */
export function validate(template: SettingsTemplate, values: Sparse): ValidateResult {
  const issues: Issue[] = [];
  const out: Sparse = {};
  const prefix = template.namespace ? `${template.namespace}.` : '';
  for (const [k, f] of Object.entries(template.fields)) {
    if (!(k in values)) continue;
    const v = checkField(f, values[k], `${prefix}${k}`, issues);
    if (v !== undefined) out[k] = v;
  }
  for (const rule of template.rules ?? []) {
    for (const issue of rule(out)) issues.push({ ...issue, path: `${prefix}${issue.path}` });
  }
  return { values: out, issues };
}

/** Required fields that are visible and empty. */
export function missingRequired(template: SettingsTemplate, effectiveValues: Sparse): Issue[] {
  const issues: Issue[] = [];
  for (const [k, f] of Object.entries(template.fields)) {
    if (!f.required || !shouldShow(f, effectiveValues)) continue;
    const v = effectiveValues[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      issues.push({ path: `${template.namespace ? `${template.namespace}.` : ''}${k}`, message: `${f.label} is required`, code: 'required', params: { label: f.label } });
    }
  }
  return issues;
}

// ── Sparse storage ────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep only the values that differ from `defaults` (the stored form is sparse). */
export function prune(values: Sparse, defaults: Sparse): Sparse {
  const out: Sparse = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined && !same(v, defaults[k])) out[k] = v;
  return out;
}

// ── Whole settings objects ────────────────────────────────────────────────────

export interface TemplateSet {
  /** The widget type's template (namespace ''). */
  type: SettingsTemplate;
  /** Absent for a settings object that has no card (the board's own settings). */
  card?: SettingsTemplate;
  format?: SettingsTemplate;
  /** Module extensions (`$x:<module>`). */
  extensions?: SettingsTemplate[];
}

export const templatesOf = (set: TemplateSet): SettingsTemplate[] =>
  [set.type, set.card, set.format, ...(set.extensions ?? [])].filter((t): t is SettingsTemplate => !!t);

export interface ReadResult {
  /** Current-version values per template id (sparse, as stored). */
  parts: Partial<Record<TemplateId, Sparse>>;
  applied: Array<{ id: TemplateId; from: number; to: number; note: string }>;
  newer: Array<{ id: TemplateId; stored: number; known: number }>;
}

/** Read a stored settings object: split by template and migrate each part to current. Never writes back. */
export function readSettings(stored: Sparse | null | undefined, set: TemplateSet): ReadResult {
  const stamp = readStamp(stored);
  const out: ReadResult = { parts: {}, applied: [], newer: [] };
  for (const t of templatesOf(set)) {
    const r = migrate(t, readNamespace(stored, t), stamp[t.id] ?? 1);
    out.parts[t.id] = r.values;
    for (const a of r.applied) out.applied.push({ id: t.id, ...a });
    if (r.newer) out.newer.push({ id: t.id, ...r.newer });
  }
  return out;
}

export interface PrepareResult {
  /** What to store: migrated, validated, pruned against `defaults`, stamped. */
  settings: Sparse;
  issues: Issue[];
  /** Non-empty: refuse the write (409) — something was written by a newer version. */
  newer: Array<{ id: TemplateId; stored: number; known: number }>;
}

/**
 * The server's write path: migrate the incoming object (its `$v` is only a starting point), validate
 * every part, prune against the layered defaults below the placement, and stamp the current versions.
 * `previous` is the stored object being replaced; a stored part newer than the code also refuses.
 */
export function prepareForSave(
  incoming: Sparse | null | undefined,
  set: TemplateSet,
  opts: { defaults?: Partial<Record<TemplateId, Sparse>>; previous?: Sparse | null } = {},
): PrepareResult {
  const read = readSettings(incoming, set);
  const prevStamp = readStamp(opts.previous);
  const newer = [...read.newer];
  for (const t of templatesOf(set)) {
    const p = prevStamp[t.id];
    if (p !== undefined && p > t.version && !newer.some((n) => n.id === t.id)) newer.push({ id: t.id, stored: p, known: t.version });
  }
  if (newer.length) return { settings: isObj(incoming) ? incoming : {}, issues: [], newer };

  let settings: Sparse = {};
  const issues: Issue[] = [];
  const stamp: SettingsStamp = {};
  for (const t of templatesOf(set)) {
    const v = validate(t, read.parts[t.id] ?? {});
    issues.push(...v.issues);
    const base = { ...templateDefaults(t), ...(opts.defaults?.[t.id] ?? {}) };
    settings = writeNamespace(settings, t, prune(v.values, base));
    stamp[t.id] = t.version;
  }
  settings[STAMP_KEY] = stamp;
  return { settings, issues, newer: [] };
}

/** The group ids that apply to a widget with these capabilities and bound slots. */
export function visibleGroups(template: SettingsTemplate, caps: WidgetCaps, boundSlots: string[] = []): Set<string> {
  return new Set(template.groups.filter((g) => {
    if (g.showWhen?.caps && !caps[g.showWhen.caps]) return false;
    if (g.showWhen?.slotBound && !boundSlots.includes(g.showWhen.slotBound)) return false;
    return true;
  }).map((g) => g.id));
}
