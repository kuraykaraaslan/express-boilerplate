import 'reflect-metadata'
import { In } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { Slo } from './entities/slo.entity'
import { Monitor } from './entities/monitor.entity'
import { StatusComponent } from './entities/status_component.entity'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'
import {
  BURN_TIERS, budgetStatus, burnRate, evaluateTier, projectedExhaustionDays, tierSeverity,
  type BudgetState, type BudgetStatus, type Counts, type TierEvaluation,
} from './slo.budget'
import { dbSliReader, getMetricSliSource, resolveMonitorIds, type SliReader } from './slo.sli'
import { sloProblem, type CreateSloInput, type UpdateSloInput } from './slo.dto'
import type { AlertSignal } from './alert.ingest.parsers'
import { assertHeadroomFor } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import { assertEditable } from './config/config.managed'

/**
 * SLOs (observability phase 13): CRUD, the evaluation of one SLO against its events, and the minutely pass that turns burn into alerts
 * and budget transitions into webhook events.
 */

const DAY_MS = 86_400_000
const DEFAULT_RETENTION_DAYS = 30

export interface TierReport {
  id: string; action: string; thresholdBurnRate: number; longHours: number; shortHours: number
  longBurn: number | null; shortBurn: number | null; firing: boolean
}

export interface SloReport {
  sloId: string
  name: string
  kind: string
  objectivePercent: number
  windowDays: number
  /** The window actually measured: a latency SLO cannot look back further than raw checks are kept. */
  effectiveWindowDays: number
  limitedByRetention: boolean
  counts: Counts
  budget: BudgetStatus
  /** Burn over the last 6 hours when there is data, otherwise over the whole window. */
  currentBurn: number | null
  projectedExhaustionDays: number | null
  tiers: TierReport[]
  evaluatedAt: Date
}

export interface EvalContext {
  reader: SliReader
  now: Date
  retentionDays: number
  excludeMaintenance: boolean
}

export function utcDay(d: Date): string { return d.toISOString().slice(0, 10) }

export async function loadContext(tenantId: string, reader: SliReader = dbSliReader, now: Date = new Date()): Promise<EvalContext> {
  const values = await SettingService
    .getByKeys(tenantId, [OBSERVABILITY_SETTING_KEYS.UPTIME_CHECK_RETENTION_DAYS, OBSERVABILITY_SETTING_KEYS.EXCLUDE_MAINTENANCE_FROM_UPTIME])
    .catch(() => ({} as Record<string, string>))
  const parsed = parseInt(values[OBSERVABILITY_SETTING_KEYS.UPTIME_CHECK_RETENTION_DAYS] ?? '', 10)
  return {
    reader, now,
    retentionDays: Number.isFinite(parsed) ? Math.min(365, Math.max(2, parsed)) : DEFAULT_RETENTION_DAYS,
    excludeMaintenance: values[OBSERVABILITY_SETTING_KEYS.EXCLUDE_MAINTENANCE_FROM_UPTIME] !== 'false',
  }
}

