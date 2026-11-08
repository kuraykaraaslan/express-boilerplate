import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { toE164 } from '@kuraykaraaslan-labs/common/server/common.phone';
import { boundedBy } from '@kuraykaraaslan-labs/common/server/bounded';
import { NotificationSmsOptOut } from './entities/notification_sms_optout.entity';

/**
 * The SMS opt-out (STOP) list, durable (docs/audits/2026-11-03-redis-outage.md §6.7 item 2, decision D254).
 *
 *   source of truth   `notification_sms_optouts`, one row per (tenant, E.164 number), written by every STOP and every START before anything else.
 *   cache             Redis `sms:optout:<tenantId>:<e164>` = '1' (opted out, 1 h) or '0' (not, 60 s). A miss reads the table; a Redis error reads
 *                     the table; the answer is cached again only when Redis answered. The short life of a '0' bounds every way a cache can be stale
 *                     against a STOP (a cache write that failed after the table write, a reader that cached '0' just before the STOP committed): a
 *                     STOP is honoured within 60 s whatever Redis did. A START that could not reach Redis leaves a '1' at most an hour: the safe side.
 *                     Every cache call is bounded (`CACHE_TIMEOUT_MS`): the production client queues commands while Redis is down instead of
 *                     failing them, and a read that does not answer in time counts as a Redis error (the table answers).
 *   unknown           neither Redis nor the table could answer: `SmsOptOutUnknownError`. Never "not opted out" because nothing could answer; the
 *                     worker fails the job (nothing is sent; RedisIdempotencyService lets a retry send it later).
 *
 * A STOP whose table write fails still sets the cache to '1' (best effort, the next hour's sends are held) and THROWS, so the inbound handler can
 * answer an error and the carrier redelivers the reply. A number that does not parse is not a subscriber: it is neither recorded nor ever sent to
 * (the worker drops it), so `isOptedOut` answers false for it without asking anything.
 */

export const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'IPTAL', 'DUR'] as const;
export const OPT_IN_KEYWORDS = ['START', 'UNSTOP', 'BASLA'] as const;
export const CACHE_TTL_OPTED_OUT_S = 60 * 60;
export const CACHE_TTL_NOT_OPTED_OUT_S = 60;
/** How long a cache call may take before the table answers instead (the ban gate's bound). */
export const CACHE_TIMEOUT_MS = 250;

export class SmsOptOutUnknownError extends Error {
  constructor() {
    super('SMS opt-out state could not be read (neither the cache nor the database answered)');
    this.name = 'SmsOptOutUnknownError';
  }
}

export interface OptOutStore {
  /** The stored state, or null when the number never sent a keyword to this tenant. Throws when the database cannot answer. */
  read(tenantId: string, phone: string): Promise<boolean | null>;
  write(tenantId: string, phone: string, optedOut: boolean, keyword: string, at: Date): Promise<void>;
}

export interface OptOutCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export const pgOptOutStore: OptOutStore = {
  read: async (tenantId, phone) => {
    const row = await withTenantRepositoryFor(tenantId, NotificationSmsOptOut, (repo) => repo.findOne({ where: { tenantId, phone }, select: { optedOut: true } }));
    return row ? row.optedOut : null;
  },
  write: async (tenantId, phone, optedOut, keyword, at) => {
    await withTenantRepositoryFor(tenantId, NotificationSmsOptOut, (repo) =>
      repo.upsert({ tenantId, phone, optedOut, keyword, changedAt: at }, { conflictPaths: ['tenantId', 'phone'] }));
  },
};

export const redisOptOutCache: OptOutCache = {
  get: (key) => redis.get(key),
  set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
};

export interface OptOutDeps { store: OptOutStore; cache: OptOutCache; now?: () => Date }
export const defaultOptOutDeps: OptOutDeps = { store: pgOptOutStore, cache: redisOptOutCache };

/** The canonical form a number is stored and looked up under (E.164), or null when it is not a phone number. */
export const normaliseOptOutNumber = (raw: string | null | undefined): string | null => toE164(raw);

export const optOutCacheKey = (tenantId: string, phone: string): string => `sms:optout:${tenantId}:${phone}`;

const cacheValue = (optedOut: boolean): [string, number] => (optedOut ? ['1', CACHE_TTL_OPTED_OUT_S] : ['0', CACHE_TTL_NOT_OPTED_OUT_S]);

/** A cache write that never throws and never waits longer than `CACHE_TIMEOUT_MS`. */
async function cacheSet(deps: OptOutDeps, key: string, optedOut: boolean): Promise<void> {
  const [value, ttl] = cacheValue(optedOut);
  await boundedBy(Promise.resolve().then(() => deps.cache.set(key, value, 'EX', ttl)), CACHE_TIMEOUT_MS).catch(() => undefined);
}

/** Whether `to` opted out of `tenantId`'s messages. Throws `SmsOptOutUnknownError` when neither the cache nor the table can answer. */
export async function isOptedOut(tenantId: string, to: string, deps: OptOutDeps = defaultOptOutDeps): Promise<boolean> {
  const phone = normaliseOptOutNumber(to);
  if (!phone) return false;
  const key = optOutCacheKey(tenantId, phone);
  let cacheAnswered = true;
  let cached: string | null = null;
  try {
    const r = await boundedBy(Promise.resolve().then(() => deps.cache.get(key)), CACHE_TIMEOUT_MS);
    if (r.timedOut) cacheAnswered = false;
    else cached = r.value;
  } catch {
    cacheAnswered = false;
  }
  if (cached === '1') return true;
  if (cached === '0') return false;
  let stored: boolean | null;
  try {
    stored = await deps.store.read(tenantId, phone);
  } catch {
    throw new SmsOptOutUnknownError();
  }
  const optedOut = stored === true;
  if (cacheAnswered) await cacheSet(deps, key, optedOut);
  return optedOut;
}

/**
 * Records a STOP (`optedOut` true) or a START for `from`: the table first, then the cache. Returns false (nothing recorded) for a sender that is not
 * a phone number. Throws when the table cannot be written (a STOP still sets the cache first).
 */
export async function recordOptOutState(
  tenantId: string, from: string, optedOut: boolean, keyword: string, deps: OptOutDeps = defaultOptOutDeps,
): Promise<boolean> {
  const phone = normaliseOptOutNumber(from);
  if (!phone) {
    Logger.warn(`[sms] ${optedOut ? 'STOP' : 'START'} keyword from a sender that is not a phone number: not recorded`);
    return false;
  }
  const key = optOutCacheKey(tenantId, phone);
  try {
    await deps.store.write(tenantId, phone, optedOut, keyword.slice(0, 16), (deps.now ?? (() => new Date()))());
  } catch (err) {
    // the record is what counts: hold the sends for an hour from the cache, and let the caller fail so the carrier redelivers the reply
    if (optedOut) await cacheSet(deps, key, true);
    Logger.error(`[sms] ${optedOut ? 'STOP' : 'START'} for tenant ${tenantId} could not be stored: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  await cacheSet(deps, key, optedOut);
  return true;
}

/** STOP / START keyword of an inbound reply (trimmed, case-insensitive, the whole message), or null. */
export function keywordAction(text: string): { optedOut: boolean; keyword: string } | null {
  const kw = text.trim().toUpperCase();
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(kw)) return { optedOut: true, keyword: kw };
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(kw)) return { optedOut: false, keyword: kw };
  return null;
}
