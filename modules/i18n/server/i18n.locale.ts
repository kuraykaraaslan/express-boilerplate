// Pure application-locale resolution, shared by every layer: the RSC layout, the
// client and server routes that answer in the caller's UI language (an API that
// serves text the UI shows). No imports, so `ui/` re-exports it and `server/`
// code can call it without reaching into `ui/` (AGENTS.md §16).

/** The `app_locale` cookie — the fast SSR mirror of `user_preferences.language`. */
export const APP_LOCALE_COOKIE = 'app_locale';

/**
 * Resolution order: user preference → tenant default → 'en', and only if it is
 * enabled. Normalization (lowercase + primary subtag) is inline so this stays
 * dependency-free.
 */
export function resolveAppLocale(input: {
  userLang?: string | null;
  defaultLang?: string | null;
  enabledLanguages?: string[] | null;
}): string {
  const enabled = (input.enabledLanguages || []).map((l) => (l || '').toLowerCase());
  const def = ((input.defaultLang || 'en').toLowerCase().split('-')[0]) || 'en';
  const user = (input.userLang || '').toLowerCase().split('-')[0];

  const isAllowed = (code: string) => enabled.length === 0 || enabled.includes(code);

  if (user && isAllowed(user)) return user;
  if (isAllowed(def)) return def;
  return enabled[0] || 'en';
}
