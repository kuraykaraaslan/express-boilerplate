// Typed accessor over the generated `dictionary-locales.json` (moduleId → the locales
// its `dictionaries/*.json` ship). Server-only, React-free: lets a module's server layer
// know which languages the dictionaries in code cover, which only the app-layer message
// map (`_generated/ui-messages.ts`) could tell before. Mirrors `module-entities`.
// Not to be confused with `generated/module-dictionaries.ts`, which LOADS the dictionaries.

import data from './generated/dictionary-locales.json';

const MODULES = (data as { modules?: Record<string, string[]> }).modules ?? {};

/** The locales a module's dictionary ships; empty for a module without one. */
export function moduleDictionaryLocales(moduleId: string): string[] {
  return MODULES[moduleId] ?? [];
}

/**
 * Every locale at least one dictionary ships, English always included (it is the
 * source every key falls back to). Same set as the admin layout's `availableLocales()`.
 */
export function dictionaryLocales(): string[] {
  const set = new Set<string>(['en']);
  for (const locales of Object.values(MODULES)) for (const l of locales) set.add(l);
  return [...set].sort();
}
