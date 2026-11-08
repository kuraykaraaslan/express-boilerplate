// path: app/tenant/[tenantId]/api/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { SendInvitationDTO, GetInvitationsDTO, ListInvitationsQuery } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.dto";
import { readListQuery } from "@kuraykaraaslan-labs/common/server/common.list-query";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { sendInvitationEmail } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.notify";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import { assertInvitationQuota } from "./tenant_invitation.quota";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/invitations
 * List invitations for a tenant (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.read", scope: 'TENANT' });

    // phase 43 list contract: statuses, roles, sent / expiry days, a search over the e-mail, a whitelisted sort; 1-based
    const q = readListQuery(new URL(request.url).searchParams, ListInvitationsQuery);
    const { page, pageSize } = q;
    const parsed = GetInvitationsDTO.safeParse({
      tenantId, page, pageSize, status: null,
      statuses: q.status, memberRoles: q.memberRole, search: q.search,
      createdFrom: q.createdFrom, createdTo: q.createdTo, expiresFrom: q.expiresFrom, expiresTo: q.expiresTo, sort: q.sort,
    });
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    const { invitations, total } = await TenantInvitationService.getByTenantId(parsed.data);

    // `data` is the list contract's name of the rows (phase 43); `invitations` stays for older readers
    return NextResponse.json({ invitations, data: invitations, total, page, pageSize }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/invitations
 * Send an invitation (ADMIN+)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.invite", scope: 'TENANT' });

    const { total: currentMemberCount } = await TenantMemberService.getByTenantId({
      tenantId,
      page: 1,
      pageSize: 1,
      search: null,
      memberRole: null,
      memberStatus: 'ACTIVE',
    });

    await assertInvitationQuota(tenantId, currentMemberCount);

    const body = await request.json();
    const parsed = SendInvitationDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    const { invitation, rawToken } = await TenantInvitationService.send(
      tenantId,
      user.userId,
      parsed.data,
      tenantMember.memberRole
    );

    await sendInvitationEmail(tenantId, {
      invitationId: invitation.invitationId,
      email: invitation.email,
      memberRole: invitation.memberRole,
      rawToken,
      expiresAt: invitation.expiresAt,
    });

    return NextResponse.json({ message: "Invitation sent successfully", invitation }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
