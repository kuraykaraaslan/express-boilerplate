// path: app/tenant/[tenantId]/api/members/[memberId]/transition/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantSessionNextService from "@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import TenantMemberMessages from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { mayActOn } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.helpers";

/** The width of `tenant_members.suspensionReason` (tenant_member.09). */
const MAX_SUSPENSION_REASON = 512;

type Params = { params: Promise<{ tenantId: string; memberId: string }> };

/**
 * POST /tenant/[tenantId]/api/members/[memberId]/transition
 * Apply a member status-workflow action (requires ADMIN role).
 * Body: { action: 'suspend' | 'reactivate', reason?: string, until?: string }
 *  - suspend    → SUSPENDED (revokes sessions; OWNER cannot be suspended)
 *  - reactivate → ACTIVE (lifts suspension)
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request);
    const { tenantMember: currentMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.suspend', scope: 'TENANT' });

    const target = await TenantMemberService.getById(memberId, tenantId);

    // Only owners may act on other owners (mirrors the item-route guard).
    if (target.memberRole === "OWNER" && currentMember.memberRole !== "OWNER") {
      return NextResponse.json({ message: TenantMemberMessages.OWNER_MODIFY_FORBIDDEN }, { status: 403 });
    }
    // tenant_member.03 (fixed 2026-10-20): a non-owner acts only on members strictly below their own rank (no peer ADMIN).
    if (!mayActOn(currentMember.memberRole, target.memberRole)) {
      return NextResponse.json({ message: "You cannot act on a member whose role is equal to or higher than your own" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    let member;
    if (action === "suspend") {
      const reason = typeof body?.reason === "string" ? body.reason : "";
      // tenant_member.09 (fixed 2026-10-20): a reason wider than the column is a 400 before anything is written.
      if (reason.length > MAX_SUSPENSION_REASON) {
        return NextResponse.json({ message: `The reason may be at most ${MAX_SUSPENSION_REASON} characters` }, { status: 400 });
      }
      const until = body?.until ? new Date(body.until) : null;
      member = await TenantMemberService.suspend(memberId, tenantId, {
        reason,
        until: until && !Number.isNaN(until.getTime()) ? until : null,
        actorId: currentMember.userId,
      });
    } else if (action === "reactivate" || action === "unsuspend") {
      member = await TenantMemberService.unsuspend(memberId, tenantId, currentMember.userId);
    } else {
      return NextResponse.json({ message: TenantMemberMessages.INVALID_TRANSITION }, { status: 400 });
    }

    await TenantSessionNextService.clearTenantCache(target.userId, tenantId);

    return NextResponse.json({ message: "Member updated successfully", member }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