/** Evaluate one SLO against its events. Pure with respect to the context: the reader and the clock are injected. */
export async function evaluateSlo(tenantId: string, slo: Slo, ctx: EvalContext): Promise<SloReport> {
  const { reader, now } = ctx
  const objective = Number(slo.objectivePercent)
  let windowCounts: Counts = { good: 0, total: 0 }
  let effectiveWindowDays = slo.windowDays
  let limitedByRetention = false
  let countsIn: (hours: number) => Promise<Counts>

  if (slo.kind === 'METRIC_RATIO') {
    const source = getMetricSliSource()
    const spec = slo.metricSpec
    if (source && spec) {
      windowCounts = (await source.ratio(spec, slo.windowDays * 86_400, now)) ?? { good: 0, total: 0 }
      countsIn = async (hours) => (await source.ratio(spec, Math.round(hours * 3600), now)) ?? { good: 0, total: 0 }
    } else {
      countsIn = async () => ({ good: 0, total: 0 })
    }
  } else {
    const monitorIds = await resolveMonitorIds(tenantId, slo)
    const from = (hours: number) => new Date(now.getTime() - hours * 3_600_000)
    if (slo.kind === 'MONITOR_LATENCY') {
      const threshold = slo.latencyThresholdMs ?? 0
      effectiveWindowDays = Math.min(slo.windowDays, ctx.retentionDays)
      limitedByRetention = effectiveWindowDays < slo.windowDays
      windowCounts = await reader.latency(tenantId, monitorIds, from(effectiveWindowDays * 24), now, threshold, ctx.excludeMaintenance)
      countsIn = (hours) => reader.latency(tenantId, monitorIds, from(hours), now, threshold, ctx.excludeMaintenance)
    } else {
      windowCounts = await reader.availabilityDaily(tenantId, monitorIds, utcDay(new Date(now.getTime() - (slo.windowDays - 1) * DAY_MS)))
      countsIn = (hours) => reader.availability(tenantId, monitorIds, from(hours), now, ctx.excludeMaintenance)
    }
  }

  const budget = budgetStatus(windowCounts, objective, slo.lowBudgetPercent)
  const tiers: TierReport[] = []
  for (const tier of BURN_TIERS) {
    const [longCounts, shortCounts] = await Promise.all([countsIn(tier.longHours), countsIn(tier.shortHours)])
    const e: TierEvaluation = evaluateTier(tier, longCounts, shortCounts, objective, slo.windowDays)
    tiers.push({ id: tier.id, action: tier.action, thresholdBurnRate: e.thresholdBurnRate, longHours: tier.longHours, shortHours: tier.shortHours, longBurn: e.longBurn, shortBurn: e.shortBurn, firing: e.firing })
  }
  const recent = await countsIn(6)
  const currentBurn = burnRate(recent, objective) ?? burnRate(windowCounts, objective)
  return {
    sloId: slo.sloId, name: slo.name, kind: slo.kind, objectivePercent: objective, windowDays: slo.windowDays,
    effectiveWindowDays, limitedByRetention, counts: windowCounts, budget, currentBurn,
    projectedExhaustionDays: projectedExhaustionDays(currentBurn, budget.remainingFraction, slo.windowDays),
    tiers, evaluatedAt: now,
  }
}

/** The alert a firing tier raises, and the same identity with status RESOLVED when it stops. */
export function burnSignal(slo: Pick<Slo, 'sloId' | 'name' | 'componentId' | 'objectivePercent' | 'windowDays'>, t: TierReport, status: 'FIRING' | 'RESOLVED'): AlertSignal {
  const tier = BURN_TIERS.find((x) => x.id === t.id) ?? BURN_TIERS[0]
  const fmt = (n: number | null) => (n === null ? 'n/a' : Number.isFinite(n) ? n.toFixed(1) : '∞')
  return {
    source: 'slo', sourceRef: slo.sloId, status, severity: tierSeverity(tier),
    title: `${slo.name}: error budget burning ${fmt(t.longBurn)}x faster than allowed`.slice(0, 300),
    fingerprint: `slo:${slo.sloId}:${t.id}`,
    labels: {
      alertname: 'SloBurn', slo: slo.name.slice(0, 200), sloId: slo.sloId, tier: t.id, action: t.action,
      entity: [`slo:${slo.sloId}`, ...(slo.componentId ? [`component:${slo.componentId}`] : [])].join(','),
    },
    annotations: {
      summary: `${fmt(t.longBurn)}x over ${t.longHours >= 1 ? `${t.longHours}h` : `${Math.round(t.longHours * 60)}m`} and ${fmt(t.shortBurn)}x over ${t.shortHours >= 1 ? `${t.shortHours}h` : `${Math.round(t.shortHours * 60)}m`}`
        + ` (fires at ${t.thresholdBurnRate.toFixed(1)}x); objective ${slo.objectivePercent}% over ${slo.windowDays} days`,
    },
  }
}

const WORSE: Record<string, number> = { OK: 0, NO_DATA: 0, LOW: 1, EXHAUSTED: 2 }

/** Did the budget just get worse than where it stood? Only that fires an event; recovering is silent. */
export function budgetEvent(previous: string | null | undefined, now: BudgetState): 'slo.budget_low' | 'slo.budget_exhausted' | null {
  if (now !== 'LOW' && now !== 'EXHAUSTED') return null
  if ((WORSE[now] ?? 0) <= (WORSE[previous ?? 'OK'] ?? 0)) return null
  return now === 'EXHAUSTED' ? 'slo.budget_exhausted' : 'slo.budget_low'
}

