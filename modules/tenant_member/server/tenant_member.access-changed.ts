import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantMemberAccessChangedLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_member.access_changed';

/** Extension point id — declared in tenant_member/module.json `extensionPoints`. */
export const ACCESS_CHANGED_POINT = 'tenant_member:access_changed';

export interface AccessChanged {
  tenantId: string;
  userId: string;
  /** `role` (the built-in role moved, e.g. ADMIN → USER) or `role_keys` (custom roles added or removed). */
  reason: 'role' | 'role_keys';
  /** D249: as `MembershipEnded.sessionEndOrderedBy` (the modules whose orders the role change's own transaction recorded). */
  sessionEndOrderedBy?: string[];
}

/**
 * `tenant_member:access_changed` — told after an ACTIVE member's role or custom roles changed, so what they may see or
 * do changed while they stay a member (risk register websocket.08). For things granted once and kept: websocket_session
 * drops the member's sockets in the workspace, so each one comes back with a ticket minted under the new rights (a
 * socket's rooms are decided at the handshake). Ending a membership is `tenant_member:membership_ended`, not this.
 *
 * Best-effort by contract, like membership_ended: a hook that throws is logged and skipped, and one that has not
 * answered within the point's `timeoutMs` is no longer awaited. Changing someone's role must never fail because a
 * satellite had trouble.
 */
export type AccessChangedHook = (changed: AccessChanged) => Promise<void>;

export async function notifyAccessChanged(changed: AccessChanged): Promise<void> {
  await ext.fanOut<AccessChangedHook>(
    ACCESS_CHANGED_POINT, tenantCtx(changed.tenantId), tenantMemberAccessChangedLoaders,
    (hook) => hook(changed),
  );
}
