import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { countCustomerTenants, TENANT_CEILING_KEY } from './tenant.ceiling';

/**
 * `feature_gate:deployment_usage` contribution (fleet 3b.11, S11 rule 7): how many customer tenants this deployment holds, shown in the console next to
 * the license's `tenants` cap. The same count the creation path enforces (root, fleet, soft-deleted and RELOCATED rows left out), read without its lock:
 * display only.
 */
const tenantDeploymentUsage = async (): Promise<Record<string, number>> =>
  ({ [TENANT_CEILING_KEY]: await withSystemRLS((qr) => countCustomerTenants(qr)) });

export default tenantDeploymentUsage;
