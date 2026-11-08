import redis from '@kuraykaraaslan-labs/redis';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { notificationMailBrandSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/notification_mail.brand_source';
import { mergeBrands, sanitizeBrandPatch } from './notification_mail.brand';
import {
  MAIL_BRAND_SOURCE_POINT,
  type MailBrandSource,
  type SanitizedBrand,
} from './notification_mail.brand.types';

/**
 * Redis key of a tenant's merged, sanitized brand.
 *
 * `tenant_branding` and `tenant_domain` DELETE this exact key from their
 * existing write paths (they cannot import this module: `tenant_branding` has no
 * reason to depend on mail, and `tenant_domain` already sits behind it). The
 * string is therefore part of the contract — change it in all three places.
 */
export const MAIL_BRAND_CACHE_PREFIX = 'notification_mail:brand:';
export const MAIL_BRAND_CACHE_TTL_SECONDS = 300;

const EMPTY: SanitizedBrand = { name: null, logoUrl: null, primaryColor: null, baseUrl: null };

export const mailBrandCacheKey = (tenantId: string): string => `${MAIL_BRAND_CACHE_PREFIX}${tenantId}`;

/** Drop a tenant's cached brand (also callable by an owner that does import this module). */
export async function invalidateMailBrand(tenantId: string): Promise<void> {
  await redis.del(mailBrandCacheKey(tenantId)).catch(() => {});
}

/**
 * Ask every `notification_mail:brand_source` contribution of a module active for
 * the tenant and merge the validated answers, in contribution order. A source
 * that throws, times out or is not installed is skipped (the host runtime logs
 * it) — missing or empty means the platform default, never an error, so
 * `notification_mail` renders with `tenant_branding` and `tenant_domain`
 * disabled.
 */
async function loadFromSources(tenantId: string): Promise<SanitizedBrand> {
  const { results } = await ext.aggregate<MailBrandSource, SanitizedBrand>(
    MAIL_BRAND_SOURCE_POINT, tenantCtx(tenantId), notificationMailBrandSourceLoaders,
    async (source) => sanitizeBrandPatch(await source.load(tenantId)),
  );
  return results.length ? mergeBrands(results.map((r) => r.value)) : EMPTY;
}

/**
 * The tenant's brand (sanitized, possibly all-null), cached 5 minutes in Redis
 * and invalidated by the branding and domain write paths. A Redis outage falls
 * through to a live read: branding must never be the reason a security mail
 * does not go out.
 */
export async function resolveMailBrand(tenantId?: string | null): Promise<SanitizedBrand> {
  if (!tenantId) return EMPTY;
  const key = mailBrandCacheKey(tenantId);
  try {
    const cached = await redis.get(key);
    if (cached) return { ...EMPTY, ...(JSON.parse(cached) as Partial<SanitizedBrand>) };
  } catch { /* fall through to a live read */ }
  const brand = await loadFromSources(tenantId).catch(() => EMPTY);
  await redis.setex(key, MAIL_BRAND_CACHE_TTL_SECONDS, JSON.stringify(brand)).catch(() => {});
  return brand;
}
