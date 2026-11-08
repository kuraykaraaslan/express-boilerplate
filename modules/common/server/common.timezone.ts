import { z } from 'zod';

/**
 * IANA timezone primitive. `TIMEZONES` is the runtime-supported zone list,
 * computed once from the Intl database, so scheduling/invoice/date-display
 * modules validate against exactly what this Node build supports.
 *
 * Dependency-free: relies only on the platform `Intl` API.
 */
export const TIMEZONES: string[] = Intl.supportedValuesOf('timeZone');

export const DEFAULT_TIMEZONE = 'UTC';

// `Intl.supportedValuesOf('timeZone')` omits the `UTC` alias in some runtimes;
// include the default explicitly so it always validates.
const TIMEZONE_SET: ReadonlySet<string> = new Set([...TIMEZONES, DEFAULT_TIMEZONE]);

/** Every segment of an IANA name starts with a capital (`America/Port-au-Prince`, `Etc/GMT+5`): `europe/istanbul` is not one. */
const IANA_CASING = /^[A-Z][^/]*(?:\/[A-Z][^/]*)*$/;

/**
 * The name this runtime keeps for `v` (41-ui-fixes/14 1.6): `v` itself when it is in `TIMEZONES`, otherwise the zone
 * `Intl` resolves an alias to, when that one is in `TIMEZONES`; null for anything else.
 *
 * ICU (Node, Chrome) keeps the old names (`Asia/Calcutta`, `Europe/Kiev`) and lists neither `Asia/Kolkata` nor
 * `Europe/Kyiv` nor `Etc/UTC`, while a browser may report the current names. Both spellings are the same zone: the alias
 * is accepted and stored under the runtime's own name, so a value written from one side reads back on the other.
 * Casing is still IANA's (`europe/istanbul` stays refused even though `Intl` would resolve it).
 */
export function canonicalTimezone(v: string): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (TIMEZONE_SET.has(v)) return v;
  if (!IANA_CASING.test(v)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return TIMEZONE_SET.has(resolved) ? resolved : null;
}

/**
 * Membership check against the supported IANA zones (case-sensitive), aliases included (41-ui-fixes/14 1.6): an alias
 * `Intl` resolves to a supported zone (`Asia/Kolkata`, `Europe/Kyiv`, `Etc/UTC`) is a zone too.
 */
export function isTimezone(v: string): boolean {
  return canonicalTimezone(v) !== null;
}

/** A zone, stored under the runtime's own name: an alias is accepted and canonicalised (`canonicalTimezone`). */
export const TimezoneSchema = z
  .string()
  .refine(isTimezone, 'Invalid IANA timezone')
  .transform((v) => canonicalTimezone(v) ?? v);

export type Timezone = z.infer<typeof TimezoneSchema>;
