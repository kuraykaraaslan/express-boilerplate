/**
 * Retention tiers for everything observability keeps beyond raw checks (docs/phases/09-observability/16.4): resolved alerts, resolved incidents with their
 * post-mortems, daily rollups and the reconciliation history. One daily pass per tenant, run by the retention job.
 *
 * The rules, each a test:
 *  - A tenant's own setting says how long, a PLAN may shorten it and never lengthen it (`capRetention`), and every number is clamped to a floor so a
 *    typo cannot wipe a week of history.
 *  - An OPEN alert is never pruned. An incident that is not RESOLVED, an incident under a legal hold and every alert linked to one of those are never
 *    pruned, and neither is anything while the WORKSPACE is under a legal hold (the setting `observabilityLegalHold`, or the fleet directory's hold when
 *    that module is installed). A hold that cannot be read is treated as NO hold only for the setting (a missing setting is "off"); an unreadable
 *    directory fails open like every governance read, because the alternative (keeping everything forever on a read error) is its own failure.
 *  - Rollups stay: with no tenant setting and no plan cap they are kept for good, and a configured number has a floor of one year. A workspace hold covers
 *    them too. (Raw checks are pruned by the existing check retention, which a hold does not change: they are working data, the rollups are the record.)
 *  - Deletes are bounded (batches, a cap of batches per run) so one tenant's backlog cannot hold the sweep; the next day continues.
 */
import 'reflect-metadata'
import { withTenantRLS } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { capRetention, limitOf } from './observability.limits'
import { OBSERVABILITY_SETTING_KEYS as S } from './observability.setting.keys'
import { tenantHome } from './observability.home'
import { loadIncidentNotes } from './incident.integrations'
import { INCIDENT_NOTE_SUBJECT } from './incident.integration.types'

export type RetentionTier = 'alerts' | 'incidents' | 'rollups'

interface TierSpec { setting: string; limitKey: string; defaultDays: number | null; minDays: number; maxDays: number }
export const TIERS: Record<RetentionTier, TierSpec> = {
  alerts: { setting: S.ALERT_RETENTION_DAYS, limitKey: K.ALERT_RETENTION_DAYS, defaultDays: 180, minDays: 7, maxDays: 3650 },
  incidents: { setting: S.INCIDENT_RETENTION_DAYS, limitKey: K.INCIDENT_RETENTION_DAYS, defaultDays: 730, minDays: 90, maxDays: 3650 },
  rollups: { setting: S.ROLLUP_RETENTION_DAYS, limitKey: K.ROLLUP_RETENTION_DAYS, defaultDays: null, minDays: 365, maxDays: 3650 },
}
export const RECONCILIATION_KEEP_DAYS = 90
export const BATCH = 2_000
export const MAX_BATCHES_PER_RUN = 25

export interface RetentionReaders {
  setting(tenantId: string, key: string): Promise<string | null>
  /** The fleet directory's legal hold for the tenant, `null` when that module cannot say. */
  directoryHold(tenantId: string): Promise<boolean | null>
  /** Run one SQL statement for the tenant under its row-level-security scope. */
  sql(tenantId: string, text: string, params: unknown[]): Promise<Array<Record<string, unknown>>>
}

const defaultReaders: RetentionReaders = {
  async setting(tenantId, key) {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')
    return SettingService.getValue(tenantId, key)
  },
  async directoryHold(tenantId) {
    // The `observability:tenant_home` contributors (fleet_directory's routing record carries the hold); null = nobody can say.
    const home = await tenantHome(tenantId)
    return home ? home.legalHold : null
  },
  sql: (tenantId, text, params) => withTenantRLS(tenantId, async (qr) => (await qr.query(text, params)) as Array<Record<string, unknown>>),
}

let readers: RetentionReaders = defaultReaders
/** Test seam. */
export function setRetentionReaders(r?: Partial<RetentionReaders>): void { readers = r ? { ...defaultReaders, ...r } : defaultReaders }

/**
 * Days to keep a tier for this tenant, or `null` for "for good". The setting is clamped to the tier's floor and ceiling, then capped by the plan; a
 * plan cap below the floor wins (the operator said so explicitly), and a plan cap on a tier with no setting applies even to the default.
 */
export async function tierDays(tenantId: string, tier: RetentionTier): Promise<number | null> {
  const spec = TIERS[tier]
  let own: number | null = spec.defaultDays
  try {
    const raw = await readers.setting(tenantId, spec.setting)
    if (raw != null && raw.trim() !== '') {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n)) own = Math.min(spec.maxDays, Math.max(spec.minDays, n))
    }
  } catch { /* settings unavailable: the default */ }
  const plan = await limitOf(tenantId, spec.limitKey)
  if (own === null) return Number.isFinite(plan) ? Math.max(1, Math.floor(plan)) : null
  return capRetention(own, plan)
}

export type HoldSource = 'setting' | 'fleet_directory'
/** Is the whole workspace under a legal hold, and by whom? */
export async function workspaceHold(tenantId: string): Promise<{ held: boolean; source?: HoldSource }> {
  try {
    const v = await readers.setting(tenantId, S.LEGAL_HOLD)
    if (v && /^(true|1|yes|on)$/i.test(v.trim())) return { held: true, source: 'setting' }
  } catch { /* unreadable setting: not held by the setting */ }
  if ((await readers.directoryHold(tenantId)) === true) return { held: true, source: 'fleet_directory' }
  return { held: false }
}

const OPEN_OR_HELD = `(i."legalHold" OR i.status <> 'RESOLVED')`

