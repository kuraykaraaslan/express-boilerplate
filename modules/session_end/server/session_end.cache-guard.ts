import { randomInt } from 'node:crypto';
import { noteRedisTrouble, redisCacheInstance } from '@kuraykaraaslan-labs/redis/server/redis.health';
import { CACHE_DROP_MAXLEN, CACHE_DROP_STREAM, type SessionEndOrderInput } from './session_end.contract';
import { withTimeout } from './session_end.deliver';

/**
 * The cache guard (D253, docs/audits/2026-11-03-redis-outage.md §6.10): how a Redis cache that an ACCESS decision reads (an API key
 * by its hash, a tenant's ABAC policy set, its role set, a cached PDP decision) stays exact through a Redis outage, a restart, a
 * failover and a partition. Four rules, all cheap on the hot path:
 *
 *   1. **The drop is durable.** The change that must end access (a key revoked, rotated, deleted or narrowed; a policy or a role set
 *      written) records a cache-drop order (`cacheDropOrders`) in its own database transaction: the entry keys to `DEL` and the
 *      namespace version keys to `INCR`. The writer delivers it right after the commit (`deliverRecorded`); what Redis did not take,
 *      the session_end relay delivers (due at once, every 5 s, from any node).
 *   2. **No trust while a drop is pending.** Every process reads the tenants with a pending (or recently dead-lettered) drop from the
 *      outbox, at most once a second (`noDropPending`). While one is pending for a tenant, or the outbox cannot be read, that tenant's
 *      guarded entries are not believed: the database answers. This is what holds when the writer could not reach Redis and the
 *      readers could (a partition), and right after Redis comes back with its old data before the relay ran.
 *   3. **No trust while Redis is unhealthy or another instance.** Every guarded entry is sealed with a stamp: the Redis instance id
 *      (`redis.health.ts`: its `run_id`, withheld during and for 5 s after any trouble) and the namespace versions read BEFORE the
 *      database read that filled it. An entry is believed only when its stamp equals the stamp of the current read: a version bump
 *      (rule 1) retires every entry of the namespace at once on every node, and an entry written to another instance (a restart that
 *      replayed an old AOF, a replica promoted before it caught up) is never believed. A missing version (Redis lost its data, or the
 *      key expired) believes nothing; the refill creates it (`SET NX`) or does not cache. The stamp taken before the database read
 *      also closes the refill race (a reader that read the old row before the commit writes it with the old version).
 *   4. **No process-local copies.** Nothing here keeps an entry in memory: every node asks Redis, so a drop is seen by every node at
 *      once while Redis is up.
 *
 * Cost when healthy: the version key is read with the entry (two GETs sent together on one connection: one round trip), plus one
 * small outbox query per process per second. A guarded refill writes with the stamp; a miss of a version costs one `SET NX`.
 */

// The database, the shared client and the logger are loaded on first use: the access caches import this file, and a suite (or a
// bundle) that never reads a guarded entry must not boot the database and the Redis connection for it.
const loadDb = () => import('@kuraykaraaslan-labs/db');
const loadRedis = async (): Promise<GuardRedis> => (await import('@kuraykaraaslan-labs/redis')).default as unknown as GuardRedis;
const loadLogger = async () => (await import('@kuraykaraaslan-labs/logger')).default;

/** How long a version key lives; bumped (and its TTL renewed) by every drop. Far longer than any guarded entry's TTL. */
export const CACHE_VERSION_TTL_SECONDS = 7 * 86_400;
/** The outbox view is re-read when older than this. */
export const PENDING_VIEW_MS = 1_000;
/** The longest the outbox read may take; past it the view is unreadable (nothing trusted). */
export const PENDING_READ_TIMEOUT_MS = 1_000;
/** A dead-lettered drop keeps its tenant untrusted this long after it was recorded (every guarded entry's TTL is far shorter). */
export const DEAD_DROP_WINDOW_MS = 60 * 60_000;
/** Past this many tenants with a pending drop, nobody's guarded entries are trusted (one cheap answer for a wide outage). */
export const PENDING_MAX_TENANTS = 1_000;

const MAX_INCR = 16;
const MAX_DEL = 64;
const SEP = '|';

