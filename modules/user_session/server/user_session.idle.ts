import redis from '@kuraykaraaslan-labs/redis';
import AuthPolicyService from '@kuraykaraaslan-labs/auth/server/auth.policy.service';

/**
 * D28: when is a session idle? `getSession` keeps a Redis key per session (`session:idle:<id>`, refreshed to the tenant's idle timeout on
 * every request); a session whose key is gone has an access token `getSession` refuses, but it is NOT dead: `refreshTokens` has no idle
 * check, so a remember-me browser or a native app left alone for a day still comes back with its refresh token. The list and the prune job
 * therefore call a session IDLE only when it is DORMANT: the key is gone AND the row has not been touched (a sign-in or a token refresh
 * writes it) for the dormancy window, which is 30 days, or the tenant's absolute session limit when that is shorter, and never less than
 * the tenant's idle timeout. Such a session is one nobody has used for a month: it is hidden from the list and, after the history
 * retention (user_session.prune.ts), deleted. A Redis that lost its keys alone never idles a recently seen session (its row is fresh).
 */
export const idleKeyOf = (userSessionId: string) => `session:idle:${userSessionId}`;

export type IdleRow = { userSessionId: string; tenantId: string; createdAt?: Date | null; updatedAt?: Date | null };

/** Seconds left on each session's idle key (-2: no key, -1: no TTL), or null when Redis cannot answer (then nothing is called idle). */
export async function readIdleRemaining(ids: string[]): Promise<Map<string, number> | null> {
  if (ids.length === 0) return new Map();
  try {
    const m = redis.multi();
    for (const id of ids) m.ttl(idleKeyOf(id));
    const out = await m.exec();
    if (!out) return null;
    const map = new Map<string, number>();
    for (let i = 0; i < ids.length; i++) {
      const [err, ttl] = out[i] ?? [new Error('missing'), null];
      if (err || typeof ttl !== 'number') return null;
      map.set(ids[i], ttl);
    }
    return map;
  } catch {
    return null;
  }
}

/** The access-token idle window in seconds of each tenant among `rows` (what `getSession` allows; it dates `lastActiveAt`). Unreadable policy: left out. */
export async function idleWindows(rows: IdleRow[]): Promise<Map<string, number>> {
  const windows = new Map<string, number>();
  await Promise.all([...new Set(rows.map((r) => r.tenantId))].map(async (tenantId) => {
    try {
      const policy = await AuthPolicyService.getSessionPolicy(tenantId);
      windows.set(tenantId, Math.max(60, policy.idleTimeoutMinutes * 60));
    } catch { /* unreadable policy: not idle */ }
  }));
  return windows;
}

/** D28: the longest a session may sit unused before the list hides it as dormant (a tenant's shorter absolute session limit lowers it). */
export const DORMANT_MAX_SECONDS = 30 * 24 * 3600;

/**
 * The dormancy window in seconds of each tenant among `rows`: `DORMANT_MAX_SECONDS`, lowered to the tenant's absolute session limit
 * when that is shorter, and never below the tenant's idle timeout (what `getSession` itself allows). A tenant whose policy cannot be
 * read is left out: its sessions are never dormant.
 */
export async function dormantWindows(rows: IdleRow[]): Promise<Map<string, number>> {
  const windows = new Map<string, number>();
  await Promise.all([...new Set(rows.map((r) => r.tenantId))].map(async (tenantId) => {
    try {
      const policy = await AuthPolicyService.getSessionPolicy(tenantId);
      const idleSec = Math.max(60, policy.idleTimeoutMinutes * 60);
      const absoluteSec = Number.isFinite(policy.absoluteMaxHours) && policy.absoluteMaxHours > 0 ? policy.absoluteMaxHours * 3600 : DORMANT_MAX_SECONDS;
      windows.set(tenantId, Math.max(idleSec, Math.min(DORMANT_MAX_SECONDS, absoluteSec)));
    } catch { /* unreadable policy: not dormant */ }
  }));
  return windows;
}

const touchedMs = (r: IdleRow) => (r.updatedAt ?? r.createdAt ?? new Date(0)).getTime();

/** Is the row's own clock past its idle window? (The cheap half: only these rows need the Redis question.) */
export function rowIsStale(r: IdleRow, windowSec: number | undefined, now: number): boolean {
  return windowSec !== undefined && now - touchedMs(r) > windowSec * 1000;
}

/**
 * The ids among `rows` that are idle, i.e. dormant (see above). `keep` is never idle (the caller's own session: it is making this
 * request). Redis unreachable, or a tenant policy that cannot be read: nothing of it is called idle (a listing shows too much, a
 * prune deletes nothing).
 */
export async function findIdleSessions(rows: IdleRow[], keep?: string | null, now = Date.now()): Promise<Set<string>> {
  const windows = await dormantWindows(rows);
  const stale = rows.filter((r) => r.userSessionId !== keep && rowIsStale(r, windows.get(r.tenantId), now));
  if (stale.length === 0) return new Set();
  const remaining = await readIdleRemaining(stale.map((r) => r.userSessionId));
  if (!remaining) return new Set();
  return new Set(stale.filter((r) => (remaining.get(r.userSessionId) ?? 0) === -2).map((r) => r.userSessionId));
}

/** When the session was last seen: the idle key's remaining TTL says how long ago the last request was; the row's clock when the key is gone. */
export function lastActiveAt(r: IdleRow, windowSec: number | undefined, remaining: number | undefined, now = Date.now()): Date | null {
  if (windowSec !== undefined && remaining !== undefined && remaining > 0) {
    return new Date(now - (windowSec - Math.min(remaining, windowSec)) * 1000);
  }
  const t = r.updatedAt ?? r.createdAt;
  return t ?? null;
}
