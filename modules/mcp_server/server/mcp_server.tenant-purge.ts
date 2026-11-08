import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import Logger from '@kuraykaraaslan-labs/logger';
import { oauthStore } from './oauth/mcp_oauth.store';

/**
 * `tenant:purge_step` contribution: a purged tenant keeps no MCP OAuth grant. Its access tokens and codes expire in Redis on their own
 * (ten minutes at most) and answer nothing once the grant row is gone. Idempotent.
 */
const step: TenantPurgeStep = {
  async purge(tenantId) {
    const n = await oauthStore.purgeTenant(tenantId);
    Logger.info(`[mcp_server] purge of tenant ${tenantId}: ${n} OAuth grant rows deleted`);
  },
};

export default step;
