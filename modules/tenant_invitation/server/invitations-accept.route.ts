// path: app/tenant/[tenantId]/api/invitations/accept/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { AcceptInvitationDTO } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.dto";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteInvitationTokenRefused } from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.firewall-emitters";

/**
 * GET /tenant/[tenantId]/api/invitations/accept?token=
 * Public preview of invitation info (no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const rawToken = new URL(request.url).searchParams.get("token");

    if (!rawToken) {
      return NextResponse.json({ message: "Token is required" }, { status: 400 });
    }

    let found: Awaited<ReturnType<typeof TenantInvitationService.preview>>;
    try {
      found = await TenantInvitationService.preview(tenantId, rawToken);
    } catch (e) {
      // Phase 55 02.6: an unknown token is a signal for the AI firewall (tallied; synchronous, never throws, never changes this answer).
      noteInvitationTokenRefused(request, tenantId, e, null, () => Limiter.getIpFromRequest(request));
      throw e;
    }
    const { invitation, tenant } = found;

    return NextResponse.json({ invitation, tenant }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/invitations/accept
 * Accept an invitation (system session required — user must be logged in)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: "tenant_invitation.invitations.accept", scope: "ACCOUNT" });

    const body = await request.json();
    const parsed = AcceptInvitationDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    try {
      await TenantInvitationService.accept(tenantId, user.userId, user.email, parsed.data.token);
    } catch (e) {
      // Phase 55 02.6: an unknown token is a signal for the AI firewall (tallied; synchronous, never throws, never changes this answer).
      noteInvitationTokenRefused(request, tenantId, e, user.userId, () => Limiter.getIpFromRequest(request));
      throw e;
    }

    return NextResponse.json({ message: "Invitation accepted successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
