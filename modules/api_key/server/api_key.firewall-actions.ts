/**
 * api_key's actions for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): throttle a key (phase 55 00.5
 * `enforceKeyThrottle`: at most 10 calls a minute, enforced, source `firewall`) and revoke a key (deactivated, `isActive: false`, which
 * its undo turns back; never the delete, which cannot be undone). A key is a machine: acted on per credential on its own lane, never per
 * address (FWA-6, 38 L-4).
 *
 * Scope: a key is its tenant's; a run acts on a key of its own tenant only (a platform run, `tenantId` null, on the ROOT tenant's keys),
 * and a key of another tenant is, as far as the run can tell, no key (`getById` answers 404 for it).
 *
 * Add, never subtract (FWA-2): a key already throttled (by its strikes' flag, an administrator or an earlier run) keeps that record, and
 * an inactive key is left inactive; each undo reverts only its own run (the revocation's undo only while the key is still deactivated by
 * this run: its `deactivatedAt`, which only a deactivation or reactivation writes, D55-16; `updatedAt` also moves with every usage stamp).
 * The activation state is read from the row, never the cache. The services are loaded on first run.
 */
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import {
  firewallStep,
  undoText,
  type FirewallActionContribution,
  type FirewallUndoData,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** `KEY_THROTTLE_MAX_SECONDS` of api_key.strikes (a day; the test holds them equal). */
export const FIREWALL_KEY_THROTTLE_MAX_SECONDS = 24 * 60 * 60;

const tenantOf = (tenantId: string | null): string => tenantId ?? ROOT_TENANT_ID;
const crud = () => import('./api_key.crud.service');
const keyStrikes = () => import('./api_key.strikes');

export const THROTTLE_KEY: FirewallActionContribution = {
  id: 'api_key.throttle',
  rung: 'throttle',
  lanes: ['machine-apikey'],
  actorKinds: ['apiKey'],
  ttl: { defaultMs: 15 * MINUTE_MS, maxMs: FIREWALL_KEY_THROTTLE_MAX_SECONDS * 1000 },
  minimumMode: 'auto',
  hourlyBudget: 20,
  // 00.5: the key's own accepted calls, never its refusals (whoever leaked a key could otherwise cap the rightful integration).
  evidence: { boundToActor: true, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    const tenantId = tenantOf(ctx.tenantId);
    const apiKeyId = ctx.actor.id;
    await (await crud()).getById(tenantId, apiKeyId);
    const s = await keyStrikes();
    if (await s.getKeyThrottle(apiKeyId)) return { status: 'noop', reason: 'already_throttled' };
    const seconds = Math.max(60, Math.min(FIREWALL_KEY_THROTTLE_MAX_SECONDS, Math.round(ctx.ttlMs / 1000)));
    const t = await s.enforceKeyThrottle(apiKeyId, { tenantId, actorId: null, source: 'firewall', seconds, reason: `firewall:${ctx.reason}` });
    return { status: 'executed', undoData: { apiKeyId, throttledAt: t.throttledAt }, expiresAt: new Date(t.until).toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const apiKeyId = undoText(ctx.undoData, 'apiKeyId');
    const throttledAt = ctx.undoData.throttledAt;
    if (!apiKeyId || typeof throttledAt !== 'number') return { status: 'noop', reason: 'no_undo_data' };
    const s = await keyStrikes();
    const t = await s.getKeyThrottle(apiKeyId);
    if (!t) return { status: 'noop', reason: 'not_throttled' };
    if (t.throttledAt !== throttledAt) return { status: 'noop', reason: 'superseded' };
    const removed = await s.clearKeyThrottle(apiKeyId, { tenantId: tenantOf(ctx.tenantId), actorId: null, source: 'firewall' });
    return removed ? { status: 'executed' } : { status: 'noop', reason: 'not_throttled' };
  }),
};

export const REVOKE_KEY: FirewallActionContribution = {
  id: 'api_key.revoke',
  rung: 'ban',
  lanes: ['machine-apikey'],
  actorKinds: ['apiKey'],
  // Revoked until undone; the TTL is when the responder turns it back if nobody decided otherwise.
  ttl: { defaultMs: 24 * HOUR_MS, maxMs: 30 * 24 * HOUR_MS },
  // An integration stops working: a person approves every run.
  minimumMode: 'suggest',
  hourlyBudget: 5,
  evidence: { boundToActor: true, minSignals: 2 },
  execute: (ctx) => firewallStep(async () => {
    const tenantId = tenantOf(ctx.tenantId);
    const apiKeyId = ctx.actor.id;
    const c = await crud();
    // a key of another tenant, or none, is no key
    const before = await c.activationOf(tenantId, apiKeyId);
    if (!before) return { status: 'noop', reason: 'not_found' };
    if (!before.isActive) return { status: 'noop', reason: 'not_active' };
    const since = Date.now();
    await c.update(tenantId, apiKeyId, { isActive: false });
    // The stamp this run's deactivation wrote (read from the row; `update` answers the schema's shape, which leaves it out). One older
    // than the call is someone else's (a deactivation that won the race): the undo then has no marker and reactivates nothing.
    const after = await c.activationOf(tenantId, apiKeyId);
    const stamp = after && !after.isActive && after.deactivatedAt ? new Date(after.deactivatedAt) : null;
    const undoData: FirewallUndoData = { apiKeyId };
    if (stamp && stamp.getTime() >= since) undoData.revokedAt = stamp.toISOString();
    return {
      status: 'executed',
      undoData,
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const apiKeyId = undoText(ctx.undoData, 'apiKeyId');
    const revokedAt = undoText(ctx.undoData, 'revokedAt');
    if (!apiKeyId || !revokedAt) return { status: 'noop', reason: 'no_undo_data' };
    const tenantId = tenantOf(ctx.tenantId);
    const c = await crud();
    const key = await c.activationOf(tenantId, apiKeyId);
    if (!key) return { status: 'noop', reason: 'not_found' };
    if (key.isActive) return { status: 'noop', reason: 'already_active' };
    // Deactivated again since the run (an administrator reactivated and retired it, a revoke-all after a reactivation): that decision is
    // not this run's to undo, and an expiry must never bring back a key someone retired as compromised (FWA-2). A usage stamp, an edit or a
    // review does not count: they leave the stamp alone (D55-16).
    if (!key.deactivatedAt || new Date(key.deactivatedAt).toISOString() !== revokedAt) return { status: 'noop', reason: 'superseded' };
    // The service's own rules hold: a key rotated away stays retired, and the tenant's key limit is checked (both 409, refused).
    await c.update(tenantId, apiKeyId, { isActive: true });
    return { status: 'executed' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [THROTTLE_KEY, REVOKE_KEY];

export default ACTIONS;
