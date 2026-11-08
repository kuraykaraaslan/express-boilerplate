// path: app/tenant/[tenantId]/api/invitations/[invitationId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/invitations/[invitationId]
 * Get a single invitation (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invitationId: string }> }
) {
  try {
    const { tenantId, invitationId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.read", scope: 'TENANT' });

    const invitation = await TenantInvitationService.getById(invitationId, tenantId);

    return NextResponse.json({ invitation }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/invitations/[invitationId]
 * Revoke an invitation (ADMIN+)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invitationId: string }> }
) {
  try {
    const { tenantId, invitationId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.revoke", scope: 'TENANT' });

    await TenantInvitationService.revoke(invitationId, tenantId);

    return NextResponse.json({ message: "Invitation revoked successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
