import type { TenantDefaultModulesProvider } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { applyDefaultModules } from './module-lifecycle.service';

/**
 * `tenant:default_modules` contribution: a newly created tenant is installed with
 * the platform's default modules (docs/phases/25-marketplace/03-module-governance/01),
 * through the single door — plan check, ledger, hooks, audit. Runs after the
 * default plan, so the plan check sees the new tenant's plan.
 */
const provider: TenantDefaultModulesProvider = {
  async applyDefaultModules(tenantId) {
    return applyDefaultModules(tenantId);
  },
};

export default provider;
