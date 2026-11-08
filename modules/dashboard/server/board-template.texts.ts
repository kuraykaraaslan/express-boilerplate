import { loadModuleDictionaries, mergeLocaleMessages } from '@kuraykaraaslan-labs/common/server/module-messages'
import type { BoardTemplate, TemplateCardTextKeys, TemplatePlacement } from './board-templates'

/**
 * D118 (e): a template's words in the creator's language. A template is code with English texts; beside a text it may name a dictionary key of
 * its contributing module (`<module>.<words>`): the board's title and description (`titleKey`, `descriptionKey`, phase 49b), a card's title
 * (`titleKey`) and its other words (`textKeys`: a text setting, an action's name), a section's title, the main page's and the pages' titles and the
 * parameters' labels (`BoardTemplate.textKeys`). When the template is applied (and when it is previewed or listed) each text whose key the creator's
 * language has is replaced by that text, so the board is STORED in that language: a card title is the person's own text from then on, edited like
 * any other, never a key. A language without the key, or English, keeps the template's English. Nothing here reads a key a person typed: the keys
 * are the template's, validated by `ContributedTemplateSchema`.
 */

type Messages = Readonly<Record<string, string>>

/** The module a dictionary key belongs to: its first segment (`dashboard_scada.sitesTemplate.title` → `dashboard_scada`). */
const moduleOfKey = (key: string): string => key.slice(0, key.indexOf('.'))

/** Every dictionary key the template names for a text it stores or shows (deduplicated). Pure. */
export function templateTextKeysOf(template: BoardTemplate): string[] {
  const keys = new Set<string>()
  const add = (k: string | undefined) => { if (k) keys.add(k) }
  const addCard = (c: { titleKey?: string; textKeys?: TemplateCardTextKeys } | null | undefined) => {
    if (!c) return
    add(c.titleKey)
    for (const k of Object.values(c.textKeys?.settings ?? {})) add(k)
    for (const k of Object.values(c.textKeys?.actions ?? {})) add(k)
  }
  add(template.titleKey)
  add(template.descriptionKey)
  add(template.textKeys?.mainPage)
  for (const k of Object.values(template.textKeys?.pages ?? {})) add(k)
  for (const k of Object.values(template.textKeys?.params ?? {})) add(k)
  for (const s of template.sections ?? []) add(s.titleKey)
  for (const p of template.placements ?? []) { addCard(p); addCard(p.fallback) }
  return [...keys]
}

/** An action's name by its id, in the v2 sources (`{ v: 2, sources: { <source>: [{ id, name, action }] } }`); any other shape is left as it is. */
function renameActions<T>(actions: T, keys: Readonly<Record<string, string>> | undefined, text: (key: string, english: string) => string): T {
  if (!keys || !actions || typeof actions !== 'object') return actions
  const v2 = actions as { sources?: Record<string, Array<{ id?: unknown; name?: unknown }>> }
  if (!v2.sources || typeof v2.sources !== 'object') return actions
  const sources = Object.fromEntries(Object.entries(v2.sources).map(([source, entries]) => [
    source,
    (entries ?? []).map((e) => (typeof e?.id === 'string' && keys[e.id] && typeof e.name === 'string' && e.name ? { ...e, name: text(keys[e.id]!, e.name) } : e)),
  ]))
  return { ...v2, sources } as T
}

/** A card's title, its text settings and its action names in the language of `text`. */
function localizeCard<C extends Pick<TemplatePlacement, 'title' | 'titleKey' | 'textKeys' | 'settings' | 'actions'>>(card: C, text: (key: string, english: string) => string): C {
  const out: C = { ...card }
  if (card.titleKey && typeof card.title === 'string' && card.title) out.title = text(card.titleKey, card.title)
  const settingKeys = card.textKeys?.settings
  if (settingKeys && card.settings) {
    const settings = { ...card.settings }
    for (const [name, key] of Object.entries(settingKeys)) if (typeof settings[name] === 'string' && settings[name]) settings[name] = text(key, settings[name] as string)
    out.settings = settings
  }
  out.actions = renameActions(card.actions, card.textKeys?.actions, text)
  return out
}

/**
 * The template with each text whose key `messages` holds replaced by that text; an English text stays where `messages` has no text (or an empty one).
 * Pure: the keys stay on the template (the apply path stores the named fields only, never a key).
 */
export function localizeTemplateTexts(template: BoardTemplate, messages: Messages): BoardTemplate {
  const text = (key: string, english: string): string => {
    const found = messages[key]
    return typeof found === 'string' && found.trim() ? found : english
  }
  const keys = template.textKeys
  return {
    ...template,
    title: template.titleKey ? text(template.titleKey, template.title) : template.title,
    ...(template.description !== undefined && template.descriptionKey ? { description: text(template.descriptionKey, template.description) } : {}),
    ...(template.sections ? { sections: template.sections.map((s) => (s.titleKey ? { ...s, title: text(s.titleKey, s.title) } : s)) } : {}),
    ...(template.placements ? {
      placements: template.placements.map((p) => {
        const card = localizeCard(p, text)
        return p.fallback ? { ...card, fallback: localizeCard(p.fallback, text) } : card
      }),
    } : {}),
    ...(template.mainPage && keys?.mainPage && typeof template.mainPage.title === 'string'
      ? { mainPage: { ...template.mainPage, title: text(keys.mainPage, template.mainPage.title) } } : {}),
    ...(template.pages && keys?.pages
      ? { pages: template.pages.map((pg) => (keys.pages![pg.key] && typeof pg.title === 'string' ? { ...pg, title: text(keys.pages![pg.key]!, pg.title) } : pg)) } : {}),
    ...(template.params && keys?.params
      ? { params: template.params.map((pr) => (keys.params![pr.key] && typeof pr.label === 'string' ? { ...pr, label: text(keys.params![pr.key]!, pr.label) } : pr)) as BoardTemplate['params'] } : {}),
  }
}

/** `pt-BR` → `pt`: the dictionaries are keyed by the primary language subtag. */
const baseOf = (locale: string | null | undefined): string => (locale || 'en').toLowerCase().split('-')[0] || 'en'

/**
 * The template in `locale` (the creator's app language, `templateLocaleOf`), for the apply routes, the preview and the gallery. English, or a
 * template that names no key, is returned as it is, without loading anything; otherwise the dictionaries of the modules its keys name are loaded
 * (the generated lazy loaders, `module-messages.ts`) and merged for the locale. A module whose dictionary cannot be loaded keeps its English.
 */
export async function templateInLocale(template: BoardTemplate, locale: string | null | undefined): Promise<BoardTemplate> {
  if (baseOf(locale) === 'en') return template
  const keys = templateTextKeysOf(template)
  if (!keys.length) return template
  const dicts = await loadModuleDictionaries(new Set(keys.map(moduleOfKey)))
  return localizeTemplateTexts(template, mergeLocaleMessages(baseOf(locale), dicts))
}
