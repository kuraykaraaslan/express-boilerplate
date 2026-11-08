// Vendored from kui-react f7db139: modules/app/WidgetKit/views/control-form-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// The pure logic of control.form (no React): the fields a form edits (declared in the settings, or taken from what the
// source says about its record), their starting values, the checks a save must pass, what a save sends, and the
// dirty state. `ControlFormView.tsx` draws it; kui-ejs and KUInative vendor this file. Saving is interactive: it sends
// ONE `{ kind: 'set', value: { <field key>: <value>, … } }` and the host answers `onControl`; the command (checked on the
// server) picks the fields it wants by key. The form never decides what is written.

import { asBoolean, asNumber } from '../_ui/ControlTile/control-logic';
import type { FontValue } from '../_app/SchemaForm/types';
import type { SlotData } from '../kind';
import { metaLabel, type ColumnMeta } from '../settings/source-meta';
import { confirmProps, controlBlockReasonOf, controlMessages, textOr, type ControlHost, type FeedbackSettings } from './control-common';

export type FormFieldType = 'number' | 'boolean' | 'text' | 'enum';

/** One row of the `fields` setting. */
export type FormFieldSetting = {
  key?: string;
  label?: string;
  type?: FormFieldType;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string;
  unit?: string;
  gate?: string;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  group?: string;
};

export type FormSettings = FeedbackSettings & {
  label?: string;
  labelFont?: FontValue;
  labelColor?: string;
  fields?: unknown;
  fromSource?: boolean;
  saveLabel?: string;
  resetLabel?: string;
  showReset?: boolean;
  /** A save sends only the fields the viewer changed (template v2); off, every field with a value. */
  saveChangedOnly?: boolean;
  disableWhen?: string[];
};

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  min?: number;
  max?: number;
  step?: number;
  /** An enum's values, each with the word shown for it. */
  options?: Array<{ value: string; label: string }>;
  unit?: string;
  /** The key of a boolean field that switches this one on and off ("a gated number": a flag and its value). */
  gate?: string;
  required: boolean;
  readOnly: boolean;
  placeholder?: string;
  group?: string;
}

export type FormValue = number | boolean | string | null;
export type FormValues = Record<string, FormValue>;
export type FormErrorCode = 'required' | 'nan' | 'range' | 'invalid';

/** At most this many fields: a form is a card, not a spreadsheet. */
export const MAX_FORM_FIELDS = 40;
/** A key a form never accepts: it would name a prototype member of the payload. */
const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/;
export const FORM_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export const isFormKey = (k: unknown): k is string => typeof k === 'string' && FORM_KEY.test(k) && !UNSAFE_KEY.test(k);

/** A repeater row's `options` text ("low, medium, high" or "1=Low, 2=High") as values with words. */
export function parseOptions(text: unknown): Array<{ value: string; label: string }> {
  if (typeof text !== 'string') return [];
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const part of text.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    const value = (eq > 0 ? t.slice(0, eq) : t).trim();
    const label = (eq > 0 ? t.slice(eq + 1) : t).trim() || value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  return out.slice(0, 50);
}

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function declared(row: FormFieldSetting, meta: ColumnMeta | undefined, locale?: string): FormField | null {
  if (!row || typeof row !== 'object' || !isFormKey(row.key)) return null;
  const type: FormFieldType = row.type === 'boolean' || row.type === 'text' || row.type === 'enum' ? row.type : 'number';
  const fromMeta = metaLabel(meta?.label, locale);
  const options = type === 'enum' ? parseOptions(row.options) : undefined;
  const step = finite(row.step);
  return {
    key: row.key,
    label: textOr(row.label) ?? fromMeta ?? row.key,
    type,
    ...(type === 'number' && finite(row.min) !== undefined ? { min: finite(row.min) } : {}),
    ...(type === 'number' && finite(row.max) !== undefined ? { max: finite(row.max) } : {}),
    ...(type === 'number' && step !== undefined && step > 0 ? { step } : type === 'number' && meta?.decimals ? { step: 10 ** -meta.decimals } : {}),
    ...(options ? { options } : {}),
    ...(textOr(row.unit) ?? meta?.unit ? { unit: textOr(row.unit) ?? meta?.unit } : {}),
    ...(isFormKey(row.gate) && row.gate !== row.key ? { gate: row.gate } : {}),
    required: row.required === true,
    readOnly: row.readOnly === true,
    ...(textOr(row.placeholder) ? { placeholder: row.placeholder } : {}),
    ...(textOr(row.group) ? { group: row.group!.trim() } : {}),
  };
}

