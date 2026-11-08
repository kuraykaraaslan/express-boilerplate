import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { Monitor } from './entities/monitor.entity'
import { AlertDependency } from './entities/alert_dependency.entity'
import MonitorService from './uptime.monitor.service'

/**
 * The platform's own cron jobs as heartbeat monitors of the ROOT tenant (observability phase 19.7, the dogfood item of 09.3).
 *
 * `cronRun(spec, body)` wraps a job's body: the first run creates the job's heartbeat monitor (owned by observability through `sourceKey`), a successful run
 * records a ping, a thrown error records a failure and is rethrown. A job that stops running is then caught by the ordinary heartbeat verdict (silence for longer
 * than its interval plus grace), with the ordinary alert, incident and status plumbing and nothing special-cased.
 *
 *  - The monitor depends on `process:worker` in the dependency graph: if the worker process is down, every cron job goes silent, and that is ONE alert (the
 *    process) with the jobs' alerts suppressed under it, not a page per job (phase 19.2).
 *  - An operator who deletes a job's monitor opts that job out: the soft-deleted row keeps its `sourceKey`, and nothing resurrects it.
 *  - Best-effort: a failure to record never fails the job, and a job never waits on this beyond two small queries.
 */
export interface CronJobSpec { name: string; everySeconds: number }

export const PLATFORM_CRON_JOBS = {
  probe: { name: 'uptime-probe', everySeconds: 60 },
  alertDispatch: { name: 'alert-dispatch', everySeconds: 60 },
  processCheck: { name: 'process-check', everySeconds: 60 },
  retention: { name: 'uptime-retention', everySeconds: 86_400 },
  reconcile: { name: 'metering-reconcile', everySeconds: 86_400 },
} as const satisfies Record<string, CronJobSpec>

/** The graph node a cron job's silence is explained by. */
export const CRON_PARENT_ENTITY = 'process:worker'

const sourceKeyOf = (name: string) => `observability:cron-${name}`
const known = new Map<string, { monitor: Monitor | null; at: number }>()
const REMEMBER_MS = 10 * 60_000

/** The job's monitor, created on first use; null when an operator deleted it (opted out). */
export async function ensureCronMonitor(spec: CronJobSpec, now: number = Date.now()): Promise<Monitor | null> {
  const hit = known.get(spec.name)
  if (hit && now - hit.at < REMEMBER_MS) return hit.monitor
  const sourceKey = sourceKeyOf(spec.name)
  const monitor = await withTenantRepositoryFor(ROOT_TENANT_ID, Monitor, async (repo) => {
    const existing = await repo.findOne({ where: { tenantId: ROOT_TENANT_ID, sourceKey }, withDeleted: true })
    if (existing) return existing.deletedAt ? null : existing
    return repo.save(repo.create({
      tenantId: ROOT_TENANT_ID, name: `Cron: ${spec.name}`, type: 'HEARTBEAT', target: 'heartbeat', sourceKey, groupName: 'Platform jobs',
      intervalSeconds: spec.everySeconds, timeoutMs: 10_000, consecutiveFailThreshold: 1,
      heartbeatGraceSeconds: Math.min(3600, Math.max(60, Math.round(spec.everySeconds * 0.5))), isActive: true,
      lastStatus: 'UNKNOWN', consecutiveFailures: 0, consecutiveSuccesses: 0,
    }))
  })
  if (monitor) {
    await withTenantRepositoryFor(ROOT_TENANT_ID, AlertDependency, async (repo) => {
      const child = `monitor:${monitor.monitorId}`
      if (!(await repo.count({ where: { tenantId: ROOT_TENANT_ID, child, parent: CRON_PARENT_ENTITY } }))) {
        await repo.save(repo.create({ tenantId: ROOT_TENANT_ID, child, parent: CRON_PARENT_ENTITY }))
      }
    }).catch(() => {})
  }
  known.set(spec.name, { monitor, at: now })
  return monitor
}

/** Test seam. */
export function resetCronMonitorCache(): void { known.clear() }

export async function cronRun<T>(spec: CronJobSpec, body: () => Promise<T>): Promise<T> {
  const monitor = await ensureCronMonitor(spec).catch((err) => {
    Logger.debug?.(`[cron.heartbeat] ${spec.name}: no monitor (${err instanceof Error ? err.message : String(err)})`)
    return null
  })
  try {
    const result = await body()
    if (monitor) await MonitorService.applyHeartbeat(ROOT_TENANT_ID, monitor, 'ping').catch(() => {})
    return result
  } catch (err) {
    if (monitor) await MonitorService.applyHeartbeat(ROOT_TENANT_ID, monitor, 'fail').catch(() => {})
    throw err
  }
}
