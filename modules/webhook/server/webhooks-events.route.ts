import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { catalogForScope, groupedCatalogForScope, scopeForTenant } from '@kuraykaraaslan-labs/webhook/server/webhook.catalog';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/events
 * Returns the subscribable webhook event catalog for this tenant's scope (ADMIN+).
 * Root tenant → platform-wide events; regular tenant → tenant-local events. The catalog is what the installed
 * modules declare through `webhook:event_type`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.events.read', scope: 'TENANT' });

    const scope = scopeForTenant(isRootTenant(tenantId));
    return NextResponse.json(
      {
        scope,
        events: await catalogForScope(scope),
        groups: await groupedCatalogForScope(scope),
      },
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
