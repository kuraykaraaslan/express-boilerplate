import { extensionRegistry, type ExtensionPointLoaders } from './extension-registry'
import { ext, systemCtx } from './extensions/ext'

/**
 * A named boot step; each is run in its own try so one broken module can't block the rest. The optional third element
 * carries the task's declared options: `parallel` marks a scheduler-phase task that must run in EVERY process of the
 * kind (a queue consumer, a host that shares its work through leases) rather than in the one leader that owns the
 * single-owner work (see `startBackgroundJobs`).
 */
export type BootTask = [name: string, run: () => Promise<unknown>, opts?: { parallel?: boolean }]

/** Extension point of boot tasks, declared in common/module.json `extensionPoints`. */
export const BOOT_TASK_POINT = 'common:boot_task'

/**
 * `guard`: a precondition of serving at all (P9-17: a fleet node refuses to boot without RLS forced and with a plaintext secret column). Runs
 * first in every process that boots, and unlike the other phases a guard that throws stops the process (`bootRuntime`).
 * `runtime`: registers an in-process hook every process needs before it serves anything (always runs, right after the
 *   guards), e.g. the stored-text overlay of `i18n`'s server messages. A hook that must be visible across Next's bundle
 *   graphs keeps its state on `globalThis` (instrumentation and route handlers evaluate a module separately).
 * `approval`: registers an approval decision handler (always runs, in every process that can record a decision).
 * `consumer`: starts a delivery queue consumer (mail, SMS, chat, webhook) in every process that boots. These used to
 * start as a side effect of importing their queue file, and they are the only consumers in dev, the default compose
 * and serverless, so gating them on the background-job toggle would stop delivery.
 * `scheduler`: registers a recurring job or starts a queue consumer (runs only where background jobs are enabled).
 */
export type BootPhase = 'guard' | 'runtime' | 'approval' | 'consumer' | 'scheduler'

/**
 * The boot tasks the installed modules declare for a phase, in `order`.
 *
 * Every module lists its own tasks in its module.json (`point: "common:boot_task"`, `export`: the file, `metadata: { phase, fn, name }`),
 * so the process that boots needs no list of modules: a module that is not installed has no declaration and nothing runs for it.
 * `fn` is the exported function to call in `export`; it is looked up when the task runs, never at registration.
 *
 * Read in a system context: boot belongs to no tenant, so every task of the build runs (a per-tenant switch decides what a
 * job does for that tenant, not whether the process starts it). The tasks themselves are run by `runBootTasks`, one after
 * another in this order: a task names a function of a file rather than its default export, which the extension runtime's
 * call helpers do not load.
 *
 * `loaders` is the phase's generated map (`generated/extensions/common.boot_task.<phase>`), imported by the caller: the
 * approval phase runs on the HTTP decision path too (approval-bootstrap.ts), which must not compile every scheduler job.
 */
export async function bootTasks(phase: BootPhase, loaders: ExtensionPointLoaders): Promise<BootTask[]> {
  return (await ext.contributions(BOOT_TASK_POINT, systemCtx(`process boot: ${phase} tasks`)))
    .filter((task) => task.metadata.phase === phase)
    .map((task): BootTask => {
      const name = typeof task.metadata.name === 'string' ? task.metadata.name : (task.key ?? task.id)
      return [
        name,
        async () => {
          const fn = (await extensionRegistry.loadModule(task, loaders))[String(task.metadata.fn)]
          if (typeof fn !== 'function') throw new Error(`${task.exportId} does not export a function named "${String(task.metadata.fn)}"`)
          return (fn as () => Promise<unknown> | unknown)()
        },
        { parallel: task.metadata.parallel === true },
      ]
    })
}
