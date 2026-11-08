import type { EntitlementChangeListener } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.entitlement-changed';
import { reconcileTenantDomains } from './tenant_domain.reconcile';

/**
 * `feature_gate:entitlement_changed` contribution: a tenant's plan just changed (assigned, cancelled, lapsed, a
 * catalogue entitlement granted or expired), so hold its custom domains to the new plan at once instead of on the next
 * 6-hourly sweep. Idempotent; the sweep remains the safety net for a missed announcement.
 */
const listener: EntitlementChangeListener = {
  async entitlementChanged(tenantId) {
    await reconcileTenantDomains(tenantId);
  },
};

export default listener;
