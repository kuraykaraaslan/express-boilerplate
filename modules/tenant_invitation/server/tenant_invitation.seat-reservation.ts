import { MoreThan } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantInvitation as TenantInvitationEntity } from './entities/tenant_invitation.entity';

/**
 * Pending invitations as held seats, contributed into
 * `tenant_member:seat_reservation`.
 *
 * EXPIRED rows are excluded even while they still say `PENDING`: expiry is
 * swept lazily, and letting an invitation nobody ever answered hold a paid seat
 * forever would turn a background job's schedule into a billing limit.
 */
export async function countPendingInvitations(tenantId: string): Promise<number> {
  return withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) => repo.count({
    where: { tenantId, status: 'PENDING', expiresAt: MoreThan(new Date()) },
  }));
}

const provider = { countReserved: countPendingInvitations };

export default provider;
