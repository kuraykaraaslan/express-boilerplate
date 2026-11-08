/**
 * limiter's actions for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): ban an address (phase 55 00.2: source
 * `firewall`, so it holds everywhere on the ban lanes, D55-3, is persisted and is listed and liftable on the ban screen like any ban), and
 * throttle an address (its signed-in ceiling divided, the misbehaviour divisor of D40-10(d), decided instead of earned).
 *
 * Addresses only on the lanes that ban addresses (FWA-6, 38 L-4: `human-web`, `human-native`, `public-anon`); a machine or device is acted
 * on per credential by its own module. A ban or a throttle covers the whole installation, every tenant behind the address, so only a
 * platform run (`tenantId` null) takes them; a tenant's incident reaches them through the platform (05).
 *
 * Add, never subtract (FWA-2): a standing ban is never replaced (its source, end and offense history stay), an address a ROOT member
 * signed in from in the last 30 days is never banned by the firewall (D55-3: the operator's own office stays reachable), and each undo
 * lifts only what its run set. The global blocklist is not an action: it has no end and is the operator's alone (phase 55 00.2 review).
 */
import {
  FIREWALL_ADDRESS_LANES,
  firewallStep,
  outOfScope,
  undoText,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** `BAN_MAX_SECONDS` of limiter.ip-strikes (seven days; the test holds them equal), kept here so loading the registry loads no Redis client. */
export const FIREWALL_BAN_MAX_SECONDS = 7 * 24 * 60 * 60;

/** The divisor of a firewall throttle: the misbehaviour script's repeat division (a quarter of the address's ceiling). */
export const FIREWALL_THROTTLE_DIVISOR = 4;

const strikes = async () => (await import('./limiter.ip-strikes')).default;

export const IP_BAN: FirewallActionContribution = {
  id: 'limiter.ip_ban',
  rung: 'ban',
  lanes: FIREWALL_ADDRESS_LANES,
  actorKinds: ['ip'],
  ttl: { defaultMs: HOUR_MS, maxMs: FIREWALL_BAN_MAX_SECONDS * 1000 },
  minimumMode: 'auto',
  hourlyBudget: 50,
  // Only as the platform (account- or installation-wide): a tenant's run is refused (outOfScope); its mode is the root tenant's.
  scope: 'platform',
  // An address is acted on by what came from it; an address is not a person, so FWA-5's binding does not apply.
  evidence: { boundToActor: false, minSignals: 3 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const svc = await strikes();
    const address = ctx.actor.id;
    if (await svc.getBan(address)) return { status: 'noop', reason: 'already_banned' };
    const { rateLimitBucketOf } = await import('./limiter.ip-bucket');
    const { isOperatorAddress } = await import('./limiter.ban-promotion');
    if (await isOperatorAddress(rateLimitBucketOf(address))) return { status: 'refused', reason: 'operator_address' };
    const seconds = Math.max(60, Math.min(FIREWALL_BAN_MAX_SECONDS, Math.round(ctx.ttlMs / 1000)));
    const ban = await svc.ban(address, `firewall:${ctx.reason}`, { manual: false, source: 'firewall', seconds });
    return {
      status: 'executed',
      undoData: { bucket: ban.bucket, bannedAt: ban.bannedAt },
      expiresAt: new Date(ban.until).toISOString(),
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const bucket = undoText(ctx.undoData, 'bucket');
    const bannedAt = ctx.undoData.bannedAt;
    if (!bucket || typeof bannedAt !== 'number') return { status: 'noop', reason: 'no_undo_data' };
    const svc = await strikes();
    const ban = await svc.getBan(bucket);
    if (!ban) return { status: 'noop', reason: 'not_banned' };
    // Banned again since (by an administrator, the strikes or a later run): that ban is not this run's to lift.
    if (ban.source !== 'firewall' || ban.bannedAt !== bannedAt) return { status: 'noop', reason: 'superseded' };
    return (await svc.unban(bucket)) ? { status: 'executed' } : { status: 'noop', reason: 'not_banned' };
  }),
};

export const THROTTLE: FirewallActionContribution = {
  id: 'limiter.throttle',
  rung: 'throttle',
  lanes: FIREWALL_ADDRESS_LANES,
  actorKinds: ['ip'],
  // The misbehaviour script's own spans: 15 minutes, an hour on a repeat; a decision may hold up to a day.
  ttl: { defaultMs: 15 * MINUTE_MS, maxMs: 24 * HOUR_MS },
  minimumMode: 'auto',
  hourlyBudget: 100,
  // Only as the platform (account- or installation-wide): a tenant's run is refused (outOfScope); its mode is the root tenant's.
  scope: 'platform',
  evidence: { boundToActor: false, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const { rateLimitBucketOf } = await import('./limiter.ip-bucket');
    const { throttleAddress } = await import('./limiter.misbehaviour');
    const bucket = rateLimitBucketOf(ctx.actor.id);
    // the run's proposal id is recorded with the division (D55-20): its undo lifts only this run's, never a later run's of the same strength
    const { applied } = await throttleAddress(bucket, FIREWALL_THROTTLE_DIVISOR, ctx.ttlMs, ctx.proposalId);
    if (!applied) return { status: 'noop', reason: 'already_throttled' };
    return {
      status: 'executed',
      undoData: { bucket, divisor: FIREWALL_THROTTLE_DIVISOR, runId: ctx.proposalId },
      expiresAt: new Date(Date.now() + ctx.ttlMs).toISOString(),
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const bucket = undoText(ctx.undoData, 'bucket');
    const divisor = ctx.undoData.divisor;
    const runId = undoText(ctx.undoData, 'runId');
    if (!bucket || typeof divisor !== 'number' || !runId) return { status: 'noop', reason: 'no_undo_data' };
    const { clearAddressThrottle } = await import('./limiter.misbehaviour');
    return (await clearAddressThrottle(bucket, divisor, runId)) ? { status: 'executed' } : { status: 'noop', reason: 'not_throttled' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [IP_BAN, THROTTLE];

export default ACTIONS;
