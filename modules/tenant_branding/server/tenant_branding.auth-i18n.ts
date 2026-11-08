import { cookies } from 'next/headers';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { loadModuleDictionaries, mergeLocaleMessages, shipsLocale } from '@kuraykaraaslan-labs/common/server/module-messages';
import { APP_LOCALE_COOKIE, resolveAppLocale } from '@kuraykaraaslan-labs/i18n/server/i18n.locale';
import type { Direction } from '@kuraykaraaslan-labs/i18n/server/i18n.core';
import { isRtlLang } from '@kuraykaraaslan-labs/localization/server/languages';
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages';

/** The slots an auth page renders other modules' contributions into (the login page's alternative methods). */
const AUTH_SLOTS = ['auth.login.methods'];

/**
 * The modules whose words an auth page needs: the shared UI, the white label, the page's own module and every module that
 * may contribute to an auth slot. Decided from the installed build, never from the tenant's enabled modules: the page is
 * anonymous and its messages must not tell a visitor which modules a tenant runs (as `displayMessageModules`).
 */
export function authMessageModules(pageModuleId?: string): string[] {
  const contributors = AUTH_SLOTS.flatMap((slot) => moduleRegistry.getSlotContributions(slot).map((c) => c.moduleId));
  return [...new Set(['common', 'tenant_branding', ...(pageModuleId ? [pageModuleId] : []), ...contributors])];
}

/**
 * An auth page's locale, direction and messages (e2e run 1, V2-L1: sign-in was English in a Turkish workspace because no
 * I18nProvider was mounted). The locale is resolved as the admin shell resolves it: the visitor's `app_locale` cookie,
 * then the tenant's default language, clamped to the enabled languages; English when no shipped dictionary has it.
 */
export async function authPageI18n(
  tenantId: string,
  pageModuleId?: string,
): Promise<{ locale: string; dir: Direction; messages: Record<string, string>; languages: string[] }> {
  const langs = await resolveTenantLanguages(tenantId).catch(() => null);
  const cookieLocale = (await cookies()).get(APP_LOCALE_COOKIE)?.value;
  const wanted = resolveAppLocale({ userLang: cookieLocale, defaultLang: langs?.defaultLanguage, enabledLanguages: langs?.enabledLanguages });
  const dicts = await loadModuleDictionaries(authMessageModules(pageModuleId));
  const locale = shipsLocale(wanted, dicts) ? wanted.split('-')[0] : 'en';
  return {
    locale,
    dir: isRtlLang(locale) ? 'rtl' : 'ltr',
    messages: mergeLocaleMessages(locale, dicts),
    languages: langs?.enabledLanguages?.length ? langs.enabledLanguages : [locale],
  };
}
