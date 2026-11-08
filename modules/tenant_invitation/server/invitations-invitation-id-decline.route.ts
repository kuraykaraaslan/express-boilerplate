// path: app/tenant/[tenantId]/api/invitations/[invitationId]/decline/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import TenantInvitationMessages from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.messages";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/invitations/[invitationId]/decline
 * Decline an invitation by id; same caller rules as `.../accept`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invitationId: string }> },
) {
  try {
    const { tenantId, invitationId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: "tenant_invitation.invitations.decline", scope: "ACCOUNT" });

    await TenantInvitationService.declineById(
      tenantId,
      { email: user.email, emailVerifiedAt: user.emailVerifiedAt },
      invitationId,
    );

    return NextResponse.json({ message: TenantInvitationMessages.INVITATION_DECLINED }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
