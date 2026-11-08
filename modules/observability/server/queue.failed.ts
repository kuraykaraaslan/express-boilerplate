/**
 * The node's recent BullMQ failures as one class-G number (`queue_failed_jobs` of `exportGlobalSafe`, X4-6): the jobs that FAILED in the last
 * `GLOBAL_WINDOW_SECONDS` (5 minutes), every queue of the node together. It feeds `ReleaseHealth.queueFailed`, the fourth number the rollout
 * gates judge, so a release whose jobs start failing trips an automatic gate that limits it.
 *
 * Read straight from Redis, where BullMQ keeps each queue's failed set as a sorted set scored by the time the job finished: `ZCOUNT
 * bull:<queue>:failed <now - window> +inf`. So the number is
 *  - a WINDOW, not the size of the failed set: failures kept by `removeOnFail` that are older than five minutes are not counted. The window
 *    does NOT stop at a deploy: for five minutes after a cutover it still covers jobs the previous release failed. The rollout gate handles
 *    that (`QUEUE_FAILED_SETTLE_SECONDS` in `fleet_release.plan.rules.ts`: the number is not judged until a whole window lies after the
 *    deployment's finish), so this reader stays a plain count;
 *  - shared by every process of the node (the app, the worker): Redis is where the jobs live, whichever process ran them;
 *  - right after a restart: the timestamps are in Redis, there is no in-memory history to fill;
 *  - a floor: a job retried out of the failed set or trimmed by `removeOnFail` within the window is not counted. Only a queue whose
 *    `removeOnFail` count is smaller than its failures within five minutes can hide some, and then the count is at least that cap.
 *
 * Queues are discovered like the queue health sweep does (`bull:<name>:meta`), so a queue a module adds is counted without registering it. The
 * discovery is cached (a SCAN is not free on a big keyspace) and so is the answer, briefly, because a heartbeat reads the G export twice. "Not
 * measured" is ABSENT, never zero: Redis unreachable, slow (over `READ_TIMEOUT_MS`) or failing gives `undefined`. A node whose Redis answers and
 * has no queue, or no failure, says 0, which is a measurement.
 */
export const QUEUE_DISCOVERY_TTL_MS = 5 * 60_000;
export const QUEUE_FAILED_CACHE_MS = 10_000;
export const READ_TIMEOUT_MS = 2_000;
export const MAX_QUEUES = 200;

export interface QueueFailedPort {
  /** Every queue name that exists now (at most `MAX_QUEUES`). */
  discover(): Promise<string[]>;
  /** Per queue, in order: the jobs in its failed set that finished at or after `sinceMs`. */
  failedSince(names: readonly string[], sinceMs: number): Promise<number[]>;
}

/** The sum of per-queue counts, or undefined when any of them is not a non-negative safe integer (a broken answer is not a measurement). */
export function sumFailed(counts: readonly unknown[]): number | undefined {
  let total = 0;
  for (const c of counts) {
    if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0) return undefined;
    total += c;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    (t as { unref?: () => void }).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** A reader over a port, with the discovery and answer caches and the timeout. Never throws. */
export function createQueueFailedReader(port: QueueFailedPort, windowSeconds: number, opts: { timeoutMs?: number } = {}) {
  let names: { at: number; list: string[] } | null = null;
  let last: { at: number; value: number | undefined } | null = null;
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  async function measure(nowMs: number): Promise<number | undefined> {
    if (!names || nowMs - names.at >= QUEUE_DISCOVERY_TTL_MS || nowMs < names.at) {
      names = { at: nowMs, list: [...new Set(await port.discover())].slice(0, MAX_QUEUES) };
    }
    if (names.list.length === 0) return 0;
    const counts = await port.failedSince(names.list, nowMs - windowSeconds * 1000);
    return counts.length === names.list.length ? sumFailed(counts) : undefined;
  }
  return async function read(nowMs: number): Promise<number | undefined> {
    if (last && nowMs >= last.at && nowMs - last.at < QUEUE_FAILED_CACHE_MS) return last.value;
    let value: number | undefined;
    try { value = await withTimeout(measure(nowMs), timeoutMs); } catch { value = undefined; names = null; }
    last = { at: nowMs, value };
    return value;
  };
}

/** The queue names BullMQ has created in Redis, by their meta key (default `bull` prefix). */
export async function discoverQueueNames(max = MAX_QUEUES): Promise<string[]> {
  const { default: redis } = await import('@kuraykaraaslan-labs/redis');
  const names = new Set<string>();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull:*:meta', 'COUNT', 200);
    cursor = next;
    for (const k of keys) { const m = /^bull:(.+):meta$/.exec(k); if (m) names.add(m[1]); }
  } while (cursor !== '0' && names.size < max);
  return [...names].slice(0, max);
}

/** The Redis port: discovery by meta key, one pipelined ZCOUNT per queue over its failed set. */
export const redisQueueFailedPort: QueueFailedPort = {
  discover: () => discoverQueueNames(),
  async failedSince(names, sinceMs) {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    const pipe = redis.pipeline();
    for (const n of names) pipe.zcount(`bull:${n}:failed`, Math.floor(sinceMs), '+inf');
    const res = (await pipe.exec()) ?? [];
    return res.map(([err, v]) => (err ? Number.NaN : Number(v)));
  },
};
