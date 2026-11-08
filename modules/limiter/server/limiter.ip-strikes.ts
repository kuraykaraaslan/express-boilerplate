/**
 * Cross-account per-IP strike store with exponential bans (docs/phases/38-security/02-bans-and-abuse.md 2.1, fail2ban semantics at
 * the app layer). Per-account counters never see a password spray (one guess against many accounts); this counts failures per
 * trusted-parsed client address across all accounts and bans the address once it crosses a threshold.
 *
 * Lane rule (L-4): strikes are recorded only by human auth flows (login, OTP, reset token), and a ban is enforced only on lanes whose
 * `LANE_POLICY.banParticipation` is `true`. Machine lanes are never banned by IP.
 *
 * Phase 55 00 §0.2: a ban holds on every request of those lanes (the proxy's ban gate, limiter.ban-gate.ts), not only on the `auth`
 * scope; it may cover a CIDR block (a manual ban, limiter.ban-target.ts); a manual or firewall ban, and an automatic one longer than an
 * hour, is also written to the table `security_ip_bans` (limiter.ip-ban-store.ts), which rebuilds Redis after a flush; and an address
 * banned automatically for the fifth time gets the longest automatic ban at once, unless a ROOT member signed in from it lately
 * (limiter.ban-promotion.ts). A failure from an address that is banned right now is not a strike.
 */
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { rateLimitBucketOf } from './limiter.ip-bucket';
import { withinRedisBound } from './limiter.service';
import { capped, getLimiterPolicy } from './limiter.settings-policy';
import { BAN_INDEX_KEY, BAN_KEY_PATTERN, BAN_STATE_CIDR_PREFIX, BAN_STATE_KEY, banKey } from './limiter.ban-keys';
import { banKindOf, banTargetOf } from './limiter.ban-target';
import { forgetCachedBans } from './limiter.ban-gate';
import { BAN_EVERYWHERE_FROM_OFFENSE, type IpBanScope } from './limiter.ban-scope';
import { auditPromotion, promotedBanSeconds } from './limiter.ban-promotion';
import type { IpBanSource } from './entities/security_ip_ban.entity';

/** Failures within the window that earn a ban (the ROOT setting `limiterStrikeThreshold` may lower it, limiter.settings-policy.ts). */
export const STRIKE_THRESHOLD = 10;
/** The window the failures are counted in, seconds. */
export const STRIKE_WINDOW_SECONDS = 10 * 60;
/** First ban, seconds; every repeat offense doubles it (the ROOT setting `limiterBanBaseMinutes` may lengthen it). */
export const BAN_BASE_SECONDS = 60 * 60;
/** Longest ban, seconds. */
export const BAN_MAX_SECONDS = 7 * 24 * 60 * 60;
/** How long an offense is remembered for the exponential step, seconds. */
export const OFFENSE_MEMORY_SECONDS = 30 * 24 * 60 * 60;

const strikeKey = (bucket: string) => `ip-strike:${bucket}`;
const offenseKey = (bucket: string) => `ip-offense:${bucket}`;
/**
 * The ban index: a sorted set of every banned bucket, score = the ban's `until` (ms). Written by `ban()` (the only writer of a ban
 * key, automatic bans from `recordStrike` included) and `unban()`, trimmed of ended bans by `listBans`, so a listing reads the
 * bans it shows instead of walking the shared keyspace. Its TTL is refreshed to the longest possible ban on every ban, so it never
 * outlives the bans it indexes by more than that.
 */
export { BAN_INDEX_KEY };
/** Set for a while after a complete fallback SCAN found no ban the index lacked, so an empty index is not walked again each poll. */
const BAN_LEGACY_SCANNED_KEY = 'ip-bans:legacy-scanned';
export const BAN_LEGACY_SCANNED_SECONDS = 60 * 60;

/** `listBans`: keys per SCAN round and MGET page, the most rounds, keys and time one fallback walk takes, and its largest `limit`. */
export const BAN_LIST_SCAN_COUNT = 200;
export const BAN_LIST_MAX_ROUNDS = 500;
export const BAN_LIST_MAX_KEYS = 5_000;
export const BAN_LIST_SCAN_DEADLINE_MS = 2_000;
export const BAN_LIST_MAX_LIMIT = 1_000;

