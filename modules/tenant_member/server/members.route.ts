// path: app/tenant/[tenantId]/api/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { assertSeatAllowance, assertSeatCapacity } from "./tenant_member.seats";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { readListQuery } from "@kuraykaraaslan-labs/common/server/common.list-query";
import { ListTenantMembersQuery } from "./tenant_member.dto";
import { TenantMemberRoleEnum, TenantMemberStatusEnum } from "./tenant_member.enums";
import { isSensitiveRole, isDualControlEnabled, submitMemberChangeForApproval } from "./tenant_member.approval";
import { isMemberManager, toPeerView } from "./tenant_member.peer-view";
import { mayActOn } from "./tenant_member.rank";
import { resolveDefaultRole } from "./tenant_member.helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /tenant/[tenantId]/api/members
 * Get all members of a tenant (requires USER role)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {

  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor USER (members.view)
    const { tenantMember: caller } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.view', scope: 'TENANT' });

    // phase 43 list contract: roles, statuses, a joined-day range, a search over e-mail and a whitelisted sort.
    // tenant_invitation.01 (fixed 2026-10-20, in this route) stays: the 0-based page and pageSize are clamped
    // (0 <= page <= 100 000, 1 <= pageSize <= 200); a negative, NaN or huge value is never passed to the query as is.
    const q = readListQuery(new URL(request.url).searchParams, ListTenantMembersQuery);
    const { page, pageSize } = q;

    // tenant_member.12, 05-tenant-member 3.3: a caller who does not manage members cannot search (the search matches e-mail
    // addresses, which would let them probe who is a member), and gets the allow-listed projection of every row.
    const manager = isMemberManager(caller);

    // Get members (the service counts pages from 1)
    const { members, total } = await TenantMemberService.getByTenantId({
      tenantId: tenantId,
      page: page + 1,
      pageSize,
      search: manager ? q.search ?? null : null,
      memberRole: null,
      memberStatus: null,
      memberRoles: q.memberRole,
      memberStatuses: q.memberStatus,
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
      sort: q.sort,
    });

    const rows = manager ? members : members.map((m) => toPeerView(m, caller?.userId));
    // `data` is the list contract's name of the rows (phase 43); `members` stays for older readers
    return NextResponse.json({
      members: rows,
      data: rows,
      total,
      page,
      pageSize
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/members
 * Add a new member to the tenant (requires ADMIN role)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Only ADMIN and OWNER can add members (members.invite, floor ADMIN)
    const { tenantMember: actor } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.invite', scope: 'TENANT' });

    const { total: currentMemberCount } = await TenantMemberService.getByTenantId({
      tenantId,
      page: 1,
      pageSize: 1,
      search: null,
      memberRole: null,
      memberStatus: 'ACTIVE',
    });

    await assertSeatCapacity(tenantId, currentMemberCount);

    // Entitlement-based seat allowance (phases/monetization/6.md): when something sells seats (`tenant_member:seat_allowance`,
    // contributed by tenant_subscription while monetization is on), also enforce the plan/bundle included seats (+ admin free-seat
    // override). The same check invitations use, so pending invitations hold their seats here too (36-tenant-subscription
    // 03-ui-fixes 2.1). With no contributor, or monetization off, the max_members feature gate above still applies.
    await assertSeatAllowance(tenantId, currentMemberCount);

    const body = await request.json().catch(() => null);
    // tenant_member.06 (fixed 2026-10-20): the body and the userId are validated before anything reaches the repository.
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.userId !== "string" || !UUID_RE.test(body.userId)) {
      return NextResponse.json({ message: "A valid userId is required" }, { status: 400 });
    }
    // 05-tenant-member 3.1: a member added without a named role gets the tenant's defaultMemberRole (an owner-only setting);
    // the enum and rank checks below still apply to it, so an ADMIN default needs an OWNER or dual control.
    const memberRole = body?.memberRole || await resolveDefaultRole(tenantId);
    const memberStatus = body?.memberStatus || 'ACTIVE';

    // The enums are checked before the rank rule, so a junk role is a 400 (tenant_member.02), not a rank refusal.
    if (!TenantMemberRoleEnum.safeParse(memberRole).success || !TenantMemberStatusEnum.safeParse(memberStatus).success) {
      return NextResponse.json({ message: "Invalid member role or status" }, { status: 400 });
    }

    // Rank rule, the same one PUT /members/[id] enforces (tenant_member.01, fixed 2026-10-20): a caller may only add a
    // role strictly below their own; an OWNER may add any role. An ADMIN can no longer mint an OWNER or a peer ADMIN.
    // The same comparison as tenant_member.rank mayActOn (one rank rule, 05-tenant-member 2.1).
    if (!mayActOn(actor.memberRole, memberRole)) {
      return NextResponse.json({ message: "You cannot add a member with a role equal to or higher than your own" }, { status: 403 });
    }

    // tenant_member.07 (fixed 2026-10-20): with dual control ON (or unreadable), adding an account straight in as ADMIN/OWNER waits for
    // a second person, like a promotion does. The item's entityId is the user being added; the replay re-checks the submitter.
    if (isSensitiveRole(memberRole) && await isDualControlEnabled(tenantId)) {
      await submitMemberChangeForApproval(tenantId, body.userId, { action: 'add', targetRole: memberRole, actorId: actor.userId });
      return NextResponse.json({ message: "Adding this member was submitted for approval", pendingApproval: true }, { status: 202 });
    }

    // Create new member
    const newMember = await TenantMemberService.create({
      tenantId,
      userId: body.userId,
      memberRole,
      memberStatus,
    }, actor.userId);

    return NextResponse.json({
      message: "Member added successfully",
      member: newMember
    }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
