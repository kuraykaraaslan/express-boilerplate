// Server-only: the application-UI messages of a few NAMED modules, for a page outside the admin shell (a display
// link's screen). The admin layout keeps its eager every-module aggregator in the app layer
// (`app/tenant/[tenantId]/admin/(shell)/_generated/ui-messages.ts`); a module may not import app code, so this reads
// the generated lazy loaders instead and loads only the dictionaries it is asked for.
import { moduleDictionaries, type ModuleDict } from './generated/module-dictionaries';

type Messages = Record<string, string>;

/** `pt-BR` -> `pt`: the dictionaries are keyed by primary language subtag, as the admin picker reads them. */
const baseOf = (locale: string) => (locale || 'en').toLowerCase().split('-')[0] || 'en';

/**
 * The named modules' dictionaries (unknown ids and modules without a dictionary are skipped), in the generated map's
 * order. A module whose dictionary fails to load is skipped: its keys fall back to the caller's defaults instead of
 * failing the page.
 */
export async function loadModuleDictionaries(moduleIds: Iterable<string>): Promise<Array<[string, ModuleDict]>> {
  const only = new Set(moduleIds);
  const ids = Object.keys(moduleDictionaries).filter((id) => only.has(id));
  const loaded = await Promise.all(ids.map(async (id) => [id, await moduleDictionaries[id]().catch(() => null)] as const));
  return loaded.filter((e): e is [string, ModuleDict] => !!e[1]);
}

/**
 * Merged, module-prefixed messages for a locale, the same merge as the admin's `pickLocaleMessages`: per module the
 * English base with the locale laid over it (per-key fallback to English; a locale a module does not ship is English).
 */
export function mergeLocaleMessages(locale: string, dicts: Array<[string, ModuleDict]>): Messages {
  const base = baseOf(locale);
  const out: Messages = {};
  for (const [, d] of dicts) Object.assign(out, d.en ?? {}, base !== 'en' ? d[base] ?? {} : {});
  return out;
}

/** Whether any of the dictionaries ships the locale's language (English always counts). */
export function shipsLocale(locale: string, dicts: Array<[string, ModuleDict]>): boolean {
  const base = baseOf(locale);
  return base === 'en' || dicts.some(([, d]) => !!d[base]);
}
