import SettingService from './tenant_setting.service';
import { parseEnabledLanguages } from '@kuraykaraaslan-labs/localization/server/languages';

export type TenantLanguages = {
  /** The tenant's default application language (lowercased, non-empty). */
  defaultLanguage: string;
  /** Ordered, de-duped, default-first list of enabled application languages. */
  enabledLanguages: string[];
};

const DEFAULT_FALLBACK = 'en';

/**
 * The tenant's configured application languages — the `Localization` setting group
 * (`defaultLanguage` + `enabledLanguages` CSV). Ordered, de-duped, default-first;
 * fails open to the single-language baseline. This is the SHARED reader used by
 * both the admin-UI i18n layout and dynamic_page's `resolveSiteLanguages`; never
 * split the `enabledLanguages` CSV ad hoc elsewhere.
 *
 * No monetization clamp here: the content-publishing `MAX_LANGUAGES` limit is
 * applied by dynamic_page on top (it governs how many languages a tenant may
 * PUBLISH, not which language a user views the admin UI in).
 */
export async function resolveTenantLanguages(tenantId: string): Promise<TenantLanguages> {
  let record: Record<string, string> = {};
  try {
    record = await SettingService.getByKeys(tenantId, ['defaultLanguage', 'enabledLanguages']);
  } catch {
    record = {};
  }

  const defaultLanguage = ((record.defaultLanguage || DEFAULT_FALLBACK).trim().toLowerCase()) || DEFAULT_FALLBACK;
  const enabled = parseEnabledLanguages(record.enabledLanguages);
  const enabledLanguages = [defaultLanguage, ...enabled.filter((l) => l !== defaultLanguage)];

  return { defaultLanguage, enabledLanguages };
}
