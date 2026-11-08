import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantMemberSeatReservationLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_member.seat_reservation';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { seatAllowance } from './tenant_member.seat-allowance';

export const SEAT_RESERVATION_POINT = 'tenant_member:seat_reservation';

/** A holder of seats that are spoken for but not yet ACTIVE members. */
export interface SeatReservationProvider {
  countReserved(tenantId: string): Promise<number>;
}

export const SEAT_LIMIT_REACHED = "Your plan's member limit has been reached";

/**
 * Seat accounting for the `max_members` plan limit.
 *
 * ## The hole this closes
 *
 * Both seat checks — inviting somebody, and adding a member directly — counted
 * only ACTIVE members. A pending invitation is a seat that is already spoken
 * for, so a tenant one seat below a 5-seat plan could send fifty invitations
 * (each passing a check that saw 4 members), and every acceptance walked in
 * unchecked: `accept()` creates the member without consulting the plan at all.
 * The paid ceiling was therefore not a ceiling, and the overshoot was unbounded.
 *
 * Counting reservations at ISSUE time is the fix, and the placement matters for
 * the same reason it did for SSO: the alternative is to check the plan when an
 * invitee clicks their link, which punishes the one person in the story who did
 * nothing wrong and cannot act on the refusal. The tenant is refused while it is
 * still the tenant's decision.
 *
 * ## Reservations arrive through a seam
 *
 * `tenant_member` is the tenancy primitive that `tenant_invitation` is built
 * on; importing invitations back from here would invert that and cycle. So
 * holders of unclaimed seats contribute through `tenant_member:seat_reservation`
 * and this module never learns that invitations exist.
 *
 * ## UNDECLARED is allowed
 *
 * `assertFeatureAccess` refuses anything a live plan does not mention, which is
 * a defensible default for a boolean capability and the wrong one for a ceiling:
 * a plan that says nothing about `max_members` has stated no limit, and reading
 * that as "may not add anybody" locked invitations for every tenant whose plan
 * predates the key. Only a declared LIMIT refuses here.
 */
async function countReservedSeats(tenantId: string): Promise<number> {
  // A contributor that cannot count is not evidence of zero reservations, but
  // refusing the whole operation over it would make an unrelated module's
  // outage look like a billing refusal. So this quota guard fails OPEN, as the
  // point declares (`failOpen`, EXT-3): the runtime logs it and we undercount.
  const { results } = await ext.guard<SeatReservationProvider, number>(
    SEAT_RESERVATION_POINT, tenantCtx(tenantId), tenantMemberSeatReservationLoaders,
    async (provider) => {
      const n = await provider?.countReserved(tenantId);
      return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0;
    },
    { failOpen: true },
  );
  return results.reduce((sum, r) => sum + r.value, 0);
}

/** Seats in use: ACTIVE members plus every seat a contributor is holding. */
export async function countSeatsInUse(tenantId: string, activeMemberCount: number): Promise<number> {
  return activeMemberCount + await countReservedSeats(tenantId);
}

/**
 * Refuse the caller when one more seat would exceed a DECLARED `max_members`
 * limit. Fails open on a gate error: a feature-gate outage must not stop a
 * tenant staffing its own workspace.
 */
export async function assertSeatCapacity(tenantId: string, activeMemberCount: number): Promise<void> {
  if (isRootTenant(tenantId)) return;

  const inUse = await countSeatsInUse(tenantId, activeMemberCount);
  const result = await FeatureGateService
    .checkFeatureAccess(tenantId, FEATURE_KEYS.MAX_MEMBERS, inUse)
    .catch(() => null);

  if (result && result.type === 'LIMIT' && !result.allowed) {
    throw new AppError(SEAT_LIMIT_REACHED, 403, ErrorCode.FEATURE_NOT_AVAILABLE);
  }
}

/** The refusal of the paid seat allowance (the same words the direct add-member POST uses). */
export const seatAllowanceReached = (allowance: number): string =>
  `Seat limit reached (${allowance}). Upgrade your plan or add seats to invite more members.`;

/**
 * Refuse the caller when one more seat would pass the paid seat allowance (`tenant_member:seat_allowance`: what the
 * tenant's entitlements include, or the operator's override; `seatAllowance`). The same ceiling the direct add-member
 * POST enforces, here counted against the seats in use (ACTIVE members plus every reservation, `countSeatsInUse`), so an
 * invitation cannot be the way past it (03-ui-fixes 2.1): fifty invitations at a full allowance used to pass, and every
 * acceptance walked in. Checked when the invitation is issued, for the reason `assertSeatCapacity` gives: an unclaimed
 * invitation holds its seat until it is accepted, declined or expires. No allowance (no seller, monetization off) means
 * no ceiling; a seller that cannot answer refuses (503, as `seatAllowance` does).
 */
export async function assertSeatAllowance(tenantId: string, activeMemberCount: number): Promise<void> {
  if (isRootTenant(tenantId)) return;
  const allowance = await seatAllowance(tenantId);
  if (allowance == null) return;
  const inUse = await countSeatsInUse(tenantId, activeMemberCount);
  if (inUse >= allowance) {
    throw new AppError(seatAllowanceReached(allowance), 403, ErrorCode.FORBIDDEN);
  }
}
