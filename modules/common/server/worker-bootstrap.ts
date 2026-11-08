/**
 * Boot sequence shared by every process that owns background work: the Next server (`instrumentation.ts`, single
 * process) and the `worker` image (`scripts/worker.ts`). Importing this file has NO side effects: it neither starts a
 * process host nor touches a queue. The scheduler arrays are imported lazily, and a job file builds its BullMQ
 * `Worker` only when its schedule function calls `startWorker()`, so a process that never calls
 * `startBackgroundJobs` (the web runner of a split deployment) never consumes a scheduled queue. The delivery
 * consumers (mail, SMS, chat, webhook) are the exception: `startQueueConsumers` starts them in every process that
 * boots, as their import-time start used to, because nothing else consumes them in a single-process setup.
 *
 * `common` stays a dependency-free leaf: the logger is passed in. The tasks themselves are not listed here or anywhere at the root: every
 * module declares its own in its module.json (`common:boot_task`, see boot-tasks.ts), so a module that is not installed contributes none.
 */
import { bootTasks, type BootTask } from './boot-tasks';
import { runBootTasks, type BootLogger } from './boot-runner';
import { registerApprovalHandlers } from './approval-bootstrap';
import { registerDrainHook, withConsumerScope } from './process-hooks';
import { commonBootTaskRuntimeLoaders } from './generated/extensions/common.boot_task.runtime';
import { commonBootTaskConsumerLoaders } from './generated/extensions/common.boot_task.consumer';
import { commonBootTaskGuardLoaders } from './generated/extensions/common.boot_task.guard';
import { commonBootTaskSchedulerLoaders } from './generated/extensions/common.boot_task.scheduler';

export type { BootLogger } from './boot-runner';
export { registerApprovalHandlers } from './approval-bootstrap';

/**
 * In-process hooks every process needs before it serves anything (`runtime` phase, e.g. the stored-text overlay of the
 * server messages). Always runs, in every process, before the approval handlers.
 */
export async function registerRuntimeHooks(log: BootLogger, source = 'instrumentation'): Promise<void> {
  await runBootTasks(await bootTasks('runtime', commonBootTaskRuntimeLoaders), (name, reason) =>
    log.warn(`[${source}] runtime hook "${name}" not registered: ${reason}`),
  );
}

/**
 * `BACKGROUND_JOBS_ONLY`: the scheduler tasks to start where background jobs are on, by the name the boot log prints (their
 * module.json `metadata.name`), comma-separated. Unset or blank: every scheduler of the build, as before. For an install that must
 * not run everything it was built with, e.g. a demo whose mail server is real but whose rollups must run (2026-10-26, INC-17).
 */
