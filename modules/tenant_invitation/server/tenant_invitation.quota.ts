import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { assertSeatAllowance, assertSeatCapacity } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.seats';
import TenantInvitationMessages from './tenant_invitation.messages';
import { countPendingInvitations } from './tenant_invitation.seat-reservation';

/**
 * The two plan limits an invitation has to clear.
 *
 * `max_members` is the SEAT ceiling, and it is checked against members plus
 * unclaimed invitations (see `tenant_member.seats`) rather than members alone.
 *
 * `max_invitations` is a different quantity that was sold and never read: how
 * many invitations may be OUTSTANDING at once. Counting invitations ever sent
 * would have been the other reading and it is the wrong one — it would bill a
 * tenant forever for staff turnover, and a five-year-old company would find
 * itself unable to replace a leaver. Outstanding invitations, by contrast, are
 * a real cost (each is a mail we send and a live credential) and the ceiling
 * frees itself as invitations are accepted, declined or expire.
 *
 * Both refuse only what a live plan DECLARES, and both fail open.
 *
 * The paid seat allowance (what the tenant's entitlements include, or the operator's override) is the third: the same
 * ceiling the direct add-member POST enforces, counted with the invitations already out (`assertSeatAllowance`). It used
 * to be checked only there, so inviting went past it (03-ui-fixes 2.1). It fails closed, like the add-member check.
 */
export async function assertInvitationQuota(tenantId: string, activeMemberCount: number): Promise<void> {
  if (isRootTenant(tenantId)) return;

  await assertSeatCapacity(tenantId, activeMemberCount);
  await assertSeatAllowance(tenantId, activeMemberCount);

  const pending = await countPendingInvitations(tenantId).catch(() => null);
  if (pending === null) return;

  const result = await FeatureGateService
    .checkFeatureAccess(tenantId, FEATURE_KEYS.MAX_INVITATIONS, pending)
    .catch(() => null);

  if (result && result.type === 'LIMIT' && !result.allowed) {
    throw new AppError(TenantInvitationMessages.INVITATION_LIMIT_REACHED, 403, ErrorCode.FEATURE_NOT_AVAILABLE);
  }
}
