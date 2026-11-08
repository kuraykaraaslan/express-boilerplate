import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import TenantRoleService from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.service';
import { CreateRoleDTO } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.dto';
import { isSensitive, unknownPermissionIds } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.helpers';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/** GET /tenant/[tenantId]/api/access-control/roles — list roles/groups (admin). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
    const [roles, memberCounts] = await Promise.all([
      TenantRoleService.listRoles(tenantId),
      TenantRoleService.memberCounts(tenantId),
    ]);
    return NextResponse.json({ roles, memberCounts }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** POST /tenant/[tenantId]/api/access-control/roles — create a custom group (admin; OWNER for sensitive). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = CreateRoleDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // A sensitive id (members.manage_owner, abac.*, ...) is the OWNER's alone: refused 403 first, whether or not it is a known id, so
    // the answer to a non-owner never depends on the catalog.
    if (tenantMember?.memberRole !== 'OWNER' && parsed.data.permissions.some((id) => isSensitive(id))) {
      return NextResponse.json({ message: 'Only the workspace owner can grant or change a sensitive permission' }, { status: 403 });
    }
    // tenant_member.11 (fixed 2026-10-20): only permission ids from the catalog may be granted.
    const unknownIds = unknownPermissionIds(parsed.data.permissions);
    if (unknownIds.length) {
      return NextResponse.json({ message: `Unknown permission id: ${unknownIds.join(', ')}` }, { status: 400 });
    }
    const role = await TenantRoleService.createRole(tenantId, parsed.data, {
      isOwner: tenantMember?.memberRole === 'OWNER',
      actorId: user.userId,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
