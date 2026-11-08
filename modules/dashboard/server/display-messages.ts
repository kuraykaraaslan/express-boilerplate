import { moduleRegistry, type RuntimeComponentExtension } from '@kuraykaraaslan-labs/common/server/module-registry'
import type { Direction } from '@kuraykaraaslan-labs/i18n/server/i18n.core'
import { resolveAppLocale } from '@kuraykaraaslan-labs/i18n/server/i18n.locale'
import { isRtlLang } from '@kuraykaraaslan-labs/localization/server/languages'
import { loadModuleDictionaries, mergeLocaleMessages, shipsLocale } from '@kuraykaraaslan-labs/common/server/module-messages'
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages'
import { displayRenderable } from './display-safe'
import { toExtDescriptor } from './widget-catalog.service'

/** The modules whose messages every screen needs: the shared UI and this module's own. */
const DISPLAY_BASE_MODULES = ['common', 'dashboard']

/**
 * The modules whose messages a display link's screen ships (decision #10): `common`, `dashboard`, and every module that
 * contributes a `dashboard:widget` a screen may render (`displayRenderable`: data-bound and `metadata.displaySafe`), so
 * such a card's own `<module>.…` keys are translated. Decided from the installed build only, never from the tenant's
 * enabled modules or the link's board: the page does not read the token, and a screen's messages must not tell an
 * anonymous visitor which modules a tenant runs. Messages are static UI strings; a contribution whose module is off
 * never renders, so its strings cost a few bytes and reveal nothing. Today no module opts in, so this is the two base
 * modules. A contribution that reads ANOTHER module's keys must keep them in its own dictionary to be translated here.
 */
export function displayMessageModules(
  extensions: RuntimeComponentExtension[] = moduleRegistry.getComponentExtensions('dashboard:widget'),
): string[] {
  const contributors = extensions.filter((e) => displayRenderable(toExtDescriptor(e))).map((e) => e.moduleId)
  return [...new Set([...DISPLAY_BASE_MODULES, ...contributors])]
}

/**
 * A screen's locale, writing direction and messages. The locale is the tenant's default language, resolved the way the admin shell
 * resolves it when the viewer has no preference (`resolveAppLocale`: primary subtag, clamped to the enabled
 * languages), since a wall screen has no viewer; English when no shipped dictionary has that language. The messages are
 * the admin merge (English base, the locale laid over it per key) of `displayMessageModules`. The direction is the
 * admin shell's rule (`isRtlLang`) applied to the locale the screen actually renders in, so a right-to-left default
 * language with no shipped dictionary falls back to English left-to-right rather than English laid out mirrored.
 */
export async function displayMessages(
  tenantId: string,
): Promise<{ locale: string; dir: Direction; messages: Record<string, string> }> {
  const langs = await resolveTenantLanguages(tenantId).catch(() => null)
  const wanted = resolveAppLocale({ defaultLang: langs?.defaultLanguage, enabledLanguages: langs?.enabledLanguages })
  const dicts = await loadModuleDictionaries(displayMessageModules())
  const locale = shipsLocale(wanted, dicts) ? wanted.split('-')[0] : 'en'
  return { locale, dir: isRtlLang(locale) ? 'rtl' : 'ltr', messages: mergeLocaleMessages(locale, dicts) }
}
