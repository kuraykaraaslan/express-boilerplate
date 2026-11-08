// path: app/tenant/[tenantId]/api/invitations/[invitationId]/accept/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import TenantInvitationMessages from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.messages";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/invitations/[invitationId]/accept
 *
 * Accept an invitation by id, as the signed-in account it is addressed to — no
 * emailed token. `tenantId` is the INVITING tenant (`invitations[].tenantId` from
 * `GET /auth/me/tenants`), which may differ from the tenant the caller's token is
 * bound to: ACCOUNT scope does not compare them (it is how `/auth/me/*` works).
 *
 * The invitation's email must equal the caller's AND the caller's email must be
 * verified (403 otherwise); anyone else's invitation answers 404.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invitationId: string }> },
) {
  try {
    const { tenantId, invitationId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: "tenant_invitation.invitations.accept", scope: "ACCOUNT" });

    const { memberRole } = await TenantInvitationService.acceptById(
      tenantId,
      { userId: user.userId, email: user.email, emailVerifiedAt: user.emailVerifiedAt },
      invitationId,
    );

    return NextResponse.json({ message: TenantInvitationMessages.INVITATION_ACCEPTED, tenantId, memberRole }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
