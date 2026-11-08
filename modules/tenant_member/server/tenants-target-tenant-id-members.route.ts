// path: app/tenant/[tenantId]/api/tenants/[targetTenantId]/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { readListQuery } from "@kuraykaraaslan-labs/common/server/common.list-query";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import TenantMemberService from "./tenant_member.service";
import TenantMemberMessages from "./tenant_member.messages";
import { ListTenantMembersQuery } from "./tenant_member.dto";
import { profileNameOf } from "./tenant_member.peer-view";
import type { SafeTenantMember } from "./tenant_member.types";

const TargetTenantId = z.string().uuid();

/**
 * What the operator's members table shows of a member: who (e-mail, profile name), the role and status, and since
 * when. An allow-list, not the stored row: no phone, no global account fields, no suspension reason, no custom groups.
 */
function toOperatorView(m: SafeTenantMember) {
  return {
    tenantMemberId: m.tenantMemberId,
    tenantId: m.tenantId,
    userId: m.userId,
    memberRole: m.memberRole,
    memberStatus: m.memberStatus,
    createdAt: m.createdAt ?? null,
    displayName: profileNameOf(m.user as Parameters<typeof profileNameOf>[0]),
    user: m.user ? { userId: m.user.userId, email: m.user.email } : null,
  };
}

/**
 * GET /tenant/[tenantId]/api/tenants/[targetTenantId]/members
 * Root-tenant admin: the members of any tenant, for the members table on the operator's tenant page. Same permission and
 * scope as reading the tenant itself (as /api/tenants/[targetTenantId]/domains). Read-only: there is no POST here.
 *
 * (41-ui-fixes/09 A2.1) The table used to call the TARGET tenant's own TENANT-scoped /api/members through crossTenantPath:
 * only a legacy userRole ADMIN passed, a suspended tenant refused even them, and in path mode the session cookie (scoped to
 * /t/{root}) was not sent, so the operator was bounced to the target's login. This route is served on the operator's own
 * tenant and authorizes at GLOBAL scope.
 *
 * The list contract (phase 43): the member list's own params, filters and sort whitelist (`ListTenantMembersQuery`,
 * MEMBER_SORTABLE), `{ data, total }`. An unknown tenant is a 404, a malformed id a 400.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.read', scope: 'GLOBAL' });

    if (!TargetTenantId.safeParse(targetTenantId).success) {
      throw new AppError(TenantMemberMessages.INVALID_TENANT_ID, 400, ErrorCode.VALIDATION_ERROR);
    }
    const q = readListQuery(new URL(request.url).searchParams, ListTenantMembersQuery);
    // A 404 for a tenant that does not exist (or was deleted), rather than an empty list that reads as "no members".
    await TenantService.getById(targetTenantId);

    // The service counts pages from 1; its query carries the explicit `tenantId` predicate.
    const { members, total } = await TenantMemberService.getByTenantId({
      tenantId: targetTenantId,
      page: q.page + 1,
      pageSize: q.pageSize,
      search: q.search ?? null,
      memberRole: null,
      memberStatus: null,
      memberRoles: q.memberRole,
      memberStatuses: q.memberStatus,
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
      sort: q.sort,
    });

    return NextResponse.json({
      data: members.map(toOperatorView),
      total,
      page: q.page,
      pageSize: q.pageSize,
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
