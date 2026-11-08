import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { storeOverview } from './telemetry.admin';

/**
 * GET /tenant/[tenantId]/api/telemetry/admin/store — what the store holds for this tenant (docs/phases/42-telemetry/02 §2.7): the
 * registered kinds, the tenant's class bindings, its key count, its latest rows per kind, the lanes and the listener queue.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // The store overview is the platform operator's page (owner 2026-10-27): placed root, the root super-admin only.
    await authorizeRequest({ request, tenantId, requiredPermission: 'telemetry.admin.read', scope: 'GLOBAL' });
    return NextResponse.json(await storeOverview(tenantId), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
