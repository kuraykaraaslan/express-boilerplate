import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import ObservabilityService from './observability.service'
import { RUNBOOKS } from './observability.runbooks'
import type { AlertSignal } from './alert.ingest.parsers'

/**
 * BullMQ queue health (observability phase 19.7): depth, the age of the oldest waiting job and the failure ratio, per queue, as Prometheus gauges and as
 * default alerts. Evaluated by the minutely alert sweep of the ROOT tenant; queues are DISCOVERED from Redis (`bull:<name>:meta`), so a queue a module adds is
 * watched without registering it anywhere.
 *
 *  - BACKLOG: the oldest waiting job has waited longer than `maxOldestWaitingSeconds` (default 300). A deep queue that is being drained is healthy; an old
 *    job that nothing picks up is not, so age is judged, not depth.
 *  - FAILING: at least `minFailed` jobs failed AND failures are more than `maxFailedRatio` of failed + completed (default 10 and 25%). A single failed job is
 *    noise; the retention of BullMQ's completed/failed sets means the ratio is over the recent window, which is what an alert wants.
 *
 * The gauges are plain series (`queue_waiting_jobs`, `queue_oldest_waiting_seconds`, `queue_failed_ratio`, label `queue`), so a metric SLO (phase 13, METRIC_RATIO)
 * can be defined on them once a Prometheus backend is configured.
 */
export interface QueueStats { name: string; waiting: number; failed: number; completed: number; oldestWaitingAgeSeconds: number | null }
export interface QueueThresholds { maxOldestWaitingSeconds: number; minFailed: number; maxFailedRatio: number }
export const DEFAULT_QUEUE_THRESHOLDS: QueueThresholds = { maxOldestWaitingSeconds: 300, minFailed: 10, maxFailedRatio: 0.25 }

export function failedRatio(s: Pick<QueueStats, 'failed' | 'completed'>): number {
  const total = s.failed + s.completed
  return total === 0 ? 0 : s.failed / total
}

export type QueueVerdict = { backlog: boolean; failing: boolean }
export function judgeQueue(s: QueueStats, t: QueueThresholds = DEFAULT_QUEUE_THRESHOLDS): QueueVerdict {
  return {
    backlog: s.oldestWaitingAgeSeconds !== null && s.oldestWaitingAgeSeconds > t.maxOldestWaitingSeconds,
    failing: s.failed >= t.minFailed && failedRatio(s) > t.maxFailedRatio,
  }
}

export function queueAlertSignal(s: QueueStats, kind: 'backlog' | 'failing', status: 'FIRING' | 'RESOLVED'): AlertSignal {
  const entity = `queue:${s.name}`
  const title = kind === 'backlog'
    ? `Queue "${s.name}" has a job waiting ${s.oldestWaitingAgeSeconds ?? 0}s with nothing picking it up`
    : `Queue "${s.name}" is failing ${Math.round(failedRatio(s) * 100)}% of its jobs (${s.failed} failed)`
  return {
    source: 'process', sourceRef: s.name, status, severity: kind === 'backlog' ? 'MAJOR' : 'MINOR', title: title.slice(0, 300),
    fingerprint: `queue:${kind}:${s.name}`,
    labels: { alertname: kind === 'backlog' ? 'QueueBacklog' : 'QueueFailing', queue: s.name, entity },
    annotations: { summary: title, waiting: String(s.waiting), failed: String(s.failed), completed: String(s.completed), runbook: kind === 'backlog' ? RUNBOOKS.alertStorm : RUNBOOKS.platformJobs },
  }
}

export interface QueueHealthDeps {
  /** Every queue that exists, with its current numbers. */
  read(): Promise<QueueStats[]>
  ingest(signal: AlertSignal): Promise<unknown>
  now(): number
}

const gauges = {
  waiting: ObservabilityService.gauge({ name: 'queue_waiting_jobs', help: 'Jobs waiting in a BullMQ queue', labelNames: ['queue'] }),
  oldest: ObservabilityService.gauge({ name: 'queue_oldest_waiting_seconds', help: 'Age of the oldest waiting job in a BullMQ queue', labelNames: ['queue'] }),
  ratio: ObservabilityService.gauge({ name: 'queue_failed_ratio', help: 'Failed share of failed plus completed jobs in a BullMQ queue', labelNames: ['queue'] }),
}

/** Queues that already have a firing alert from this process, so a RESOLVED is sent once, on the transition (the pipeline treats a spare RESOLVED as a no-op anyway). */
const firing = new Set<string>()
export function resetQueueHealthState(): void { firing.clear() }

export async function evaluateQueues(deps: QueueHealthDeps, t: QueueThresholds = DEFAULT_QUEUE_THRESHOLDS): Promise<{ queues: number; firing: string[] }> {
  const stats = await deps.read()
  const now: string[] = []
  for (const s of stats) {
    try {
      gauges.waiting.set({ queue: s.name }, s.waiting)
      if (s.oldestWaitingAgeSeconds !== null) gauges.oldest.set({ queue: s.name }, s.oldestWaitingAgeSeconds)
      gauges.ratio.set({ queue: s.name }, failedRatio(s))
    } catch { /* telemetry must not stop the alerts */ }
    const v = judgeQueue(s, t)
    for (const kind of ['backlog', 'failing'] as const) {
      const id = `${kind}:${s.name}`
      const bad = kind === 'backlog' ? v.backlog : v.failing
      if (bad) { now.push(id); firing.add(id); await deps.ingest(queueAlertSignal(s, kind, 'FIRING')) }
      else if (firing.delete(id)) await deps.ingest(queueAlertSignal(s, kind, 'RESOLVED'))
    }
  }
  return { queues: stats.length, firing: now }
}

/** Redis-backed reader: discovers queues by their meta key and reads counts and the oldest waiting job. */
export async function readQueuesFromRedis(max = 200): Promise<QueueStats[]> {
  const { Queue } = await import('bullmq')
  const { getBullMQConnection } = await import('@kuraykaraaslan-labs/redis/server/redis.bullmq')
  const { discoverQueueNames } = await import('./queue.failed')
  const out: QueueStats[] = []
  for (const name of await discoverQueueNames(max)) {
    const q = new Queue(name, { connection: getBullMQConnection() })
    try {
      const counts = await q.getJobCounts('waiting', 'failed', 'completed')
      const [oldest] = await q.getWaiting(0, 0).catch(() => [])
      out.push({
        name, waiting: counts.waiting ?? 0, failed: counts.failed ?? 0, completed: counts.completed ?? 0,
        oldestWaitingAgeSeconds: oldest?.timestamp ? Math.max(0, Math.round((Date.now() - oldest.timestamp) / 1000)) : null,
      })
    } catch (err) {
      Logger.debug?.(`[queue.health] ${name}: ${err instanceof Error ? err.message : String(err)}`)
    } finally { await q.close().catch(() => {}) }
  }
  return out
}

/** The minutely pass: ROOT only (queues are platform infrastructure), best-effort. */
export async function evaluateQueuesNow(tenantId: string): Promise<void> {
  if (tenantId !== ROOT_TENANT_ID) return
  const { default: AlertService } = await import('./alert.service')
  await evaluateQueues({ read: () => readQueuesFromRedis(), ingest: (s) => AlertService.ingest(ROOT_TENANT_ID, s), now: Date.now })
}
