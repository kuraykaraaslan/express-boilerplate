import { dictionaries } from '../dictionaries';

/** The module's words a server answer carries in the viewer's language: its own dictionaries, else English, else the text as written. Pure. */
type Locale = 'en' | 'tr';
const localeOf = (locale: string | undefined | null): Locale => (String(locale ?? '').toLowerCase().startsWith('tr') ? 'tr' : 'en');

/** The text of `key` in `locale`, else English, else `fallback`. */
export function telemetrySourceWord(locale: string | undefined | null, key: string, fallback: string): string {
  return dictionaries[localeOf(locale)]?.[key] ?? dictionaries.en?.[key] ?? fallback;
}

/**
 * The source's queries with their names and their parameters' labels in `locale` (run 3 #14, #34, #53: the card's Data tab listed them in English in a
 * Turkish workspace): `telemetry.query.<query>` and `telemetry.query.<query>.<param>`, the English as written where the dictionary has nothing. Pure.
 */
export function localizedQueries<Q extends { key: string; label: string; params?: Record<string, unknown> }>(defs: readonly Q[], locale: string | undefined | null): Q[] {
  return defs.map((q) => ({
    ...q,
    label: telemetrySourceWord(locale, `telemetry.query.${q.key}`, q.label),
    ...(q.params ? {
      params: Object.fromEntries(Object.entries(q.params).map(([k, p]) => {
        const label = (p as { label?: unknown } | null)?.label;
        return [k, typeof label === 'string' && label ? { ...(p as object), label: telemetrySourceWord(locale, `telemetry.query.${q.key}.${k}`, label) } : p];
      })),
    } : {}),
  }));
}
