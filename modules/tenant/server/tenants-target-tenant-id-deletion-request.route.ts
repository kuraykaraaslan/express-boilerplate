import { NextRequest, NextResponse } from 'next/server';
import TenantDeletionService, { DELETION_GRACE_DAYS, OWNER_CANCELLABLE_REQUESTERS } from '@kuraykaraaslan-labs/tenant/server/tenant.deletion.service';
import { DeletionRequestDTO } from '@kuraykaraaslan-labs/tenant/server/tenant.dto';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';

/**
 * The permission each handler asks for. 1.7: written as a literal inside each exported handler and passed down as an object
 * literal (no const, no spread): the ABAC coverage inventory (scripts/registry/abac-coverage.mjs) reads it only from a
 * handler's own body, and the drift gate (scripts/check-drift.mjs) resolves it only through object-literal arguments.
 */
type Access = { requiredPermission: 'tenant.deletion.request' };
const FORBIDDEN = 'Only an owner of this organization can manage its deletion';

type Params = { params: Promise<{ tenantId: string; targetTenantId: string }> };

/**
 * 04-tenant-setting 1.7: is the caller an OWNER of this very tenant, in person? An active, real membership: a global admin's
 * virtual OWNER and an impersonation are not (an operator goes through the GLOBAL path, behind the admin gate).
 */
function isOwnerInPerson(auth: TenantAuthResult, tenantId: string): boolean {
  const m = auth.tenantMember;
  return !auth.isGlobalAdmin && !auth.isImpersonating
    && auth.tenant?.tenantId === tenantId
    && m?.tenantId === tenantId && m.userId === auth.user?.userId
    && m.memberRole === 'OWNER' && m.memberStatus === 'ACTIVE';
}

/** The OWNER check at TENANT scope, bound to the URL's tenant; throws 401 / 403. */
async function authorizeOwner(request: NextRequest, tenantId: string, access: Access): Promise<void> {
  const auth = await authorizeRequest({ request, tenantId, requiredPermission: access.requiredPermission, requiredTenantRole: 'OWNER', scope: 'TENANT' });
  if (!isOwnerInPerson(auth, tenantId)) throw new AppError(FORBIDDEN, 403, ErrorCode.FORBIDDEN);
}

const isRefusal = (e: unknown) => e instanceof AppError && (e.statusCode === 401 || e.statusCode === 403);

/**
 * Who may schedule or cancel the deletion of `targetTenantId`:
 *  - 04-tenant-setting 1.7 (owner decision): the tenant's own OWNER, only for the tenant of the URL (never another one, never a
 *    reserved platform tenant);
 *  - the platform operator (GLOBAL scope: root admin behind the admin gate), for any tenant, as before.
 * When the owner check refuses, the GLOBAL path is still tried (an operator on the tenant's own URL); if that refuses too, the
 * owner check's answer is returned, so a tenant ADMIN reads 403, not the admin gate's 401.
 */
async function authorizeDeletion(request: NextRequest, tenantId: string, targetTenantId: string, access: Access): Promise<'OWNER' | 'OPERATOR'> {
  if (targetTenantId === tenantId && !isReservedTenant(tenantId)) {
    try {
      await authorizeOwner(request, tenantId, { requiredPermission: access.requiredPermission });
      return 'OWNER';
    } catch (ownerRefusal) {
      if (!isRefusal(ownerRefusal)) throw ownerRefusal;
      try {
        await authorizeRequest({ request, requiredPermission: access.requiredPermission, scope: 'GLOBAL' });
        return 'OPERATOR';
      } catch {
        throw ownerRefusal;
      }
    }
  }
  await authorizeRequest({ request, requiredPermission: access.requiredPermission, scope: 'GLOBAL' });
  return 'OPERATOR';
}

/**
 * GET /tenant/[tenantId]/api/tenants/[targetTenantId]/deletion-request
 * 04-tenant-setting 1.7: the deletion state the settings page's danger zone starts from. The tenant's own OWNER only, for its own
 * tenant (operators read the platform console's tenant detail). `requestedBy`: who asked for the pending deletion (null while none is
 * pending, and on one requested before tenant migration 134, which the owner's cancel treats as the operator's).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeOwner(request, tenantId, { requiredPermission: 'tenant.deletion.request' });
    if (targetTenantId !== tenantId || isReservedTenant(tenantId)) throw new AppError(FORBIDDEN, 403, ErrorCode.FORBIDDEN);
    const status = await TenantDeletionService.deletionStatus(tenantId);
    if (!status) throw new AppError('Tenant not found', 404, ErrorCode.TENANT_NOT_FOUND);
    const pending = status.tenantStatus === 'PENDING_DELETION';
    return NextResponse.json({
      tenantStatus: status.tenantStatus,
      deleteAfter: pending ? status.deleteAfter?.toISOString() ?? null : null,
      requestedBy: pending ? status.deletionRequestedBy : null,
    });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/tenants/[targetTenantId]/deletion-request
 * Schedule or cancel deletion of a target tenant: the platform operator for any tenant, or (1.7) the tenant's own OWNER.
 * A tenant already scheduled is a 409 with its `deleteAfter` (the grace period is never restarted); success returns `deleteAfter`.
 * 1.7: the request is stored with its requester (OWNER or OPERATOR); an OWNER may cancel only an owner's or a self-service request
 * (403, `details.reason` 'REQUESTED_BY_OPERATOR' otherwise), the operator any.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    const actor = await authorizeDeletion(request, tenantId, targetTenantId, { requiredPermission: 'tenant.deletion.request' });
    const body = await request.json().catch(() => ({}));
    const { cancel, graceDays } = DeletionRequestDTO.parse(body);

    if (cancel) {
      await TenantDeletionService.cancelDeletion(targetTenantId, actor === 'OWNER' ? { onlyRequestedBy: OWNER_CANCELLABLE_REQUESTERS } : {});
      return NextResponse.json({ message: 'Deletion request cancelled. Tenant restored to ACTIVE.' });
    }
    // 1.7: shortening the grace period (the owners' last chance to stop it) is an operator decision
    if (actor === 'OWNER' && graceDays !== undefined && graceDays < DELETION_GRACE_DAYS) {
      throw new AppError(`Only a platform operator can set a grace period shorter than ${DELETION_GRACE_DAYS} days`, 403, ErrorCode.FORBIDDEN);
    }
    const { deleteAfter } = await TenantDeletionService.requestDeletion(targetTenantId, graceDays, { requestedBy: actor, refuseIfPending: true });
    return NextResponse.json({
      message: `Deletion scheduled. Tenant will be permanently deleted after ${graceDays ?? DELETION_GRACE_DAYS} days.`,
      deleteAfter: deleteAfter.toISOString(),
    });
  } catch (e) {
    return normalizeError(e);
  }
}
