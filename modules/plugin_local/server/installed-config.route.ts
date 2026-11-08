// path: app/tenant/[tenantId]/api/plugin_local/installed/[pluginId]/config/route.ts  (tenant admin)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { getLocalPluginConfig, setLocalPluginConfig } from './plugin_local.config.service';
import { SetLocalPluginConfigDTO, UUID_RE, notFoundResponse, parseJsonBody } from './plugin_local.dto';

const NOT_INSTALLED = 'The plugin is not installed for this workspace.';

/** GET — declared settings with values and secrets as set-status only (a secret value is never returned). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; pluginId: string }> }) {
  try {
    const { tenantId, pluginId } = await params;
    if (!UUID_RE.test(pluginId)) return notFoundResponse(NOT_INSTALLED);
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.config.read', scope: 'TENANT' });
    const config = await getLocalPluginConfig(tenantId, pluginId);
    if (!config) return notFoundResponse(NOT_INSTALLED);
    return NextResponse.json({ success: true, config });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PUT { settings?, secrets? } — writes declared keys only; secrets are encrypted; a blank secret keeps the stored one. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string; pluginId: string }> }) {
  try {
    const { tenantId, pluginId } = await params;
    if (!UUID_RE.test(pluginId)) return notFoundResponse(NOT_INSTALLED);
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.config.write', scope: 'TENANT' });
    const parsed = await parseJsonBody(request, SetLocalPluginConfigDTO);
    if (!parsed.ok) return parsed.response;
    const config = await setLocalPluginConfig(tenantId, pluginId, parsed.data, user?.userId);
    if (!config) return notFoundResponse(NOT_INSTALLED);
    return NextResponse.json({ success: true, config });
  } catch (e) {
    return normalizeError(e);
  }
}
