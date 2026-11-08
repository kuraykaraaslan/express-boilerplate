// path: app/tenant/[tenantId]/api/invitations/[invitationId]/resend/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { sendInvitationEmail } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.notify";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import TenantInvitationMessages from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/invitations/[invitationId]/resend
 * Rotate the token, extend expiry and re-email a PENDING invitation (ADMIN+)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invitationId: string }> }
) {
  try {
    const { tenantId, invitationId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.resend", scope: 'TENANT' });

    const { invitation, rawToken } = await TenantInvitationService.resend(invitationId, tenantId);

    await sendInvitationEmail(tenantId, {
      invitationId: invitation.invitationId,
      email: invitation.email,
      memberRole: invitation.memberRole,
      rawToken,
      expiresAt: invitation.expiresAt,
    });

    return NextResponse.json({ message: TenantInvitationMessages.INVITATION_SENT, invitation }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
