import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheck } from './entities/monitor_check.entity'

export interface UptimeSummary {
  samples: number
  up: number
  degraded: number
  down: number
  /** (up + degraded) / samples · 100 — DEGRADED counts as available. `null` when no samples: an unmeasured window is not a good one (as `probe.stats` and `sla.report`). */
  uptimePercent: number | null
}

export default class UptimeService {
  static async uptime(
    tenantId: string, monitorId: string, range: { from: Date; to: Date },
  ): Promise<UptimeSummary> {
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.monitorId = :monitorId', { monitorId })
      .andWhere('c.checkedAt BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string }>())

    let up = 0, degraded = 0, down = 0
    for (const r of rows) {
      const n = parseInt(r.count, 10)
      if (r.status === 'UP') up += n
      else if (r.status === 'DEGRADED') degraded += n
      else if (r.status === 'DOWN') down += n
    }
    const samples = up + degraded + down
    const uptimePercent = samples === 0 ? null : Math.round(((up + degraded) / samples) * 10000) / 100
    return { samples, up, degraded, down, uptimePercent }
  }
}
