import type { TelemetryDropReason, TelemetryValue } from './telemetry.contract';

/**
 * The key and value rules every kind's rows pass (docs/phases/42-telemetry/00 §0.3), one copy for every writer so a caller that
 * changes a payload on the way cannot store what the rule refused.
 *
 * Keys: `^[A-Za-z0-9_.\-]{1,64}$`, case-sensitive. A kind adds its own rule on top (reserved prefixes, a declared set): see
 * `telemetry.kinds.ts` `keyProblem`.
 *
 * Values: a finite number is numeric (stored by key id in the arrays); a boolean, a string of at most 1 024 characters, or an
 * object or array of at most 4 KiB serialised is stored as JSON under its key name; `null` is "no reading" (skipped, not a drop).
 * A key the kind marks as raw is exempt from the string limit and capped by bytes instead (`rawMaxBytes`). A value over a cap
 * drops its key only: the rest of the row is kept.
 */
export const KEY_CHARS = /^[A-Za-z0-9_.\-]+$/;
export const MAX_KEY_LENGTH = 64;
export const MAX_STRING_CHARS = 1024;
export const MAX_JSON_BYTES = 4096;
/** The byte cap of a raw key when the caller names none. */
export const DEFAULT_RAW_MAX_BYTES = 4096;
/** The largest raw cap any caller may set (the writer's own ceiling). */
export const MAX_RAW_BYTES = 65_536;

/** Why a key cannot be stored under the generic rule, or null when it can. */
export function checkKey(key: string): TelemetryDropReason | null {
  if (typeof key !== 'string' || key.length === 0 || !KEY_CHARS.test(key)) return 'key_invalid';
  if (key.length > MAX_KEY_LENGTH) return 'key_too_long';
  return null;
}

/** Code points of a string, counted only when the UTF-16 length could exceed the limit. */
function codePointsOver(s: string, max: number): boolean {
  if (s.length <= max) return false;
  const it = s[Symbol.iterator]();
  let n = 0;
  while (!it.next().done) if (++n > max) return true;
  return false;
}

export type ValueCheck =
  | { kind: 'num'; value: number }
  | { kind: 'other'; value: TelemetryValue }
  /** `null` (or `undefined` from a caller): no reading, not stored and not counted as a drop. */
  | { kind: 'skip' }
  | { kind: 'drop'; reason: TelemetryDropReason };

/**
 * The storage class of one value. `raw` marks a raw key (exempt from the string limit, capped at `rawMaxBytes`). A non-finite
 * number (JSON has none) is `value_too_large`; a value JSON cannot hold (a function, a bigint, a cycle) is `bad_form`.
 */
export function checkValue(v: unknown, o: { raw?: boolean; rawMaxBytes?: number } = {}): ValueCheck {
  if (v === null || v === undefined) return { kind: 'skip' };
  switch (typeof v) {
    case 'number':
      return Number.isFinite(v) ? { kind: 'num', value: v } : { kind: 'drop', reason: 'value_too_large' };
    case 'boolean':
      return { kind: 'other', value: v };
    case 'string':
      if (o.raw) return Buffer.byteLength(v, 'utf8') > (o.rawMaxBytes ?? DEFAULT_RAW_MAX_BYTES) ? { kind: 'drop', reason: 'value_too_large' } : { kind: 'other', value: v };
      return codePointsOver(v, MAX_STRING_CHARS) ? { kind: 'drop', reason: 'string_too_long' } : { kind: 'other', value: v };
    case 'object': {
      let text: string | undefined;
      try {
        text = JSON.stringify(v);
      } catch {
        return { kind: 'drop', reason: 'bad_form' };
      }
      if (text === undefined) return { kind: 'drop', reason: 'bad_form' };
      if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) return { kind: 'drop', reason: 'value_too_large' };
      // what is stored is what JSON keeps (a Date becomes its string, an undefined member goes)
      return { kind: 'other', value: JSON.parse(text) as Record<string, unknown> | unknown[] };
    }
    default:
      return { kind: 'drop', reason: 'bad_form' };
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
