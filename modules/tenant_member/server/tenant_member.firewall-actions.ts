/**
 * tenant_member's action for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): suspend a person's membership of
 * the workspace for a while (`suspend` with `until`: the membership's sessions stop at once through its `sessionVersion`, and the
 * suspension lifts itself when `suspendedUntil` passes). A membership is a tenant's: only a run for that tenant takes it, never the
 * platform's across tenants.
 *
 * Add, never subtract (FWA-2): a membership that is not ACTIVE (already suspended by an administrator, deprovisioned) is left as it is, and
 * the undo lifts only the suspension this run set. The OWNER is never suspended (the service refuses, 409; transfer ownership first). The
 * service is loaded on first run.
 */
import {
  FIREWALL_HUMAN_LANES,
  firewallStep,
  outOfScope,
  undoText,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const members = async () => (await import('./tenant_member.service')).default;

export const SUSPEND_MEMBERSHIP: FirewallActionContribution = {
  id: 'tenant_member.suspend',
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: DAY_MS, maxMs: 30 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 10,
  // Only inside a tenant: a run as the platform is refused (outOfScope); the catalogue offers its mode to tenants only.
  scope: 'tenant',
  evidence: { boundToActor: true, minSignals: 2 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId === null) return outOfScope('tenant_only');
    const svc = await members();
    const member = await svc.getByTenantAndUser({ tenantMemberId: null, tenantId: ctx.tenantId, userId: ctx.actor.id });
    if (!member) return { status: 'noop', reason: 'not_a_member' };
    if (member.memberStatus !== 'ACTIVE') return { status: 'noop', reason: 'not_active' };
    if (member.memberRole === 'OWNER') return { status: 'refused', reason: 'owner' };
    const until = new Date(Date.now() + ctx.ttlMs);
    await svc.suspend(member.tenantMemberId, ctx.tenantId, { reason: `firewall: ${ctx.reason}`, until });
    return {
      status: 'executed',
      undoData: { tenantMemberId: member.tenantMemberId, userId: ctx.actor.id, until: until.toISOString() },
      expiresAt: until.toISOString(),
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const tenantMemberId = undoText(ctx.undoData, 'tenantMemberId');
    const until = undoText(ctx.undoData, 'until');
    if (!ctx.tenantId || !tenantMemberId || !until) return { status: 'noop', reason: 'no_undo_data' };
    const svc = await members();
    const member = await svc.getByTenantAndUser({ tenantMemberId, tenantId: ctx.tenantId, userId: ctx.actor.id });
    if (!member || member.memberStatus !== 'SUSPENDED') return { status: 'noop', reason: 'not_suspended' };
    // Suspended again since (an administrator's own suspension has another end): not this run's to lift.
    if (!member.suspendedUntil || member.suspendedUntil.toISOString() !== until) return { status: 'noop', reason: 'superseded' };
    await svc.unsuspend(tenantMemberId, ctx.tenantId);
    return { status: 'executed' };
  }),
};

/** How new a membership must be for the review hold: an older one is no sign-up any more (02.6). */
export const REVIEW_WINDOW_MS = 7 * DAY_MS;
/** The marker of a run (tenant_member.write.service.ts `reviewMarker`, the same prefix; a test keeps them equal). */
export const reviewMarkerOf = (proposalId: string): string => `firewall_review:${proposalId}`;

/**
 * Phase 55 02.6, sign-up protection: queue a NEW membership for an administrator's review. Covers both ways in: a self sign-up (the
 * register route makes an ACTIVE USER membership) and an accepted invitation (any invited role). The membership becomes PENDING (its
 * sessions stop, the sign-in pages say "pending approval") until an administrator sets it ACTIVE on the members page; the undo, and the
 * TTL's end, lift only this run's hold. Soft: the person keeps the account, nothing is deleted. Never the OWNER, never a membership older
 * than REVIEW_WINDOW_MS (an established member is the suspend action's), never one that is not ACTIVE.
 */
export const SIGNUP_REVIEW: FirewallActionContribution = {
  id: 'tenant_member.signup_review',
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: 7 * DAY_MS, maxMs: 30 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 20,
  // Only inside a tenant: a membership is a tenant's; a run as the platform is refused (outOfScope).
  scope: 'tenant',
  // FWA-5: the new member's own signals (its sign-up, its first requests), never someone else's.
  evidence: { boundToActor: true, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId === null) return outOfScope('tenant_only');
    const svc = await members();
    const member = await svc.getByTenantAndUser({ tenantMemberId: null, tenantId: ctx.tenantId, userId: ctx.actor.id });
    if (!member) return { status: 'noop', reason: 'not_a_member' };
    if (member.memberStatus !== 'ACTIVE') return { status: 'noop', reason: 'not_active' };
    if (member.memberRole === 'OWNER') return { status: 'refused', reason: 'owner' };
    const joinedAt = member.createdAt ? new Date(member.createdAt).getTime() : NaN;
    if (!Number.isFinite(joinedAt) || Date.now() - joinedAt > REVIEW_WINDOW_MS) return { status: 'refused', reason: 'not_new_member' };
    const marker = reviewMarkerOf(ctx.proposalId);
    const { held } = await svc.holdForReview(member.tenantMemberId, ctx.tenantId, { marker });
    if (!held) return { status: 'noop', reason: 'not_active' };
    return {
      status: 'executed',
      undoData: { tenantMemberId: member.tenantMemberId, userId: ctx.actor.id, marker },
      expiresAt: new Date(Date.now() + ctx.ttlMs).toISOString(),
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const tenantMemberId = undoText(ctx.undoData, 'tenantMemberId');
    const marker = undoText(ctx.undoData, 'marker');
    if (!ctx.tenantId || !tenantMemberId || !marker) return { status: 'noop', reason: 'no_undo_data' };
    const lifted = await (await members()).releaseReview(tenantMemberId, ctx.tenantId, marker);
    // Decided since (approved, declined, suspended or changed by an administrator): not this run's to lift.
    return lifted ? { status: 'executed' } : { status: 'noop', reason: 'superseded' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [SUSPEND_MEMBERSHIP, SIGNUP_REVIEW];

export default ACTIONS;
