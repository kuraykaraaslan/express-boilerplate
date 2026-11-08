// path: app/tenant/[ROOT]/api/plugin_local/plugins/[pluginId]/installs/route.ts  (ROOT operator only)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { installLocal, listInstalls, setLocalActive, uninstallLocal } from './plugin_local.install.service';
import { InstallActionDTO, UUID_RE, notFoundResponse, parseJsonBody } from './plugin_local.dto';

/** GET — the tenants this plugin is installed for (version, active, whether plugin_local is enabled there). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; pluginId: string }> }) {
  try {
    const { tenantId, pluginId } = await params;
    if (!isRootTenant(tenantId) || !UUID_RE.test(pluginId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    return NextResponse.json({ success: true, installs: await listInstalls(pluginId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT { tenantId, action: 'install' | 'activate' | 'deactivate' | 'uninstall', versionId? } — the operator installs,
 * switches or removes the plugin for one tenant. `install` takes the current approved version unless `versionId` pins one.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string; pluginId: string }> }) {
  try {
    const { tenantId, pluginId } = await params;
    if (!isRootTenant(tenantId) || !UUID_RE.test(pluginId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const parsed = await parseJsonBody(request, InstallActionDTO);
    if (!parsed.ok) return parsed.response;
    const { tenantId: target, action, versionId } = parsed.data;
    const actor = user?.userId;
    if (action === 'install') return NextResponse.json({ success: true, ...(await installLocal(target, pluginId, actor, { versionId })) });
    if (action === 'uninstall') return NextResponse.json({ success: true, ...(await uninstallLocal(target, pluginId, actor)) });
    await setLocalActive(target, pluginId, action === 'activate', actor);
    return NextResponse.json({ success: true });
  } catch (e) {
    return normalizeError(e);
  }
}
