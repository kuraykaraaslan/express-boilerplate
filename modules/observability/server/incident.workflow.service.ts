import 'reflect-metadata'
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Incident } from './entities/incident.entity'
import { recordIncidentEvent } from './incident.timeline.service'
import { emitIncidentWebhook } from './incident.webhook'
import { publishStatusChanged } from './status.realtime'
import { loadIncidentNotes, loadIncidentTasks } from './incident.integrations'
import { INCIDENT_NOTE_SUBJECT } from './incident.integration.types'

export { INCIDENT_NOTE_SUBJECT }

/**
 * The response workflow on top of the incident record (observability phase 14): acknowledge, mitigate, notes, follow-up tasks. Notes are
 * `comments` records and tasks are `tasks` records, both optional modules that contribute to `observability:incident-notes` and
 * `observability:incident-tasks` (this module is Core and does not import them): an installation without them still has the timeline, the roles
 * and the post-mortem, and a missing module is a clear 409, never a silent no-op.
 */

async function lockedIncident(qr: { manager: { getRepository: <T>(e: new () => T) => { findOne: (o: unknown) => Promise<T | null> } } }, tenantId: string, incidentId: string): Promise<Incident> {
  const row = await qr.manager.getRepository(Incident).findOne({ where: { tenantId, incidentId }, lock: { mode: 'pessimistic_write' } })
  if (!row) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
  return row
}

export default class IncidentWorkflowService {
  /** The first acknowledgement stands; later ones are quiet no-ops (who saw it first is a fact). Resolved incidents cannot be acknowledged. */
  static async acknowledge(tenantId: string, incidentId: string, userId: string | null): Promise<Incident> {
    const { row, first } = await withTenantTransactionFor(tenantId, async (qr) => {
      const incident = await lockedIncident(qr as never, tenantId, incidentId)
      if (incident.status === 'RESOLVED') throw new AppError('A resolved incident cannot be acknowledged', 409, ErrorCode.CONFLICT)
      if (incident.acknowledgedAt) return { row: incident, first: false }
      incident.acknowledgedAt = new Date(); incident.acknowledgedBy = userId
      return { row: await qr.manager.getRepository(Incident).save(incident), first: true }
    })
    if (first) {
      await recordIncidentEvent(tenantId, incidentId, 'ACKNOWLEDGED', { actorId: userId })
      emitIncidentWebhook(tenantId, 'incident.updated', row, { change: 'acknowledged' })
    }
    return row
  }

  /** Mark the impact as stopped while the incident stays open (a fix is out and being watched). */
  static async mitigate(tenantId: string, incidentId: string, userId: string | null): Promise<Incident> {
    const { row, first } = await withTenantTransactionFor(tenantId, async (qr) => {
      const incident = await lockedIncident(qr as never, tenantId, incidentId)
      if (incident.status === 'RESOLVED') throw new AppError('A resolved incident is already closed', 409, ErrorCode.CONFLICT)
      if (incident.mitigatedAt) return { row: incident, first: false }
      incident.mitigatedAt = new Date()
      return { row: await qr.manager.getRepository(Incident).save(incident), first: true }
    })
    if (first) {
      await recordIncidentEvent(tenantId, incidentId, 'MITIGATED', { actorId: userId })
      emitIncidentWebhook(tenantId, 'incident.updated', row, { change: 'mitigated' })
      void publishStatusChanged(tenantId)
    }
    return row
  }

  private static async requireIncident(tenantId: string, incidentId: string): Promise<void> {
    await withTenantTransactionFor(tenantId, (qr) => lockedIncident(qr as never, tenantId, incidentId).then(() => undefined))
  }

  /** A note is a `comments` record on the incident. Internal only: nothing here reaches the status page. */
  /** `authorName` names the writer when there is no user (an api key): the comments module refuses a note nobody wrote. */
  static async addNote(tenantId: string, incidentId: string, content: string, userId: string | null, authorName?: string): Promise<{ commentId: string }> {
    await IncidentWorkflowService.requireIncident(tenantId, incidentId)
    const notes = await loadIncidentNotes(tenantId)
    if (!notes) throw new AppError('Notes need the comments module, which is not installed', 409, ErrorCode.CONFLICT)
    const saved = await notes.create(tenantId, {
      subjectType: INCIDENT_NOTE_SUBJECT, subjectId: incidentId, content, authorUserId: userId ?? undefined, ...(userId ? {} : { authorName: authorName ?? 'Automation' }),
    })
    await recordIncidentEvent(tenantId, incidentId, 'NOTE_ADDED', { actorId: userId, data: { commentId: saved.commentId } })
    return { commentId: saved.commentId }
  }

  static async listNotes(tenantId: string, incidentId: string): Promise<unknown[]> {
    const notes = await loadIncidentNotes(tenantId)
    if (!notes) return []
    return notes.list(tenantId, { subjectType: INCIDENT_NOTE_SUBJECT, subjectId: incidentId })
  }

  /** A follow-up is a `tasks` record related to the incident (`relatedType INCIDENT`). */
  static async addTask(tenantId: string, incidentId: string, input: { title: string; assigneeUserId?: string | null; dueAt?: Date | null; priority?: string }, userId: string | null): Promise<{ taskId: string }> {
    await IncidentWorkflowService.requireIncident(tenantId, incidentId)
    const tasks = await loadIncidentTasks(tenantId)
    if (!tasks) throw new AppError('Follow-up tasks need the tasks module, which is not installed', 409, ErrorCode.CONFLICT)
    const task = await tasks.create(tenantId, {
      title: input.title, priority: input.priority ?? 'MEDIUM', assigneeUserId: input.assigneeUserId ?? null, dueAt: input.dueAt ?? null,
      relatedType: 'INCIDENT', relatedId: incidentId,
    }, userId ?? undefined)
    await recordIncidentEvent(tenantId, incidentId, 'TASK_ADDED', { actorId: userId, data: { taskId: task.taskId, title: input.title } })
    return { taskId: task.taskId }
  }

  static async listTasks(tenantId: string, incidentId: string): Promise<unknown[]> {
    try {
      const tasks = await loadIncidentTasks(tenantId)
      return tasks ? await tasks.list(tenantId, { relatedType: 'INCIDENT', relatedId: incidentId }) : []
    } catch (err) {
      Logger.debug?.(`[incident.workflow] tasks unavailable: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }
}
