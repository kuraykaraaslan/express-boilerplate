import 'reflect-metadata';
import { IsNull, MoreThan } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { TenantInvitation as TenantInvitationEntity } from '@kuraykaraaslan-labs/tenant_invitation/server/entities/tenant_invitation.entity';

/**
 * The two reads behind the workspace switcher that are cross-tenant BY DESIGN (38-security 6.1): a person's memberships and the invitations sent to
 * their address, across every tenant at once. They run on the system connection (a runtime login with no tenant context sees nothing once RLS is
 * forced) and are keyed only by the session user's id / e-mail. They live here, not in the route file, because no `*.route.ts` may open a cross-tenant
 * bypass (db.rls-context.security.test.ts).
 */
export function activeMembershipsOf(userId: string) {
  return withSystemRLS((qr) => qr.manager.getRepository(TenantMemberEntity).find({
    where: { userId, memberStatus: 'ACTIVE', deletedAt: IsNull() },
    order: { createdAt: 'DESC' },
  }));
}

export function pendingInvitationsFor(email: string, now: Date) {
  return withSystemRLS((qr) => qr.manager.getRepository(TenantInvitationEntity).find({
    where: { email: email.toLowerCase(), status: 'PENDING', expiresAt: MoreThan(now) },
    order: { createdAt: 'DESC' },
  }));
}
