import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import TenantRoleService from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.service';
import { UpdateRoleDTO } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.dto';
import { unknownPermissionIds } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.helpers';
import { holdsSensitive, roleUpdateNeedsOwner } from './tenant_role.owner-only';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

type Ctx = { params: Promise<{ tenantId: string; roleKey: string }> };

/** PUT /tenant/[tenantId]/api/access-control/roles/[roleKey] — update a role (admin; OWNER for sensitive). */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, roleKey } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = UpdateRoleDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // A sensitive id (members.manage_owner, abac.*, ...) is the OWNER's alone: refused 403 first, whether or not it is a known id, so
    // the answer to a non-owner never depends on the catalog. 05-tenant-member 2.2 / 3.2: refused is a CHANGE against the stored
    // group (adding or removing one, the OWNER role's grants, switching off a group that holds one), not a sensitive id that is
    // already there. A group not in the set is left to the service's 404. The service asks again under the role-set lock.
    if (tenantMember?.memberRole !== 'OWNER') {
      const stored = (await TenantRoleService.listRoles(tenantId)).find((r) => r.key === roleKey);
      if (stored && roleUpdateNeedsOwner(roleKey, { permissions: stored.permissions, isActive: stored.isActive !== false, isBuiltin: stored.isBuiltin }, parsed.data)) {
        return NextResponse.json({ message: 'Only the workspace owner can grant or change a sensitive permission' }, { status: 403 });
      }
    }
    // tenant_member.11 (fixed 2026-10-20): only permission ids from the catalog may be granted.
    const unknownIds = unknownPermissionIds(parsed.data.permissions ?? []);
    if (unknownIds.length) {
      return NextResponse.json({ message: `Unknown permission id: ${unknownIds.join(', ')}` }, { status: 400 });
    }
    const role = await TenantRoleService.updateRole(tenantId, roleKey, parsed.data, {
      isOwner: tenantMember?.memberRole === 'OWNER',
      actorId: user.userId,
    });
    return NextResponse.json({ role }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE /tenant/[tenantId]/api/access-control/roles/[roleKey] — delete a custom group (admin; OWNER for a group holding a sensitive permission). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, roleKey } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
    const isOwner = tenantMember?.memberRole === 'OWNER';
    // 05-tenant-member 3.2: deleting a group that holds a sensitive permission revokes it from every holder: the OWNER's alone.
    if (!isOwner) {
      const stored = (await TenantRoleService.listRoles(tenantId)).find((r) => r.key === roleKey);
      if (stored && holdsSensitive(stored.permissions)) {
        return NextResponse.json({ message: 'Only the workspace owner can delete a group that holds a sensitive permission' }, { status: 403 });
      }
    }
    // The service checks it again under the role-set lock (it reads `isOwner` from these options).
    const { unassignedMembers } = await TenantRoleService.deleteRole(tenantId, roleKey, { actorId: user.userId, isOwner });
    return NextResponse.json({ success: true, unassignedMembers }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
