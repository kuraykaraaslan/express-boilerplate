import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { listExternalContributions, type ExternalContribution } from '@kuraykaraaslan-labs/common/server/external-extensions';
import { parsePhone } from '@kuraykaraaslan-labs/common/server/common.phone';
import type BaseSMSProvider from './providers/base.provider';
import { IsolatedSmsProvider } from './providers/isolated.provider';

export type SMSProviderType = 'twilio' | 'netgsm' | 'clickatell' | 'nexmo' | 'verimor';

/** Extension point SMS providers contribute into (sandboxed community plugins). */
const SMS_PROVIDER_POINT = 'sms:provider';

export default class NotificationSmsProviderService {

  static readonly ALLOWED_COUNTRIES = env.SMS_ALLOWED_COUNTRIES?.split(',').map((c) => c.trim());

  static readonly DEFAULT_PROVIDER_NAME: SMSProviderType =
    (env.SMS_DEFAULT_PROVIDER as SMSProviderType) || 'twilio';

  /** Installed sandboxed community SMS providers for a tenant. */
  private static async contributions(tenantId: string): Promise<ExternalContribution[]> {
    return listExternalContributions(tenantId, SMS_PROVIDER_POINT);
  }

  private static build(c: ExternalContribution): BaseSMSProvider {
    return new IsolatedSmsProvider(c.key, c.metadata ?? {}, c.invoke, c.configured);
  }

  static readonly REGION_PROVIDER_MAP: Map<string, SMSProviderType> =
    NotificationSmsProviderService.buildRegionProviderMap();

  private static buildRegionProviderMap(): Map<string, SMSProviderType> {
    const map = new Map<string, SMSProviderType>();
    const envMap = env.SMS_PROVIDER_MAP;
    if (envMap) {
      for (const pair of envMap.split(',').map((p) => p.trim())) {
        const [region, provider] = pair.split(':').map((s) => s.trim());
        if (region && provider && NotificationSmsProviderService.isValidProviderName(provider)) {
          map.set(region.toUpperCase(), provider as SMSProviderType);
        }
      }
    } else {
      map.set('TR', 'netgsm');
      map.set('US', 'twilio');
      map.set('GB', 'twilio');
      map.set('DE', 'twilio');
      map.set('FR', 'twilio');
    }
    return map;
  }

  private static isValidProviderName(name: string): boolean {
    return ['twilio', 'netgsm', 'clickatell', 'nexmo', 'verimor'].includes(name.toLowerCase());
  }

  /**
   * Resolve a provider for a tenant. Providers are SANDBOXED community plugins
   * resolved per-tenant via the external-contributions bridge — no in-tree built-in
   * fallback. Honours an explicit choice / the `smsProvider` setting, then falls back
   * to the first installed+configured provider.
   */
  static async getProvider(tenantId: string, providerName?: SMSProviderType): Promise<BaseSMSProvider> {
    const contribs = await NotificationSmsProviderService.contributions(tenantId);
    if (contribs.length === 0) {
      throw new Error('No SMS provider is installed for this tenant');
    }

    let name = providerName;
    if (!name) {
      const configured = await SettingService.getValue(tenantId, 'smsProvider').catch(() => null);
      name = (configured && NotificationSmsProviderService.isValidProviderName(configured) ? configured as SMSProviderType : null)
        || NotificationSmsProviderService.DEFAULT_PROVIDER_NAME;
    }

    const firstConfigured = (): BaseSMSProvider | undefined => {
      const c = contribs.find((x) => x.configured);
      if (c) Logger.info(`NotificationSmsProviderService: Using fallback provider "${c.key}"`);
      return c ? NotificationSmsProviderService.build(c) : undefined;
    };

    const chosen = contribs.find((c) => c.key === name);
    if (!chosen) {
      Logger.warn(`NotificationSmsProviderService: provider "${name}" is unknown/not installed, falling back`);
      return firstConfigured() ?? NotificationSmsProviderService.build(contribs[0]);
    }
    if (!chosen.configured) {
      Logger.warn(`NotificationSmsProviderService: provider "${name}" not configured for tenant ${tenantId}, trying fallback`);
      return firstConfigured() ?? NotificationSmsProviderService.build(chosen);
    }
    return NotificationSmsProviderService.build(chosen);
  }

  static async listProviders(tenantId: string): Promise<{ name: SMSProviderType; configured: boolean }[]> {
    return (await NotificationSmsProviderService.contributions(tenantId))
      .map((c) => ({ name: c.key as SMSProviderType, configured: c.configured }));
  }

  static getRegionProviderMap(): Record<string, SMSProviderType> {
    const result: Record<string, SMSProviderType> = {};
    for (const [region, provider] of NotificationSmsProviderService.REGION_PROVIDER_MAP) {
      result[region] = provider;
    }
    return result;
  }

  static async getProviderForRegion(tenantId: string, regionCode: string): Promise<BaseSMSProvider> {
    // Per-tenant region→provider override takes precedence over the global map.
    try {
      const { default: NotificationSmsDeliveryService } = await import('./notification_sms.delivery.service');
      const override = await NotificationSmsDeliveryService.resolveRegionProvider(tenantId, regionCode);
      if (override && NotificationSmsProviderService.isValidProviderName(override)) {
        return NotificationSmsProviderService.getProvider(tenantId, override as SMSProviderType);
      }
    } catch { /* fall through to global map */ }

    const providerName = NotificationSmsProviderService.REGION_PROVIDER_MAP.get(regionCode.toUpperCase());
    if (providerName) {
      return NotificationSmsProviderService.getProvider(tenantId, providerName);
    }
    Logger.warn(`NotificationSmsProviderService: No specific provider for ${regionCode}. Using default.`);
    return NotificationSmsProviderService.getProvider(tenantId);
  }

  /**
   * Region + canonical form, for picking a provider by country.
   *
   * Delegates to the shared value object rather than keeping a second
   * libphonenumber instance: routing an outbound SMS and matching an inbound
   * call are the same parse, and two copies drift (AGENTS §10). The shape stays
   * `{ number, regionCode }` because that is what the provider registry reads.
   *
   * No default region is passed: an SMS recipient reaches this service already
   * canonicalized by whoever accepted it, and guessing a country for a bare
   * `0532…` here would silently send to the wrong subscriber.
   */
  static parsePhoneNumber(phoneNumber: string): { number: string; regionCode: string } | null {
    const parsed = parsePhone(phoneNumber);
    if (!parsed?.regionCode) {
      Logger.error(`NotificationSmsProviderService: Unable to parse phone number: ${phoneNumber}`);
      return null;
    }
    return { number: parsed.e164, regionCode: parsed.regionCode };
  }

  static isAllowedCountry(regionCode: string): boolean {
    const allowed = NotificationSmsProviderService.ALLOWED_COUNTRIES;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(regionCode);
  }

  /**
   * Per-tenant country allowlist (`smsAllowedCountries`, CSV of ISO-2 codes).
   * Falls back to the platform `ALLOWED_COUNTRIES` env list when unset.
   */
  static async isAllowedCountryForTenant(tenantId: string, regionCode: string): Promise<boolean> {
    const raw = await SettingService.getValue(tenantId, 'smsAllowedCountries').catch(() => null);
    if (raw) {
      const list = raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
      if (list.length > 0) return list.includes(regionCode.toUpperCase());
    }
    return NotificationSmsProviderService.isAllowedCountry(regionCode);
  }

  static isValidPhoneNumber(phoneNumber: string): boolean {
    return parsePhone(phoneNumber) !== null;
  }
}