/** What `listBans` returns: the bans, and whether the list may be missing some (a fallback walk stopped at one of its bounds). */
export type IpBanList = { items: IpBan[]; truncated: boolean };

/** A stored ban value, or null when it is not one (a hand-written key, a value from an older shape). */
function parseBan(raw: string | null | undefined): IpBan | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<IpBan> | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.bucket !== 'string' || typeof v.reason !== 'string') return null;
    if (![v.offense, v.bannedAt, v.until].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const source = typeof v.source === 'string' && IP_BAN_SOURCE_SET.has(v.source) ? { source: v.source } : {};
    const scope = v.scope === 'auth' || v.scope === 'everywhere' ? { scope: v.scope } : {};
    return { bucket: v.bucket, offense: v.offense!, reason: v.reason, bannedAt: v.bannedAt!, until: v.until!, manual: v.manual === true, ...source, ...scope };
  } catch {
    return null;
  }
}

/**
 * One ban. `bucket` is its target (an IPv4 address, an IPv6 /64 bucket or a masked CIDR block); `source` says who set it (absent on a
 * ban written before sources existed: `manual` tells those apart).
 */
export type IpBan = {
  bucket: string; offense: number; reason: string; bannedAt: number; until: number; manual: boolean; source?: IpBanSource;
  /**
   * Where the ban holds (D55-3, phase 55 00.2). `everywhere`: the proxy's gate refuses every page and API on the ban lanes. `auth`: only the
   * sign-in endpoints refuse (the limiter's own check), as every ban did before phase 55. Absent on a ban written before scopes existed:
   * `banHoldsEverywhere` decides from the source and the offense.
   */
  scope?: IpBanScope;
};

export { BAN_EVERYWHERE_FROM_OFFENSE, banHoldsEverywhere, type IpBanScope } from './limiter.ban-scope';

const IP_BAN_SOURCE_SET: ReadonlySet<string> = new Set<IpBanSource>(['auto', 'manual', 'firewall']);

