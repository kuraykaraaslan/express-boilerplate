import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantMemberMembershipEndedLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_member.membership_ended';

/** Extension point id — declared in tenant_member/module.json `extensionPoints`. */
export const MEMBERSHIP_ENDED_POINT = 'tenant_member:membership_ended';

export interface MembershipEnded {
  tenantId: string;
  userId: string;
  /** `removed` (deleted), or the non-ACTIVE status the membership moved to (`suspended`, `inactive`, …). */
  reason: string;
  /**
   * D249: the modules whose session-ending orders for this change were already recorded in the membership's own transaction
   * (`session_end:order_source`); their hooks skip it. Absent when nothing was recorded there.
   */
  sessionEndOrderedBy?: string[];
}

/**
 * `tenant_member:membership_ended` — told after a member stops being an ACTIVE member of a
 * workspace (removed, suspended, deprovisioned).
 *
 * For things that were addressed to the person BECAUSE they were a member and must stop the
 * moment they are not: notification_push removes their push registrations for the workspace,
 * otherwise a removed member's phone keeps receiving the workspace's notifications. Default
 * export of a contribution: `(ended: MembershipEnded) => Promise<void>`.
 *
 * Best-effort by contract: a hook that throws is logged and skipped, and one that has not
 * answered within the point's `timeoutMs` (2 s, tenant_member/module.json) is no longer awaited.
 * Removing someone from a workspace is a security action and must never fail, or hang, because a
 * satellite's cleanup had trouble. Hooks of modules not active for the workspace are not told.
 */
export type MembershipEndedHook = (ended: MembershipEnded) => Promise<void>;

export async function notifyMembershipEnded(ended: MembershipEnded): Promise<void> {
  await ext.fanOut<MembershipEndedHook>(
    MEMBERSHIP_ENDED_POINT, tenantCtx(ended.tenantId), tenantMemberMembershipEndedLoaders,
    (hook) => hook(ended),
  );
}
