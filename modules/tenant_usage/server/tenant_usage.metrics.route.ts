import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { listDeclaredUsage } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.declared.service';

/**
 * GET /tenant/[tenantId]/api/tenant-usage/metrics
 * Declared period metrics with value and plan quota (label, unit, value, quota) for
 * the tenant's usage screen.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_usage.metrics.read', scope: 'TENANT' });
    return NextResponse.json({ metrics: await listDeclaredUsage(tenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
