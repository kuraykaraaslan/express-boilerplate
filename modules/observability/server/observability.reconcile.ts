/**
 * Daily metering reconciliation (docs/phases/09-observability/16.3 "reconcile daily and alert on divergence").
 *
 * Metering gaps become billing disputes, so once a day, for every tenant, the meters are compared with the raw tables they describe, for the UTC day that
 * has just ended:
 *
 *   probe_runs  the `observability_probe_runs` meter against `monitor_checks` rows (split by check type and location)
 *   alerts      the `observability_alerts_ingested` meter against `alerts` rows created (split by source)
 *   sms_pages   the `observability_sms_pages` meter against `on_call_page_events` DELIVERY_OK on `sms`
 *   voice_pages the `observability_voice_pages` meter against DELIVERY_OK on `voice`
 *
 * The result is stored (`observability_reconciliations`, one row per tenant, day and kind, overwritten by a re-run of the same day), and a divergence beyond
 * the tolerance raises an alert in the ROOT tenant (fingerprint per tenant and kind, resolved by the next clean day) with a runbook. A side that cannot be
 * read is `SKIPPED` and says why: never reported as agreeing.
 *
 * Why divergence happens and is not always a bug: the buffers that aggregate events live in the process that counted, so a crash or a kill loses at most
 * the windows not yet flushed (shutdown flushes them); an hourly meter lag is not possible because windows are stamped with their own start. The tolerance
 * (`max(3, 1%)`) absorbs a lost window of a quiet tenant, not a systematic undercount.
 */
import 'reflect-metadata'
import { withTenantRLS } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { OBSERVABILITY_METERS } from './observability.metering'
import { RUNBOOKS } from './observability.runbooks'

export const RECONCILE_KINDS = ['probe_runs', 'alerts', 'sms_pages', 'voice_pages'] as const
export type ReconcileKind = (typeof RECONCILE_KINDS)[number]
export type ReconcileStatus = 'OK' | 'DIVERGED' | 'SKIPPED'

export const TOLERANCE_ABSOLUTE = 3
export const TOLERANCE_RATIO = 0.01

export interface ReconcileResult {
  tenantId: string
  day: string
  kind: ReconcileKind
  metered: number | null
  actual: number
  difference: number
  status: ReconcileStatus
  detail: Record<string, unknown>
}

export interface ReconcileDeps {
  sql(tenantId: string, text: string, params: unknown[]): Promise<Array<Record<string, unknown>>>
  /** Is the metering module active for this tenant? (false: nothing to compare against) */
  meteringActive(tenantId: string): Promise<boolean>
  /** Days raw checks are kept for this tenant (a day shorter than two cannot be reconciled after the fact). */
  rawCheckDays(tenantId: string): Promise<number>
  /** Active tenant ids. */
  tenants(): Promise<string[]>
  /** Write the pending metering windows of this process first. */
  flush(): Promise<void>
  raise(tenantId: string, kind: ReconcileKind, result: ReconcileResult | null): Promise<void>
}

const num = (v: unknown): number => Number(v ?? 0)

const defaultDeps: ReconcileDeps = {
  sql: (tenantId, text, params) => withTenantRLS(tenantId, async (qr) => (await qr.query(text, params)) as Array<Record<string, unknown>>),
  async meteringActive(tenantId) {
    const { ifActive } = await import('@kuraykaraaslan-labs/common/server/extensions/optional-module')
    return (await ifActive(tenantId, 'metering', async () => true)) === true
  },
  async rawCheckDays(tenantId) {
    const { retentionDays } = await import('./uptime.retention.job')
    return retentionDays(tenantId)
  },
  async tenants() {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    return (await listActiveTenants()).map((t) => t.tenantId)
  },
  async flush() {
    const { flushAllUsage } = await import('./observability.metering')
    await flushAllUsage({ all: true })
  },
  async raise(tenantId, kind, result) {
    const { default: AlertService } = await import('./alert.service')
    const fingerprint = `metering-reconcile:${tenantId}:${kind}`
    if (!result) {
      await AlertService.ingest(ROOT_TENANT_ID, { source: 'extension', sourceRef: 'observability:reconcile', fingerprint, status: 'RESOLVED', severity: 'WARNING', title: 'Metering diverges from the raw data', labels: { alertname: 'MeteringDivergence', tenant: tenantId, kind }, annotations: {} })
      return
    }
    await AlertService.ingest(ROOT_TENANT_ID, {
      source: 'extension', sourceRef: 'observability:reconcile', fingerprint, status: 'FIRING',
      severity: Math.abs(result.difference) > Math.max(10, result.actual * 0.25) ? 'MAJOR' : 'WARNING',
      title: `Metering of ${kind} diverges from the raw data for tenant ${tenantId.slice(0, 8)} on ${result.day}`,
      labels: { alertname: 'MeteringDivergence', tenant: tenantId, kind },
      annotations: { summary: `${kind} on ${result.day}: metered ${result.metered}, raw ${result.actual} (difference ${result.difference}).`, runbook: RUNBOOKS.meteringDivergence },
    })
  },
}

