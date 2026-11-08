/**
 * The contract of the session-ending outbox (docs/audits/2026-11-03-redis-outage.md §3, layer 1). Pure: no database, no Redis, no
 * Next; the producers (iot_device, iot_device_profile, websocket_session) build their orders with these types and the gateways'
 * readers know the `oid` field from here.
 *
 * An order says, generically, what delivering it writes to Redis, so the relay needs no producer code to deliver it (a module removed
 * later still has its pending orders delivered):
 *   1. `incr`: each key `INCR` then `EXPIRE <ttl>` (a credential-cache generation: every cached answer of a device stops matching);
 *   2. `del`: the keys deleted (a known cache entry);
 *   3. `XADD <stream> MAXLEN ~ <maxlen> * <field> <entry + oid>`: the order itself, with the order's stable id as `oid` in the JSON.
 * Steps 1 and 2 are idempotent in effect (a second generation bump is one more cache miss); the readers act on an `oid` once.
 */

/** The JSON field of an entry that carries the order's id (`oid`): a reader that saw it already skips the entry. */
export const ORDER_ID_FIELD = 'oid';

export interface SessionEndPayload {
  /** The stream the order goes to (`iot:kicks`, `ws:control:stream`). */
  stream: string;
  /** The entry's one field (`k` on `iot:kicks`, `e` on `ws:control:stream`). */
  field: string;
  /** `MAXLEN ~` of the XADD. */
  maxlen: number;
  /** The entry's JSON object, without `oid` (the delivery adds it). */
  entry: Record<string, unknown>;
  /** Keys to `INCR` and `EXPIRE` before the XADD. */
  incr?: Array<{ key: string; ttlSeconds: number }>;
  /** Keys to `DEL` before the XADD. */
  del?: string[];
}

/** One order as a producer hands it over. */
export interface SessionEndOrderInput {
  tenantId: string;
  /** `<module>.<what>`, for the operator and the metric labels. */
  kind: string;
  payload: SessionEndPayload;
}

/** One order after it was recorded: what the fast path delivers. */
export interface RecordedSessionEndOrder extends SessionEndOrderInput {
  orderId: string;
}

/** How long a recorded row waits for its writer's fast path before the relay may take it. */
export const FAST_PATH_GRACE_MS = 5_000;

/**
 * The stream of the cache drops (D253, `session_end.cache-guard.ts`): an order whose real work is its `incr` (a cache version bump)
 * and `del` (the entries) steps, for a change that must end access at once (an API key revoked, an ABAC policy or a role set edited).
 * The entry is a short log line (`kind`, tenant); nothing reads it. Such an order is due at once (no fast-path grace: delivering it
 * twice is one more cache miss), and while one is pending for a tenant no process trusts that tenant's guarded caches.
 */
export const CACHE_DROP_STREAM = 'session_end:cache_drops';
/** `MAXLEN ~` of the cache-drop log stream. */
export const CACHE_DROP_MAXLEN = 1_000;
/** The relay's cadence. */
export const RELAY_EVERY_MS = 5_000;
/** A pending row older than this is an incident (metric, alert, error log). */
export const STALE_AFTER_MS = 60_000;
/** Relay attempts (while Redis answers) before a row becomes a dead letter. */
export const MAX_ATTEMPTS = 50;
/** One delivery may take this long before it counts as failed (a Redis that does not answer must not hold a request). */
export const DELIVERY_TIMEOUT_MS = 2_000;
/** Rows one relay pass takes. */
export const RELAY_BATCH = 200;

/** Backoff of the relay's next attempt at a row: 2, 4, 8 … seconds, at most a minute. */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, attempts - 1), 60_000);
}

const NAME = /^[A-Za-z0-9:_.{}-]{1,120}$/;
const KEY = /^[^\s]{1,300}$/;
const MAX_ENTRY_BYTES = 8_192;

