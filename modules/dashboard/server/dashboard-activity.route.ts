import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { assertAuditLogEntitled } from '@kuraykaraaslan-labs/audit_log/server/audit_log.entitlement';
import { ActivityQueryDTO } from './activity.dto';
import { activityPage } from './dashboard.activity';

/**
 * GET /tenant/[tenantId]/api/dashboard/activity
 * The home's "Recent activity" (e2e run 1, E21 + V2-A1): the audit trail without its machine events, each row naming its actor
 * (`dashboard.activity.ts`). Query: page (from 1), pageSize (at most 50), severity, search (the action name), sort (createdAt),
 * filterTenantId (the root's feed). The same reads as the audit list: `audit_log.logs.read` and the audit plan entitlement for a
 * tenant's own trail; the root's feed spans every tenant and asks `audit_log.logs.read_cross_tenant` as well (the cross-tenant
 * view's permission). Nothing is written.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.read', scope: 'TENANT' });
    const crossTenant = isRootTenant(tenantId);
    if (crossTenant) await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.read_cross_tenant', scope: 'TENANT' });
    else await assertAuditLogEntitled(tenantId);
    const query = ActivityQueryDTO.parse(Object.fromEntries(new URL(request.url).searchParams));
    const page = await activityPage(tenantId, crossTenant, query);
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
