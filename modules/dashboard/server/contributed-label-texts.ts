import type { NextRequest } from 'next/server'
import { loadModuleDictionaries, mergeLocaleMessages } from '@kuraykaraaslan-labs/common/server/module-messages'
import { englishLabels, moduleOfLabelKey, type LabelText } from './contributed-labels'

/**
 * The texts of the localisation seam (D551, `contributed-labels.ts`) in one language: each key is read from the dictionary of the module
 * it names (its first segment), through the generated dictionary map, so no module is imported. English, and a language a module does
 * not ship, read the English as declared; a key the language lacks reads its English too (`mergeLocaleMessages`' per-key fallback).
 * A module's messages are merged once per language and process: the dictionaries are code.
 */
const merged = new Map<string, Promise<Readonly<Record<string, string>>>>()

/**
 * The builtin settings templates' texts (`dictionaries/kit-templates/<locale>.json`, not in the module's dictionary: the admin page
 * loads them only in the settings editor). The seam reads a platform builtin's name from them (`dashboard.kit.tpl.<template>.label`).
 */
const KIT_TEMPLATE_TEXTS: Readonly<Record<string, () => Promise<{ default: Record<string, string> }>>> = {
  tr: () => import('../dictionaries/kit-templates/tr.json'),
}
const KIT_TEMPLATE_PREFIX = 'dashboard.kit.tpl.'

const baseOf = (locale: string): string => (locale || 'en').toLowerCase().split('-')[0] || 'en'

function moduleMessages(base: string, moduleId: string): Promise<Readonly<Record<string, string>>> {
  const id = `${base}:${moduleId}`
  let p = merged.get(id)
  if (!p) {
    p = moduleId === KIT_TEMPLATE_PREFIX
      ? (KIT_TEMPLATE_TEXTS[base]?.().then((m) => m.default) ?? Promise.resolve({}))
      : loadModuleDictionaries([moduleId]).then((dicts) => mergeLocaleMessages(base, dicts))
    // a failed load is not kept: the next request tries again, this one reads English
    p.catch(() => merged.delete(id))
    merged.set(id, p)
  }
  return p.catch(() => ({}))
}

/** A `LabelText` for `locale` over the dictionaries of `moduleIds` (a key of another module reads its English). */
export async function contributedLabelTexts(locale: string, moduleIds: Iterable<string>): Promise<LabelText> {
  const base = baseOf(locale)
  if (base === 'en') return englishLabels
  const ids = [...new Set(moduleIds)].filter(Boolean)
  // the dashboard's own builtins are named from its kit template texts
  if (ids.includes('dashboard')) ids.push(KIT_TEMPLATE_PREFIX)
  const byModule = new Map(await Promise.all(ids.map(async (m) => [m, await moduleMessages(base, m)] as const)))
  return (key, english) => {
    const text = byModule.get(key.startsWith(KIT_TEMPLATE_PREFIX) ? KIT_TEMPLATE_PREFIX : moduleOfLabelKey(key))?.[key]
    return typeof text === 'string' && text ? text : english
  }
}

/**
 * The seam's texts in the app language of the person asking (`appLocaleOf`: their language, else the workspace default). The locale's
 * resolver (the tenant's settings) is imported on use, so a reader that only needs `contributedLabelTexts` never boots the database.
 */
export async function requestLabelTexts(request: Pick<NextRequest, 'cookies'>, tenantId: string, moduleIds: Iterable<string>): Promise<LabelText> {
  const { appLocaleOf } = await import('./board-template.locale')
  return contributedLabelTexts(await appLocaleOf(request, tenantId), moduleIds)
}
