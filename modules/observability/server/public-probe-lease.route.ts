import { signedRunnerHandler } from './probe.runner.http'
import ProbeLeaseService from './probe.lease.service'
import { LeaseRequestDTO } from './probe.dto'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ProbeLocation } from './entities/probe_location.entity'
import { normalisePolicy } from './probe.policy'

/** POST /api/public/probe/lease — a signed runner asks for the due checks of its location. */
export const POST = signedRunnerHandler('/lease', async (runner, body) => {
  const { max, browserSlots } = LeaseRequestDTO.parse(body)
  const { leases, shed } = await ProbeLeaseService.leaseWithStats(runner, { max, browserSlots })
  const location = await withTenantRepositoryFor(runner.tenantId, ProbeLocation, (repo) => repo.findOne({ where: { tenantId: runner.tenantId, locationId: runner.locationId } }))
  // Only a PRIVATE location's runner receives CIDRs: they are what lets it reach its own network, so a public runner is never handed any.
  const cidrs = location?.kind === 'PRIVATE' ? normalisePolicy(location.targetPolicy).cidrs : []
  // `shed`: due checks this poll did not lease because a lease cap was hit (they stay due); additive, an older runner ignores it.
  return { leases, egress: { cidrs }, pollSeconds: 10, shed: shed.tenant + shed.global }
})
