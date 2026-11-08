import 'reflect-metadata'
import { MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { Incident } from './entities/incident.entity'
import { Alert } from './entities/alert.entity'
import { computeIncidentAnalytics, type IncidentAnalytics } from './incident.analytics'

export const MAX_ANALYTICS_DAYS = 365

/** The numbers over the last `days` days: incidents started in the window, and the alerts raised in it. */
export async function incidentAnalytics(tenantId: string, days: number, now: Date = new Date()): Promise<IncidentAnalytics & { days: number }> {
  const window = Math.min(MAX_ANALYTICS_DAYS, Math.max(1, Math.floor(days) || 30))
  const since = new Date(now.getTime() - window * 86_400_000)
  const [incidents, alertCount] = await Promise.all([
    withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({ where: { tenantId, startedAt: MoreThanOrEqual(since) }, order: { startedAt: 'ASC' }, take: 5000 })),
    withTenantRepositoryFor(tenantId, Alert, (repo) => repo.count({ where: { tenantId, startsAt: MoreThanOrEqual(since) } })),
  ])
  return { ...computeIncidentAnalytics(incidents, alertCount), days: window }
}
