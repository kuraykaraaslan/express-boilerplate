import 'reflect-metadata'
import { z } from 'zod'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { StatusAutomation } from './entities/status_automation.entity'
import { StatusComponent } from './entities/status_component.entity'
import { Incident } from './entities/incident.entity'
import IncidentService from './incident.service'
import { renderTemplate } from './incident.templates'
import { IncidentSeverityEnum } from './uptime.enums'

/**
 * Monitor-driven auto-post and auto-resolve (observability phase 15.10).
 *
 * A component whose status gets worse than a threshold drafts an incident from the component's own wording; when it is OPERATIONAL again
 * the draft is resolved. Two rules keep the machine from speaking for the tenant:
 *
 *  - The draft is PRIVATE. It becomes public only when its template carries `autoPublish`, and turning that on takes the
 *    `observability.status.publish` permission (checked by the route that writes the template), the permission that already guards
 *    publishing an incident. With it off a person publishes the draft through the ordinary incident flow, or never.
 *  - A person already on it wins. If a PUBLIC incident for the component is open, nothing is drafted: two voices on one outage is worse than none.
 *
 * Wording uses the closed placeholder set of the incident update templates (`{{title}}` is the component's name here, `{{components}}`,
 * `{{severity}}`), replaced as plain text. One draft per component at a time: the incident's alert-group key is `status-auto:<component>`, so the
 * same open-incident machinery that deduplicates alert groups deduplicates these.
 */

export const AUTOMATION_GROUP_PREFIX = 'status-auto:'
export const AUTOMATION_MIN_STATUS = ['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'] as const
const RANK: Record<string, number> = { OPERATIONAL: 0, MAINTENANCE: 0, DEGRADED: 1, PARTIAL_OUTAGE: 2, MAJOR_OUTAGE: 3 }

export const UpsertAutomationDTO = z.object({
  componentId: z.string().uuid(),
  enabled: z.boolean().default(true),
  minStatus: z.enum(AUTOMATION_MIN_STATUS).default('PARTIAL_OUTAGE'),
  postTitle: z.string().trim().min(1).max(300),
  postMessage: z.string().trim().min(1).max(2000),
  resolveMessage: z.string().trim().max(2000).nullish(),
  severity: IncidentSeverityEnum.default('MAJOR'),
  autoResolve: z.boolean().default(true),
  /** False unless a person who may publish says otherwise. */
  autoPublish: z.boolean().default(false),
})
export type UpsertAutomationInput = z.infer<typeof UpsertAutomationDTO>

/** Whether a status is bad enough for a template with this threshold. MAINTENANCE and OPERATIONAL never are. */
export function reachesThreshold(status: string, minStatus: string): boolean {
  const r = RANK[status] ?? 0
  return r > 0 && r >= (RANK[minStatus] ?? 2)
}

export default class StatusAutomationService {
  static async list(tenantId: string): Promise<StatusAutomation[]> {
    return withTenantRepositoryFor(tenantId, StatusAutomation, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } }))
  }

  /** Create or replace the template of a component (one per component). The component must be this tenant's. */
  static async upsert(tenantId: string, input: UpsertAutomationInput): Promise<StatusAutomation> {
    const owned = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.count({ where: { tenantId, componentId: input.componentId } }))
    if (owned === 0) throw new AppError('Component not found', 404, ErrorCode.NOT_FOUND)
    return withTenantRepositoryFor(tenantId, StatusAutomation, async (repo) => {
      const fields = {
        enabled: input.enabled, minStatus: input.minStatus, postTitle: input.postTitle, postMessage: input.postMessage,
        resolveMessage: input.resolveMessage || null, severity: input.severity, autoResolve: input.autoResolve, autoPublish: input.autoPublish,
      }
      const existing = await repo.findOne({ where: { tenantId, componentId: input.componentId } })
      if (existing) {
        await repo.update({ tenantId, automationId: existing.automationId }, fields)
        return { ...existing, ...fields } as StatusAutomation
      }
      return repo.save(repo.create({ tenantId, componentId: input.componentId, ...fields }))
    })
  }

  static async remove(tenantId: string, automationId: string): Promise<void> {
    const r = await withTenantRepositoryFor(tenantId, StatusAutomation, (repo) => repo.delete({ tenantId, automationId }))
    if (!r.affected) throw new AppError('Automation not found', 404, ErrorCode.NOT_FOUND)
  }

  /**
   * React to a component's status having changed. Idempotent: calling it again for the same state draws no second draft and resolves
   * nothing twice. Never throws: a failed automation must not fail the probe that moved the component.
   */
  static async onComponentChanged(tenantId: string, componentId: string): Promise<void> {
    try {
      const [tpl, comp] = await Promise.all([
        withTenantRepositoryFor(tenantId, StatusAutomation, (repo) => repo.findOne({ where: { tenantId, componentId } })),
        withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.findOne({ where: { tenantId, componentId } })),
      ])
      if (!tpl || !tpl.enabled || !comp) return
      const groupKey = `${AUTOMATION_GROUP_PREFIX}${componentId}`
      const open = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, alertGroupKey: groupKey, status: 'OPEN' } }))

      if (comp.status === 'OPERATIONAL') {
        if (open && tpl.autoResolve) await StatusAutomationService.resolve(tenantId, open, tpl, comp.name)
        return
      }
      if (!reachesThreshold(comp.status, tpl.minStatus) || open) return
      if (await StatusAutomationService.humanIsOnIt(tenantId, componentId)) return

      const vars = { title: comp.name, components: [comp.name], severity: tpl.severity }
      const created = await IncidentService.openIncident(tenantId, {
        alertGroupKey: groupKey, title: renderTemplate(tpl.postTitle, vars).slice(0, 300), isAuto: true, severity: tpl.severity,
        reason: `Component "${comp.name}" reached ${comp.status}`,
      })
      // A PRIVATE draft unless the template was explicitly allowed to publish; either way the public wording is written so it is ready.
      await IncidentService.updateIncident(tenantId, created.incidentId, {
        publicMessage: renderTemplate(tpl.postMessage, vars), affectedComponentIds: [componentId], isPublic: tpl.autoPublish === true,
      })
    } catch (err) {
      Logger.warn(`[observability] status automation failed for component ${componentId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Is a person already running a PUBLIC incident that names this component? */
  private static async humanIsOnIt(tenantId: string, componentId: string): Promise<boolean> {
    const open = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({ where: { tenantId, status: 'OPEN', isPublic: true } }))
    return open.some((i) => (i.affectedComponentIds ?? []).includes(componentId))
  }

  private static async resolve(tenantId: string, incident: Incident, tpl: StatusAutomation, name: string): Promise<void> {
    if (incident.isPublic && tpl.resolveMessage) {
      // The update both writes the closing words and resolves, so subscribers hear it once.
      await IncidentService.addUpdate(tenantId, incident.incidentId, {
        status: 'RESOLVED', publicMessage: renderTemplate(tpl.resolveMessage, { title: name, components: [name], severity: tpl.severity }),
      })
      return
    }
    await IncidentService.resolveAutoById(tenantId, incident.incidentId, 'Component recovered')
  }
}