// ── Orders ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What one changed thing drops: the entries (`del`) and the namespace versions (`bump`). */
export interface CacheDrop {
  del: readonly string[];
  bump: readonly string[];
}

/** The orders of one tenant's drops (several when they exceed one order's limits: 16 bumps, 64 deletes). Pure. */
export function cacheDropOrders(tenantId: string, kind: string, drops: readonly CacheDrop[]): SessionEndOrderInput[] {
  const out: SessionEndOrderInput[] = [];
  let del: string[] = [];
  let bump: string[] = [];
  const flush = () => {
    if (del.length === 0 && bump.length === 0) return;
    out.push({
      tenantId,
      kind,
      payload: {
        stream: CACHE_DROP_STREAM,
        field: 'd',
        maxlen: CACHE_DROP_MAXLEN,
        entry: { tenantId, kind },
        ...(bump.length ? { incr: bump.map((key) => ({ key, ttlSeconds: CACHE_VERSION_TTL_SECONDS })) } : {}),
        ...(del.length ? { del } : {}),
      },
    });
    del = [];
    bump = [];
  };
  for (const d of drops) {
    const dDel = [...new Set(d.del)].filter((k) => !del.includes(k));
    const dBump = [...new Set(d.bump)].filter((k) => !bump.includes(k));
    if (dDel.length > MAX_DEL || dBump.length > MAX_INCR) throw new Error(`[session_end] ${kind}: one cache drop exceeds an order's limits`);
    if (del.length + dDel.length > MAX_DEL || bump.length + dBump.length > MAX_INCR) flush();
    del.push(...dDel);
    bump.push(...dBump);
  }
  flush();
  return out;
}

// ── The outbox view (rule 2) ──────────────────────────────────────────────────────────────────────────────────────────────

interface PendingView {
  /** When the read that built it started (the view is at least this fresh). */
  at: number;
  tenants: ReadonlySet<string>;
  overflow: boolean;
}

let view: PendingView | null = null;
let refreshing: Promise<PendingView | null> | null = null;
let warnedAt = 0;
let pinned: { pending: readonly string[] } | 'unreadable' | null = null;

async function readPending(now: number): Promise<PendingView> {
  const { withSystemRLS } = await loadDb();
  const rows = (await withSystemRLS((qr) => qr.query(
    `SELECT DISTINCT "tenantId" FROM "session_end_orders"
      WHERE "payload"->>'stream' = $1 AND ("deadAt" IS NULL OR "createdAt" > $2)
      LIMIT $3`,
    [CACHE_DROP_STREAM, new Date(now - DEAD_DROP_WINDOW_MS), PENDING_MAX_TENANTS + 1],
  ))) as Array<{ tenantId: string }>;
  return { at: now, tenants: new Set(rows.map((r) => r.tenantId)), overflow: rows.length > PENDING_MAX_TENANTS };
}