let deps: ReconcileDeps = defaultDeps
/** Test seam. */
export function setReconcileDeps(d?: Partial<ReconcileDeps>): void { deps = d ? { ...deps, ...d } : defaultDeps }

/** `[start, end)` of a UTC day as instants. */
export function dayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00.000Z`)
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

/** The UTC day before `now`. */
export function previousDay(now: Date): string { return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) }

export function classify(metered: number, actual: number): { status: ReconcileStatus; difference: number } {
  const difference = metered - actual
  const tolerance = Math.max(TOLERANCE_ABSOLUTE, Math.ceil(TOLERANCE_RATIO * actual))
  return { status: Math.abs(difference) > tolerance ? 'DIVERGED' : 'OK', difference }
}

async function meteredByDims(tenantId: string, meterKey: string, start: Date, end: Date, dims: string[]): Promise<Array<{ dims: string[]; qty: number }>> {
  const cols = dims.map((d, i) => `COALESCE(metadata->>'${d}', '') AS d${i}`).join(', ')
  const group = dims.map((_, i) => `d${i}`).join(', ')
  const rows = await deps.sql(tenantId,
    `SELECT ${cols ? `${cols}, ` : ''}COALESCE(SUM(quantity), 0)::bigint AS qty FROM metered_usage_events WHERE "tenantId" = $1 AND "meterKey" = $2 AND "occurredAt" >= $3 AND "occurredAt" < $4${group ? ` GROUP BY ${group}` : ''}`,
    [tenantId, meterKey, start, end])
  return rows.map((r) => ({ dims: dims.map((_, i) => String(r[`d${i}`] ?? '')), qty: num(r.qty) }))
}

const sum = (rows: Array<{ qty: number }>) => rows.reduce((a, r) => a + r.qty, 0)
const key = (parts: string[]) => parts.join('|')

/** The split of both sides, only where they differ (the part of the answer a person needs). */
function splitDiff(metered: Array<{ dims: string[]; qty: number }>, actual: Array<{ dims: string[]; qty: number }>): Array<{ key: string; metered: number; actual: number }> {
  const m = new Map(metered.map((r) => [key(r.dims), r.qty]))
  const a = new Map(actual.map((r) => [key(r.dims), r.qty]))
  const out: Array<{ key: string; metered: number; actual: number }> = []
  for (const k of new Set([...m.keys(), ...a.keys()])) if ((m.get(k) ?? 0) !== (a.get(k) ?? 0)) out.push({ key: k, metered: m.get(k) ?? 0, actual: a.get(k) ?? 0 })
  return out.slice(0, 20)
}

async function reconcileKind(tenantId: string, day: string, kind: ReconcileKind): Promise<ReconcileResult | null> {
  const { start, end } = dayBounds(day)
  const skipped = (reason: string, actual = 0): ReconcileResult => ({ tenantId, day, kind, metered: null, actual, difference: 0, status: 'SKIPPED', detail: { reason } })
  if (kind === 'probe_runs') {
    if ((await deps.rawCheckDays(tenantId)) < 2) return skipped('raw_checks_kept_less_than_two_days')
    const raw = (await deps.sql(tenantId,
      `SELECT COALESCE(m.type, 'DELETED') AS d0, COALESCE(c."locationKey", 'local') AS d1, count(*)::int AS qty FROM monitor_checks c LEFT JOIN monitors m ON m."monitorId" = c."monitorId" AND m."tenantId" = c."tenantId" WHERE c."tenantId" = $1 AND c."checkedAt" >= $2 AND c."checkedAt" < $3 GROUP BY 1, 2`,
      [tenantId, start, end])).map((r) => ({ dims: [String(r.d0), String(r.d1)], qty: num(r.qty) }))
    const actual = sum(raw)
    if (!(await deps.meteringActive(tenantId))) return actual === 0 ? null : skipped('metering_not_active', actual)
    const meteredRows = await meteredByDims(tenantId, OBSERVABILITY_METERS.PROBE_RUNS.key, start, end, ['checkType', 'location'])
    const metered = sum(meteredRows)
    if (metered === 0 && actual === 0) return null
    const { status, difference } = classify(metered, actual)
    return { tenantId, day, kind, metered, actual, difference, status, detail: { by: 'checkType|location', differing: splitDiff(meteredRows, raw) } }
  }
  if (kind === 'alerts') {
    const raw = (await deps.sql(tenantId, `SELECT source AS d0, count(*)::int AS qty FROM alerts WHERE "tenantId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 GROUP BY 1`, [tenantId, start, end]))
      .map((r) => ({ dims: [String(r.d0)], qty: num(r.qty) }))
    const actual = sum(raw)
    if (!(await deps.meteringActive(tenantId))) return actual === 0 ? null : skipped('metering_not_active', actual)
    const meteredRows = await meteredByDims(tenantId, OBSERVABILITY_METERS.ALERTS_INGESTED.key, start, end, ['source'])
    const metered = sum(meteredRows)
    if (metered === 0 && actual === 0) return null
    const { status, difference } = classify(metered, actual)
    return { tenantId, day, kind, metered, actual, difference, status, detail: { by: 'source', differing: splitDiff(meteredRows, raw) } }
  }
  // sms_pages / voice_pages: the page events of on_call (an optional module: no table, no answer)
  const channel = kind === 'sms_pages' ? 'sms' : 'voice'
  const meter = kind === 'sms_pages' ? OBSERVABILITY_METERS.SMS_PAGES : OBSERVABILITY_METERS.VOICE_PAGES
  let actual: number
  try {
    const rows = await deps.sql(tenantId, `SELECT count(*)::int AS qty FROM on_call_page_events WHERE "tenantId" = $1 AND type = 'DELIVERY_OK' AND channel = $2 AND "createdAt" >= $3 AND "createdAt" < $4`, [tenantId, channel, start, end])
    actual = num(rows[0]?.qty)
  } catch { return null }
  if (!(await deps.meteringActive(tenantId))) return actual === 0 ? null : skipped('metering_not_active', actual)
  const meteredRows = await meteredByDims(tenantId, meter.key, start, end, [])
  const metered = sum(meteredRows)
  if (metered === 0 && actual === 0) return null
  const { status, difference } = classify(metered, actual)
  return { tenantId, day, kind, metered, actual, difference, status, detail: { channel } }
}