/** Resolved alerts past their retention that are not linked to an incident that is open or held. Returns the number deleted. */
export async function pruneAlerts(tenantId: string, cutoff: Date): Promise<number> {
  let total = 0
  for (let b = 0; b < MAX_BATCHES_PER_RUN; b += 1) {
    const rows = await readers.sql(tenantId, `
      WITH victims AS (
        SELECT a."alertId" FROM alerts a
        WHERE a."tenantId" = $1 AND a.status = 'RESOLVED' AND a."lastFiredAt" < $2
          AND (a."incidentId" IS NULL OR NOT EXISTS (SELECT 1 FROM incidents i WHERE i."tenantId" = $1 AND i."incidentId" = a."incidentId" AND ${OPEN_OR_HELD}))
        ORDER BY a."lastFiredAt" LIMIT $3)
      DELETE FROM alerts WHERE "tenantId" = $1 AND "alertId" IN (SELECT "alertId" FROM victims) RETURNING "alertId"`, [tenantId, cutoff, BATCH])
    total += rows.length
    if (rows.length < BATCH) break
  }
  return total
}

/**
 * Resolved, unheld incidents past their retention, with everything that belongs to them (timeline, participants, post-mortem, updates, AI notes), and the
 * link on any alert that still points at them. One statement per batch, so an incident is never half-deleted.
 */
export async function pruneIncidents(tenantId: string, cutoff: Date): Promise<number> {
  let total = 0
  for (let b = 0; b < MAX_BATCHES_PER_RUN; b += 1) {
    const rows = await readers.sql(tenantId, `
      WITH victims AS (
        SELECT i."incidentId" FROM incidents i
        WHERE i."tenantId" = $1 AND i.status = 'RESOLVED' AND NOT i."legalHold" AND i."resolvedAt" IS NOT NULL AND i."resolvedAt" < $2
        ORDER BY i."resolvedAt" LIMIT $3),
      e AS (DELETE FROM incident_events WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims)),
      p AS (DELETE FROM incident_participants WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims)),
      m AS (DELETE FROM incident_postmortems WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims)),
      u AS (DELETE FROM incident_updates WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims)),
      n AS (DELETE FROM incident_ai_notes WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims)),
      a AS (UPDATE alerts SET "incidentId" = NULL WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims))
      DELETE FROM incidents WHERE "tenantId" = $1 AND "incidentId" IN (SELECT "incidentId" FROM victims) RETURNING "incidentId"`, [tenantId, cutoff, BATCH])
    total += rows.length
    await dropIncidentNotes(tenantId, rows.map((r) => String(r.incidentId)))
    if (rows.length < BATCH) break
  }
  return total
}

/** Internal notes live behind `observability:incident-notes` (the `comments` module, subject type `INCIDENT`); best-effort, only when a module active for the tenant provides it. */
async function dropIncidentNotes(tenantId: string, incidentIds: string[]): Promise<void> {
  if (incidentIds.length === 0) return
  try {
    const notes = await loadIncidentNotes(tenantId)
    await notes?.deleteForSubjects(tenantId, { subjectType: INCIDENT_NOTE_SUBJECT, subjectIds: incidentIds.slice(0, 200) })
  } catch (err) {
    Logger.debug?.(`[observability.retention] incident notes not removed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function pruneRollups(tenantId: string, cutoff: Date): Promise<number> {
  const rows = await readers.sql(tenantId, `DELETE FROM monitor_check_daily WHERE "tenantId" = $1 AND day < $2::date RETURNING 1`, [tenantId, cutoff.toISOString().slice(0, 10)])
  return rows.length
}

export async function pruneReconciliations(tenantId: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RECONCILIATION_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rows = await readers.sql(tenantId, `DELETE FROM observability_reconciliations WHERE "tenantId" = $1 AND day < $2::date RETURNING 1`, [tenantId, cutoff])
  return rows.length
}

export interface TenantRetentionResult {
  held: boolean
  holdSource?: HoldSource
  alerts: number
  incidents: number
  rollups: number
  reconciliations: number
  /** Days applied per tier (`null` = for good), for the log line and the operator. */
  days: Record<RetentionTier, number | null>
}

/** One tenant's pass. Each tier fails alone: a statement that errors is logged and the next tier still runs. */
export async function runTenantRetention(tenantId: string, now: Date = new Date()): Promise<TenantRetentionResult> {
  const hold = await workspaceHold(tenantId)
  const days = { alerts: await tierDays(tenantId, 'alerts'), incidents: await tierDays(tenantId, 'incidents'), rollups: await tierDays(tenantId, 'rollups') }
  const out: TenantRetentionResult = { held: hold.held, ...(hold.source ? { holdSource: hold.source } : {}), alerts: 0, incidents: 0, rollups: 0, reconciliations: 0, days }
  const cut = (d: number) => new Date(now.getTime() - d * 86_400_000)
  const guarded = async (name: string, fn: () => Promise<number>): Promise<number> => {
    try { return await fn() } catch (err) { Logger.warn(`[observability.retention] ${name} failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`); return 0 }
  }
  if (!hold.held) {
    if (days.alerts !== null) out.alerts = await guarded('alerts', () => pruneAlerts(tenantId, cut(days.alerts as number)))
    if (days.incidents !== null) out.incidents = await guarded('incidents', () => pruneIncidents(tenantId, cut(days.incidents as number)))
    if (days.rollups !== null) out.rollups = await guarded('rollups', () => pruneRollups(tenantId, cut(days.rollups as number)))
  }
  out.reconciliations = await guarded('reconciliations', () => pruneReconciliations(tenantId, now))
  return out
}