/** The one that ends last first; the bucket breaks a tie, so the order is stable. */
function sortBans(bans: IpBan[]): IpBan[] {
  return bans.sort((a, b) => b.until - a.until || (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}

/** Ban length for the nth offense (1-based): base (never below `BAN_BASE_SECONDS`), doubled per repeat, capped. Pure. */
export function banSecondsFor(offense: number, baseSeconds: number = BAN_BASE_SECONDS): number {
  const n = Math.max(1, Math.floor(offense));
  const base = Number.isFinite(baseSeconds) ? Math.max(BAN_BASE_SECONDS, baseSeconds) : BAN_BASE_SECONDS;
  return Math.min(BAN_MAX_SECONDS, base * 2 ** Math.min(n - 1, 30));
}

function auditBan(action: string, bucket: string, metadata: Record<string, unknown>, actorId?: string): void {
  AuditLogService.log({
    tenantId: null,
    actorId: actorId ?? null,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'ip',
    resourceId: bucket,
    metadata: { ip: bucket, ...metadata },
  } as never).catch(() => {});
}

export default class IpStrikeService {
  /**
   * An active ban on this address, or null. Fails open: a Redis outage must not turn the ban check into an outage (the auth limiter
   * behind it already fails closed on its own).
   */
  static async getBan(ip: string): Promise<IpBan | null> {
    if (!ip || ip === 'unknown') return null;
    const bucket = rateLimitBucketOf(ip);
    try {
      const raw = await withinRedisBound(redis.get(banKey(bucket)));
      return raw ? (JSON.parse(raw) as IpBan) : null;
    } catch {
      return null;
    }
  }

  /** Seconds left of an active ban (for `Retry-After`), 0 when none. */
  static async retryAfter(ip: string): Promise<number> {
    const ban = await this.getBan(ip);
    return ban ? Math.max(1, Math.ceil((ban.until - Date.now()) / 1000)) : 0;
  }

  /**
   * One failed human authentication attempt from this address (any account). Crossing the threshold bans the address, longer for a
   * repeat offender. Best-effort: never throws into the login path. Returns the ban when this strike caused one.
   */
  static async recordStrike(ip: string | null | undefined, reason = 'auth_failure'): Promise<IpBan | null> {
    if (!ip || ip === 'unknown') return null;
    const bucket = rateLimitBucketOf(ip);
    try {
      // Phase 55 00 review: a failure from an address that is banned right now is not a strike. The limiter refuses a banned address before
      // the sign-in runs, so such a failure comes from a path that slipped the ban (or a race with it); counting it would escalate the address
      // while it is serving its ban.
      const standing = parseBan(await withinRedisBound(redis.get(banKey(bucket))).catch(() => null));
      if (standing && standing.until > Date.now()) return null;
      const count = Number(await withinRedisBound(redis.incr(strikeKey(bucket))));
      if (count === 1) await withinRedisBound(redis.expire(strikeKey(bucket), STRIKE_WINDOW_SECONDS));
      if (count < capped(STRIKE_THRESHOLD, (await getLimiterPolicy()).strikeThreshold)) return null;
      return await this.ban(bucket, reason, { manual: false });
    } catch (err) {
      Logger.warn(`[ip-strikes] strike not recorded: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Bans an address or CIDR block now. Automatic bans escalate with the offense count; a manual or firewall ban takes `seconds`
   * (default the base ban). The target is canonical (`banTargetOf`): a manual ban that names no address or block, or a block wider
   * than MIN_BAN_PREFIX, is a 400. An automatic ban never shortens a longer ban that is already in force.
   * Persisted (limiter.ip-ban-store.ts) when it is manual, from the firewall or longer than an hour (`place` also says whether that
   * write went through; a database outage leaves the Redis ban in force and is logged).
   */
  static async ban(
    ipOrTarget: string,
    reason: string,
    opts: { manual: boolean; seconds?: number; actorId?: string; source?: IpBanSource },
  ): Promise<IpBan> {
    return (await this.place(ipOrTarget, reason, opts)).ban;
  }

  /** `ban`, with whether the ban was written to the table (`persisted`), for the ban route's answer. */
  static async place(
    ipOrTarget: string,
    reason: string,
    opts: { manual: boolean; seconds?: number; actorId?: string; source?: IpBanSource },
  ): Promise<{ ban: IpBan; persisted: boolean }> {
    const source: IpBanSource = opts.source ?? (opts.manual ? 'manual' : 'auto');
    const parsed = banTargetOf(ipOrTarget);
    if (!parsed.ok && source !== 'auto') {
      throw new AppError(parsed.reason === 'too_broad'
        ? 'This block is too wide for a ban. Use the global blocklist for a whole network.'
        : 'Enter an IP address or a CIDR block.', 400, ErrorCode.VALIDATION_ERROR, { details: { reason: parsed.reason === 'too_broad' ? 'IP_BAN_TOO_BROAD' : 'IP_BAN_INVALID_TARGET' } });
    }
    const bucket = parsed.ok ? parsed.target : rateLimitBucketOf(ipOrTarget);
    const auto = source === 'auto';
    const offense = auto ? Number(await withinRedisBound(redis.incr(offenseKey(bucket)))) : 1;
    if (auto) await withinRedisBound(redis.expire(offenseKey(bucket), OFFENSE_MEMORY_SECONDS));
    // A repeat offender's automatic ban is the longest one at once (limiter.ban-promotion.ts), with an end like every other ban.
    const promoted = auto && !(opts.seconds && opts.seconds > 0) ? await promotedBanSeconds(bucket, offense) : null;
    const seconds = opts.seconds && opts.seconds > 0
      ? Math.min(opts.seconds, BAN_MAX_SECONDS)
      : promoted !== null
        ? Math.min(promoted, BAN_MAX_SECONDS)
        : banSecondsFor(offense, (await getLimiterPolicy()).banBaseSeconds ?? BAN_BASE_SECONDS);
    const now = Date.now();
    // D55-3: a manual or firewall ban holds everywhere; an automatic one from its second offense, unless a ROOT member signed in from that
    // address lately (the operator's own office stays reachable to lift it; a lookup that fails counts as "operator", availability first).
    const everywhere = !auto
      || (offense >= BAN_EVERYWHERE_FROM_OFFENSE && !(await import('./limiter.ban-promotion').then((p) => p.isOperatorAddress(bucket)).catch(() => true)));
    const ban: IpBan = {
      bucket, offense, reason, bannedAt: now, until: now + seconds * 1000, manual: source === 'manual', source, scope: everywhere ? 'everywhere' : 'auth',
    };

    if (auto) {
      const standing = parseBan(await withinRedisBound(redis.get(banKey(bucket))).catch(() => null));
      if (standing && standing.until > ban.until) {
        await withinRedisBound(redis.del(strikeKey(bucket))).catch(() => 0);
        return { ban: standing, persisted: false };
      }
    }

    await withinRedisBound(redis.set(banKey(bucket), JSON.stringify(ban), 'EX', seconds));
    await this.indexBans([ban]);
    if (banKindOf(bucket) === 'cidr') {
      await withinRedisBound(redis.hset(BAN_STATE_KEY, `${BAN_STATE_CIDR_PREFIX}${bucket}`, String(ban.until))).catch((err: unknown) => {
        Logger.warn(`[ip-strikes] CIDR ban not listed for the gate: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    forgetCachedBans(bucket);
    await withinRedisBound(redis.del(strikeKey(bucket))).catch(() => 0);
    auditBan(AuditActions.SECURITY_IP_BANNED, bucket, { reason, offense, seconds, manual: ban.manual, source }, opts.actorId);

    let persisted = false;
    try {
      const store = await import('./limiter.ip-ban-store');
      if (store.shouldPersist(seconds, source)) {
        await store.persistBan(ban, source, opts.actorId ?? null);
        persisted = true;
      }
    } catch (err) {
      Logger.warn(`[ip-strikes] ban of ${bucket} not persisted: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (promoted !== null) auditPromotion(bucket, offense, seconds);
    return { ban, persisted };
  }

  /**
   * Adds bans to the index (score = `until`) and refreshes its TTL. Best-effort: the ban itself is already in force, so an index
   * write that fails only costs the listing, and is logged.
   */
  private static async indexBans(bans: readonly IpBan[]): Promise<void> {
    if (bans.length === 0) return;
    try {
      await withinRedisBound(redis.zadd(BAN_INDEX_KEY, ...bans.flatMap((b) => [b.until, b.bucket])));
      await withinRedisBound(redis.expire(BAN_INDEX_KEY, BAN_MAX_SECONDS));
    } catch (err) {
      Logger.warn(`[ip-strikes] ban index not updated: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The active bans, the one that ends last first (`until` descending), at most `limit` (capped at BAN_LIST_MAX_LIMIT), and whether
   * the list may be incomplete. Every Redis call is within the limiter's bound.
   *
   * From the ban index: ended bans are trimmed (ZREMRANGEBYSCORE -inf..now), the `limit` latest-ending members are read (ZRANGE of
   * the last `limit` ranks, so the cost is the page, not the set) and their ban keys fetched with MGET; a member whose key is gone
   * (lifted out of band, or a value that does not parse) is left out of the page, not counted.
   *
   * Only while the index is empty (bans written before it existed) the keyspace is walked as before: SCAN with MATCH `ip-ban:*`
   * (never KEYS), BAN_LIST_SCAN_COUNT keys a round, stopping at BAN_LIST_MAX_ROUNDS rounds, BAN_LIST_MAX_KEYS keys or
   * BAN_LIST_SCAN_DEADLINE_MS, whichever comes first; a walk that stopped early says `truncated`. A complete walk adds what it
   * found to the index, or, when it found nothing, is not repeated for BAN_LEGACY_SCANNED_SECONDS.
   *
   * Unlike the ban check this does not fail open: a Redis failure throws, so a screen can say "unavailable" instead of "no bans".
   */
  static async listBans(limit = 200): Promise<IpBanList> {
    const cap = Math.min(BAN_LIST_MAX_LIMIT, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)));
    if (cap === 0) return { items: [], truncated: false };
    const now = Date.now();
    await withinRedisBound(redis.zremrangebyscore(BAN_INDEX_KEY, '-inf', now));
    const members = (await withinRedisBound(redis.zrange(BAN_INDEX_KEY, -cap, -1))) as string[];
    if (members.length > 0) {
      const bans = await this.readBans(members.map(banKey), now);
      return { items: sortBans(bans).slice(0, cap), truncated: false };
    }
    return this.listBansByScan(cap, now);
  }

  /** MGET of ban keys in pages of BAN_LIST_SCAN_COUNT; values that do not parse or have ended are left out. */
  private static async readBans(keys: readonly string[], now: number): Promise<IpBan[]> {
    const bans: IpBan[] = [];
    for (let i = 0; i < keys.length; i += BAN_LIST_SCAN_COUNT) {
      const values = await withinRedisBound(redis.mget(...keys.slice(i, i + BAN_LIST_SCAN_COUNT)));
      for (const raw of values) {
        const ban = parseBan(raw);
        if (ban && ban.until > now) bans.push(ban);
      }
    }
    return bans;
  }

  /** The fallback walk of `listBans` (an empty index), bounded in rounds, keys and time. */
  private static async listBansByScan(cap: number, now: number): Promise<IpBanList> {
    if (await withinRedisBound(redis.exists(BAN_LEGACY_SCANNED_KEY))) return { items: [], truncated: false };
    const deadline = performance.now() + BAN_LIST_SCAN_DEADLINE_MS;
    const keys = new Set<string>();
    let cursor = '0';
    let rounds = 0;
    let full = false;
    do {
      const [next, page] = await withinRedisBound(redis.scan(cursor, 'MATCH', BAN_KEY_PATTERN, 'COUNT', BAN_LIST_SCAN_COUNT));
      cursor = String(next);
      rounds += 1;
      for (const key of page) {
        if (keys.size >= BAN_LIST_MAX_KEYS) { full = true; break; }
        keys.add(key);
      }
    } while (cursor !== '0' && !full && rounds < BAN_LIST_MAX_ROUNDS && keys.size < BAN_LIST_MAX_KEYS && performance.now() < deadline);
    const truncated = cursor !== '0' || full;
    if (truncated) {
      Logger.warn(`[ip-strikes] ban listing stopped at its bound (${keys.size} keys, ${rounds} rounds); older bans may be missing`);
    }

    const bans = await this.readBans([...keys], now);
    if (!truncated) {
      if (bans.length > 0) await this.indexBans(bans);
      else await withinRedisBound(redis.set(BAN_LEGACY_SCANNED_KEY, '1', 'EX', BAN_LEGACY_SCANNED_SECONDS)).catch(() => null);
    }
    return { items: sortBans(bans).slice(0, cap), truncated };
  }

  /**
   * Lifts a ban (an address or a CIDR block, as `banTargetOf` writes it) and forgets the address's strikes and offense history (a
   * sysadmin decision), in Redis and in the table. True when a ban was standing in either: after a flush the table may know a ban
   * Redis has not been rebuilt with yet.
   */
  static async unban(ipOrTarget: string, actorId?: string): Promise<boolean> {
    const parsed = banTargetOf(ipOrTarget);
    const bucket = parsed.ok ? parsed.target : rateLimitBucketOf(ipOrTarget);
    const removed = Number(await withinRedisBound(redis.del(banKey(bucket)))) > 0;
    await withinRedisBound(redis.zrem(BAN_INDEX_KEY, bucket)).catch(() => 0);
    await withinRedisBound(redis.hdel(BAN_STATE_KEY, `${BAN_STATE_CIDR_PREFIX}${bucket}`)).catch(() => 0);
    await withinRedisBound(redis.del(strikeKey(bucket), offenseKey(bucket))).catch(() => 0);
    forgetCachedBans(bucket);
    let lifted = 0;
    try {
      const store = await import('./limiter.ip-ban-store');
      lifted = await store.liftPersisted(bucket, actorId ?? null);
    } catch (err) {
      Logger.warn(`[ip-strikes] lift of ${bucket} not written to the table: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (removed || lifted > 0) auditBan(AuditActions.SECURITY_IP_UNBANNED, bucket, {}, actorId);
    return removed || lifted > 0;
  }
}
