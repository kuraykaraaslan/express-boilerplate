/**
 * What a member who does not manage members may see of the others (tenant_member.12, 05-tenant-member 3.3), as pure
 * functions shared by the list and detail routes. `members.view` has the USER floor, and self-registration makes every
 * shopper a USER member. Such a caller gets an allow-list, never the stored row: who (a display name), their role and
 * status, and since when. No e-mail or phone of anyone else, no global account field (userRole, userStatus,
 * emailVerifiedAt), no SCIM externalId, no suspension reason or end, no lastActiveAt, no custom groups.
 */
import type { SafeTenantMember } from './tenant_member.types';

/** Who administers members: an OWNER or ADMIN of the tenant (they see the full record). */
export function isMemberManager(caller: { memberRole?: string | null } | null | undefined): boolean {
  return caller?.memberRole === 'OWNER' || caller?.memberRole === 'ADMIN';
}

export interface MemberPeerView {
  tenantMemberId: string;
  tenantId: string;
  userId: string;
  memberRole: SafeTenantMember['memberRole'];
  memberStatus: SafeTenantMember['memberStatus'];
  createdAt: Date | null;
  /** The person's profile name when they have one (display name, else name, else given + family name); otherwise null. */
  displayName: string | null;
  /** Only on the caller's own row: their own e-mail. */
  user?: { userId: string; email: string };
}

type ProfileNames = { displayName?: string | null; name?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

/** The profile name of a member's user, or null. An e-mail is never a display name here: that is what is being hidden. */
export function profileNameOf(user: { userProfile?: ProfileNames } | null | undefined): string | null {
  const p = user?.userProfile;
  const name = p?.displayName?.trim() || p?.name?.trim()
    || [p?.firstName, p?.lastName].map((x) => x?.trim()).filter(Boolean).join(' ');
  return name || null;
}

/** The allow-listed projection of one member for a caller who does not manage members. */
export function toPeerView(member: SafeTenantMember, callerUserId: string | null | undefined): MemberPeerView {
  const view: MemberPeerView = {
    tenantMemberId: member.tenantMemberId,
    tenantId: member.tenantId,
    userId: member.userId,
    memberRole: member.memberRole,
    memberStatus: member.memberStatus,
    createdAt: member.createdAt ?? null,
    displayName: profileNameOf(member.user as { userProfile?: ProfileNames } | null | undefined),
  };
  if (callerUserId && member.userId === callerUserId && member.user?.email) {
    view.user = { userId: member.userId, email: member.user.email };
  }
  return view;
}
