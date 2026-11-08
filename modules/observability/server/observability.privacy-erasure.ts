import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import type { ErasureOutcome, PrivacySubject } from '@kuraykaraaslan-labs/common/server/common.privacy-contracts'
import { ChatDestination } from './entities/chat_destination.entity'
import { StatusSubscriber } from './entities/status_subscriber.entity'
import { IncidentParticipant } from './entities/incident_participant.entity'
import { IncidentEvent } from './entities/incident_event.entity'
import { Incident } from './entities/incident.entity'
import { Alert } from './entities/alert.entity'
import { AlertSilence } from './entities/alert_silence.entity'
import { Slo } from './entities/slo.entity'
import { ProbeEnrolment } from './entities/probe_enrolment.entity'

/**
 * `privacy:erasure` for observability (phase 16.8): what the module holds about a PERSON is
 *  - a status-page subscriber's e-mail address, and
 *  - references to a workspace user: incident roles, who acknowledged or declared, who owns an SLO, who created a silence, who minted a probe-runner enrolment token.
 *
 * The subscriber and the role assignments are deleted. The references are cleared (the row stays, the person goes), which makes the row
 * anonymous rather than gone: an incident timeline is the operational record of an outage and other people's actions sit in the same rows.
 * Free text typed into timelines and post-mortems is NOT searched or rewritten, and the report says so instead of claiming it.
 */
const RETAINED_REASON =
  'Incident timelines and post-mortems are the operational record of an outage and carry other people\'s actions in the same rows. '
  + 'The person\'s identifier was removed from them; free text in notes and post-mortems was not searched or rewritten.'

export async function erase(tenantId: string, subject: PrivacySubject, options: { dryRun: boolean }): Promise<ErasureOutcome> {
  const userId = subject.identifiers?.userId ?? null
  const email = subject.identifiers?.email?.trim().toLowerCase() || null
  const dry = options?.dryRun === true
  if (!userId && !email) return { erased: 0, mode: 'ERASE' }

  let erased = 0
  let retained = 0

  if (email) {
    // Subscriber addresses are stored lowercased (status.subscriber.service), so equality finds every row.
    erased += await withTenantRepositoryFor(tenantId, StatusSubscriber, async (repo) => {
      const n = await repo.count({ where: { tenantId, email } })
      if (!dry && n) await repo.delete({ tenantId, email })
      return n
    })
  }

  if (userId) {
    erased += await withTenantRepositoryFor(tenantId, IncidentParticipant, async (repo) => {
      const n = await repo.count({ where: { tenantId, userId } })
      if (!dry && n) await repo.delete({ tenantId, userId })
      return n
    })
    // Rows that stay but stop naming the person. Counted separately: the timeline ones are "retained" (anonymised), the rest are plain erasure.
    const clear = async <T extends object>(entity: new () => T, column: string, countsAsRetained = false): Promise<void> => {
      const n = await withTenantRepositoryFor(tenantId, entity as never, async (r) => {
        const repo = r as unknown as { count(o: object): Promise<number>; update(w: object, p: object): Promise<unknown> }
        const found = await repo.count({ where: { tenantId, [column]: userId } })
        if (!dry && found) await repo.update({ tenantId, [column]: userId }, { [column]: null })
        return found
      })
      if (countsAsRetained) retained += n; else erased += n
    }
    await clear(IncidentEvent, 'actorId', true)
    await clear(Incident, 'acknowledgedBy')
    await clear(Incident, 'declaredBy')
    await clear(IncidentParticipant, 'assignedBy')
    await clear(Alert, 'acknowledgedBy')
    await clear(AlertSilence, 'createdBy')
    await clear(Slo, 'ownerUserId')
    await clear(ProbeEnrolment, 'createdBy')
    await clear(ChatDestination, 'createdBy')
  }

  return {
    erased, mode: retained > 0 ? 'MIXED' : 'ERASE',
    ...(retained > 0 ? { retained, retainedReason: RETAINED_REASON } : {}),
  }
}

const erasureProvider = { erase }
export default erasureProvider
