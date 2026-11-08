/**
 * The one way a LIMIT value is read (feature_gate.05, fixed 2026-10-20): an optional minus sign and digits, nothing else. `parseInt`
 * read any numeric PREFIX, so "-1abc", "-1 ", "-1.9" and "-1e0" became -1 (unlimited) and "1e3" became 1. Anything that is not a
 * plain integer is NaN, which every comparison treats as "no headroom" (fail closed).
 */
export function parseLimitValue(value: unknown): number {
  return typeof value === 'string' && /^-?\d{1,15}$/.test(value) ? Number(value) : NaN
}