/** Why a payload cannot be delivered, or null when it can. A row with an undeliverable payload is dead-lettered at once. */
export function payloadProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'not an object';
  const v = p as Partial<SessionEndPayload>;
  if (typeof v.stream !== 'string' || !NAME.test(v.stream)) return 'bad stream';
  if (typeof v.field !== 'string' || !NAME.test(v.field)) return 'bad field';
  if (typeof v.maxlen !== 'number' || !Number.isInteger(v.maxlen) || v.maxlen < 1 || v.maxlen > 10_000_000) return 'bad maxlen';
  if (!v.entry || typeof v.entry !== 'object' || Array.isArray(v.entry)) return 'bad entry';
  if (JSON.stringify(v.entry).length > MAX_ENTRY_BYTES) return 'entry too long';
  if (v.incr !== undefined) {
    if (!Array.isArray(v.incr) || v.incr.length > 16) return 'bad incr';
    for (const i of v.incr) {
      if (!i || typeof i.key !== 'string' || !KEY.test(i.key) || !Number.isInteger(i.ttlSeconds) || i.ttlSeconds < 1) return 'bad incr';
    }
  }
  if (v.del !== undefined) {
    if (!Array.isArray(v.del) || v.del.length > 64) return 'bad del';
    for (const k of v.del) if (typeof k !== 'string' || !KEY.test(k)) return 'bad del';
  }
  return null;
}

/** The entry's JSON as written to the stream: the producer's object with the order's id. */
export function entryJson(orderId: string, entry: Record<string, unknown>): string {
  return JSON.stringify({ ...entry, [ORDER_ID_FIELD]: orderId });
}

/**
 * The extension point `session_end:order_source` (D249, docs/audits/2026-11-03-redis-outage.md §3.2): how a change that ends access
 * gets the session-ending orders of modules it must not know (the websocket gateway's drops) into ITS OWN transaction. The host
 * (`user_session`, `tenant_member`, `tenant`) calls `recordSessionEndInTx(qr, cause)` (`session_end.in-tx.ts`) with its open
 * transaction before it commits; every contribution answers the orders the cause asks of it, and `session_end` records them in that
 * transaction. A contribution only BUILDS orders (pure, no database, no Redis): it never touches the host's transaction, and every
 * order it answers must name the cause's tenant.
 */
export const SESSION_END_ORDER_SOURCE_POINT = 'session_end:order_source';

/** One revoked session of a `sessions_revoked` cause. `userSessionId` is absent when the session cannot be told apart. */
export interface SessionEndSessionRef {
  tenantId: string;
  userId: string;
  userSessionId?: string;
}

/**
 * Why access ends, in ids only (no secret, no personal data beyond the ids the gateways need):
 *   - `sessions_revoked`: sessions deleted (logout, sign out other devices, log out everywhere, password change, a cap, an admin);
 *   - `member_access_ended`: a person stopped being an active member of a workspace (`membership_ended`), or an active member's role
 *     changed so what was granted at a handshake must be granted again (`access_changed`);
 *   - `tenant_access_ended`: a whole tenant was suspended, its deletion started, or it was purged.
 */
export type SessionEndCause =
  | { type: 'sessions_revoked'; sessions: SessionEndSessionRef[] }
  | { type: 'member_access_ended'; tenantId: string; userId: string; reason: 'membership_ended' | 'access_changed' }
  | { type: 'tenant_access_ended'; tenantId: string; reason: 'suspended' | 'deletion_requested' | 'purged' };

/** Default export of a `session_end:order_source` contribution. Answers [] for a cause it has nothing to end for. */
export interface SessionEndOrderSource {
  ordersFor(cause: SessionEndCause): SessionEndOrderInput[] | Promise<SessionEndOrderInput[]>;
}

/** The tenants a cause touches, in first-seen order. */
export function causeTenants(cause: SessionEndCause): string[] {
  if (cause.type !== 'sessions_revoked') return [cause.tenantId];
  return [...new Set(cause.sessions.map((s) => s.tenantId))];
}

/** The part of a cause that belongs to one tenant (each tenant's contributions are asked under that tenant's gate). */
export function causeForTenant(cause: SessionEndCause, tenantId: string): SessionEndCause {
  if (cause.type !== 'sessions_revoked') return cause;
  return { type: 'sessions_revoked', sessions: cause.sessions.filter((s) => s.tenantId === tenantId) };
}
