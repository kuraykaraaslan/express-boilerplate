import type { TenantOnboardingCheck } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import TenantDomainService from './tenant_domain.service';

/**
 * `tenant:onboarding_check` contribution, key `dns_configured`: the tenant has at least one custom domain whose DNS
 * ownership was verified. tenant used to ask tenant_domain for this itself (docs/phases/37-extensions/10).
 */
const check: TenantOnboardingCheck = {
  async done(tenantId) {
    const { domains } = await TenantDomainService.getByTenantId({ tenantId, page: 1, pageSize: 10 });
    return domains.some((d) => !!d.verifiedAt);
  },
};

export default check;
