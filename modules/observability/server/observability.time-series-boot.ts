import { scheduleTimeSeriesRollupJob, setRollupLagHandler } from '@kuraykaraaslan-labs/db/server/db.time-series.job'
import ObservabilityService from './observability.service'

/**
 * Boot task `db-time-series-rollup`: schedules the time-series rollup of `db` and reports a rollup that falls behind.
 *
 * `db` is below `observability` and cannot call it, so the lag handler is wired here, in the module that owns error reporting,
 * instead of in a list of modules at the root.
 */
export async function startTimeSeriesRollup(): Promise<void> {
  setRollupLagHandler(async (a) => {
    ObservabilityService.recordError(
      new Error(`time-series rollup lag: ${a.rollup} tenant ${a.tenantId} lags ${a.lagBuckets} buckets`),
      {
        tenantId: a.tenantId, fingerprint: ['time-series-rollup-lag', a.rollup], level: 'warning',
        extra: { table: a.table, rollup: a.rollup, lagBuckets: a.lagBuckets, lagMs: a.lagMs, threshold: a.threshold, watermark: a.watermark, truncated: a.truncated },
      },
    )
  })
  await scheduleTimeSeriesRollupJob()
}
