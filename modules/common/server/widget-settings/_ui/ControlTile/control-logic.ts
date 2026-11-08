// Vendored from kui-react f7db139: modules/ui/ControlTile/control-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Pure helpers shared by the async controls (phase 9 §9.16). No React, no transport.

/** A scalar as a boolean: true/false, 1/0, "on"/"off", "true"/"false"/"yes"/"no"; anything else is unknown (null). */
export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 0 ? false : value === 1 ? true : null;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'on', '1', 'yes'].includes(v)) return true;
    if (['false', 'off', '0', 'no'].includes(v)) return false;
  }
  return null;
}

/** A scalar as a finite number, or null. Blank strings are not numbers. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type NumericRange = { min: number; max: number; step: number };

/** Loose bounds -> a usable range (min < max, positive step). Defaults 0..100 step 1. */
export function toRange(bounds: { min?: unknown; max?: unknown; step?: unknown }): NumericRange {
  const min = asNumber(bounds.min) ?? 0;
  const maxRaw = asNumber(bounds.max) ?? 100;
  const step = asNumber(bounds.step);
  return { min, max: maxRaw > min ? maxRaw : min + 1, step: step && step > 0 ? step : 1 };
}

export type SetpointCheck = { ok: true; value: number } | { ok: false; reason: 'empty' | 'nan' | 'range' };

/** Validate a typed set-point so a bad entry becomes a field error, never a write. */
export function validateSetpoint(raw: string, range: NumericRange): SetpointCheck {
  if (raw.trim() === '') return { ok: false, reason: 'empty' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: 'nan' };
  if (n < range.min || n > range.max) return { ok: false, reason: 'range' };
  return { ok: true, value: n };
}

/** Round to the step grid anchored at `min`, so a slider never sends 20.000000004. */
export function snapToStep(value: number, range: NumericRange): number {
  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
  const decimals = (String(range.step).split('.')[1] ?? '').length;
  return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(decimals));
}

/** Fixed-decimals number text (no grouping), for the value line. */
export function formatValue(value: number, decimals = 0): string {
  return value.toFixed(Math.max(0, decimals));
}
