import 'reflect-metadata';
import Logger from '@kuraykaraaslan-labs/logger';
import ApprovalQueueService from '@kuraykaraaslan-labs/approval/server/approval.service';
import type { ApprovalQueueItem } from '@kuraykaraaslan-labs/approval/server/approval.types';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import type { TenantMemberRole } from './tenant_member.enums';
import { update, remove, create, submitterMayReplay } from './tenant_member.write.service';

// The entityType tenant_member submits under when a SENSITIVE membership change
// (promotion to owner/admin, or removal of an owner/admin) is deferred because
// the tenant enabled dual-control (`tenantMemberDualControl`). The queue never
// interprets it beyond routing this decision handler.
const ENTITY_TYPE = 'tenant_member_change';

// Per-tenant toggle: when 'true', SENSITIVE membership changes are held in the
// shared approval queue instead of applied immediately (default OFF).
export const DUAL_CONTROL_SETTING = 'tenantMemberDualControl';

/**
 * The kind of deferred change encoded in an approval item's metadata. The
 * decision handler replays exactly this on APPROVED.
 */
export type MemberChangeAction = 'role_change' | 'remove' | 'add';

export interface MemberChangeMetadata {
  action: MemberChangeAction;
  /** Target role for a `role_change` (the role being granted). */
  targetRole?: TenantMemberRole;
  /** The user who requested the change (submitter; carried for audit). */
  actorId?: string;
}

/**
 * A membership change is SENSITIVE when it grants or revokes privileged access:
 * promoting a member to OWNER/ADMIN, or removing a member who IS an OWNER/ADMIN.
 * Only sensitive changes are ever routed through dual-control.
 */
export function isSensitiveRole(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Read the tenant's `tenantMemberDualControl` toggle. Fails closed (tenant_member.08, fixed 2026-10-20): a settings read failure
 * resolves to ON, so a flaky settings store parks the sensitive change for a second person instead of switching the rule off.
 */
export async function isDualControlEnabled(tenantId: string): Promise<boolean> {
  try {
    return (await SettingService.getValue(tenantId, DUAL_CONTROL_SETTING)) === 'true';
  } catch (err) {
    Logger.warn(`[tenant_member] dual-control setting unreadable for tenant=${tenantId}, treating as ON: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }
}

/**
 * Defer a SENSITIVE membership change by submitting it to the shared approval
 * queue instead of applying it now. The pending change lives entirely in the
 * item's `metadata`; the boot-registered decision handler replays it on
 * APPROVED and discards it on REJECTED. Idempotent — the queue collapses an
 * already-open item for the same member, so a resubmit is a no-op.
 */
export async function submitMemberChangeForApproval(
  tenantId: string,
  tenantMemberId: string,
  metadata: MemberChangeMetadata,
): Promise<void> {
  const reason = metadata.action === 'remove'
    ? 'Sensitive member removal pending dual-control approval'
    : metadata.action === 'add'
      ? `Adding a member as ${metadata.targetRole ?? 'privileged role'} pending dual-control approval`
      : `Sensitive role change to ${metadata.targetRole ?? 'privileged role'} pending dual-control approval`;
  await ApprovalQueueService.submit(tenantId, {
    entityType: ENTITY_TYPE,
    entityId: tenantMemberId,
    submittedByUserId: metadata.actorId ?? null,
    priority: 1,
    reason,
    metadata: { ...metadata },
  });
}

/**
 * React to a TERMINAL approval decision on a deferred membership change — the
 * boot-registered sync-back that completes the dual-control loop:
 *
 *  - APPROVED → replay the pending change from `item.metadata` by calling the
 *    real write-service mutation (`update` for a role grant, `remove` for a
 *    removal), which BYPASSES the route-level dual-control gate (the gate lives
 *    in the route, not the service — see members-member-id.route).
 *  - REJECTED → discard: the change was never applied, so there is nothing to
 *    undo.
 *
 * Best-effort and IDEMPOTENT: `remove` on an already-removed member and `update`
 * re-applying the same role are effectively no-ops, and any throw is caught and
 * logged, so a redelivered decision can never break the decision write (the
 * queue swallows handler errors — this must never rely on throwing).
 */
async function onMemberChangeDecision(event: { tenantId: string; item: ApprovalQueueItem }): Promise<void> {
  const { tenantId, item } = event;
  if (item.status !== 'APPROVED' && item.status !== 'REJECTED') return;
  // REJECTED → the deferred change was never applied; nothing to sync.
  if (item.status === 'REJECTED') return;

  const meta = item.metadata ?? {};
  const action = typeof meta.action === 'string' ? meta.action : undefined;
  const targetRole = typeof meta.targetRole === 'string' ? meta.targetRole : undefined;
  // The reviewer who approved the change is the acting user for the replay.
  const actorId = item.reviewedByUserId ?? undefined;
  // tenant_member.05 (fixed 2026-10-20): the submitter's authority is re-checked at replay time (see `submitterMayReplay`).
  const submitter = item.submittedByUserId ?? (typeof meta.actorId === 'string' ? meta.actorId : null);

  try {
    const known = action === 'remove' || ((action === 'role_change' || action === 'add') && isSensitiveRole(targetRole));
    if (known && !(await submitterMayReplay(tenantId, submitter, { action: action as MemberChangeAction, targetRole, tenantMemberId: item.entityId }))) {
      Logger.warn(`[tenant_member] approval replay refused: the submitter may not make this change tenant=${tenantId} item=${item.approvalItemId}`);
    } else if (action === 'remove') {
      await remove(item.entityId, tenantId, actorId);
    } else if (action === 'role_change' && isSensitiveRole(targetRole)) {
      await update(item.entityId, tenantId, { memberRole: targetRole as TenantMemberRole, memberStatus: null }, actorId);
    } else if (action === 'add' && isSensitiveRole(targetRole)) {
      // tenant_member.07: a privileged add parked under dual control; the item's entityId is the user being added.
      await create({ tenantId, userId: item.entityId, memberRole: targetRole as TenantMemberRole, memberStatus: 'ACTIVE' } as never, actorId);
    } else {
      Logger.warn(`[tenant_member] approval decision with unrecognised metadata tenant=${tenantId} item=${item.approvalItemId}`);
    }
  } catch (err) {
    // Idempotent no-ops (member already removed / re-applied role) and any other
    // hiccup are swallowed — a decision must never fail because the replay did.
    Logger.warn(
      `[tenant_member] approval replay failed tenant=${tenantId} member=${item.entityId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Register the membership-change decision handler with the shared approval
 * queue. Called once at server boot from `instrumentation.ts`. Idempotent — the
 * queue keeps a single handler per entityType, so re-registering replaces it.
 */
export function registerTenantMemberApprovalHandler(): void {
  ApprovalQueueService.registerHandler(ENTITY_TYPE, onMemberChangeDecision);
  Logger.info('[tenant_member] approval decision handler registered for tenant_member_change');
}
