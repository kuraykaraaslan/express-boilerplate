/**
 * Whether this process may trust what the shared Redis holds for an access decision right now (D253,
 * docs/audits/2026-11-03-redis-outage.md §6.10): a revoked API key, an ABAC policy set, a role set. A leaf with no imports and no side
 * effects: `redis.service.ts` hands it the default client (`watchRedisClient`), and the caches that guard an access decision ask
 * `redisCacheInstance()` before they believe an entry (session_end's cache guard stamps every such entry with it).
 *
 * The answer is the id of the Redis INSTANCE the client talks to (its `run_id`, new on every start and on a failover to another
 * server), or null while the answer cannot be trusted:
 *   - before the client is ready and identified, and from the moment it reports trouble (`error`, `close`, `end`, `reconnecting`)
 *     until it is ready and identified again;
 *   - for `REDIS_QUIET_MS` after any trouble, a failed command included (`noteRedisTrouble`): a flapping connection is not trusted.
 * An entry stamped with another instance's id was written to a Redis that is gone (a restart that replayed an old AOF, a replica that
 * had not caught up when it was promoted): it is never trusted, whatever its content.
 *
 * Where INFO is refused (a managed Redis without the command), the id is a marker key the first client writes (`SET NX`, no TTL):
 * a Redis that lost its data loses the marker too, so its old entries are not trusted either.
 */

/** How long after any trouble the instance id is withheld. */
export const REDIS_QUIET_MS = 5_000;
/** The marker key of the INFO-less fallback. */
export const INSTANCE_MARKER_KEY = 'nb:redis:instance';

/** The part of an ioredis client the tracker uses (`ioredis` satisfies it; tests pass a fake). */
export interface WatchedRedis {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  status?: string;
  info(section: string): Promise<string>;
  set(key: string, value: string, mode: 'NX'): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

let client: WatchedRedis | null = null;
let instance: string | null = null;
let troubleAt = 0;
/** Bumped by every trouble: an identification that started before it is thrown away. */
let troubleSeq = 0;
let clientSeq = 0;

function trouble(): void {
  instance = null;
  troubleAt = Date.now();
  troubleSeq += 1;
}

/** A command against the shared client failed (or timed out): withhold the instance id for `REDIS_QUIET_MS`. */
export function noteRedisTrouble(): void {
  troubleAt = Date.now();
  troubleSeq += 1;
}

function runIdOf(info: string): string | null {
  const m = /(?:^|\r?\n)run_id:([0-9a-f]{8,64})/.exec(info);
  return m ? m[1] : null;
}

async function identify(c: WatchedRedis, mine: number): Promise<void> {
  const seq = troubleSeq;
  let id: string | null = null;
  try {
    id = runIdOf(await c.info('server'));
  } catch { /* INFO refused or the connection went: the marker below, or nothing */ }
  if (!id) {
    try {
      await c.set(INSTANCE_MARKER_KEY, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, 'NX');
      const marker = await c.get(INSTANCE_MARKER_KEY);
      id = marker ? `marker:${marker}` : null;
    } catch {
      id = null;
    }
  }
  // the client changed, or reported trouble while we asked: this answer may describe a connection that is gone
  if (mine !== clientSeq || seq !== troubleSeq) return;
  instance = id;
}

/** Starts tracking `c` (the default client; a test passes its own). Replaces any client tracked before. */
export function watchRedisClient(c: WatchedRedis): void {
  clientSeq += 1;
  const mine = clientSeq;
  client = c;
  instance = null;
  const onTrouble = () => { if (mine === clientSeq) trouble(); };
  for (const event of ['error', 'close', 'end', 'reconnecting']) c.on(event, onTrouble);
  c.on('ready', () => { if (mine === clientSeq) void identify(c, mine); });
  if (c.status === 'ready') void identify(c, mine);
}

/** The trusted instance id, or null when the caches that guard access must not be believed now (see the file comment). */
export function redisCacheInstance(now: number = Date.now()): string | null {
  if (!client || !instance) return null;
  if (client.status !== undefined && client.status !== 'ready') return null;
  if (now - troubleAt < REDIS_QUIET_MS) return null;
  return instance;
}

/** Test seam: forget the tracked client, or pin an instance id (`null` = untrusted) without a client. */
export function setRedisHealthForTests(state: { instance: string | null } | null): void {
  clientSeq += 1;
  troubleAt = 0;
  troubleSeq += 1;
  if (state === null) {
    client = null;
    instance = null;
    return;
  }
  client = { on: () => undefined, info: async () => '', set: async () => 'OK', get: async () => null };
  instance = state.instance;
}
