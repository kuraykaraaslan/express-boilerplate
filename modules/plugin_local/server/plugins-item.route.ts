// path: app/tenant/[ROOT]/api/plugin_local/plugins/[pluginId]/route.ts  (ROOT operator only)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { setPluginStatus } from './plugin_local.store.service';
import { PluginStatusDTO, UUID_RE, notFoundResponse, parseJsonBody } from './plugin_local.dto';

/** PUT { status: 'active' | 'disabled' } — the operator's platform-wide switch for one plugin. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string; pluginId: string }> }) {
  try {
    const { tenantId, pluginId } = await params;
    if (!isRootTenant(tenantId) || !UUID_RE.test(pluginId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const parsed = await parseJsonBody(request, PluginStatusDTO);
    if (!parsed.ok) return parsed.response;
    const plugin = await setPluginStatus(pluginId, parsed.data.status, user?.userId);
    return NextResponse.json({ success: true, plugin: { pluginId: plugin.pluginId, status: plugin.status } });
  } catch (e) {
    return normalizeError(e);
  }
}
