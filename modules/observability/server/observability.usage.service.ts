import 'reflect-metadata'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { limitOf } from './observability.limits'
import { getLastSweep } from './uptime.sweep-state'
import { matchesSearch, sortRows, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { USAGE_SORTABLE, type UsageSortField } from './usage.dto'

/**
 * The operator's view of consumption (phase 16.7): per tenant, what it uses, what its plan allows, and who is near a limit. ROOT-plane only (the
 * route enforces it): it reads across tenants on the SYSTEM connection, which is exactly what a tenant-scoped caller must never be able to do.
 *
 * Counts are ONE grouped query per table, not a query per tenant, so the screen costs the same for 20 tenants and 20 000.
 */
export interface Meter { used: number; limit: number | null }
export interface TenantUsageRow {
  tenantId: string
  name: string | null
  monitors: Meter
  slos: Meter
  integrations: Meter
  openAlerts: Meter
  probes24h: number
  telemetryMbToday: Meter
  /** Phase 16 leftovers: the rest of what a plan can size. */
  statusPages: Meter
  subscribers: Meter
  /** Distinct metric series seen today, against the plan's active-series cap (or the safety ceiling's absence: no limit shown). */
  activeSeriesToday: Meter
  logMbToday: Meter
  /** What the cardinality caps dropped or folded today, by reason (`series_tenant_cap`, `series_metric_cap`, `stream_overflow`): the visible outcome of a cap. */
  droppedToday: Record<string, number>
  /** Meters at 80% or more of a finite limit, or over it. */
  nearLimit: string[]
}

export const NEAR_LIMIT_RATIO = 0.8

type Counts = Map<string, number>
export interface UsageSources {
  tenants(): Promise<Array<{ tenantId: string; name: string | null }>>
  counts(table: 'monitors' | 'slos' | 'alert_integrations' | 'open_alerts' | 'probes_24h' | 'status_pages' | 'subscribers'): Promise<Counts>
  telemetryBytesToday(tenantIds: string[]): Promise<Counts>
  /** Optional (a source written before phase 16's leftovers may not have them): today's log bytes, distinct series and cardinality drops per tenant. */
  logBytesToday?(tenantIds: string[]): Promise<Counts>
  seriesToday?(tenantIds: string[]): Promise<Counts>
  dropsToday?(tenantIds: string[]): Promise<Map<string, Record<string, number>>>
  limit(tenantId: string, key: string): Promise<number>
}

const SQL: Record<Parameters<UsageSources['counts']>[0], string> = {
  monitors: `SELECT "tenantId", count(*)::int AS n FROM monitors WHERE "deletedAt" IS NULL GROUP BY "tenantId"`,
  slos: `SELECT "tenantId", count(*)::int AS n FROM slos GROUP BY "tenantId"`,
  alert_integrations: `SELECT "tenantId", count(*)::int AS n FROM alert_integrations GROUP BY "tenantId"`,
  open_alerts: `SELECT "tenantId", count(*)::int AS n FROM alerts WHERE status IN ('FIRING','SUPPRESSED') GROUP BY "tenantId"`,
  status_pages: `SELECT "tenantId", count(*)::int AS n FROM status_pages GROUP BY "tenantId"`,
  subscribers: `SELECT "tenantId", count(*)::int AS n FROM status_subscribers GROUP BY "tenantId"`,
  probes_24h: `SELECT "tenantId", count(*)::int AS n FROM monitor_checks WHERE "checkedAt" > now() - interval '24 hours' GROUP BY "tenantId"`,
}

export const defaultSources: UsageSources = {
  async tenants() {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    return (await listActiveTenants()).map((t) => ({ tenantId: t.tenantId, name: (t as { name?: string | null }).name ?? null }))
  },
  async counts(table) {
    const { withSystemRLS } = await import('@kuraykaraaslan-labs/db')
    const rows = await withSystemRLS((qr) => qr.query(SQL[table])) as Array<{ tenantId: string; n: number }>
    return new Map(rows.map((r) => [r.tenantId, Number(r.n)]))
  },
  async telemetryBytesToday(tenantIds) {
    const out: Counts = new Map()
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      const day = new Date().toISOString().slice(0, 10)
      const values = await redis.mget(tenantIds.map((t) => `obs:telemetry_bytes:${t}:${day}`))
      values.forEach((v, i) => { if (v) out.set(tenantIds[i], Number(v)) })
    } catch { /* counter unavailable: the column reads as zero, the rest of the screen still works */ }
    return out
  },
  async logBytesToday(tenantIds) {
    const out: Counts = new Map()
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      const { redisCall } = await import('./observability.redis-guard')
      const day = new Date().toISOString().slice(0, 10)
      const values = await redisCall(() => redis.mget(tenantIds.map((t) => `obs:telemetry_log_bytes:${t}:${day}`)))
      values.forEach((v, i) => { if (v) out.set(tenantIds[i], Number(v)) })
    } catch { /* counter unavailable: the column reads as zero */ }
    return out
  },
  async seriesToday(tenantIds) {
    const out: Counts = new Map()
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      const { redisCall } = await import('./observability.redis-guard')
      const day = new Date().toISOString().slice(0, 10)
      const p = redis.pipeline()
      tenantIds.forEach((t) => p.scard(`obs:series:${t}:${day}`))
      const res = (await redisCall(() => p.exec())) ?? []
      res.forEach(([, v], i) => { if (Number(v) > 0) out.set(tenantIds[i], Number(v)) })
    } catch { /* counter unavailable */ }
    return out
  },
  async dropsToday(tenantIds) {
    const out = new Map<string, Record<string, number>>()
    const { droppedToday } = await import('./telemetry/telemetry.cardinality')
    await Promise.all(tenantIds.map(async (t) => { const d = await droppedToday(t); if (Object.keys(d).length) out.set(t, d) }))
    return out
  },
  limit: limitOf,
}

