// Shared narrowing for every localization picker. Each picker ships the FULL
// catalogue (194 languages, ~278 countries, ~156 currencies, all IANA zones) and
// takes an optional domain-named allow-list — `languages`, `countries`,
// `currencies`, `timezones`, `formats`, `days` — to offer only a subset.
//
// One rule, everywhere: no allow-list → show everything. This is the whole
// contract, so it lives in one leaf instead of being re-implemented per picker.

/** Anything the pickers can narrow: an option carrying a `value` code. */
export type NarrowableOption = { value: string };

/**
 * Restrict `options` to an allow-list of codes, in the ALLOW-LIST's order so the
 * caller controls presentation. Matching is case-insensitive (`tr`/`TR`,
 * `usd`/`USD`); codes that are not in the catalogue are dropped and duplicates
 * collapse. An empty or absent allow-list means no restriction — `options` passes
 * through untouched.
 *
 * It only ever narrows: a code the catalogue does not contain cannot be added by
 * listing it here.
 */
export function narrowOptions<T extends NarrowableOption>(
  options: T[],
  allow?: string[] | null,
): T[] {
  if (!allow?.length) return options;

  const byCode = new Map<string, T>();
  for (const option of options) {
    const code = (option.value || '').trim().toLowerCase();
    if (code && !byCode.has(code)) byCode.set(code, option);
  }

  const out: T[] = [];
  const taken = new Set<string>();
  for (const raw of allow) {
    const code = (raw || '').trim().toLowerCase();
    const option = code ? byCode.get(code) : undefined;
    if (option && !taken.has(code)) {
      taken.add(code);
      out.push(option);
    }
  }
  return out;
}
