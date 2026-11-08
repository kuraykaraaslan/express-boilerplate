import { isLocaleCode, normalizeLocale } from './status.page.rules'

/**
 * Language handling for the public status page (observability phase 15.7), pure.
 *
 * The rule is the one the risk note of the phase asks for: the tenant's PRIMARY language is the source of truth and the fallback. A
 * page offers the languages an operator turned on; a visitor asking for one it does not offer gets the primary language, and any
 * text that has no translation is shown in the primary language with the page saying so, instead of being hidden or machine-guessed.
 */

export const TRANSLATABLE_ENTITY_TYPES = ['page', 'group', 'component', 'incident', 'update'] as const
export type TranslatableEntityType = (typeof TRANSLATABLE_ENTITY_TYPES)[number]

export interface TranslationRow {
  entityType: string
  entityId: string
  locale: string
  name?: string | null
  body?: string | null
}

/** Languages written right to left. A closed list: a language missing here is drawn left to right, never mirrored by a guess. */
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'dv', 'yi'])

export function isRtl(locale: string): boolean {
  return RTL.has(normalizeLocale(locale).split('-')[0])
}

/**
 * Which language to serve. `requested` (the `lang` query or a header) is honoured only when it is the primary language or one of the
 * page's offered `languages`; a regional form (`de-AT`) falls back to its base language (`de`) when only that is offered.
 */
export function pickLanguage(requested: string | null | undefined, primary: string, offered: readonly string[]): string {
  const p = normalizeLocale(primary)
  if (!requested || !isLocaleCode(requested.trim())) return p
  const want = normalizeLocale(requested)
  const allowed = new Set([p, ...offered.map(normalizeLocale)])
  if (allowed.has(want)) return want
  const base = want.split('-')[0]
  return allowed.has(base) ? base : p
}

/** The languages a page offers, primary first, no duplicates. */
export function availableLanguages(primary: string, offered: readonly string[] | null | undefined): string[] {
  const p = normalizeLocale(primary)
  return [p, ...(offered ?? []).map(normalizeLocale).filter((l, i, all) => l !== p && all.indexOf(l) === i)]
}

export interface Translator {
  /** Name or title of an entity, `fallback` when this language has none. */
  name(entityType: TranslatableEntityType, entityId: string, source: string): string
  /** Description or message of an entity. */
  body(entityType: TranslatableEntityType, entityId: string, source: string | null): string | null
  /** True once any text asked for was shown in the primary language instead. */
  readonly usedFallback: boolean
}

/**
 * A translator for one language over the rows already loaded. For the primary language it returns the source text untouched and never
 * reports a fallback (there is nothing to fall back from).
 */
export function makeTranslator(language: string, primary: string, rows: readonly TranslationRow[]): Translator {
  const target = normalizeLocale(language)
  const isPrimary = target === normalizeLocale(primary)
  const index = new Map<string, TranslationRow>()
  if (!isPrimary) for (const r of rows) if (normalizeLocale(r.locale) === target) index.set(`${r.entityType}:${r.entityId}`, r)
  let used = false
  return {
    name(entityType, entityId, source) {
      if (isPrimary) return source
      const t = index.get(`${entityType}:${entityId}`)?.name
      if (t) return t
      used = true
      return source
    },
    body(entityType, entityId, source) {
      if (isPrimary || source === null || source === '') return source
      const t = index.get(`${entityType}:${entityId}`)?.body
      if (t) return t
      used = true
      return source
    },
    get usedFallback() { return used },
  }
}
