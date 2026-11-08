// path: app/tenant/[tenantId]/api/plugin_local/installed/route.ts  (tenant admin)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { listTenantLocalPlugins } from './plugin_local.config.service';

/** GET — the local plugins the operator installed for this tenant, with their settings (secrets as set-status only). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.config.read', scope: 'TENANT' });
    return NextResponse.json({ success: true, plugins: await listTenantLocalPlugins(tenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