/** A field a source's record describes (no settings row): its kind, word and unit come from the source. */
function derived(key: string, meta: ColumnMeta | undefined, sample: unknown, locale?: string): FormField | null {
  if (!isFormKey(key)) return null;
  const mapped = meta?.valueMap ? Object.entries(meta.valueMap).map(([value, e]) => ({ value, label: e?.label || value })) : [];
  const kind = meta?.kind ?? (mapped.length ? 'enum' : typeof sample === 'boolean' ? 'boolean' : typeof sample === 'number' ? 'number' : typeof sample === 'string' ? 'string' : undefined);
  if (!kind || kind === 'json') return null;
  const type: FormFieldType = kind === 'enum' ? (mapped.length ? 'enum' : 'text') : kind === 'string' ? 'text' : kind;
  return {
    key,
    label: metaLabel(meta?.label, locale) ?? key,
    type,
    ...(type === 'number' && meta?.decimals ? { step: 10 ** -meta.decimals } : {}),
    ...(type === 'enum' ? { options: mapped } : {}),
    ...(meta?.unit ? { unit: meta.unit } : {}),
    required: false,
    readOnly: false,
  };
}

/**
 * The fields of the form: the `fields` rows, each taking its word, unit and step from the source's meta when the row
 * leaves them empty; with no rows (and `fromSource` on) the record's own fields in the source's order.
 */
export function formFields(s: FormSettings, record: SlotData | undefined, locale?: string): FormField[] {
  const metaOf = (k: string): ColumnMeta | undefined => record?.recordMeta?.[k];
  const rows = Array.isArray(s.fields) ? (s.fields as FormFieldSetting[]) : [];
  const seen = new Set<string>();
  const out: FormField[] = [];
  const push = (f: FormField | null) => {
    if (!f || seen.has(f.key) || out.length >= MAX_FORM_FIELDS) return;
    seen.add(f.key);
    out.push(f);
  };
  for (const row of rows) push(declared(row, row && typeof row.key === 'string' ? metaOf(row.key) : undefined, locale));
  if (rows.length === 0 && s.fromSource !== false) {
    const keys = [...new Set([...Object.keys(record?.recordMeta ?? {}), ...Object.keys(record?.record ?? {})])];
    for (const k of keys) push(derived(k, metaOf(k), record?.record?.[k], locale));
  }
  // A gate that names no boolean field of this form is dropped: the field is then plain.
  const flags = new Set(out.filter((f) => f.type === 'boolean').map((f) => f.key));
  return out.map((f) => {
    if (!f.gate || flags.has(f.gate)) return f;
    const plain = { ...f };
    delete plain.gate;
    return plain;
  });
}

/** The values the record holds, as the form starts with them. A missing number is `null`, never 0. */
export function formInitial(fields: FormField[], record: Record<string, unknown> | undefined): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    const raw = record && Object.hasOwn(record, f.key) ? record[f.key] : undefined;
    out[f.key] = f.type === 'number' ? asNumber(raw)
      : f.type === 'boolean' ? asBoolean(raw) === true
        : raw === null || raw === undefined ? '' : String(raw);
  }
  return out;
}

/** A gated field is switched off while its flag is false: it is neither checked nor sent. */
export const gatedOff = (f: FormField, values: FormValues): boolean => !!f.gate && values[f.gate] !== true;

/**
 * What stops a save, per field key. A number the viewer typed that is not a number comes in as `NaN`. Read-only and
 * switched-off fields are never checked.
 */
