import 'reflect-metadata'
import type { ObjectLiteral, Repository } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { Monitor } from '../entities/monitor.entity'
import { Slo } from '../entities/slo.entity'
import { AlertRoute } from '../entities/alert_route.entity'
import { AlertIntegration } from '../entities/alert_integration.entity'
import { AlertDependency } from '../entities/alert_dependency.entity'
import { AlertSilenceTemplate } from '../entities/alert_silence_template.entity'
import { IncidentUpdateTemplate } from '../entities/incident_update_template.entity'
import StatusComponentService from '../status.component.service'
import { CONFIG_KINDS, MANAGED_BY_CODE, keyOfSource, type ConfigKind } from './config.kinds'
import type { LiveSnapshot } from './config.plan'

/** Reads the live rows a plan needs (observability phase 21). Every query carries the tenant; the connection is the tenant's own. */

const LIMIT = 2000
type EntityClass = abstract new (...args: never[]) => object
type R = Record<string, unknown>

/** The monitors and components other kinds point at are loaded whenever one of those kinds is planned, so references can be turned into keys. */
function needed(kinds: readonly ConfigKind[]): Set<ConfigKind> {
  const set = new Set<ConfigKind>(kinds)
  if (set.has('slos') || set.has('dependencies') || set.has('components')) { set.add('monitors'); set.add('components') }
  return set
}

export async function loadSnapshot(tenantId: string, kinds: readonly ConfigKind[] = CONFIG_KINDS): Promise<LiveSnapshot> {
  const want = needed(kinds)
  const snap: LiveSnapshot = {}
  const find = (entity: EntityClass, order: Record<string, 'ASC' | 'DESC'>) =>
    withTenantRepositoryFor(tenantId, entity as never, (repo: Repository<ObjectLiteral>) => repo.find({ where: { tenantId }, order, take: LIMIT } as never)) as unknown as Promise<R[]>
  if (want.has('monitors')) snap.monitors = await find(Monitor, { createdAt: 'ASC' })
  if (want.has('components')) snap.components = (await StatusComponentService.list(tenantId)) as unknown as R[]
  if (want.has('slos')) snap.slos = await find(Slo, { createdAt: 'ASC' })
  if (want.has('silenceTemplates')) snap.silenceTemplates = await find(AlertSilenceTemplate, { createdAt: 'ASC' })
  if (want.has('integrations')) snap.integrations = await find(AlertIntegration, { createdAt: 'ASC' })
  if (want.has('routes')) snap.routes = await find(AlertRoute, { position: 'ASC' })
  if (want.has('dependencies')) snap.dependencies = await find(AlertDependency, { createdAt: 'ASC' })
  if (want.has('incidentTemplates')) snap.incidentTemplates = await find(IncidentUpdateTemplate, { status: 'ASC' })
  return snap
}

/** Keys of the code-managed monitors and components that exist live: what a document may refer to without defining them. */
export function managedKeys(snap: LiveSnapshot, kind: 'monitors' | 'components'): Set<string> {
  return new Set((snap[kind] ?? []).flatMap((r) => (r.managedBy === MANAGED_BY_CODE ? [keyOfSource(r.sourceKey as string | null)].filter((k): k is string => k !== null) : [])))
}
