// path: app/tenant/[ROOT]/api/plugin_local/versions/[versionId]/route.ts  (ROOT operator only)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { approveVersion, yankVersion, parseGrant } from './plugin_local.store.service';
import { UUID_RE, VersionActionDTO, notFoundResponse, parseJsonBody } from './plugin_local.dto';

/**
 * PUT { action: 'approve', grant? } — approve the version's sandbox grant (default: what the manifest requests; it
 *     may only narrow it; limits are capped at the platform maximum).
 * PUT { action: 'yank', reason? } — never installable or runnable again; warm isolates are evicted.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string; versionId: string }> }) {
  try {
    const { tenantId, versionId } = await params;
    if (!isRootTenant(tenantId) || !UUID_RE.test(versionId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const parsed = await parseJsonBody(request, VersionActionDTO);
    if (!parsed.ok) return parsed.response;
    const version = parsed.data.action === 'approve'
      ? await approveVersion(versionId, parsed.data.grant, user?.userId)
      : await yankVersion(versionId, parsed.data.reason, user?.userId);
    return NextResponse.json({
      success: true,
      version: { versionId: version.versionId, version: version.version, grant: parseGrant(version.sandboxJson), yanked: !!version.yankedAt },
    });
  } catch (e) {
    return normalizeError(e);
  }
}