export function formErrors(fields: FormField[], values: FormValues): Record<string, FormErrorCode> {
  const out: Record<string, FormErrorCode> = {};
  for (const f of fields) {
    if (f.readOnly || gatedOff(f, values)) continue;
    const v = values[f.key];
    if (f.type === 'number') {
      if (v === null || v === undefined || v === '') { if (f.required) out[f.key] = 'required'; continue; }
      if (typeof v !== 'number' || !Number.isFinite(v)) out[f.key] = 'nan';
      else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) out[f.key] = 'range';
    } else if (f.type === 'text') {
      if (f.required && String(v ?? '').trim() === '') out[f.key] = 'required';
    } else if (f.type === 'enum') {
      const s = String(v ?? '');
      if (s === '') { if (f.required) out[f.key] = 'required'; } else if (!f.options?.some((o) => o.value === s)) out[f.key] = 'invalid';
    }
  }
  return out;
}

const same = (a: FormValue | undefined, b: FormValue | undefined) => (a ?? null) === (b ?? null);

/** The keys the viewer changed (read-only fields never count). */
export function formDirty(fields: FormField[], initial: FormValues, values: FormValues): string[] {
  return fields.filter((f) => !f.readOnly && !same(initial[f.key], values[f.key])).map((f) => f.key);
}

/**
 * What a save sends: the editable fields that have something to say, so one command can set several things at once.
 * A text is trimmed, a list choice is its value, a number is a number, and an on / off field is always sent (`false`
 * is a value). An empty text, an empty number input, an empty choice and a switched-off gated field are LEFT OUT,
 * never sent as `null`: the command then sees the field as absent (its `{ "$field": "key" }` resolves to nothing, so
 * an optional parameter stays optional and a schema never refuses an empty optional field). With `only` (the keys the
 * viewer changed, see `formDirty`), just those fields are sent. Null-prototype, so a key can never reach a prototype
 * member.
 */
export function formPayload(fields: FormField[], values: FormValues, only?: Iterable<string>): Record<string, FormValue> {
  const keep = only ? new Set(only) : null;
  const out: Record<string, FormValue> = Object.create(null);
  for (const f of fields) {
    if (f.readOnly || gatedOff(f, values) || (keep && !keep.has(f.key))) continue;
    const v = values[f.key];
    if (f.type === 'boolean') out[f.key] = v === true;
    else if (f.type === 'number') { if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = v; }
    else {
      const text = String(v ?? '').trim();
      if (text) out[f.key] = text;
    }
  }
  return out;
}

/** The fields grouped for drawing, in order; fields with no group come first, untitled. */
export function formGroups(fields: FormField[]): Array<{ name: string | null; fields: FormField[] }> {
  const groups: Array<{ name: string | null; fields: FormField[] }> = [];
  for (const f of fields) {
    const name = f.group ?? null;
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  return groups.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : 0));
}

/** Everything control.form draws, decided once. */
export function controlFormModel(s: FormSettings, data: Record<string, SlotData | undefined>, locale: string | undefined, host: ControlHost) {
  const record = data.record;
  const fields = formFields(s, record, locale);
  const { messages: policyMessages, ...confirm } = confirmProps(host.confirm);
  const messages = controlMessages(s, policyMessages, host.messages);
  const save = textOr(s.saveLabel);
  return {
    request: { kind: 'set' as const, valueType: 'object' as const },
    label: { text: textOr(s.label), font: s.labelFont, color: s.labelColor },
    fields,
    groups: formGroups(fields),
    initial: formInitial(fields, record?.record),
    saveLabel: save ?? host.messages.save,
    resetLabel: textOr(s.resetLabel) ?? host.messages.reset,
    showReset: s.showReset !== false,
    /** A save sends only the changed fields (`formPayload` with the dirty keys), not every field with a value. */
    saveChangedOnly: s.saveChangedOnly === true,
    confirm,
    messages,
    ariaLabel: textOr(s.label) ?? textOr(host.title) ?? host.messages.form,
    disabledReason: controlBlockReasonOf(host, s.disableWhen, !record?.record, host.messages),
  };
}
