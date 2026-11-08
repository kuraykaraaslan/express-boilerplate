// path: app/tenant/[tenantId]/api/settings/branding/asset/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import {
  uploadBrandingAsset,
  BRANDING_ASSET_KEYS,
  type BrandingAssetKey,
} from './tenant_branding.media.service';

/**
 * POST /tenant/[tenantId]/api/settings/branding/asset
 * Upload a branding image (logo / favicon / wallpaper) to the tenant's storage
 * (S3) and set the resulting object URL on the matching branding field
 * (tenant:admin). Replaces hot-linking an externally-hosted URL.
 *
 * Body (FormData):
 * - file:   File (required) — validated content-side by storage (MIME/size/scan)
 * - target: string (required) — one of BRANDING_ASSET_KEYS
 *           (brandLogoLight | brandLogoDark | brandFavicon | authWallpaper)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({
      request,
      tenantId,
      requiredPermission: 'tenant_branding.branding.update',
      scope: 'TENANT',
    });

    const formData = await request.formData();
    const file = formData.get('file');
    const target = formData.get('target') as string;

    if (!(file instanceof File)) {
      return NextResponse.json({ message: 'File is required' }, { status: 400 });
    }
    if (!BRANDING_ASSET_KEYS.includes(target as BrandingAssetKey)) {
      return NextResponse.json(
        { message: `target must be one of: ${BRANDING_ASSET_KEYS.join(', ')}` },
        { status: 400 },
      );
    }

    const result = await uploadBrandingAsset(tenantId, target as BrandingAssetKey, file, auth.user.userId);

    return NextResponse.json(
      { message: 'Branding asset uploaded', key: result.key, url: result.url, branding: result.branding },
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
