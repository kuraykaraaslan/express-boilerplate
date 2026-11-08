import { createHash } from 'node:crypto';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { addressBucketOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import { setRefusalSink, type RefusalEvent } from '@kuraykaraaslan-labs/common/server/refusal-sink';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { outsideProbeRun } from '@kuraykaraaslan-labs/common/server/common.firewall-probe-run';
import AuditLogService from './audit_log.service';
import type { AuditActorType, AuditSeverity } from './audit_log.enums';

/**
 * Phase 55 00 §0.3 (P-3): the silent refusals, aggregated. The sink behind `common/server/refusal-sink.ts`: every refusal reported there is counted
 * per (action, tenant, key, minute) and the audit log gets ONE row per such bucket when its minute is over, carrying the count, the window, the
 * first refusal's facts and up to five distinct samples. A flood of ten thousand forged webhooks a minute from one address is one row a minute.
 *
 * Where the count lives:
 *  - **Redis** (the cluster's one count): a hash per bucket (`count`, `payload` = the first refusal, `firstAt`, `lastAt`, `s:<sample>` fields), a TTL
 *    of five minutes, and one sorted set of the buckets due (`audit:refusal:due`, score = the minute's end plus a grace). The process that counts a
 *    bucket's first refusal sets a timer for its end; a scheduler sweep (`scheduleRefusalFlush`) picks up any bucket whose process went away.
 *    The flush claims a bucket with `ZREM` (only one process gets 1), so a bucket is written once, whoever flushes it.
 *  - **This process** while Redis does not answer: the same buckets in a bounded map, flushed by the same timer. Counts are then per process; nothing
 *    is lost to an outage up to MAX_LOCAL_BUCKETS distinct buckets a minute, and a refusal over that bound is dropped (counted in the log).
 *
 * Bounds (phase 55 00 review): a reporter's key may be something a client picks (a claimed node id, a URL segment), so the key alone cannot bound
 * the rows. Every action opens at most REFUSAL_BUCKETS_PER_ACTION_MAX buckets a minute across the cluster (`audit:refusal:a:<minute>:<action>`, a
 * sorted set by first sight; the first ones keep their own bucket); every refusal of a further bucket is counted in the action's ONE overflow
 * bucket of the minute (ROOT tenant, `metadata.overflow`), whose samples list some of the keys it folded. So one action writes at most
 * REFUSAL_BUCKETS_PER_ACTION_MAX + 1 rows a minute, whatever the keys. A refusal without a key is keyed on its address's bucket (an IPv6 /64, the
 * limiter's unit), not the full address a host rotates inside its /64.
 *
 * The first write of a bucket is the same transaction as its count (`HSETNX` of the facts, `ZADD NX` of the due entry), so a bucket that has a count
 * is always on the due list. A flushed bucket leaves a tombstone for its TTL: a late refusal of that minute (another node's clock behind) is moved
 * to the next minute instead of opening a second row for a minute already written.
 *
 * The rows go through `AuditLogService.log` like every other row (severity from the action's enum entry unless the reporter's module keeps its own,
 * the high-risk webhook for `high` / `critical`, the tenant's chain). Nothing a reporter passes is a secret: reason codes, provider keys, paths.
 */

export const REFUSAL_WINDOW_MS = 60_000;
/** How long after its minute a bucket is flushed: late counts of the same minute (another node, a slow Redis round trip) still land in it. */
export const REFUSAL_FLUSH_GRACE_MS = 5_000;
/** A bucket's TTL in Redis: long enough for a sweep to find an orphan, short enough that a stuck flush leaves nothing behind. */
export const REFUSAL_BUCKET_TTL_S = 300;
/** Distinct samples a row lists. */
export const REFUSAL_SAMPLES_MAX = 5;
/** Only the first refusals of a bucket offer a sample (so a flood does not write a field per refusal). */
const SAMPLE_OFFERS_MAX = 20;
/** Buckets kept in this process while Redis is down. */
export const MAX_LOCAL_BUCKETS = 1_000;
/** Buckets one flush writes at most (the next timer or sweep takes the rest). */
const FLUSH_BATCH = 200;
/** How often the scheduler's sweep runs. */
export const REFUSAL_SWEEP_MS = 30_000;

/** Distinct buckets one action opens per minute across the cluster; the refusals of any further bucket are counted in the action's overflow bucket. */
export const REFUSAL_BUCKETS_PER_ACTION_MAX = 100;

export const REFUSAL_DUE_KEY = 'audit:refusal:due';
export const refusalBucketKey = (member: string) => `audit:refusal:b:${member}`;
/** The tombstone of a flushed bucket: a late refusal of its minute goes to the next minute. */
export const refusalFlushedKey = (member: string) => `audit:refusal:f:${member}`;
/** The buckets an action opened in a minute, by first sight. */
export const refusalAdmissionKey = (action: string, minute: number) =>
  `audit:refusal:a:${minute}:${createHash('sha256').update(action).digest('hex').slice(0, 32)}`;
/** The arrival sequence of an action's buckets in a minute (`admitted`): a counter beside the admission set, never inside its prefix. */
export const refusalSequenceKey = (action: string, minute: number) =>
  `audit:refusal:seq:${minute}:${createHash('sha256').update(action).digest('hex').slice(0, 32)}`;
/** The key of an action's overflow bucket: control characters are stripped from every reporter's key (`clip`), so no reporter can name it. */
const OVERFLOW_KEY = '\u0000overflow';

/** What a row is built from: the first refusal of the bucket. */
interface RefusalPayload {
  action: string;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  severity?: AuditSeverity;
  metadata: Record<string, string | number | boolean | null>;
}

interface LocalBucket {
  payload: RefusalPayload;
  count: number;
  firstAt: number;
  lastAt: number;
  samples: Set<string>;
  dueAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_TYPES: ReadonlySet<string> = new Set(['USER', 'SYSTEM', 'API_KEY', 'SERVICE']);
const SEVERITIES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical']);

const local = new Map<string, LocalBucket>();
/** This process's count of the local buckets of each (action, minute), for the same bound while Redis does not answer. */
const localPerAction = new Map<string, number>();
/** The buckets this process has seen admitted, per (action, minute): their later refusals skip the admission round trip. */
const admittedHere = new Map<string, Set<string>>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let droppedLocal = 0;

const clip = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** At most 16 small facts; strings clipped, anything else that is not a number or a boolean dropped. */
function cleanMetadata(m: RefusalEvent['metadata']): RefusalPayload['metadata'] {
  const out: RefusalPayload['metadata'] = {};
  if (!m) return out;
  for (const [k, v] of Object.entries(m).slice(0, 16)) {
    const key = clip(k, 64);
    if (!key) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[key] = Number.isNaN(v as number) ? null : v;
    else if (typeof v === 'string') out[key] = v.slice(0, 200);
  }
  return out;
}

/** The first refusal of a bucket as it is stored: the address through the trusted hops, the user agent, the columns checked. */
export function refusalPayload(event: RefusalEvent): RefusalPayload {
  const ipAddress = clip(event.ipAddress, 64) ?? (event.headers ? clip(clientIpOf(event.headers), 64) : null);
  const userAgent = clip(event.userAgent, 512) ?? (event.headers ? clip(event.headers.get('user-agent'), 512) : null);
  const actorId = event.actorId && UUID.test(event.actorId) ? event.actorId : null;
  const actorType = (event.actorType && ACTOR_TYPES.has(event.actorType) ? event.actorType : actorId ? 'USER' : 'SYSTEM') as AuditActorType;
  return {
    action: event.action,
    tenantId: event.tenantId && UUID.test(event.tenantId) ? event.tenantId.toLowerCase() : null,
    ipAddress,
    userAgent,
    actorType,
    actorId,
    resourceType: clip(event.resourceType, 100),
    resourceId: clip(event.resourceId, 200),
    ...(event.severity && SEVERITIES.has(event.severity) ? { severity: event.severity } : {}),
    metadata: cleanMetadata(event.metadata),
  };
}

/** The minute a refusal falls in, and the bucket's member name: `<minute>:<digest of action, tenant and key>` (the key itself is never a Redis name). */
export function refusalBucket(payload: RefusalPayload, key: string, now: number): { minute: number; member: string; dueAt: number } {
  const minute = Math.floor(now / REFUSAL_WINDOW_MS);
  const digest = createHash('sha256').update(`${payload.action}\u0000${payload.tenantId ?? ''}\u0000${key}`).digest('hex').slice(0, 32);
  return { minute, member: `${minute}:${digest}`, dueAt: (minute + 1) * REFUSAL_WINDOW_MS + REFUSAL_FLUSH_GRACE_MS };
}

/**
 * One timer per due time in this process (every bucket of a minute is due at once). Unref'd: a pending flush never keeps a process alive.
 * Armed and run outside any probe-run stamp (phase 55 03 §3.3, D55-93): the timer is armed inside whichever request opened the minute's
 * bucket, and its flush writes the rows of every actor's buckets, so the AI firewall's record sink must never stamp them with that
 * request's probe run.
 */
function scheduleFlush(dueAt: number, now: number): void {
  if (timers.has(dueAt)) return;
  const t = outsideProbeRun(() => setTimeout(() => {
    timers.delete(dueAt);
    void outsideProbeRun(() => flushDueRefusals()).catch(() => undefined);
  }, Math.max(0, dueAt - now) + Math.floor(Math.random() * 1_000)));
  (t as { unref?: () => void }).unref?.();
  timers.set(dueAt, t);
}

/** The overflow bucket of an action in a minute: ROOT, no resource, the first folded refusal's address and facts, marked `overflow`. */
function overflowOf(payload: RefusalPayload, now: number): { payload: RefusalPayload; member: string; dueAt: number } {
  const over: RefusalPayload = {
    action: payload.action,
    tenantId: null,
    ipAddress: payload.ipAddress,
    userAgent: payload.userAgent,
    actorType: 'SYSTEM',
    actorId: null,
    resourceType: null,
    resourceId: null,
    ...(payload.severity ? { severity: payload.severity } : {}),
    metadata: { ...payload.metadata, overflow: true, bucketsMax: REFUSAL_BUCKETS_PER_ACTION_MAX },
  };
  const { member, dueAt } = refusalBucket(over, OVERFLOW_KEY, now);
  return { payload: over, member, dueAt };
}

function countLocally(member: string, payload: RefusalPayload, sample: string | null, dueAt: number, now: number, key: string): void {
  const b = local.get(member);
  if (b) {
    b.count += 1;
    b.lastAt = Math.max(b.lastAt, now);
    b.firstAt = Math.min(b.firstAt, now);
    if (sample && b.samples.size < REFUSAL_SAMPLES_MAX) b.samples.add(sample);
    return;
  }
  const perAction = `${Math.floor(now / REFUSAL_WINDOW_MS)}:${payload.action}`;
  const opened = localPerAction.get(perAction) ?? 0;
  if (opened >= REFUSAL_BUCKETS_PER_ACTION_MAX) {
    const over = overflowOf(payload, now);
    if (over.member !== member) {
      countLocally(over.member, over.payload, sample ?? clip(key, 128), over.dueAt, now, OVERFLOW_KEY);
      return;
    }
  }
  if (local.size >= MAX_LOCAL_BUCKETS) {
    droppedLocal += 1;
    return;
  }
  for (const k of localPerAction.keys()) if (Number(k.slice(0, k.indexOf(':'))) < Math.floor(now / REFUSAL_WINDOW_MS) - 1) localPerAction.delete(k);
  localPerAction.set(perAction, opened + 1);
  local.set(member, { payload, count: 1, firstAt: now, lastAt: now, samples: new Set(sample ? [sample] : []), dueAt });
}

/**
 * Whether a bucket is one of the first REFUSAL_BUCKETS_PER_ACTION_MAX its action opened this minute. The order is the order of ARRIVAL, not of the
 * refusals' clocks (nodes disagree, and a ranking by time let a late bucket with an early clock in past the bound): every first sight takes the next
 * number of the minute's sequence (`INCR`), `ZADD NX` keeps the number of the bucket's first sight, and the bucket is admitted while that number is
 * within the bound. A repeated sight (another process, a bucket folded and dropped) only spends numbers, so it can only admit fewer, never more.
 * Two round trips the first time this process sees a bucket; throws when Redis does not answer.
 */
async function admitted(action: string, minute: number, member: string, _now: number): Promise<boolean> {
  const seenKey = `${minute}:${action}`;
  if (admittedHere.get(seenKey)?.has(member)) return true;
  const key = refusalAdmissionKey(action, minute);
  const seqKey = refusalSequenceKey(action, minute);
  const seqOut = await redis.multi().incr(seqKey).expire(seqKey, REFUSAL_BUCKET_TTL_S).exec();
  const seq = Number(seqOut?.[0]?.[1]);
  if (!seqOut || seqOut.some(([err]) => err) || !Number.isFinite(seq)) throw new Error('refusal admission not stored');
  const out = await redis.multi().zadd(key, 'NX', seq, member).zscore(key, member).expire(key, REFUSAL_BUCKET_TTL_S).exec();
  const first = out?.[1]?.[1];
  if (!out || out.some(([err]) => err) || first === null || first === undefined || !Number.isFinite(Number(first))) {
    throw new Error('refusal admission not stored');
  }
  if (Number(first) > REFUSAL_BUCKETS_PER_ACTION_MAX) return false;
  for (const k of admittedHere.keys()) if (Number(k.slice(0, k.indexOf(':'))) < minute - 1) admittedHere.delete(k);
  let seen = admittedHere.get(seenKey);
  if (!seen) admittedHere.set(seenKey, (seen = new Set()));
  if (seen.size < REFUSAL_BUCKETS_PER_ACTION_MAX) seen.add(member);
  return true;
}

/**
 * One refusal into a bucket in Redis: the count, `lastAt`, the facts and `firstAt` when they are not there yet (`HSETNX`), the TTL and the due entry
 * (`ZADD NX`) in ONE transaction, so a bucket with a count is always due. `fold` is the admission entry of a bucket counted in the overflow (dropped
 * from the set so the set stays near its bound). Answers false when the bucket's minute was already written (its tombstone): the caller moves it.
 */
async function countInRedis(
  member: string, payload: RefusalPayload, sample: string | null, dueAt: number, now: number, fold?: { key: string; member: string },
): Promise<boolean> {
  const bucket = refusalBucketKey(member);
  const tx = redis.multi()
    .hincrby(bucket, 'count', 1)
    .hset(bucket, 'lastAt', String(now))
    .hsetnx(bucket, 'payload', JSON.stringify(payload))
    .hsetnx(bucket, 'firstAt', String(now))
    .expire(bucket, REFUSAL_BUCKET_TTL_S)
    .zadd(REFUSAL_DUE_KEY, 'NX', dueAt, member)
    .exists(refusalFlushedKey(member));
  if (fold) tx.zrem(fold.key, fold.member);
  const out = await tx.exec();
  const count = Number(out?.[0]?.[1]);
  if (!out || !Number.isFinite(count) || out.some(([err]) => err)) throw new Error('refusal count not stored');
  if (Number(out[6]?.[1]) === 1) {
    // A late refusal of a minute already written: undo what the transaction opened (a second row of that minute otherwise).
    await redis.multi().zrem(REFUSAL_DUE_KEY, member).del(bucket).exec();
    return false;
  }
  if (Number(out[5]?.[1]) === 1) scheduleFlush(dueAt, now);
  if (sample && count <= SAMPLE_OFFERS_MAX) await redis.hset(bucket, `s:${sample}`, '1');
  return true;
}

/**
 * Count one refusal. Never throws. A refusal costs two round trips the first time this process sees its bucket (the admission, then the count) and
 * one after that; a refusal of a bucket over the action's bound is counted in the overflow bucket.
 */
export async function recordRefusal(event: RefusalEvent, now: number = Date.now()): Promise<void> {
  return record(event, now, false);
}

async function record(event: RefusalEvent, now: number, moved: boolean): Promise<void> {
  try {
    if (!event || typeof event.action !== 'string' || !event.action) return;
    const payload = refusalPayload(event);
    const key = clip(event.key, 256) ?? (payload.ipAddress ? addressBucketOf(payload.ipAddress) : null) ?? 'unknown';
    const sample = clip(event.sample, 128);
    const { minute, member, dueAt } = refusalBucket(payload, key, now);
    try {
      let counted: boolean;
      if (await admitted(payload.action, minute, member, now)) {
        counted = await countInRedis(member, payload, sample, dueAt, now);
      } else {
        const over = overflowOf(payload, now);
        counted = await countInRedis(over.member, over.payload, sample ?? clip(key, 128), over.dueAt, now, { key: refusalAdmissionKey(payload.action, minute), member });
      }
      // Moved once, to the start of the next minute; a second tombstone there (a clock far behind) is not chased further.
      if (!counted && !moved) await record(event, (minute + 1) * REFUSAL_WINDOW_MS, true);
    } catch {
      countLocally(member, payload, sample, dueAt, now, key);
      scheduleFlush(dueAt, now);
    }
  } catch (err) {
    Logger.warn(`[audit_log] a refusal was not counted: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function writeRow(payload: RefusalPayload, agg: { count: number; firstAt: number; lastAt: number; samples: string[]; minuteStart: number }): Promise<void> {
  await AuditLogService.log({
    tenantId: payload.tenantId ?? ROOT_TENANT_ID,
    actorType: payload.actorType,
    actorId: payload.actorId,
    action: payload.action,
    ...(payload.severity ? { severity: payload.severity } : {}),
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    ipAddress: payload.ipAddress,
    userAgent: payload.userAgent,
    metadata: {
      ...payload.metadata,
      aggregated: true,
      count: agg.count,
      windowStart: new Date(agg.minuteStart).toISOString(),
      windowEnd: new Date(agg.minuteStart + REFUSAL_WINDOW_MS).toISOString(),
      firstAt: new Date(agg.firstAt).toISOString(),
      lastAt: new Date(agg.lastAt).toISOString(),
      ...(agg.samples.length ? { samples: agg.samples.slice(0, REFUSAL_SAMPLES_MAX) } : {}),
    },
  });
}

const minuteStartOf = (member: string) => Number(member.slice(0, member.indexOf(':'))) * REFUSAL_WINDOW_MS;

/** Write every bucket whose minute is over (plus the grace): one row each, once. Returns how many rows were written. */
export async function flushDueRefusals(now: number = Date.now()): Promise<number> {
  let written = 0;

  // this process's own buckets, counted while Redis did not answer
  for (const [member, b] of [...local]) {
    if (b.dueAt > now) continue;
    local.delete(member);
    await writeRow(b.payload, { count: b.count, firstAt: b.firstAt, lastAt: b.lastAt, samples: [...b.samples], minuteStart: minuteStartOf(member) });
    written += 1;
  }
  if (droppedLocal > 0) {
    Logger.warn(`[audit_log] ${droppedLocal} refusals were not counted: Redis did not answer and ${MAX_LOCAL_BUCKETS} buckets were already held`);
    droppedLocal = 0;
  }

  let due: string[];
  try {
    due = (await redis.zrange(REFUSAL_DUE_KEY, 0, FLUSH_BATCH - 1, 'WITHSCORES')) as string[];
  } catch {
    return written;
  }
  for (let i = 0; i + 1 < due.length; i += 2) {
    const member = due[i]!;
    if (Number(due[i + 1]) > now) break; // sorted by due time: nothing after this one is due
    try {
      // the claim: only one flusher removes the member
      if (Number(await redis.zrem(REFUSAL_DUE_KEY, member)) !== 1) continue;
      const bucket = refusalBucketKey(member);
      // The tombstone, the read and the delete in one transaction: no refusal lands between the read and the delete, and a late one after it
      // sees the tombstone and moves to the next minute (countInRedis).
      const out = await redis.multi().set(refusalFlushedKey(member), '1', 'EX', REFUSAL_BUCKET_TTL_S).hgetall(bucket).del(bucket).exec();
      if (!out || out.some(([err]) => err)) throw new Error('bucket not read');
      const h = out[1]?.[1] as Record<string, string> | null;
      if (!h || !h.payload) continue; // expired before anyone flushed it, or its first write never landed
      const payload = JSON.parse(h.payload) as RefusalPayload;
      const samples = Object.keys(h).filter((f) => f.startsWith('s:')).map((f) => f.slice(2)).sort().slice(0, REFUSAL_SAMPLES_MAX);
      const firstAt = Number(h.firstAt) || minuteStartOf(member);
      await writeRow(payload, {
        count: Math.max(1, Number(h.count) || 1),
        firstAt,
        lastAt: Number(h.lastAt) || firstAt,
        samples,
        minuteStart: minuteStartOf(member),
      });
      written += 1;
    } catch (err) {
      Logger.warn(`[audit_log] a refusal bucket was not flushed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return written;
}

/** `runtime` boot task (every process): the refusal sink of `common` is this module's counter. */
export function registerRefusalAudit(): void {
  setRefusalSink((event) => recordRefusal(event));
}

let sweep: ReturnType<typeof setInterval> | null = null;

/** `scheduler` boot task (the one leader): flushes the buckets a process counted and then left behind (it stopped before its minute ended). */
export function scheduleRefusalFlush(): void {
  if (sweep) return;
  sweep = setInterval(() => { void flushDueRefusals().catch(() => undefined); }, REFUSAL_SWEEP_MS);
  (sweep as { unref?: () => void }).unref?.();
}

/** Tests: forget this process's buckets, timers and sweep. */
export function resetRefusalAudit(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  local.clear();
  localPerAction.clear();
  admittedHere.clear();
  droppedLocal = 0;
  if (sweep) clearInterval(sweep);
  sweep = null;
}
