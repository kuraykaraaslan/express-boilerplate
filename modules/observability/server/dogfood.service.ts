import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { Slo } from './entities/slo.entity'
import { ensureCronMonitor, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import SloService from './slo.service'

/**
 * The ROOT tenant runs the platform's own monitoring on the platform (observability phase 22, dogfooding): its cron jobs as heartbeats, its processes in the
 * dependency graph (both from `cron.heartbeat.ts`), and an SLO over those jobs. `ensureRootDogfood()` makes the parts that are DATA exist, idempotently, so a release
 * can be run on top of them for a cycle before any tenant is offered a phase. The parts that are people's decisions (the on-call rotation, which status page to
 * publish) are reported, never invented.
 */
export const DOGFOOD_SLO_NAME = 'Platform jobs run on time'

export interface DogfoodReport {
  cronMonitors: string[]
  slo: 'created' | 'exists' | 'skipped'
  /** What a person still has to do. */
  todo: string[]
}

export async function ensureRootDogfood(): Promise<DogfoodReport> {
  const monitorIds: string[] = []
  const cronMonitors: string[] = []
  for (const spec of Object.values(PLATFORM_CRON_JOBS)) {
    const m = await ensureCronMonitor(spec)
    if (m) { monitorIds.push(m.monitorId); cronMonitors.push(spec.name) }
  }
  let slo: DogfoodReport['slo'] = 'skipped'
  if (monitorIds.length > 0) {
    const existing = await withTenantRepositoryFor(ROOT_TENANT_ID, Slo, (repo) => repo.count({ where: { tenantId: ROOT_TENANT_ID, name: DOGFOOD_SLO_NAME } }))
    if (existing) slo = 'exists'
    else {
      await SloService.create(ROOT_TENANT_ID, {
        name: DOGFOOD_SLO_NAME, description: 'Every platform cron job reports within its interval and grace. Burn alerts page the ROOT on-call.',
        kind: 'MONITOR_AVAILABILITY', objectivePercent: 99.5, windowDays: 30, monitorIds, lowBudgetPercent: 25, burnAlerts: true, isActive: true,
      })
      slo = 'created'
    }
  }
  return {
    cronMonitors, slo,
    todo: [
      'Create an on-call schedule and an escalation policy in the ROOT tenant, and route CRITICAL and MAJOR alerts to it (Alerts, routes).',
      'Set the ROOT tenant setting observabilityWatchdogUrl to a dead-man\'s-switch endpoint outside the platform.',
      'Decide which components the public status page shows and publish it (the page is disabled by default on purpose).',
      'Run one release cycle on top of this before offering a phase to any other tenant.',
    ],
  }
}
