import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * GET /tenant/[tenantId]/api/storage/bucket-cors
 * Does the tenant's bucket allow the browser-direct upload PUT from every origin
 * the tenant's pages are served on? Answers `{ state, bucket, origins, missingOrigins, code?, httpStatus? }`
 * (see `storage.bucket-cors.ts`). Read-only: it never changes the bucket.
 *
 * Guarded like the Storage settings page that calls it (docs/phases/45-install-config,
 * the settings guard): storage's own settings permission beside the generic setting
 * permission, so removing either (a role, config/access.ts) closes it with the page.
 * The answer names the bucket and the tenant's domains.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'storage.settings.read', scope: 'TENANT' });
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.read', scope: 'TENANT' });
    return NextResponse.json(await StorageService.getBucketCorsStatus(tenantId));
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/storage/bucket-cors
 * Merge the direct-upload CORS rule into the bucket's CORS configuration (the
 * bucket's other rules are kept). Answers `{ applied, status }`; `applied` is
 * false with the reason in `status.state` when the store refuses or does not
 * implement the API. Changes the bucket, so it needs storage's settings read and
 * update permissions and the generic settings-update permission, as a write of the
 * storage keys does (`/api/admin-settings`), and it is audited (`storage.bucket_cors.applied`).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'storage.settings.read', scope: 'TENANT' });
    await authorizeRequest({ request, tenantId, requiredPermission: 'storage.settings.update', scope: 'TENANT' });
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.update', scope: 'TENANT' });

    const ip =
      clientIpOf(request.headers) ?? undefined;
    const userAgent = request.headers.get('user-agent') ?? undefined;

    return NextResponse.json(await StorageService.applyBucketCors(tenantId, { userId: auth.user.userId, origin: { ip, userAgent } }));
  } catch (e) {
    return normalizeError(e);
  }
}
