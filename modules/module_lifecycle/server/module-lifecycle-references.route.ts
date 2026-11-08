// path: app/tenant/[tenantId]/api/marketplace/references/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { orphanReport, referencesTo } from './module-lifecycle.references';

/**
 * GET /tenant/[tenantId]/api/marketplace/references            — the orphan report: references to modules that are
 *                                                                 not active in this workspace.
 * GET /tenant/[tenantId]/api/marketplace/references?moduleId=x — what switching x off or removing it would leave
 *                                                                 behind (the impact preview, EXT-6).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'marketplace.modules.read', scope: 'TENANT' });
    const moduleId = request.nextUrl.searchParams.get('moduleId');
    return NextResponse.json(moduleId ? { impact: await referencesTo(tenantId, moduleId) } : { items: await orphanReport(tenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
