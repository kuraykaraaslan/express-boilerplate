import type { NextRequest } from 'next/server'
import { APP_LOCALE_COOKIE, resolveAppLocale } from '@kuraykaraaslan-labs/i18n/server/i18n.locale'
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages'

/**
 * D118 (e): the language a template's words are stored, previewed and listed in: the creator's app language, resolved the way the admin shell
 * resolves it (`app/tenant/[tenantId]/admin/(shell)/_i18n.ts`): the `app_locale` cookie (the mirror of `user_preferences.language`), else the
 * tenant's default language, clamped to the tenant's enabled languages. Never the browser's Accept-Language: the app does not follow it, so a
 * Turkish account in an en-US browser would store English boards, and the gallery would mix the client's titles (`titleKey`, in the app's
 * language) with the server's card and section titles.
 */
export async function templateLocaleOf(request: Pick<NextRequest, 'cookies'>, tenantId: string): Promise<string> {
  return appLocaleOf(request, tenantId)
}

/**
 * The app language of the person asking, for every word a board's server answers carry (column heads, field labels, Yes / No): the same
 * resolution as `templateLocaleOf`. A Turkish workspace read from an en-US browser gets Turkish words, as its admin shell does (run 3 #3).
 */
export async function appLocaleOf(request: Pick<NextRequest, 'cookies'>, tenantId: string): Promise<string> {
  const { defaultLanguage, enabledLanguages } = await resolveTenantLanguages(tenantId)
  return resolveAppLocale({ userLang: request.cookies?.get(APP_LOCALE_COOKIE)?.value, defaultLang: defaultLanguage, enabledLanguages })
}
