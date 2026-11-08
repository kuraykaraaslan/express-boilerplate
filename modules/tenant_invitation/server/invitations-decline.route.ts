// path: app/tenant/[tenantId]/api/invitations/decline/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { DeclineInvitationDTO } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.dto";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/invitations/decline
 * Decline an invitation (system session required — user must be logged in)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: "tenant_invitation.invitations.decline", scope: "ACCOUNT" });

    const body = await request.json();
    const parsed = DeclineInvitationDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    await TenantInvitationService.decline(tenantId, user.email, parsed.data.token);

    return NextResponse.json({ message: "Invitation declined successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
