import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { onboardingChecks } from './tenant.extension-points';

/** The steps tenant answers itself. Other modules add theirs through `tenant:onboarding_check` (tenant_domain: `dns_configured`). */
export type OnboardingStep =
  | 'mail_configured'
  | 'payment_configured'
  | 'branding_configured'
  | 'first_member_invited'
  | 'storage_configured';

/** The built-in steps, plus one per active `tenant:onboarding_check` contribution, keyed by its step id. */
export type OnboardingChecklist = Record<OnboardingStep, boolean> & Record<string, boolean>;

export default class TenantOnboardingService {

  static async getChecklist(tenantId: string): Promise<{ checklist: OnboardingChecklist; completedCount: number; total: number }> {
    const settings = await SettingService.getAllAsRecord(tenantId).catch(() => ({} as Record<string, string>));

    const checklist: OnboardingChecklist = {
      // Contributed first, so a contributor can never overwrite a built-in step.
      ...await onboardingChecks(tenantId).catch(() => ({})),
      mail_configured: !!(settings.mailProvider && settings.mailProvider !== 'smtp') ||
                       !!(settings.smtpHost),
      // 04-tenant-setting: the payments page writes stripePublishableKey; stripePublicKey is the older key some tenants still hold.
      payment_configured: !!(settings.stripePublishableKey || settings.stripePublicKey || settings.paypalClientId || settings.iyzicoApiKey),
      branding_configured: !!(settings.siteName || settings.logoUrl),
      first_member_invited: await this.hasMembers(tenantId),
      storage_configured: !!(settings.storageProvider && settings.storageProvider !== 'local'),
    };

    const completedCount = Object.values(checklist).filter(Boolean).length;
    const total = Object.keys(checklist).length;

    return { checklist, completedCount, total };
  }

  private static async hasMembers(tenantId: string): Promise<boolean> {
    try {
      const { default: TenantMemberService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.service');
      const result = await TenantMemberService.getByTenantId({ tenantId, page: 0, pageSize: 2, search: null, memberRole: null, memberStatus: null }).catch(() => ({ total: 0 }));
      return ((result as { total?: number }).total ?? 0) > 1;
    } catch {
      return false;
    }
  }
}
