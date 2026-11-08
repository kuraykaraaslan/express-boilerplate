/**
 * tenant_invitation's action for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): revoke the PENDING
 * invitations a person sent in the workspace (`revoke` per invitation: conditional on PENDING, the cached rows dropped, the
 * `invitation.revoked` webhook sent). A pending invitation is a membership waiting for whoever holds its link; one a hijacked
 * administrator account sent to an outside address is a way back in that outlives the account's sessions. The sender is the run's actor,
 * on the human lanes, inside its tenant only. Once accepted, the membership is tenant_member's (its suspension and its sign-up review act
 * on the joiner, 02.6), so this action leaves accepted, declined and expired invitations alone.
 *
 * A revoked invitation never turns PENDING again (every move out of PENDING is final, and the raw token was only e-mailed), so the run
 * cannot be undone (`reversible: false`) and a person approves every run (`minimumMode: 'suggest'`, FWA-4, D55-9); an administrator
 * sends a new invitation to an invitee who was rightful. At most MAX_INVITATIONS per run: the run asks for one more, and when there was
 * more it answers `executed` with reason `capped` and `more: true` in its undo data, so the approver and the activity page see the
 * containment was partial (the proposal id is the idempotency key: the same proposal never picks up the rest). The services are loaded on
 * first run.
 */
import {
  FIREWALL_HUMAN_LANES,
  firewallStep,
  notReversible,
  outOfScope,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
/** The most invitations one run revokes. */
export const MAX_INVITATIONS = 100;

export const REVOKE_SENT_INVITATIONS: FirewallActionContribution = {
  id: 'tenant_invitation.revoke_sent',
  rung: 'ban',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: HOUR_MS, maxMs: HOUR_MS },
  minimumMode: 'suggest',
  hourlyBudget: 5,
  // Only inside a tenant: an invitation is a tenant's; a run as the platform is refused (outOfScope).
  scope: 'tenant',
  // FWA-5: the sender's own signals, never someone else's.
  evidence: { boundToActor: true, minSignals: 2 },
  reversible: false,
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId === null) return outOfScope('tenant_only');
    const tenantId = ctx.tenantId;
    const [{ pendingSentBy }, { revoke }] = await Promise.all([
      import('./tenant_invitation.read.service'), import('./tenant_invitation.lifecycle.service'),
    ]);
    // one more than the cap: whether the run leaves invitations behind
    const listed = await pendingSentBy(tenantId, ctx.actor.id, MAX_INVITATIONS + 1);
    if (!listed.length) return { status: 'noop', reason: 'no_pending_invitation' };
    const pending = listed.slice(0, MAX_INVITATIONS);
    const more = listed.length > pending.length;
    let revoked = 0;
    let failure: unknown = null;
    for (const inv of pending) {
      try {
        await revoke(inv.invitationId, tenantId);
        revoked += 1;
      } catch (error) {
        // accepted, declined or revoked meanwhile (404 / 409): no longer pending, not this run's to revoke
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status !== 404 && status !== 409) failure ??= error;
      }
    }
    if (!revoked) {
      if (failure) throw failure;
      return { status: 'noop', reason: 'no_pending_invitation' };
    }
    return more
      ? { status: 'executed', reason: 'capped', undoData: { invitedByUserId: ctx.actor.id, revoked, more: true } }
      : { status: 'executed', undoData: { invitedByUserId: ctx.actor.id, revoked } };
  }),
  // A revoked invitation never turns pending again: an administrator sends a new one to a rightful invitee.
  undo: notReversible('new_invitation_required'),
};

const ACTIONS: FirewallActionContribution[] = [REVOKE_SENT_INVITATIONS];

export default ACTIONS;
