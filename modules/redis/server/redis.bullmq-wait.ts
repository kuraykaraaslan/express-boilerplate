import { Queue } from 'bullmq';
import { getBullMQConnection } from './redis.bullmq';

/**
 * The `worker` kind's scaling signal (docs/phases/14-docker/07 task 7): per BullMQ queue, how long its oldest waiting job
 * has been waiting. A queue whose consumers keep up has none older than a moment; a queue that backs up shows the wait its
 * newest job will have.
 *
 * Per queue: `getJobCounts('wait', 'prioritized')`, then the oldest job of the wait list (`getJobs(['wait'], 0, 0, true)`)
 * and the head of the prioritized set. BullMQ keeps no "entered wait at" field, so a job's wait start is the latest of what it
 * does keep: `timestamp + delay` (a delayed or repeatable job joins the wait list only when its delay ends; the promotion resets
 * the `delay` field to 0, so the delay it was added with, `opts.delay`, counts too) and the end or start of its last attempt
 * (`finishedOn ?? processedOn`: a retried job waits again only since that attempt, not since it was first added). A job
 * promoted early (`job.promote()`) may read younger than it is, never older. The prioritized head is the next job to run, not always the oldest one; it is the one that
 * says whether the consumers keep up. Paused queues and delayed jobs do not count: more consumers cannot run them sooner.
 */

export interface QueueWait {
  queue: string;
  /** Jobs waiting (wait + prioritized). */
  waiting: number;
  /** Seconds the oldest waiting job has waited; 0 when none. */
  oldestAgeSeconds: number;
}

/** The fields of a BullMQ job the wait start is read from. */
export interface WaitingJobLike {
  timestamp: number;
  delay?: number;
  opts?: { delay?: number };
  processedOn?: number;
  finishedOn?: number;
}

/** The few `Queue` calls used here (a test passes its own). */
export interface WaitQueueLike {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getJobs(types: string[], start: number, end: number, asc: boolean): Promise<Array<WaitingJobLike | undefined>>;
}

export interface QueueWaitOptions {
  /** Queue factory; default a `Queue` on the shared BullMQ connection, cached per name and prefix. */
  queue?: (name: string) => WaitQueueLike;
  /** BullMQ key prefix (default `bull`). */
  prefix?: string;
  now?: () => number;
}

const cache = new Map<string, Queue>();

function sharedQueue(name: string, prefix?: string): WaitQueueLike {
  const key = `${prefix ?? 'bull'}\u0000${name}`;
  let q = cache.get(key);
  if (!q) {
    q = new Queue(name, { connection: getBullMQConnection(), ...(prefix && { prefix }) });
    cache.set(key, q);
  }
  return q as unknown as WaitQueueLike;
}

const positive = (n: unknown): number => (Number(n) > 0 ? Number(n) : 0);

/** When a waiting job started to wait (see the module comment); null for a job without a timestamp. */
export function waitingSince(job: WaitingJobLike | undefined): number | null {
  if (!job || !Number.isFinite(job.timestamp)) return null;
  const added = job.timestamp + Math.max(positive(job.delay), positive(job.opts?.delay));
  return Math.max(added, positive(job.finishedOn ?? job.processedOn));
}

/** One queue's wait. Never throws for a missing job (a job removed between the two reads counts as not waiting). */
export async function queueWait(name: string, o: QueueWaitOptions = {}): Promise<QueueWait> {
  const q = o.queue ? o.queue(name) : sharedQueue(name, o.prefix);
  const now = (o.now ?? Date.now)();
  const counts = await q.getJobCounts('wait', 'prioritized');
  const wait = counts.wait ?? 0;
  const prioritized = counts.prioritized ?? 0;
  const starts: number[] = [];
  if (wait > 0) {
    const s = waitingSince((await q.getJobs(['wait'], 0, 0, true))[0]);
    if (s !== null) starts.push(s);
  }
  if (prioritized > 0) {
    const s = waitingSince((await q.getJobs(['prioritized'], 0, 0, true))[0]);
    if (s !== null) starts.push(s);
  }
  const oldest = starts.length ? Math.min(...starts) : now;
  return { queue: name, waiting: wait + prioritized, oldestAgeSeconds: Math.max(0, (now - oldest) / 1_000) };
}

/** Every queue's wait (a queue that cannot be read is left out). */
export async function queueWaits(names: readonly string[], o: QueueWaitOptions = {}): Promise<QueueWait[]> {
  const out = await Promise.all(names.map((n) => queueWait(n, o).catch(() => null)));
  return out.filter((w): w is QueueWait => w !== null);
}

/** The signal: the oldest wait over the queues, seconds (0 with no queue; NaN when none could be read). */
export async function oldestWaitSeconds(names: readonly string[], o: QueueWaitOptions = {}): Promise<number> {
  if (names.length === 0) return 0;
  const waits = await queueWaits(names, o);
  if (waits.length === 0) return NaN;
  return Math.max(...waits.map((w) => w.oldestAgeSeconds));
}

/** Closes the cached queues (tests, shutdown); the shared connection stays open. */
export async function closeQueueWaitCache(): Promise<void> {
  const qs = [...cache.values()];
  cache.clear();
  await Promise.all(qs.map((q) => q.close().catch(() => undefined)));
}
