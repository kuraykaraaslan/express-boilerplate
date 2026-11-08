import Logger from '@kuraykaraaslan-labs/logger'
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context'
import { isRetentionEligibleNow, listActiveTenants, listRetentionTenants } from './tenant.sweep'
import { recordSweepRun } from './tenant.sweep.runs'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'

/**
 * A BullMQ job that runs one module's work for every active tenant.
 *
 * docs/guides/cron/README.md promises every scheduled task two interchangeable triggers: an
 * in-process BullMQ worker (self-hosted) or an HTTP cron route (serverless).
 * Several jobs only ever got the HTTP half, and most of those are PER-TENANT
 * routes (`/tenant/<id>/api/cron/...`). On a self-hosted deployment they never
 * ran. Even with an external cron, someone would have had to configure one
 * entry per tenant. As a result abandoned carts were never swept, loyalty
 * points never matured, booking reminders were never sent, recurring tasks
 * and asset maintenance tasks were never generated, and pending event
 * registrations never settled.
 *
 * This factory is the BullMQ half, written once:
 * - Tenants come from `listActiveTenants()` (system RLS).
 * - Each tenant runs inside `runWithTenant`, exactly as the HTTP route does.
 * - One tenant's failure is logged and the sweep moves on.
 * - The Queue and Worker are created on `schedule()`, not at import, so
 *   importing a job module (e.g. in a test) starts nothing.
 *
 * Pick one trigger per deployment, as docs/guides/cron/README.md says; the per-tenant work must
 * be idempotent either way, and all current callers are.
 */

export interface TenantSweepSpec<R> {
  /** BullMQ queue name, also the docs/guides/cron/README.md heading. */
  name: string
  /** Default cron pattern. */
  cron: string
  /** The per-tenant work, the same call the HTTP route makes. */
  perTenant: (tenantId: string) => Promise<R>
  /** Optional one-line summary of a tenant's result, for the run log. */
  summarize?: (result: R) => string
  /** Which tenants to run for; `listActiveTenants` when not given. */
  tenants?: () => Promise<Array<{ tenantId: string }>>
  /** Record each finished run (`tenant.sweep.runs.ts`), the evidence a node's compliance check reads. */
  recordRuns?: boolean
  /**
   * How many items of a tenant's result the work could not handle (a storage delete refused, say). A tenant with any is counted as failed, exactly
   * as one that threw: a sweep that leaves expired data behind on every run must not read as a clean run.
   */
  failedItems?: (result: R) => number
  /**
   * Re-checked for each tenant right before its work (the list is read once per run): `false` skips the tenant (not a failure), a throw counts it
   * as failed and does no work for it (fail closed: a check that cannot answer is not a yes).
   */
  stillEligible?: (tenantId: string) => Promise<boolean>
}

export interface TenantSweepJob {
  run(): Promise<{ tenants: number; failed: number }>
  schedule(cronPattern?: string): Promise<void>
}

export function defineTenantSweepJob<R>(spec: TenantSweepSpec<R>): TenantSweepJob {
  const tag = `[CronJob:${spec.name}]`

  async function run(): Promise<{ tenants: number; failed: number }> {
    const tenants = await (spec.tenants ?? listActiveTenants)()
    let failed = 0
    let skipped = 0
    for (const t of tenants) {
      try {
        if (spec.stillEligible && !(await spec.stillEligible(t.tenantId))) {
          skipped += 1
          Logger.info(`${tag} tenant ${t.tenantId} skipped: no longer eligible (legal hold, migration or gone)`)
          continue
        }
        const result = await runWithTenant(t.tenantId, () => spec.perTenant(t.tenantId))
        if (spec.summarize) Logger.info(`${tag} tenant=${t.tenantId} ${spec.summarize(result)}`)
        const left = spec.failedItems?.(result) ?? 0
        if (left > 0) {
          failed += 1
          Logger.warn(`${tag} tenant ${t.tenantId} left ${left} item(s) unhandled`)
        }
      } catch (err) {
        failed += 1
        Logger.warn(`${tag} tenant ${t.tenantId} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    Logger.info(`${tag} tenants=${tenants.length} failed=${failed}${skipped ? ` skipped=${skipped}` : ''}`)
    if (spec.recordRuns) await recordSweepRun(spec.name, { tenants: tenants.length, failed })
    return { tenants: tenants.length, failed }
  }

  let scheduled = false
  async function schedule(cronPattern = spec.cron): Promise<void> {
    if (scheduled) return
    scheduled = true
    const [{ Queue, Worker }, { getBullMQConnection }] = await Promise.all([
      import('bullmq'),
      import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
    ])
    const queue = new Queue(spec.name, {
      connection: getBullMQConnection(),
      defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
    })
    const worker = new Worker(spec.name, async () => run(), { connection: getBullMQConnection(), concurrency: 1 })
    worker.on('failed', (job, err) => Logger.error(`${tag} Job ${job?.id} failed: ${err.message}`))
    registerWorkerDrain(worker)
    await queue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: `${spec.name}-recurring` })
    Logger.info(`${tag} Scheduled with pattern: ${cronPattern}`)
  }

  return { run, schedule }
}

/**
 * A retention sweep (P7-SWEEPERS): the same job over the tenants `listRetentionTenants` admits (every status but the migration ones, none under a
 * legal hold), with every finished run recorded for `privacy.sweepers_scheduled`. Each tenant's eligibility is read again right before its work
 * (`isRetentionEligibleNow`), so a hold placed mid-run stops the sweep for every tenant it has not reached. The HTTP cron twin calls the same
 * `run()`, so both triggers leave the same evidence.
 */
export function defineRetentionSweepJob<R>(spec: Omit<TenantSweepSpec<R>, 'tenants' | 'recordRuns' | 'stillEligible'>): TenantSweepJob {
  return defineTenantSweepJob({ ...spec, tenants: () => listRetentionTenants(), recordRuns: true, stillEligible: (tenantId) => isRetentionEligibleNow(tenantId) })
}