export default class SloService {
  static async list(tenantId: string): Promise<Slo[]> {
    return withTenantRepositoryFor(tenantId, Slo, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' }, take: 200 }))
  }

  static async getById(tenantId: string, sloId: string): Promise<Slo> {
    const row = await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.findOne({ where: { tenantId, sloId } }))
    if (!row) throw new AppError('SLO not found', 404, ErrorCode.NOT_FOUND)
    return row
  }

  /** Everything that must be true of the rows an SLO points at, in THIS tenant. */
  private static async validate(tenantId: string, s: { kind: string; monitorIds?: string[]; componentId?: string | null; latencyThresholdMs?: number | null; metricSpec?: unknown }): Promise<void> {
    const problem = sloProblem(s)
    if (problem) throw new AppError(problem, 400, ErrorCode.VALIDATION_ERROR)
    // Tenants never submit raw metric queries: they would read other tenants' series. Only the platform plane may.
    if (s.kind === 'METRIC_RATIO' && tenantId !== ROOT_TENANT_ID) throw new AppError('Metric-based SLOs are available on the platform workspace only', 403, ErrorCode.FORBIDDEN)
    if (s.monitorIds?.length) {
      const found = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId, monitorId: In(s.monitorIds as string[]) } }))
      if (found !== new Set(s.monitorIds).size) throw new AppError('One of the monitors does not exist', 400, ErrorCode.VALIDATION_ERROR)
    }
    if (s.componentId) {
      const c = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.count({ where: { tenantId, componentId: s.componentId as string } }))
      if (!c) throw new AppError('The status component does not exist', 400, ErrorCode.VALIDATION_ERROR)
    }
  }

  static async create(tenantId: string, input: CreateSloInput, ownerUserId: string | null = null, managed?: { managedBy: string; sourceKey: string | null }): Promise<Slo> {
    await SloService.validate(tenantId, input)
    await assertHeadroomFor(tenantId, OBSERVABILITY_LIMIT_KEYS.SLOS, 'SLOs', () => withTenantRepositoryFor(tenantId, Slo, (repo) => repo.count({ where: { tenantId } })))
    return withTenantRepositoryFor(tenantId, Slo, (repo) => repo.save(repo.create({
      tenantId, name: input.name, description: input.description ?? null, kind: input.kind, objectivePercent: input.objectivePercent,
      windowDays: input.windowDays, monitorIds: input.monitorIds, componentId: input.componentId ?? null,
      latencyThresholdMs: input.latencyThresholdMs ?? null, metricSpec: input.metricSpec ?? null, lowBudgetPercent: input.lowBudgetPercent,
      burnAlerts: input.burnAlerts, isActive: input.isActive, ownerUserId, lastState: null,
      ...(managed ? { managedBy: managed.managedBy, sourceKey: managed.sourceKey } : {}),
    })))
  }

  static async update(tenantId: string, sloId: string, input: UpdateSloInput): Promise<Slo> {
    const row = await SloService.getById(tenantId, sloId)
    assertEditable(row, 'SLO')
    const merged = { ...row, ...input }
    await SloService.validate(tenantId, merged)
    Object.assign(row, input)
    // Changing what is measured resets the remembered state, so the next evaluation announces honestly instead of comparing with a different SLO.
    if (input.kind !== undefined || input.monitorIds !== undefined || input.componentId !== undefined || input.objectivePercent !== undefined || input.windowDays !== undefined) row.lastState = null
    return withTenantRepositoryFor(tenantId, Slo, (repo) => repo.save(row))
  }

  static async remove(tenantId: string, sloId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.findOne({ where: { tenantId, sloId } })), 'SLO')
    const r = await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.delete({ tenantId, sloId }))
    if (!r.affected) throw new AppError('SLO not found', 404, ErrorCode.NOT_FOUND)
    // Its burn alerts are no longer anyone's: resolve them with it. Their identity is the sender fingerprint, which does not depend on labels.
    const { default: AlertService } = await import('./alert.service')
    for (const tier of BURN_TIERS) {
      await AlertService.ingest(tenantId, {
        source: 'slo', sourceRef: sloId, status: 'RESOLVED', severity: 'WARNING', title: 'SLO deleted', labels: {}, annotations: {}, fingerprint: `slo:${sloId}:${tier.id}`,
      }).catch(() => {})
    }
  }

  static async report(tenantId: string, sloId: string, reader: SliReader = dbSliReader): Promise<SloReport> {
    const slo = await SloService.getById(tenantId, sloId)
    return evaluateSlo(tenantId, slo, await loadContext(tenantId, reader))
  }

  /** A report for every SLO, for the list screen. One SLO that cannot be evaluated does not blank the rest. */
  static async reports(tenantId: string, reader: SliReader = dbSliReader): Promise<Array<{ slo: Slo; report: SloReport | null }>> {
    const ctx = await loadContext(tenantId, reader)
    const slos = await SloService.list(tenantId)
    return Promise.all(slos.map(async (slo) => {
      try { return { slo, report: await evaluateSlo(tenantId, slo, ctx) } } catch (err) {
        Logger.warn(`[slo] could not evaluate ${slo.sloId}: ${err instanceof Error ? err.message : String(err)}`)
        return { slo, report: null }
      }
    }))
  }

  static async dailySeries(tenantId: string, sloId: string, reader: SliReader = dbSliReader): Promise<Array<{ day: string; sli: number | null; good: number; total: number }>> {
    const slo = await SloService.getById(tenantId, sloId)
    if (slo.kind === 'METRIC_RATIO') return []
    const monitorIds = await resolveMonitorIds(tenantId, slo)
    const since = utcDay(new Date(Date.now() - (slo.windowDays - 1) * DAY_MS))
    return (await reader.dailySeries(tenantId, monitorIds, since)).map((d) => ({ ...d, sli: d.total > 0 ? d.good / d.total : null }))
  }
}

