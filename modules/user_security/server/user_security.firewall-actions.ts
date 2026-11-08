/**
 * user_security's actions for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): the security lock of phase 55 00.1
 * (every sign-in method refused, every live session ended) and the revocation of the person's trusted devices (00.6: the next sign-in on
 * them asks for the code again). Both are account-wide, like the platform routes that do them (`/api/users/{id}/security-lock`,
 * `/trusted-devices`), so only a platform run (`tenantId` null) takes them; a tenant's incident reaches them through the platform (05).
 *
 * Add, never subtract (FWA-2): the lock is never laid over a lock that already holds (an administrator's reason and end stay), and its undo
 * lifts only the lock this run set, not one an administrator set since. The services are loaded on first run.
 */
import {
  FIREWALL_HUMAN_LANES,
  firewallStep,
  notReversible,
  outOfScope,
  undoText,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const security = async () => (await import('./user_security.service')).default;

export const SECURITY_LOCK: FirewallActionContribution = {
  id: 'user_security.security_lock',
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  // A firewall lock always ends (`until`); only an administrator's may be open-ended.
  ttl: { defaultMs: DAY_MS, maxMs: 30 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 5,
  // Only as the platform (account- or installation-wide): a tenant's run is refused (outOfScope); its mode is the root tenant's.
  scope: 'platform',
  // FWA-5: signals of the person's own session or credential only (failed sign-ins for an address earn a step-up at most).
  evidence: { boundToActor: true, minSignals: 2 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const svc = await security();
    const userId = ctx.actor.id;
    if (await svc.getSecurityLock(userId)) return { status: 'noop', reason: 'already_locked' };
    const until = new Date(Date.now() + ctx.ttlMs);
    const { lock } = await svc.lockAccount(userId, { until, reason: `firewall: ${ctx.reason}`, actorId: null, source: 'firewall' });
    return { status: 'executed', undoData: { userId, lockedAt: lock.lockedAt.toISOString() }, expiresAt: until.toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const userId = undoText(ctx.undoData, 'userId');
    const lockedAt = undoText(ctx.undoData, 'lockedAt');
    if (!userId || !lockedAt) return { status: 'noop', reason: 'no_undo_data' };
    const svc = await security();
    const lock = await svc.getSecurityLock(userId);
    if (!lock) return { status: 'noop', reason: 'not_locked' };
    // Locked again since (by an administrator, or by a later run with its own undo): that lock is not this run's to lift.
    if (lock.source !== 'firewall' || lock.lockedAt.toISOString() !== lockedAt) return { status: 'noop', reason: 'superseded' };
    await svc.unlockAccount(userId, { actorId: null, source: 'firewall', reason: `firewall undo: ${ctx.why}` });
    return { status: 'executed' };
  }),
};

export const REVOKE_TRUSTED_DEVICES: FirewallActionContribution = {
  id: 'user_security.revoke_trusted_devices',
  // Below "end session" (00.6): no session ends, the next sign-in on those devices asks for the second factor again.
  rung: 'step_up',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: HOUR_MS, maxMs: HOUR_MS },
  // FWA-4, D55-9: revoked trust cannot be handed back, so a person approves every run.
  minimumMode: 'suggest',
  hourlyBudget: 20,
  // Only as the platform (account- or installation-wide): a tenant's run is refused (outOfScope); its mode is the root tenant's.
  scope: 'platform',
  evidence: { boundToActor: true, minSignals: 1 },
  reversible: false,
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const userId = ctx.actor.id;
    const { count } = await (await security()).revokeTrustedDevicesBy(userId, { by: 'firewall', actorId: null, reason: ctx.reason });
    return count > 0 ? { status: 'executed', undoData: { userId, count } } : { status: 'noop', reason: 'no_trusted_devices' };
  }),
  // The trust lived in a cookie the server only knew by its hash: it cannot be handed back. The cost is one code at the next sign-in.
  undo: notReversible('trust_not_restorable'),
};

const ACTIONS: FirewallActionContribution[] = [SECURITY_LOCK, REVOKE_TRUSTED_DEVICES];

export default ACTIONS;
