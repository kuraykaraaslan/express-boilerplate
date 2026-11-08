import type { TenantSuspensionListener } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import UserSessionCrudService from '@kuraykaraaslan-labs/user_session/server/user_session.crud.service';

/**
 * `tenant:suspension` contribution — a suspension revokes every session of the tenant (docs/phases/02-fleet/05 section 7 stage 7).
 *
 * Requests of a suspended tenant are already refused on the next request, warm cache or not (`getTenantStatus` in
 * tenant_session.membership). Revoking the sessions adds what that check cannot reach: the refresh tokens that would keep a
 * signed-in device alive across the suspension, and, through `user_session:session_revoked`, each session's live sockets.
 * Sessions in the members' other workspaces are untouched. Resuming revokes nothing and restores nothing: members sign in again.
 */
const listener: TenantSuspensionListener = {
  async suspensionChanged({ tenantId, suspended }) {
    if (suspended) await UserSessionCrudService.deleteTenantSessions(tenantId);
  },
};

export default listener;