const meter = (used: number, limit: number): Meter => ({ used, limit: Number.isFinite(limit) ? limit : null })
const near = (m: Meter) => m.limit !== null && m.limit > 0 ? m.used / m.limit >= NEAR_LIMIT_RATIO : m.limit === 0 && m.used > 0

export async function listTenantUsage(
  opts: {
    limit?: number; offset?: number
    /** A parsed list sort (whitelisted by the route), or one of the older words meaning "most first". */
    sort?: 'probes' | 'monitors' | 'alerts' | 'telemetry' | ListSort<UsageSortField>
    /** Matches the workspace name or id. */
    search?: string
    /** Only workspaces with a meter near or over its limit. */
    nearLimit?: boolean
  } = {}, src: UsageSources = defaultSources,
): Promise<{ rows: TenantUsageRow[]; total: number; nearLimitTenants: number; sweep: ReturnType<typeof getLastSweep> }> {
  const tenants = await src.tenants()
  const ids = tenants.map((t) => t.tenantId)
  const optional = async <T>(fn: (() => Promise<T>) | undefined, empty: T): Promise<T> => { try { return fn ? ((await fn()) ?? empty) : empty } catch { return empty } }
  const [monitors, slos, integrations, openAlerts, probes, telemetry, pages, subscribers, logBytes, series, drops] = await Promise.all([
    src.counts('monitors'), src.counts('slos'), src.counts('alert_integrations'), src.counts('open_alerts'), src.counts('probes_24h'),
    src.telemetryBytesToday(ids),
    optional(() => src.counts('status_pages'), new Map<string, number>()), optional(() => src.counts('subscribers'), new Map<string, number>()),
    optional(src.logBytesToday ? () => src.logBytesToday!(ids) : undefined, new Map<string, number>()),
    optional(src.seriesToday ? () => src.seriesToday!(ids) : undefined, new Map<string, number>()),
    optional(src.dropsToday ? () => src.dropsToday!(ids) : undefined, new Map<string, Record<string, number>>()),
  ])
  const rows: TenantUsageRow[] = await Promise.all(tenants.map(async (t) => {
    const [mLim, sLim, iLim, aLim, tLim, pLim, subLim, serLim, logLim] = await Promise.all([K.MONITORS, K.SLOS, K.ALERT_INTEGRATIONS, K.OPEN_ALERTS, K.TELEMETRY_MB_PER_DAY, K.STATUS_PAGES, K.SUBSCRIBERS, K.ACTIVE_SERIES, K.LOG_MB_PER_DAY].map((k) => src.limit(t.tenantId, k)))
    const row: TenantUsageRow = {
      tenantId: t.tenantId, name: t.name,
      monitors: meter(monitors.get(t.tenantId) ?? 0, mLim), slos: meter(slos.get(t.tenantId) ?? 0, sLim),
      integrations: meter(integrations.get(t.tenantId) ?? 0, iLim), openAlerts: meter(openAlerts.get(t.tenantId) ?? 0, aLim),
      probes24h: probes.get(t.tenantId) ?? 0,
      telemetryMbToday: meter(Math.round(((telemetry.get(t.tenantId) ?? 0) / (1024 * 1024)) * 10) / 10, tLim),
      statusPages: meter(pages.get(t.tenantId) ?? 0, pLim), subscribers: meter(subscribers.get(t.tenantId) ?? 0, subLim),
      activeSeriesToday: meter(series.get(t.tenantId) ?? 0, serLim),
      logMbToday: meter(Math.round(((logBytes.get(t.tenantId) ?? 0) / (1024 * 1024)) * 10) / 10, logLim),
      droppedToday: drops.get(t.tenantId) ?? {},
      nearLimit: [],
    }
    for (const [name, m] of [['monitors', row.monitors], ['slos', row.slos], ['integrations', row.integrations], ['openAlerts', row.openAlerts], ['telemetry', row.telemetryMbToday], ['statusPages', row.statusPages], ['subscribers', row.subscribers], ['activeSeries', row.activeSeriesToday], ['logs', row.logMbToday]] as const) {
      if (near(m)) row.nearLimit.push(name)
    }
    return row
  }))
  const sort: ListSort<UsageSortField> = typeof opts.sort === 'string' || opts.sort === undefined ? [{ field: opts.sort ?? 'probes', dir: 'desc' }] : opts.sort
  // Ties keep the workspace id order, so pages are stable.
  rows.sort((a, b) => a.tenantId.localeCompare(b.tenantId))
  const shown = sortRows(rows, sort, USAGE_SORTABLE)
    .filter((r) => matchesSearch(r, opts.search, ['name', 'tenantId']) && (opts.nearLimit === undefined || (r.nearLimit.length > 0) === opts.nearLimit))
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)
  return { rows: shown.slice(offset, offset + limit), total: shown.length, nearLimitTenants: rows.filter((r) => r.nearLimit.length > 0).length, sweep: getLastSweep() }
}