/**
 * The minutely pass for one tenant: evaluate every active SLO, raise or resolve one alert per burn tier, and fire a webhook event when the
 * budget gets worse. One SLO that fails to evaluate is logged and skipped; the rest still run. Returns what happened, for the sweep log and tests.
 */
export async function evaluateTenantSlos(tenantId: string, reader: SliReader = dbSliReader, now: Date = new Date()): Promise<{ evaluated: number; raised: number; resolved: number; events: number }> {
  const out = { evaluated: 0, raised: 0, resolved: 0, events: 0 }
  const slos = await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.find({ where: { tenantId, isActive: true }, take: 200 }))
  if (slos.length === 0) return out
  const ctx = await loadContext(tenantId, reader, now)
  const { default: AlertService } = await import('./alert.service')
  for (const slo of slos) {
    try {
      const report = await evaluateSlo(tenantId, slo, ctx)
      out.evaluated += 1
      for (const t of report.tiers) {
        if (t.firing && slo.burnAlerts) { await AlertService.ingest(tenantId, burnSignal(slo, t, 'FIRING')); out.raised += 1 }
        else { const r = await AlertService.ingest(tenantId, burnSignal(slo, t, 'RESOLVED')); if (r) out.resolved += 1 }
      }
      const event = budgetEvent(slo.lastState, report.budget.state)
      if (event) {
        try {
          const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service')
          await WebhookService.dispatchEvent(tenantId, event, {
            sloId: slo.sloId, name: slo.name, objectivePercent: Number(slo.objectivePercent), windowDays: slo.windowDays,
            sli: report.budget.sli, remainingFraction: report.budget.remainingFraction, state: report.budget.state,
          })
          out.events += 1
        } catch (err) { Logger.warn(`[slo] ${event} not delivered for ${slo.sloId}: ${err instanceof Error ? err.message : String(err)}`) }
      }
      if (slo.lastState !== report.budget.state) {
        await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.update({ tenantId, sloId: slo.sloId }, { lastState: report.budget.state, lastEvaluatedAt: now }))
      } else {
        await withTenantRepositoryFor(tenantId, Slo, (repo) => repo.update({ tenantId, sloId: slo.sloId }, { lastEvaluatedAt: now }))
      }
    } catch (err) {
      Logger.warn(`[slo] evaluation failed tenant=${tenantId} slo=${slo.sloId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}
