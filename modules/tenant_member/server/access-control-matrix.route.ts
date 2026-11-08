import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import TenantRoleService from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.service';
import { SaveMatrixDTO } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.dto';
import { unknownPermissionIds } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.helpers';
import { ownerOnlyMatrixChanges } from './tenant_role.owner-only';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/** GET /tenant/[tenantId]/api/access-control/matrix — the access-rights matrix (admin). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
    return NextResponse.json(await TenantRoleService.getMatrix(tenantId), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PUT /tenant/[tenantId]/api/access-control/matrix — save grant changes (admin; OWNER for sensitive). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = SaveMatrixDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // A sensitive id (members.manage_owner, abac.*, ...) and the OWNER column are the OWNER's alone: refused 403 first, whether or not
    // it is a known id, so the answer to a non-owner never depends on the catalog. 05-tenant-member 2.2: only a cell the save would
    // actually change counts (compared against the stored set), so a batch that merely repeats an owner's grant is not refused.
    // The service asks again under the role-set lock.
    if (tenantMember?.memberRole !== 'OWNER'
      && ownerOnlyMatrixChanges(parsed.data.changes, await TenantRoleService.listRoles(tenantId)).length) {
      return NextResponse.json({ message: 'Only the workspace owner can grant or change a sensitive permission' }, { status: 403 });
    }
    // tenant_member.11 (fixed 2026-10-20): only permission ids from the catalog may be granted.
    const unknownIds = unknownPermissionIds(parsed.data.changes.filter((c) => c.granted).map((c) => c.permissionId));
    if (unknownIds.length) {
      return NextResponse.json({ message: `Unknown permission id: ${unknownIds.join(', ')}` }, { status: 400 });
    }
    await TenantRoleService.saveMatrix(tenantId, parsed.data.changes, {
      isOwner: tenantMember?.memberRole === 'OWNER',
      actorId: user.userId,
    });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
