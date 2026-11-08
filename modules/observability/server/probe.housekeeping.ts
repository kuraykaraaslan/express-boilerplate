import 'reflect-metadata'
import { LessThan } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ProbeLease } from './entities/probe_lease.entity'
import { ProbeEnrolment } from './entities/probe_enrolment.entity'

/**
 * Leases and enrolment tokens are working state, not history: a lease is only useful until its deadline (and a day more, so a late duplicate result still
 * finds its consumed lease and reads as a duplicate rather than as unknown), an enrolment token only until it expires. Run by the retention sweep.
 */
export const LEASE_KEEP_MS = 24 * 3_600_000
export const ENROLMENT_KEEP_MS = 7 * 86_400_000

export async function pruneProbeHousekeeping(tenantId: string, now: Date = new Date()): Promise<{ leases: number; enrolments: number }> {
  const leases = await withTenantRepositoryFor(tenantId, ProbeLease, (repo) => repo.delete({ tenantId, expiresAt: LessThan(new Date(now.getTime() - LEASE_KEEP_MS)) }))
  const enrolments = await withTenantRepositoryFor(tenantId, ProbeEnrolment, (repo) => repo.delete({ tenantId, expiresAt: LessThan(new Date(now.getTime() - ENROLMENT_KEEP_MS)) }))
  return { leases: leases.affected ?? 0, enrolments: enrolments.affected ?? 0 }
}
