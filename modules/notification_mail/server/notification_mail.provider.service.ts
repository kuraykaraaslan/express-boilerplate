import { env } from '@kuraykaraaslan-labs/env';
import { installBrand } from '@kuraykaraaslan-labs/common/server/install-config/install-config.brand';
import Logger from '@kuraykaraaslan-labs/logger';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { listExternalContributions, type ExternalContribution } from '@kuraykaraaslan-labs/common/server/external-extensions';
import path from 'path';
import { fileURLToPath } from 'url';
import type BaseMailProvider from './providers/base.provider';
import { renderMailTemplate } from './notification_mail.render';
import { IsolatedMailProvider } from './providers/isolated.provider';

export type MailProviderType = 'smtp' | 'sendgrid' | 'mailgun' | 'ses' | 'postmark' | 'resend';

/** Extension point mail providers contribute into (sandboxed community plugins). */
const MAIL_PROVIDER_POINT = 'mail:provider';

/**
 * Directory of this file under both module systems. The Next bundle is CommonJS-shaped
 * (`__dirname` exists); the standalone worker runs this file as a native ES module
 * (tsx), where a bare `__dirname` throws "__dirname is not defined in ES module scope"
 * (it broke every job that rendered mail, e.g. `dormant-sweep`). `typeof` is safe in both.
 */
const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default class NotificationMailProviderService {

  static readonly DEFAULT_PROVIDER: MailProviderType =
    (env.MAIL_PROVIDER as MailProviderType) || 'smtp';

  static readonly TEMPLATE_PATH = path.join(HERE, 'templates');

  /** Installed sandboxed community mail providers for a tenant. */
  private static async contributions(tenantId: string): Promise<ExternalContribution[]> {
    return listExternalContributions(tenantId, MAIL_PROVIDER_POINT);
  }

  private static build(c: ExternalContribution): BaseMailProvider {
    return new IsolatedMailProvider(c.key, c.metadata ?? {}, c.invoke, c.configured);
  }

  /** Resolve the tenant's preferred sender identity (falls back to env MAIL_FROM). */
  static async resolveFrom(tenantId: string): Promise<string> {
    try {
      const s = await SettingService.getByKeys(tenantId, ['fromEmail', 'fromName']);
      if (s.fromEmail) return s.fromName ? `${s.fromName} <${s.fromEmail}>` : s.fromEmail;
    } catch { /* fall through to env default */ }
    return env.MAIL_FROM || `${installBrand().mailSenderName || env.APPLICATION_NAME || 'Next Boilerplate'} <noreply@example.com>`;
  }

  /**
   * Resolve a provider for a tenant. Providers are SANDBOXED community plugins
   * resolved per-tenant via the external-contributions bridge — no in-tree built-in
   * fallback. Honours an explicit choice / the `mailProvider` setting, then falls
   * back to the first installed+configured provider.
   */
  static async getProvider(tenantId: string, providerName?: MailProviderType): Promise<BaseMailProvider> {
    const contribs = await NotificationMailProviderService.contributions(tenantId);
    if (contribs.length === 0) {
      throw new Error('No mail provider is installed for this tenant');
    }

    let name = providerName;
    if (!name) {
      const configured = await SettingService.getValue(tenantId, 'mailProvider').catch(() => null);
      name = (configured as MailProviderType) || NotificationMailProviderService.DEFAULT_PROVIDER;
    }

    const firstConfigured = (): BaseMailProvider | undefined => {
      const c = contribs.find((x) => x.configured);
      if (c) Logger.info(`NotificationMailProviderService: Using fallback provider "${c.key}"`);
      return c ? NotificationMailProviderService.build(c) : undefined;
    };

    const chosen = contribs.find((c) => c.key === name);
    if (!chosen) {
      Logger.warn(`NotificationMailProviderService: provider "${name}" is unknown/not installed, falling back`);
      return firstConfigured() ?? NotificationMailProviderService.build(contribs[0]);
    }
    if (!chosen.configured) {
      Logger.warn(`NotificationMailProviderService: provider "${name}" not configured for tenant ${tenantId}, trying fallback`);
      return firstConfigured() ?? NotificationMailProviderService.build(chosen);
    }
    return NotificationMailProviderService.build(chosen);
  }

  static async listProviders(tenantId: string): Promise<{ name: MailProviderType; configured: boolean }[]> {
    return (await NotificationMailProviderService.contributions(tenantId))
      .map((c) => ({ name: c.key as MailProviderType, configured: c.configured }));
  }

  static async renderTemplate(templateName: string, data: Record<string, unknown>): Promise<string> {
    return renderMailTemplate(NotificationMailProviderService.TEMPLATE_PATH, templateName, data);
  }
}
