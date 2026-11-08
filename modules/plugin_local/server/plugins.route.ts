// path: app/tenant/[ROOT]/api/plugin_local/plugins/route.ts  (ROOT operator only)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { listPlugins, uploadVersion } from './plugin_local.store.service';
import { readTrustPolicy } from './plugin_local.trust';
import { MAX_UPLOAD_BODY_BYTES, UploadVersionDTO, notFoundResponse, parseJsonBody } from './plugin_local.dto';

/** GET — every local plugin with its versions, requested and approved grants, and the trust policy. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const [plugins, trust] = await Promise.all([listPlugins(), readTrustPolicy()]);
    return NextResponse.json({
      success: true,
      plugins,
      trust: { requireSigned: trust.requireSigned, trustedKeys: trust.trustedKeys, maxLimits: trust.maxLimits },
    });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST { manifestJson, bundleBase64, scopedName?, bundleSha256?, signature?, signerKid? } — upload a version
 * (creating the plugin on first upload). It lands unapproved.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) return notFoundResponse();
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'plugin_local.plugins.manage', scope: 'GLOBAL' });
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_UPLOAD_BODY_BYTES) {
      return NextResponse.json({ success: false, message: 'The upload is too large (bundle max 5 MB).' }, { status: 413 });
    }
    // The header is only a fast path: the body is also counted as it is read (a chunked upload has no content-length).
    const parsed = await parseJsonBody(request, UploadVersionDTO, { maxBytes: MAX_UPLOAD_BODY_BYTES });
    if (!parsed.ok) return parsed.response;
    const { plugin, version } = await uploadVersion(parsed.data, user?.userId);
    return NextResponse.json({
      success: true,
      plugin: { pluginId: plugin.pluginId, scopedName: plugin.scopedName, name: plugin.name },
      version: { versionId: version.versionId, version: version.version, bundleSha256: version.bundleSha256, signatureVerified: version.signatureVerified },
    }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
