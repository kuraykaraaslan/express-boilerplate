import 'reflect-metadata'
import { Between } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { observabilityChangeEventLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.change-event'
import { CHANGE_EVENT_POINT, type ChangeEventProvider, type ChangeEventSpec } from './incident.change.types'

/**
 * "What changed before this broke?" (observability phase 14): the changes in the hour before an incident started, and during it, from every
 * module that reports changes through `observability:change-event` plus the audit log. The most useful single question in an investigation,
 * and one the incident view can answer without anyone being paged to go and look.
 */

export const DEFAULT_LOOKBACK_MINUTES = 60
const MAX_LOOKBACK_MINUTES = 24 * 60
const MAX_CHANGES = 100
const KINDS = new Set(['deploy', 'config', 'module', 'flag', 'access', 'other'])

export interface ChangeEvent { at: string; kind: ChangeEventSpec['kind']; title: string; actor: string | null; ref: string | null; source: string }

/** Audit actions that describe a CHANGE a person or the platform made, as opposed to every event the log records. */
const AUDIT_CHANGE_PREFIXES: ReadonlyArray<[prefix: string, kind: ChangeEventSpec['kind']]> = [
  ['marketplace.', 'module'], ['module_lifecycle.', 'module'], ['feature_flag', 'flag'], ['setting', 'config'], ['tenant.', 'config'],
  ['dashboard.board.import', 'config'], ['release', 'deploy'], ['deploy', 'deploy'],
]

export function auditChangeKind(action: string): ChangeEventSpec['kind'] | null {
  const a = action.toLowerCase()
  return AUDIT_CHANGE_PREFIXES.find(([p]) => a.startsWith(p))?.[1] ?? null
}

function toEvent(spec: ChangeEventSpec, source: string): ChangeEvent | null {
  const at = new Date(spec.at)
  if (Number.isNaN(at.getTime()) || typeof spec.title !== 'string' || spec.title.length === 0) return null
  return {
    at: at.toISOString(), kind: KINDS.has(spec.kind) ? spec.kind : 'other', title: spec.title.slice(0, 200),
    actor: spec.actor ? String(spec.actor).slice(0, 100) : null, ref: spec.ref ? String(spec.ref).slice(0, 200) : null, source,
  }
}

/** The window an incident's changes are looked for in: `lookbackMinutes` before it started, until it resolved (or now). */
export function changeWindow(incident: { startedAt: Date; resolvedAt?: Date | null }, now: Date, lookbackMinutes = DEFAULT_LOOKBACK_MINUTES): { from: Date; to: Date } {
  const look = Math.min(MAX_LOOKBACK_MINUTES, Math.max(1, lookbackMinutes))
  return { from: new Date(new Date(incident.startedAt).getTime() - look * 60_000), to: incident.resolvedAt ? new Date(incident.resolvedAt) : now }
}

async function auditChanges(tenantId: string, from: Date, to: Date): Promise<ChangeEvent[]> {
  try {
    const { AuditLog } = await import('@kuraykaraaslan-labs/audit_log/server/entities/audit_log.entity')
    const rows = await withTenantRepositoryFor(tenantId, AuditLog, (repo) => repo.find({ where: { tenantId, createdAt: Between(from, to) }, order: { createdAt: 'DESC' }, take: 500 }))
    const out: ChangeEvent[] = []
    for (const r of rows) {
      const kind = auditChangeKind(r.action)
      if (!kind) continue
      const e = toEvent({ at: r.createdAt, kind, title: r.action, ref: r.resourceType ? `${r.resourceType}${r.resourceId ? `:${r.resourceId}` : ''}` : undefined }, 'audit_log')
      if (e) out.push(e)
    }
    return out
  } catch (err) {
    Logger.debug?.(`[incident.changes] audit log unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export async function changesBetween(tenantId: string, from: Date, to: Date): Promise<ChangeEvent[]> {
  const events: ChangeEvent[] = []
  try {
    const { results } = await ext.aggregate<ChangeEventProvider, ChangeEventSpec[]>(
      CHANGE_EVENT_POINT, tenantCtx(tenantId), observabilityChangeEventLoaders,
      async (provider) => {
        const specs = await provider.listChanges(tenantId, from, to)
        if (!Array.isArray(specs)) throw new Error('listChanges did not answer a list')
        return specs.slice(0, 200)
      },
    )
    for (const { contribution, value } of results) for (const spec of value) { const e = toEvent(spec, contribution.moduleId); if (e) events.push(e) }
  } catch (err) {
    Logger.warn(`[incident.changes] providers failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  events.push(...await auditChanges(tenantId, from, to))
  return events
    .filter((e) => { const t = new Date(e.at).getTime(); return t >= from.getTime() && t <= to.getTime() })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_CHANGES)
}
