import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages';
import { baseLang, flagCountry, getLanguage, localeLabel } from '@kuraykaraaslan-labs/localization/server/languages';
import { dictionaryLocales, moduleDictionaryLocales } from '@kuraykaraaslan-labs/common/server/dictionary-locales';
import TranslationReadService from './translation.read.service';
import { mobileModuleIds } from './translation.mobile-source';
import { LocaleSchema } from './translation.dto';
import type { TranslationScope, TranslationVersions } from './translation.types';

/** One language the app can switch to, as the mobile app's `RemoteLanguageSchema` expects it. */
export type OfferedLanguage = {
  /** The tenant's code for it, lowercased (`bg`, `pt-br`). */
  code: string;
  /** The language named in itself (`Български`); never empty. */
  name: string;
  /** ISO 3166 alpha-2 country for the flag (`BG`), or null. The app draws the emoji. */
  flag: string | null;
  /** module → version of its stored texts, for the requested scope (on mobile, only the modules the app reads). */
  versions: TranslationVersions;
};

const ALPHA2 = /^[A-Z]{2}$/;

/** `localization`'s endonym, falling back to its label, then to the code: never empty. */
function nativeName(code: string): string {
  return getLanguage(code)?.label?.trim() || localeLabel(code) || code;
}

function flagOf(code: string): string | null {
  const country = flagCountry(code);
  return ALPHA2.test(country) ? country : null;
}

export default class TranslationLanguagesService {
  /**
   * The languages to offer, in the tenant's order (default first): enabled for the
   * tenant AND covered by something, either a dictionary in code or at least one stored
   * row for `scope`. A language that is enabled but has neither is left out: the app
   * would see `versions: {}`, consider it complete and show English.
   *
   * A code the mobile schema would reject (more than one subtag) is left out too, since
   * one such entry makes the app reject the whole list.
   *
   * On mobile both are judged over the modules the app reads (the mobile snapshot's), not
   * every web module: `versions` names only those, so the app downloads only what it uses,
   * and a language with texts only in web modules is not offered there. The versions are
   * the same computation as the bundles', filtered after the (unchanged) cached map.
   */
  static async list(tenantId: string, scope: TranslationScope): Promise<OfferedLanguage[]> {
    const { enabledLanguages } = await resolveTenantLanguages(tenantId);
    const mobile = scope === 'mobile' ? new Set(mobileModuleIds()) : null;
    // English is the source every key falls back to, so it is always covered.
    const inCode = mobile ? new Set(['en', ...[...mobile].flatMap(moduleDictionaryLocales)]) : new Set(dictionaryLocales());
    const codes = enabledLanguages
      .map((c) => LocaleSchema.safeParse(c))
      .filter((r) => r.success)
      .map((r) => r.data);

    const offered = await Promise.all(codes.map(async (code): Promise<OfferedLanguage | null> => {
      const all = await TranslationReadService.getVersions(code, scope);
      const versions = mobile ? Object.fromEntries(Object.entries(all).filter(([m]) => mobile.has(m))) : all;
      const covered = inCode.has(baseLang(code)) || Object.keys(versions).length > 0;
      return covered ? { code, name: nativeName(code), flag: flagOf(code), versions } : null;
    }));
    return offered.filter((l): l is OfferedLanguage => l !== null);
  }

  /** Whether `code` is one of the tenant's enabled languages (compared lowercased). */
  static async isEnabled(tenantId: string, code: string): Promise<boolean> {
    const { enabledLanguages } = await resolveTenantLanguages(tenantId);
    return enabledLanguages.includes(code.toLowerCase());
  }
}
