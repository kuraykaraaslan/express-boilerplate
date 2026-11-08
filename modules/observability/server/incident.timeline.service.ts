import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { IncidentEvent } from './entities/incident_event.entity'
import { INCIDENT_EVENT_TYPES, type IncidentEventType } from './incident.enums'

/**
 * The incident timeline (observability phase 14). Append-only and best-effort: recording what happened must never be the reason the thing
 * that happened fails, so every failure here is logged and swallowed. Event detail is small and bounded; free text lives in `comments`.
 */

const MAX_STRING = 300
const MAX_KEYS = 12
const MAX_BYTES = 2000

/** A short, JSON-safe detail object: scalar values only, strings cut, at most a dozen keys, at most 2 KB. Anything larger is dropped whole. */
export function boundedEventData(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data).slice(0, MAX_KEYS)) {
    if (k === '__proto__') continue
    if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, MAX_STRING)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k.slice(0, 40)] = v
  }
  return JSON.stringify(out).length > MAX_BYTES ? null : out
}

export async function recordIncidentEvent(
  tenantId: string, incidentId: string, type: IncidentEventType, opts: { actorId?: string | null; data?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    if (!INCIDENT_EVENT_TYPES.includes(type)) return
    await withTenantRepositoryFor(tenantId, IncidentEvent, (repo) => repo.save(repo.create({
      tenantId, incidentId, type, actorId: opts.actorId ?? null, data: boundedEventData(opts.data),
    })))
  } catch (err) {
    Logger.warn(`[incident.timeline] could not record ${type} for ${incidentId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function listIncidentEvents(tenantId: string, incidentId: string, limit = 500): Promise<IncidentEvent[]> {
  return withTenantRepositoryFor(tenantId, IncidentEvent, (repo) => repo.find({
    where: { tenantId, incidentId }, order: { createdAt: 'ASC' }, take: Math.min(1000, Math.max(1, limit)),
  }))
}
