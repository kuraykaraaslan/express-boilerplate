import 'reflect-metadata'
import { z } from 'zod'
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Incident } from './entities/incident.entity'

/**
 * A legal hold on one incident (observability phase 16.4): while it is set, no retention sweep deletes the incident, its timeline, its post-mortem or the
 * alerts linked to it. Setting it needs a reason (somebody answered for it), releasing it clears the reason, and both are audited with the actor. The
 * workspace-wide hold is a setting (`observabilityLegalHold`), not this.
 */
export const LegalHoldDTO = z.object({
  held: z.boolean(),
  /** Required when `held` is true. */
  reason: z.string().trim().min(3).max(500).optional(),
}).strict().refine((v) => !v.held || !!v.reason, { message: 'a reason is required to put an incident on legal hold', path: ['reason'] })
export type LegalHoldInput = z.infer<typeof LegalHoldDTO>

async function audit(tenantId: string, actorId: string | null, incidentId: string, held: boolean, reason: string | null): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    await AuditLogService.log({
      tenantId, ...(actorId ? { actorId } : {}), actorType: 'USER', action: held ? 'observability.incident.legal_hold_set' : 'observability.incident.legal_hold_released',
      resourceType: 'incident', resourceId: incidentId, metadata: { held, ...(reason ? { reason } : {}) },
    })
  } catch { /* best effort, like every operator action: the change has happened */ }
}

export default class IncidentLegalHoldService {
  static async set(tenantId: string, incidentId: string, actorId: string | null, input: unknown): Promise<Incident> {
    const dto = LegalHoldDTO.parse(input)
    const row = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Incident)
      const incident = await repo.findOne({ where: { tenantId, incidentId }, lock: { mode: 'pessimistic_write' } })
      if (!incident) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
      if (dto.held) {
        incident.legalHold = true; incident.legalHoldReason = dto.reason ?? null; incident.legalHoldAt = new Date(); incident.legalHoldBy = actorId
      } else {
        incident.legalHold = false; incident.legalHoldReason = null; incident.legalHoldAt = null; incident.legalHoldBy = null
      }
      return repo.save(incident)
    })
    await audit(tenantId, actorId, incidentId, dto.held, dto.reason ?? null)
    return row
  }
}
