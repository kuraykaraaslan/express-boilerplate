import { Redis, type RedisOptions } from 'ioredis';
import { Queue, Worker, type QueueOptions } from 'bullmq';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { sentinelOptions } from './redis.sentinel';
import { installJobSecretGuard } from './redis.job-secrets';
import { installRepeatKeeper, type MarkerClient } from './redis.repeat-keeper';

// Every queue of the platform takes its connection from this file, so loading it is where job data learns it may not carry a
// secret (P9-5, redis.job-secrets.ts): `Queue.prototype.add`/`addBulk` refuse secret-named keys before anything reaches Redis.
installJobSecretGuard(Queue);
// D250: a repeatable job a Redis that lost its data forgot is added again within a minute (redis.repeat-keeper.ts). The marker goes
// over the shared command client (it fails fast), loaded on the first repeatable only.
installRepeatKeeper(Queue, {
  client: async () => (await import('./redis.service')).default as unknown as MarkerClient,
  log: Logger,
});

// Single shared BullMQ connection — reused across all queues so we don't leak
// one connection handle per createQueue() call.
// Inside the Next server the instrumentation and route bundles each evaluate this module; they share one connection through
// a global slot (see redis.service). Elsewhere the module-level variable is the only holder, as before.
const SHARED_SLOT = Symbol.for('nb.redis.bullmq');
const sharedStore = globalThis as typeof globalThis & { [SHARED_SLOT]?: Redis | null };
const useSharedSlot = !!process.env.NEXT_RUNTIME;
let _bullmqConnection: Redis | null = null;

// BullMQ requires unlimited per-request retries on its blocking connections.
const BASE_OPTIONS: RedisOptions = { maxRetriesPerRequest: null };

/**
 * REDIS_SENTINELS set: follow the master through the sentinels, so a failover moves the queues with the cache (REDIS_URL is
 * then ignored, as in redis.service). Otherwise the plain REDIS_URL connection, unchanged.
 */
function connect(): Redis {
  const sentinel = sentinelOptions(env);
  return sentinel ? new Redis({ ...BASE_OPTIONS, ...sentinel }) : new Redis(env.REDIS_URL, BASE_OPTIONS);
}

export function getBullMQConnection(): Redis {
  // read the slot per call, not at load: another bundle may have created the connection after this one was evaluated
  if (!_bullmqConnection && useSharedSlot) _bullmqConnection = sharedStore[SHARED_SLOT] ?? null;
  if (!_bullmqConnection) {
    _bullmqConnection = connect();
    _bullmqConnection.on('error', (err) =>
      Logger.error(`[Redis:bullmq] connection error: ${err.message}`),
    );
    _bullmqConnection.on('ready', () => Logger.info('[Redis:bullmq] ready'));
    if (useSharedSlot) sharedStore[SHARED_SLOT] = _bullmqConnection;
  }
  return _bullmqConnection;
}

// ── Job propagation ──────────────────────────────────────────────────────────────────────────────────────────────────────
// `createQueue` and `createWorker` are the one place every queue of the platform passes, so they are where a job learns which request enqueued it.
// This module is a leaf (env, logger only) and knows nothing of tracing: a module that does (observability, `telemetry.job-propagation.ts`)
// registers a propagator at boot, and until one is registered both functions behave exactly as before.

export interface JobPropagator {
  /** Where a job is enqueued: the data to store (typically the payload plus a carrier of the caller's trace and request id). */
  inject<T>(data: T): T;
  /** Around a job's processor: runs `fn` with the context the job carried. `job.data` is already the clean payload when `fn` runs. */
  run<R>(job: { name: string; data: unknown }, fn: () => R): R;
}

let propagator: JobPropagator | null = null;

/** Registers (or with `null` removes) the propagator. Idempotent: the last one wins. */
export function setJobPropagator(p: JobPropagator | null): void {
  propagator = p;
}

export function getJobPropagator(): JobPropagator | null {
  return propagator;
}

const PATCHED = Symbol.for('nb.bullmq.propagating');

/** A queue whose `add` and `addBulk` store the propagator's data. The registered propagator is read per call, so a queue created before boot still propagates. */
function propagating<T>(queue: Queue<T>): Queue<T> {
  const q = queue as Queue<T> & { [PATCHED]?: true };
  if (q[PATCHED]) return queue;
  q[PATCHED] = true;
  const target = queue as unknown as {
    add?: (name: string, data: unknown, opts?: unknown) => Promise<unknown>;
    addBulk?: (jobs: Array<{ name: string; data: unknown; opts?: unknown }>) => Promise<unknown>;
  };
  // (A test double that has no `add` is left alone.)
  if (typeof target.add === 'function') {
    const add = target.add.bind(queue);
    target.add = (name, data, opts) => add(name, propagator ? propagator.inject(data) : data, opts);
  }
  if (typeof target.addBulk === 'function') {
    const addBulk = target.addBulk.bind(queue);
    target.addBulk = (jobs) => addBulk(propagator ? jobs.map((j) => ({ ...j, data: propagator!.inject(j.data) })) : jobs);
  }
  return queue;
}

export function createQueue<T = unknown>(name: string, opts?: Omit<QueueOptions, 'connection'>): Queue<T> {
  return propagating(new Queue<T>(name, { ...opts, connection: getBullMQConnection() }));
}

/** Create a BullMQ Worker with the shared connection. The processor runs inside the context its job carried (see `setJobPropagator`). */
export function createWorker<T = unknown>(
  name: string,
  processor: ConstructorParameters<typeof Worker<T>>[1],
  opts?: Omit<ConstructorParameters<typeof Worker<T>>[2], 'connection'>,
): Worker<T> {
  const wrapped = ((job: { name: string; data: unknown }, ...rest: unknown[]) => {
    const p = propagator;
    const run = () => (processor as unknown as (j: unknown, ...r: unknown[]) => unknown)(job, ...rest);
    return p ? p.run(job, run) : run();
  }) as unknown as typeof processor;
  return new Worker<T>(name, typeof processor === 'function' ? wrapped : processor, { ...opts, connection: getBullMQConnection() });
}

/** Gracefully close the shared BullMQ connection (call on process shutdown). */
export async function closeBullMQConnection(): Promise<void> {
  if (_bullmqConnection) {
    await _bullmqConnection.quit().catch(() => {});
    _bullmqConnection = null;
    if (useSharedSlot) sharedStore[SHARED_SLOT] = null;
  }
}
