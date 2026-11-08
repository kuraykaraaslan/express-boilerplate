import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Incident } from './entities/incident.entity'
import { IncidentParticipant } from './entities/incident_participant.entity'
import { recordIncidentEvent } from './incident.timeline.service'
import type { IncidentRole } from './incident.enums'

/**
 * Roles on an incident (observability phase 14): commander, comms lead, responder, observer. One role per person; at most one commander, and
 * handing the command to someone else moves the previous commander to responder in the same step (and says so on the timeline), so an
 * incident is never without an owner by accident and never has two.
 */
export default class IncidentParticipantService {
  static async list(tenantId: string, incidentId: string): Promise<IncidentParticipant[]> {
    return withTenantRepositoryFor(tenantId, IncidentParticipant, (repo) => repo.find({ where: { tenantId, incidentId }, order: { assignedAt: 'ASC' } }))
  }

  static async assign(tenantId: string, incidentId: string, userId: string, role: IncidentRole, actorId: string | null): Promise<IncidentParticipant> {
    const demoted: string[] = []
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      const incident = await qr.manager.getRepository(Incident).findOne({ where: { tenantId, incidentId } })
      if (!incident) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
      const repo = qr.manager.getRepository(IncidentParticipant)
      if (role === 'COMMANDER') {
        const current = await repo.findOne({ where: { tenantId, incidentId, role: 'COMMANDER' } })
        if (current && current.userId !== userId) {
          await repo.update({ tenantId, participantId: current.participantId }, { role: 'RESPONDER' })
          demoted.push(current.userId)
        }
      }
      const existing = await repo.findOne({ where: { tenantId, incidentId, userId } })
      if (existing) {
        existing.role = role; existing.assignedBy = actorId
        return repo.save(existing)
      }
      return repo.save(repo.create({ tenantId, incidentId, userId, role, assignedBy: actorId }))
    })
    for (const prev of demoted) await recordIncidentEvent(tenantId, incidentId, 'ROLE_ASSIGNED', { actorId, data: { userId: prev, role: 'RESPONDER', reason: 'command handed over' } })
    await recordIncidentEvent(tenantId, incidentId, 'ROLE_ASSIGNED', { actorId, data: { userId, role } })
    return saved
  }

  static async remove(tenantId: string, incidentId: string, userId: string, actorId: string | null): Promise<void> {
    const r = await withTenantRepositoryFor(tenantId, IncidentParticipant, (repo) => repo.delete({ tenantId, incidentId, userId }))
    if (!r.affected) throw new AppError('That person has no role on this incident', 404, ErrorCode.NOT_FOUND)
    await recordIncidentEvent(tenantId, incidentId, 'ROLE_REMOVED', { actorId, data: { userId } })
  }
}
