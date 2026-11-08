/**
 * The approval half of the boot sequence, on its own so the HTTP decision path (approval.handlers.ts registers the
 * handlers lazily on first decision) loads only the approval-phase boot tasks. worker-bootstrap.ts re-exports it and
 * adds the schedulers; keeping both phases in one file made every approval decision compile every scheduler job.
 */
import { bootTasks } from './boot-tasks';
import { runBootTasks, type BootLogger } from './boot-runner';
import { commonBootTaskApprovalLoaders } from './generated/extensions/common.boot_task.approval';

/**
 * Approval decision handlers. Owning modules register an in-memory handler so a TERMINAL approval decision
 * (APPROVED / REJECTED) in the shared queue syncs back to their own state machine. This MUST run ALWAYS: decisions
 * can be recorded at any time in the Next server process, independent of the background-job toggle.
 */
export async function registerApprovalHandlers(log: BootLogger, source = 'instrumentation'): Promise<void> {
  await runBootTasks(await bootTasks('approval', commonBootTaskApprovalLoaders), (name, reason) =>
    log.warn(`[${source}] approval handler "${name}" not registered: ${reason}`),
  );
}
