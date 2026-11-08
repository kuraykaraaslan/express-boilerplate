import 'reflect-metadata'
import { In } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Monitor } from './entities/monitor.entity'
import MonitorService from './uptime.monitor.service'
import { generateHeartbeatToken, hashHeartbeatToken } from './uptime.heartbeat'
import { parseMonitorImport, type ImportReport } from './uptime.monitor.import'
import { assertMonitorAllowed, assertHeadroomFor } from './observability.limits'
import { assertBrowserChecksEnabled, assertBrowserHeadroom } from './observability.browser.gate'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import type { BulkMonitorInput, ImportMonitorsInput } from './uptime.dto'

/** Operations on many monitors, or on one monitor as a template (observability phase 09.7). Every query carries the tenant. */

export async function bulkMonitors(tenantId: string, input: BulkMonitorInput): Promise<{ affected: number }> {
  const { ids, action, until } = input
  if (action === 'maintenance' && !until) throw new AppError('A maintenance window needs an end time', 400, ErrorCode.VALIDATION_ERROR)
  const where = { tenantId, monitorId: In(ids) }
  // Deleting, pausing for good and resuming change a monitor's definition (`isActive`), which a code-managed monitor takes from its file.
  // Pause-until and maintenance windows are state and stay open to hand.
  if (action === 'delete' || action === 'resume' || (action === 'pause' && !until)) {
    const managed = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { ...where, managedBy: 'code' } }))
    if (managed > 0) throw new AppError(`${managed} of the selected monitors are managed from code: change the file and apply it, or detach them first`, 409, ErrorCode.CONFLICT)
  }
  const result = await withTenantRepositoryFor(tenantId, Monitor, (repo) => {
    switch (action) {
      case 'pause': return until ? repo.update(where, { pausedUntil: until }) : repo.update(where, { isActive: false })
      case 'resume': return repo.update(where, { isActive: true, pausedUntil: null })
      case 'delete': return repo.softDelete(where)
      case 'maintenance': return repo.update(where, { maintenanceUntil: until })
      case 'clear-maintenance': return repo.update(where, { maintenanceUntil: null })
    }
  })
  return { affected: result.affected ?? 0 }
}

/** A copy that starts fresh: new identity, no history, UNKNOWN status. A heartbeat clone gets its own token, returned once. */
export async function cloneMonitor(tenantId: string, monitorId: string): Promise<{ monitor: Monitor; heartbeatToken?: string }> {
  const src = await MonitorService.getById(tenantId, monitorId)
  if (src.sourceKey) throw new AppError('A provider-managed monitor cannot be cloned', 409, ErrorCode.CONFLICT)
  await assertMonitorAllowed(
    tenantId, { type: src.type, intervalSeconds: src.intervalSeconds, stepsCount: Array.isArray(src.steps) ? src.steps.length : undefined },
    { adding: 1, count: () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId } })) },
  )
  // A BROWSER monitor is a copy of an expensive thing: the same switches and count as creating one.
  if (src.type === 'BROWSER') {
    await assertBrowserChecksEnabled(tenantId)
    await assertBrowserHeadroom(tenantId, () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId, type: 'BROWSER' } })))
  }
  const token = src.type === 'HEARTBEAT' ? generateHeartbeatToken() : null
  const copy = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.save(repo.create({
    tenantId, name: `${src.name} (copy)`.slice(0, 200), type: src.type, target: src.target,
    intervalSeconds: src.intervalSeconds, timeoutMs: src.timeoutMs, expectedStatus: src.expectedStatus,
    expectedBodyContains: src.expectedBodyContains, degradedLatencyMs: src.degradedLatencyMs, headers: src.headers,
    consecutiveFailThreshold: src.consecutiveFailThreshold, isActive: src.isActive, assertions: src.assertions,
    certWarnDays: src.certWarnDays, certCriticalDays: src.certCriticalDays, heartbeatGraceSeconds: src.heartbeatGraceSeconds,
    steps: src.steps, browser: src.browser, secrets: src.secrets, locations: src.locations, quorum: src.quorum, latencyBaselineFactor: src.latencyBaselineFactor, groupName: src.groupName, tags: src.tags,
    lastStatus: 'UNKNOWN', consecutiveFailures: 0, consecutiveSuccesses: 0,
    ...(token ? { heartbeatTokenHash: hashHeartbeatToken(token) } : {}),
  })))
  return { monitor: copy, ...(token ? { heartbeatToken: token } : {}) }
}

export interface ImportResult extends ImportReport {
  dryRun: boolean
  created: number
  /**
   * Heartbeat tokens created by this import, shown once, keyed by monitor name. Names are not unique: a second monitor
   * of the same name is keyed `name (2)`, and so on, so no token is lost (23-ui-fixes 1.20).
   */
  heartbeatTokens: Record<string, string>
}

function uniqueKey(taken: Record<string, string>, name: string): string {
  if (!(name in taken)) return name
  let n = 2
  while (`${name} (${n})` in taken) n += 1
  return `${name} (${n})`
}

/** Parse, validate and (unless a dry run, or any row is invalid) create. All-or-nothing: a partly valid file writes nothing. */
export async function importMonitors(tenantId: string, input: ImportMonitorsInput): Promise<ImportResult> {
  const report = parseMonitorImport(input.format, input.content)
  const result: ImportResult = { ...report, dryRun: input.dryRun, created: 0, heartbeatTokens: {} }
  if (input.dryRun || report.errors.length > 0) return result
  // The whole file against the plan BEFORE the first row is written: an import is all-or-nothing, so it must not stop half way at the limit.
  await assertHeadroomFor(tenantId, OBSERVABILITY_LIMIT_KEYS.MONITORS, 'monitors',
    () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId } })), report.valid.length)
  // Browser checks: the workspace switch and the browser-monitor count are judged for the whole file first, for the same reason.
  const browsers = report.valid.filter((m) => m.type === 'BROWSER').length
  if (browsers > 0) {
    await assertBrowserChecksEnabled(tenantId)
    await assertBrowserHeadroom(tenantId, () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId, type: 'BROWSER' } })), browsers)
  }
  for (const m of report.valid) {
    await assertMonitorAllowed(tenantId, { type: m.type ?? 'HTTP', intervalSeconds: m.intervalSeconds, stepsCount: m.steps?.length })
  }
  for (const m of report.valid) {
    const created = await MonitorService.create(tenantId, { ...m, target: m.target ?? (m.type === 'HEARTBEAT' ? 'heartbeat' : 'steps') })
    if (created.heartbeatToken) result.heartbeatTokens[uniqueKey(result.heartbeatTokens, created.name)] = created.heartbeatToken
    result.created += 1
  }
  return result
}
