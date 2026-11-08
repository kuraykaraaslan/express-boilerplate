// path: app/tenant/[tenantId]/api/members/transfer-ownership/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantSessionNextService from "@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next";
import { TransferOwnershipDTO } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.dto";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/members/transfer-ownership
 *
 * Hand the workspace to another member: `{ toUserId, demoteTo?: 'ADMIN' | 'USER' }`.
 * The target becomes OWNER and every current owner steps down to `demoteTo` (default
 * ADMIN), atomically, so the workspace is never ownerless. OWNER-only
 * (`members.transfer_ownership`).
 *
 * This is what a sole owner who wants to delete their account has to do first
 * (`POST /auth/me/deletion-request` refuses with 409 `details.tenants` while others
 * would be left without an owner).
 *
 * 200 `{ message }`; 404 when `toUserId` is not a member of this workspace.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: "members.transfer_ownership", scope: "TENANT" });

    const parsed = TransferOwnershipDTO.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }
    const { toUserId, demoteTo } = parsed.data;

    await TenantMemberService.transferOwnership(tenantId, toUserId, demoteTo, user.userId);

    // Everyone whose role just changed must be re-read, not served from the member cache.
    await TenantSessionNextService.clearTenantCache(toUserId, tenantId);
    await TenantSessionNextService.clearTenantCache(user.userId, tenantId);

    return NextResponse.json({ message: "Ownership transferred" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