export function backgroundJobsOnly(): Set<string> | null {
  const names = (process.env.BACKGROUND_JOBS_ONLY ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

/** Same toggle the Next server has always used: self-hosted processes set it, serverless deploys trigger cron over HTTP. */
export function backgroundJobsEnabled(): boolean {
  return process.env.ENABLE_BACKGROUND_JOBS === 'true';
}

/**
 * Runs `run` only while this process holds the cluster-wide leader lock of `job` (process_host `withLeader`, injected
 * so `common` stays a leaf). Resolves after the first attempt; `stop()` releases the lock.
 */
export type LeaderRunner = (job: string, run: () => Promise<void>) => Promise<{ stop(): Promise<void> }>;

export interface BackgroundJobOptions {
  /**
   * Leader election for the single-owner schedulers (docs/phases/14-docker/07 task 2). Without it every scheduler runs
   * here, as before; with it they run in exactly one process of the cluster, however many children or containers start.
   */
  leader?: LeaderRunner;
}

/** The lock the single-owner schedulers run under: `proc:leader:<kind>:schedulers`. */
export const SCHEDULERS_LEADER_JOB = 'schedulers';

/**
 * Registers every module scheduler (BullMQ recurring jobs, which also start the queue consumers) when
 * `ENABLE_BACKGROUND_JOBS=true`. Modules that are not present (e.g. SSL job in OSS) log a warning and the rest
 * still come up. Returns the number of scheduler tasks attempted, 0 when the toggle is off.
 *
 * Single-owner work: a scheduler task registers a repeatable job, a timer or a cron owner that must exist once per
 * cluster. With `opts.leader` those tasks run inside the leader lock `schedulers` (one process of the cluster runs
 * them; another takes over within ~20 s when it dies). Tasks declared `parallel: true` in their module.json (the
 * automation host, which shares its partitions through leases; pure queue consumers) run in every process. With one
 * process the leader is acquired on the first attempt and the order and timing are what they were.
 *
 * A process that wins the lock a second time (it lost it to a Redis outage, then won it back) does not run the tasks
 * again: they are idempotent, but nothing is gained by repeating them. A process that loses the lock without exiting
 * keeps what it started (BullMQ still hands each repeat tick to one consumer, and registering a repeatable is
 * idempotent); its drain releases the lock first so the next leader starts promptly.
 */
export async function startBackgroundJobs(log: BootLogger, source = 'instrumentation', opts: BackgroundJobOptions = {}): Promise<number> {
  if (!backgroundJobsEnabled()) return 0;
  const built: BootTask[] = await bootTasks('scheduler', commonBootTaskSchedulerLoaders);
  const only = backgroundJobsOnly();
  const schedulers = only ? built.filter(([name]) => only.has(name)) : built;
  if (only) {
    const unknown = [...only].filter((name) => !built.some(([n]) => n === name));
    log.info(`[${source}] BACKGROUND_JOBS_ONLY: ${schedulers.length} of ${built.length} schedulers (${schedulers.map(([n]) => n).join(', ') || 'none'})`);
    if (unknown.length > 0) log.warn(`[${source}] BACKGROUND_JOBS_ONLY names no scheduler of this build: ${unknown.join(', ')}`);
  }
  const warn = (name: string, reason: string) => log.warn(`[${source}] scheduler "${name}" not started: ${reason}`);
  if (!opts.leader) {
    await runBootTasks(schedulers, warn);
    log.info(`[${source}] background jobs scheduled (${schedulers.length} queues)`);
    return schedulers.length;
  }
  // the consumers a single-owner task starts run on the leader only: recorded as such (the worker's scaling signal skips them)
  const scoped = schedulers.map(([name, run, o]): BootTask => (o?.parallel === true ? [name, run, o] : [name, () => withConsumerScope('leader', run), o]));
  const everywhere = scoped.filter(([, , o]) => o?.parallel === true);
  const singleOwner = scoped.filter(([, , o]) => o?.parallel !== true);
  // Won on the first attempt (always, with one process): every task runs below in registry order, as before.
  // Won later (the previous leader died): the single-owner tasks run then.
  let booting = true;
  let leaderAtBoot = false;
  let started = false;
  const handle = await opts.leader(SCHEDULERS_LEADER_JOB, async () => {
    if (started) return;
    started = true;
    if (booting) { leaderAtBoot = true; return; }
    await runBootTasks(singleOwner, warn);
    log.info(`[${source}] leader: single-owner schedulers started (${singleOwner.length})`);
  });
  booting = false;
  registerDrainHook(`leader:${SCHEDULERS_LEADER_JOB}`, () => handle.stop());
  await runBootTasks(leaderAtBoot ? scoped : everywhere, warn);
  log.info(`[${source}] background jobs scheduled (${schedulers.length} queues: ${singleOwner.length} single-owner ${leaderAtBoot ? 'here (leader)' : 'on the leader'}, ${everywhere.length} in every process)`);
  return schedulers.length;
}

/**
 * Starts the delivery queue consumers (`consumer` phase) whatever the background-job toggle says: they used to start
 * when their queue file was first imported, so every process that sent mail or fired a webhook consumed too. Starting
 * them here keeps that behaviour while making it explicit, idempotent and drained on SIGTERM.
 */
export async function startQueueConsumers(log: BootLogger, source = 'instrumentation'): Promise<void> {
  await runBootTasks(await bootTasks('consumer', commonBootTaskConsumerLoaders), (name, reason) =>
    log.warn(`[${source}] queue consumer "${name}" not started: ${reason}`),
  );
}

/** A boot guard refused: the process must not serve. `failures` names each guard and its reason (no secret ever goes into a reason). */
export class BootGuardRefusal extends Error {
  constructor(readonly failures: readonly { name: string; reason: string }[]) {
    super(`boot refused by ${failures.map((f) => `"${f.name}": ${f.reason}`).join('; ')}`);
    this.name = 'BootGuardRefusal';
  }
}

/**
 * Runs the `guard` phase (boot-tasks.ts): every guard the installed modules declare, in order, each in its own try so all refusals are
 * reported at once. Any guard that throws (or cannot be loaded) is a refusal: a guard is a precondition, so failing to evaluate it never
 * counts as passing. Resolves with the number of guards that ran.
 */
export async function runBootGuards(log: BootLogger, source = 'instrumentation'): Promise<number> {
  const guards = await bootTasks('guard', commonBootTaskGuardLoaders);
  const failures: { name: string; reason: string }[] = [];
  await runBootTasks(guards, (name, reason) => { failures.push({ name, reason }); });
  if (failures.length > 0) throw new BootGuardRefusal(failures);
  if (guards.length > 0) log.info(`[${source}] boot guards passed (${guards.length})`);
  return guards.length;
}

export interface BootRuntimeOptions extends BackgroundJobOptions {
  /** How a refused boot ends the process (tests inject it); `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * What a process with background work does at boot: the guards first (a refusal logs and exits with code 1 before anything else starts, so
 * the process never serves), then runtime hooks, handlers and delivery consumers (always), then the schedulers (toggle).
 */
export async function bootRuntime(log: BootLogger, source = 'instrumentation', opts: BootRuntimeOptions = {}): Promise<void> {
  try {
    await runBootGuards(log, source);
  } catch (err) {
    (log.error ?? log.warn).call(log, `[${source}] ${err instanceof Error ? err.message : String(err)}; refusing to serve`);
    (opts.exit ?? ((code: number) => process.exit(code)))(1);
    // an injected exit that returns (a test) still starts nothing
    throw err;
  }
  await registerRuntimeHooks(log, source);
  await registerApprovalHandlers(log, source);
  await startQueueConsumers(log, source);
  await startBackgroundJobs(log, source, opts);
}
