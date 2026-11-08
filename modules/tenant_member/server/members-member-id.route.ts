// path: app/tenant/[tenantId]/api/members/[memberId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantSessionNextService from "@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import {
  isSensitiveRole,
  isDualControlEnabled,
  submitMemberChangeForApproval,
} from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.approval";
import type { TenantMemberRole } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums";
import { mayActOn } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.helpers";
import { assignableRoles } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.rank";
import { UpdateTenantMemberDTO } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.dto";
import { isMemberManager, toPeerView } from "./tenant_member.peer-view";
import TenantRoleService from "@kuraykaraaslan-labs/tenant_member/server/tenant_role.service";
import { holdsSensitive } from "./tenant_role.owner-only";
import { requireActionStepUpWhenEnrolled } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.step-up.next";
import { noteDecoyMemberTouch } from "./tenant_member.decoy";

// Phase 55 02.5: the tenant's canary member id (tenant_member.decoy.ts) is no row and no list shows it; asking for it is a critical signal
// about the caller (noteDecoyMemberTouch, synchronous, never throwing), and the answer stays the missing member's 404 the service gives.

/**
 * GET /tenant/[tenantId]/api/members/[memberId]
 * Get a specific member (requires USER role)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> }
) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request);
    const viewer = await authorizeRequest({ request, tenantId, requiredPermission: 'members.view', scope: 'TENANT' });
    const { tenantMember: caller } = viewer;
    noteDecoyMemberTouch(request, tenantId, memberId, viewer);

    const member = await TenantMemberService.getByIdWithUser(memberId, tenantId);

    // tenant_member.12, 05-tenant-member 3.3: a caller who does not manage members gets the allow-listed projection (no
    // e-mail of others, no global account fields, no suspension / SCIM / activity data).
    if (!isMemberManager(caller)) {
      return NextResponse.json({ member: toPeerView(member, caller?.userId) }, { status: 200 });
    }
    return NextResponse.json({ member }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/members/[memberId]
 * Update a member (requires ADMIN role)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> }
) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'members.edit_role', scope: 'TENANT' });
    const { tenantMember: currentMember } = auth;
    noteDecoyMemberTouch(request, tenantId, memberId, auth);

    const memberToUpdate = await TenantMemberService.getById(memberId, tenantId);

    // Prevent non-owners from modifying owners
    if (memberToUpdate.memberRole === 'OWNER' && currentMember.memberRole !== 'OWNER') {
      return NextResponse.json(
        { message: "Only owners can modify other owners" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
    }
    // 05-tenant-member 1.1: the body is validated (roleKeys included) instead of picked apart; an empty role or status is "absent".
    const parsed = UpdateTenantMemberDTO.safeParse({
      memberRole: body.memberRole || null,
      memberStatus: body.memberStatus || null,
      ...(body.roleKeys !== undefined ? { roleKeys: body.roleKeys } : {}),
    });
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    // A role equal to the stored one is not a change (a form that re-sends it must not trip the rank rule or dual control).
    const newRole: TenantMemberRole | undefined =
      parsed.data.memberRole && parsed.data.memberRole !== memberToUpdate.memberRole ? parsed.data.memberRole : undefined;

    // Prevent privilege escalation: a member may only assign roles strictly below
    // their own (tenant_member.rank assignableRoles), so never OWNER through this route.
    if (newRole && !assignableRoles(currentMember.memberRole).includes(newRole)) {
      return NextResponse.json(
        { message: "You cannot assign a role equal to or higher than your own" },
        { status: 403 }
      );
    }

    // tenant_member.03 (fixed 2026-10-20): a non-owner changes only members strictly below their own rank (no peer ADMIN).
    if (!mayActOn(currentMember.memberRole, memberToUpdate.memberRole)) {
      return NextResponse.json({ message: "You cannot change a member whose role is equal to or higher than your own" }, { status: 403 });
    }

    // 05-tenant-member 1.1: group assignment. Only an actual change counts; it changes what the member may do, so it needs the
    // permission that governs the groups themselves (members.settings, like the matrix and the roles screen), and a group that
    // holds a sensitive permission is given or taken only by an OWNER (as in the matrix). The service validates the keys
    // under the role-set lock.
    let roleKeys: string[] | undefined;
    if (parsed.data.roleKeys !== undefined) {
      const before = new Set(memberToUpdate.roleKeys ?? []);
      const after = new Set(parsed.data.roleKeys);
      const changedKeys = [...new Set([...before, ...after])].filter((k) => before.has(k) !== after.has(k));
      if (changedKeys.length) {
        await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
        if (currentMember.memberRole !== 'OWNER') {
          // Fail fast against the cached set; the service asks again under the role-set lock.
          const roles = await TenantRoleService.listRoles(tenantId);
          if (roles.some((r) => changedKeys.includes(r.key) && holdsSensitive(r.permissions))) {
            return NextResponse.json({ message: "Only the workspace owner can assign or remove a group that holds a sensitive permission" }, { status: 403 });
          }
        }
        roleKeys = [...after];
      }
    }

    // Phase 55 00.6 (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.6): a role change is made under the administrator's
    // step-up when they hold a factor (auth_abac.step-up.next), after every rank rule above and before the change or its approval
    // request. A change of the member's groups is one too (phase 55 00 review): a group can grant any ADMIN-floor permission
    // (auth_abac.guard.group-floor meetsFloorOrGroup), the same privilege a role change gives. A body that changes only the status
    // asks nothing.
    if (newRole || roleKeys !== undefined) {
      await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'members.edit_role', target: memberId });
    }

    const isOwner = currentMember.memberRole === 'OWNER';
    const memberStatus = parsed.data.memberStatus ?? null;

    // Dual-control gate: when the tenant requires approval for sensitive changes
    // (`tenantMemberDualControl`) and this is a grant of a privileged role
    // (OWNER/ADMIN), do NOT apply the role now — defer it to the approval queue. The
    // boot-registered decision handler replays the change on APPROVE. Non-sensitive
    // changes (and dual-control OFF) keep today's immediate behavior.
    if (newRole && isSensitiveRole(newRole) && await isDualControlEnabled(tenantId)) {
      // 05-tenant-member 1.1: the rest of the same body (status, groups) is not parked with the role and must not be dropped
      // either: it is applied now, and the 202 says what was applied (`applied`) next to what waits (`pendingApproval`).
      const applied: string[] = [];
      if (memberStatus && memberStatus !== memberToUpdate.memberStatus) applied.push('memberStatus');
      if (roleKeys !== undefined) applied.push('roleKeys');
      let member = memberToUpdate;
      if (applied.length) {
        member = await TenantMemberService.update(memberId, tenantId, {
          memberRole: null,
          memberStatus,
          ...(roleKeys !== undefined ? { roleKeys } : {}),
        }, currentMember.userId, { isOwner });
        await TenantSessionNextService.clearTenantCache(memberToUpdate.userId, tenantId);
      }
      await submitMemberChangeForApproval(tenantId, memberId, {
        action: 'role_change',
        targetRole: newRole,
        actorId: currentMember.userId,
      });
      return NextResponse.json(
        { message: "Role change submitted for approval", pendingApproval: true, applied, member },
        { status: 202 }
      );
    }

    const updatedMember = await TenantMemberService.update(memberId, tenantId, {
      memberRole: newRole ?? null,
      memberStatus,
      ...(roleKeys !== undefined ? { roleKeys } : {}),
    }, currentMember.userId, { isOwner });

    // Clear tenant cache for the updated member
    await TenantSessionNextService.clearTenantCache(memberToUpdate.userId, tenantId);

    return NextResponse.json({
      message: "Member updated successfully",
      member: updatedMember
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/members/[memberId]
 * Remove a member (requires ADMIN role)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> }
) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request);
    const remover = await authorizeRequest({ request, tenantId, requiredPermission: 'members.remove', scope: 'TENANT' });
    const { tenantMember: currentMember } = remover;
    noteDecoyMemberTouch(request, tenantId, memberId, remover);

    const memberToDelete = await TenantMemberService.getById(memberId, tenantId);

    // Prevent non-owners from removing owners
    if (memberToDelete.memberRole === 'OWNER' && currentMember.memberRole !== 'OWNER') {
      return NextResponse.json(
        { message: "Only owners can remove other owners" },
        { status: 403 }
      );
    }
    // tenant_member.03 (fixed 2026-10-20): a non-owner removes only members strictly below their own rank (no peer ADMIN).
    if (!mayActOn(currentMember.memberRole, memberToDelete.memberRole)) {
      return NextResponse.json({ message: "You cannot remove a member whose role is equal to or higher than your own" }, { status: 403 });
    }

    // Prevent self-removal if OWNER (would leave tenant without owner)
    if (memberToDelete.tenantMemberId === currentMember.tenantMemberId && memberToDelete.memberRole === 'OWNER') {
      return NextResponse.json(
        { message: "You cannot remove yourself as the owner" },
        { status: 403 }
      );
    }

    // Dual-control gate: when the tenant requires approval for sensitive changes
    // (`tenantMemberDualControl`) and the member being removed IS an owner/admin,
    // defer the removal to the approval queue instead of removing now. The
    // boot-registered decision handler replays the removal on APPROVE.
    if (isSensitiveRole(memberToDelete.memberRole) && await isDualControlEnabled(tenantId)) {
      await submitMemberChangeForApproval(tenantId, memberId, {
        action: 'remove',
        actorId: currentMember.userId,
      });
      return NextResponse.json(
        { message: "Member removal submitted for approval", pendingApproval: true },
        { status: 202 }
      );
    }

    await TenantMemberService.delete(memberId, tenantId, currentMember.userId);

    // Clear tenant cache for the removed member
    await TenantSessionNextService.clearTenantCache(memberToDelete.userId, tenantId);

    return NextResponse.json({
      message: "Member removed successfully"
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