async function store(r: ReconcileResult): Promise<void> {
  await deps.sql(r.tenantId,
    `INSERT INTO observability_reconciliations ("tenantId", day, kind, metered, actual, status, difference, detail) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT ("tenantId", day, kind) DO UPDATE SET metered = EXCLUDED.metered, actual = EXCLUDED.actual, status = EXCLUDED.status, difference = EXCLUDED.difference, detail = EXCLUDED.detail, "createdAt" = now()`,
    [r.tenantId, r.day, r.kind, r.metered, r.actual, r.status, r.difference, JSON.stringify(r.detail)])
}

/** One tenant, one day, every kind. Each kind fails alone. */
export async function reconcileTenantDay(tenantId: string, day: string): Promise<ReconcileResult[]> {
  const out: ReconcileResult[] = []
  for (const kind of RECONCILE_KINDS) {
    try {
      const r = await reconcileKind(tenantId, day, kind)
      if (!r) { await deps.raise(tenantId, kind, null).catch(() => undefined); continue }
      await store(r)
      out.push(r)
      if (r.status === 'DIVERGED') await deps.raise(tenantId, kind, r)
      else if (r.status === 'OK') await deps.raise(tenantId, kind, null)
    } catch (err) {
      Logger.warn(`[observability.reconcile] ${kind} for ${tenantId} on ${day} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

export interface ReconcileSweepSummary { day: string; tenants: number; compared: number; ok: number; diverged: number; skipped: number }

/** The whole platform, for the day before `now`. Shared by the BullMQ worker and the CRON twin route. */
export async function runReconcileSweep(now: Date = new Date(), day: string = previousDay(now)): Promise<ReconcileSweepSummary> {
  await deps.flush().catch(() => undefined)
  const tenantIds = await deps.tenants().catch(() => [] as string[])
  const s: ReconcileSweepSummary = { day, tenants: tenantIds.length, compared: 0, ok: 0, diverged: 0, skipped: 0 }
  for (const tenantId of tenantIds) {
    for (const r of await reconcileTenantDay(tenantId, day)) {
      s.compared += 1
      if (r.status === 'OK') s.ok += 1; else if (r.status === 'DIVERGED') s.diverged += 1; else s.skipped += 1
    }
  }
  Logger.info(`[CronJob:observability-reconcile] day=${day} tenants=${s.tenants} compared=${s.compared} ok=${s.ok} diverged=${s.diverged} skipped=${s.skipped}`)
  return s
}
