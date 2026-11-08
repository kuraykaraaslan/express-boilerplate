import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import TenantBrandingService from './tenant_branding.service';
import type { TenantBranding } from './tenant_branding.types';

/**
 * Branding image fields that accept a direct file upload. Each maps 1:1 to a
 * URL-bearing branding setting key; the uploaded object's public URL is written
 * back onto that key.
 */
export const BRANDING_ASSET_KEYS = [
  'brandLogoLight',
  'brandLogoDark',
  'brandIconLight',
  'brandIconDark',
  'brandFavicon',
  'authWallpaper',
] as const;
export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number];

/**
 * The only file types a branding image may be (tenant_branding.04, fixed 2026-10-20): raster images. Storage's default policy accepts
 * any extension without a magic-byte signature, so HTML, SVG (script-capable), JS, PHP, a double extension or no extension at all
 * used to be stored and published as the logo URL. Storage still checks the bytes against the extension.
 */
const BRANDING_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico'])

function assertBrandingImage(file: File): void {
  const name = String(file.name ?? '')
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const type = String(file.type ?? '').toLowerCase()
  if (!BRANDING_IMAGE_EXTENSIONS.has(ext) || (type !== '' && (!type.startsWith('image/') || type.includes('svg')))) {
    throw new AppError('A branding asset must be a PNG, JPEG, GIF, WebP, AVIF or ICO image', 415, ErrorCode.VALIDATION_ERROR)
  }
}

export interface BrandingAssetUploadResult {
  key: BrandingAssetKey;
  url: string;
  branding: TenantBranding;
}

/**
 * Upload a branding image (logo / favicon / wallpaper) through the tenant's
 * configured storage (S3) and persist the resulting object URL onto the matching
 * branding setting key. Replaces "paste an externally-hosted URL" with a managed
 * object the platform controls — residency, lifecycle, content-derived MIME +
 * size validation and virus scanning — the same guarantees `user_profile` gets
 * for avatars.
 *
 * Storage validates the file content-side (magic-byte MIME, size, EXIF strip,
 * scan) in `StorageService.uploadFile`; no separate type/size check is duplicated
 * here. The URL is then routed through `TenantBrandingService.update`, which
 * enforces the URL-safety rules, busts the branding cache and writes the audit
 * log entry.
 */
export async function uploadBrandingAsset(
  tenantId: string,
  target: BrandingAssetKey,
  file: File,
  actorId?: string,
): Promise<BrandingAssetUploadResult> {
  assertBrandingImage(file);
  const result = await StorageService.uploadFile(tenantId, {
    file,
    folder: 'branding',
    tenantId,
  });

  const patch: Partial<Record<BrandingAssetKey, string>> = { [target]: result.url };
  const branding = await TenantBrandingService.update(tenantId, patch, actorId);

  return { key: target, url: result.url, branding };
}