async function currentView(now: number): Promise<PendingView | null> {
  if (pinned === 'unreadable') return null;
  if (pinned) return { at: now, tenants: new Set(pinned.pending), overflow: false };
  if (view && now - view.at < PENDING_VIEW_MS) return view;
  refreshing ??= withTimeout(readPending(now), PENDING_READ_TIMEOUT_MS)
    .then((v) => {
      if (!view || v.at >= view.at) view = v;
      return v;
    })
    .catch(async (err: unknown) => {
      if (now - warnedAt > 60_000) {
        warnedAt = now;
        await loadLogger()
          .then((log) => log.warn(`[session_end] cache-drop outbox unreadable, guarded caches are bypassed: ${(err as Error)?.message ?? String(err)}`))
          .catch(() => {});
      }
      return null;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * True when this process may believe `tenantId`'s guarded entries as far as the outbox goes: a view of the outbox at most a second
 * old shows no pending (or recently dead-lettered) drop for it. False when one is pending, or the outbox cannot be read (fail closed:
 * the database answers).
 */
export async function noDropPending(tenantId: string, now: number = Date.now()): Promise<boolean> {
  const v = await currentView(now);
  return !!v && !v.overflow && !v.tenants.has(tenantId);
}

// ── Reads and writes (rule 3) ─────────────────────────────────────────────────────────────────────────────────────────────

/** The part of an ioredis client the guard uses (`ioredis` satisfies it; tests pass a fake). */
export interface GuardRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
}

/** One guarded read: the entries and the versions, as Redis answered them, and the instance they were read from. */
export interface GuardedRead {
  values: Array<string | null>;
  versions: Array<string | null>;
  versionKeys: string[];
  /** The trusted instance id at the read, or null (nothing read is believed then, and nothing is written). */
  instance: string | null;
}

const client = async (o?: { redis?: GuardRedis }): Promise<GuardRedis> => o?.redis ?? loadRedis();

/**
 * Reads `keys` and `versionKeys` together (sent at once: one round trip). Null when Redis failed (the failure is noted: the instance
 * id is withheld for the quiet period). An instance that changed during the read counts as none.
 */
export async function readGuarded(keys: readonly string[], versionKeys: readonly string[], o?: { redis?: GuardRedis }): Promise<GuardedRead | null> {
  const before = redisCacheInstance();
  let all: Array<string | null>;
  try {
    const c = await client(o);
    all = await Promise.all([...keys, ...versionKeys].map((k) => c.get(k)));
  } catch {
    noteRedisTrouble();
    return null;
  }
  const after = redisCacheInstance();
  return {
    values: all.slice(0, keys.length),
    versions: all.slice(keys.length),
    versionKeys: [...versionKeys],
    instance: before !== null && before === after ? before : null,
  };
}

/** The stamp an entry must carry to be believed for this read, or null when nothing can be (no instance, a missing version). */
export function stampOf(read: GuardedRead | null): string | null {
  if (!read?.instance || read.versions.some((v) => v === null || v === '')) return null;
  return [read.instance, ...read.versions].join(SEP);
}

/** An entry's data when its envelope carries `stamp`; undefined otherwise (absent, not an envelope, another stamp). */
export function openEntry(raw: string | null | undefined, stamp: string | null): unknown {
  if (!raw || !stamp) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const e = parsed as { s?: unknown; d?: unknown };
  return e.s === stamp && Object.hasOwn(e, 'd') ? e.d : undefined;
}

/** The envelope written for `data` under `stamp`. */
export function sealEntry(stamp: string, data: unknown): string {
  return JSON.stringify({ s: stamp, d: data });
}

/**
 * The stamp a refill (after a database read) writes with: the versions of `read`, taken BEFORE that database read. A version that was
 * missing is created now (`SET NX`, a random start); when another process created it first, or Redis fails, or the instance changed,
 * the refill is not cached (null).
 */
export async function stampForWrite(read: GuardedRead | null, o?: { redis?: GuardRedis }): Promise<string | null> {
  if (!read?.instance) return null;
  const versions = [...read.versions];
  for (let i = 0; i < versions.length; i += 1) {
    if (versions[i] !== null && versions[i] !== '') continue;
    const fresh = String(randomInt(1, 2 ** 47));
    try {
      const c = await client(o);
      if ((await c.set(read.versionKeys[i]!, fresh, 'EX', CACHE_VERSION_TTL_SECONDS, 'NX')) !== 'OK') return null;
    } catch {
      noteRedisTrouble();
      return null;
    }
    versions[i] = fresh;
  }
  if (redisCacheInstance() !== read.instance) return null;
  return [read.instance, ...versions].join(SEP);
}

/** Writes a sealed entry (best effort: a failure is noted and the next read goes to the database). */
export async function writeGuarded(key: string, stamp: string, data: unknown, ttlSeconds: number, o?: { redis?: GuardRedis }): Promise<void> {
  try {
    await (await client(o)).setex(key, ttlSeconds, sealEntry(stamp, data));
  } catch {
    noteRedisTrouble();
  }
}

/**
 * Test seam: `{ pending }` pins the outbox view (always fresh, those tenants pending), `'unreadable'` makes it unreadable, null goes
 * back to reading the outbox (and forgets the view).
 */
export function setCacheGuardForTests(state: { pending: readonly string[] } | 'unreadable' | null): void {
  pinned = state;
  view = null;
  refreshing = null;
}
