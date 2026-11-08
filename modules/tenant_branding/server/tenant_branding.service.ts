import 'reflect-metadata';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { TENANT_BRANDING_KEYS } from './tenant_branding.setting.keys';
import { TenantBrandingSchema } from './tenant_branding.types';
import type { TenantBranding } from './tenant_branding.types';

// Branding is read on virtually every page render (logo, colours, custom CSS)
// but changes only when an admin updates it — an ideal read-through cache target.
// The underlying SettingService keys are cached individually; this consolidates
// the whole branding object into one key so a render does a single GET + no Zod
// re-parse. Invalidated explicitly on update()/reset().
const BRANDING_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);

function cacheKey(tenantId: string): string {
  return `tenant_branding:${tenantId}`;
}

/** UNLINK every key matching `pattern`, SCANning in batches (never KEYS). Best effort: a cache entry left behind expires. */
const SWEEP_MAX_ROUNDS = 10_000;

async function sweep(pattern: string): Promise<void> {
  try {
    let cursor = '0';
    // The cursor is compared as text (a client may hand back the number 0), and the walk is bounded, so a cursor that
    // never comes back to 0 cannot spin forever.
    for (let round = 0; round < SWEEP_MAX_ROUNDS; round++) {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = String(next ?? '0');
      if (Array.isArray(keys) && keys.length > 0) await redis.unlink(...keys).catch(() => 0);
      if (cursor === '0') return;
    }
  } catch { /* the TTL still bounds staleness */ }
}

// Patterns unsafe in injected CSS: IE expression(), JS URLs, data-URI backgrounds, @import exfiltration.
const UNSAFE_CSS_PATTERNS = [
  /expression\s*\(/gi,
  /url\s*\(\s*['"]?\s*javascript:/gi,
  /url\s*\(\s*['"]?\s*data:/gi,
  /@import\b/gi,
  /<\/?\s*script/gi,
  // CSS escapes decode before the parser sees the keyword: `@\69mport`, `url(j\61vascript:…)`. tenant_branding.05 (fixed
  // 2026-10-20): an escape anywhere inside the at-keyword (`@i\6d port`) is caught too, not only one right after the `@`.
  /@\s*[\w-]*\\/g,
  /url\s*\(\s*['"]?[^)]*\\/gi,
];

export function sanitizeCss(raw: string): string {
  return UNSAFE_CSS_PATTERNS.reduce((s, p) => s.replace(p, '/* blocked */'), raw);
}

// URL-bearing keys: must be absolute http(s) or root-relative — never
// javascript:/data:/vbscript: (stored-XSS via logo/link rendering).
const URL_KEYS = new Set<string>([
  'brandLogoLight', 'brandLogoDark', 'brandIconLight', 'brandIconDark', 'brandFavicon', 'authWallpaper',
  'privacyPolicyUrl', 'termsOfServiceUrl',
]);
const COLOR_KEYS = new Set<string>(['brandPrimaryColor', 'brandSecondaryColor']);

function assertSafeUrl(key: string, value: string): void {
  if (value === '') return; // clearing the value
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new AppError(`Invalid URL for ${key}`, 422, ErrorCode.VALIDATION_ERROR);
  if (value.startsWith('/')) {
    // Root-relative only when it stays on this origin: `//host`, `/\host` (and control characters) point elsewhere.
    const base = 'https://origin.invalid';
    let resolved: URL;
    try { resolved = new URL(value, base); } catch { throw new AppError(`Invalid URL for ${key}`, 422, ErrorCode.VALIDATION_ERROR); }
    if (resolved.origin !== base) throw new AppError(`Invalid URL for ${key}`, 422, ErrorCode.VALIDATION_ERROR);
    return;
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(`Invalid URL for ${key}`, 422, ErrorCode.VALIDATION_ERROR); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(`URL for ${key} must use http(s)`, 422, ErrorCode.VALIDATION_ERROR);
  }
}

function assertHexColor(key: string, value: string): void {
  if (value === '') return;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) {
    throw new AppError(`Color for ${key} must be a hex value like #1a2b3c`, 422, ErrorCode.VALIDATION_ERROR);
  }
}

export default class TenantBrandingService {

  static async get(tenantId: string): Promise<TenantBranding> {
    const key = cacheKey(tenantId);
    const cached = await redis.get(key).catch(() => null);
    if (cached) {
      try { return TenantBrandingSchema.parse(JSON.parse(cached)); } catch { await redis.del(key).catch(() => {}); }
    }

    return singleFlight(key, async () => {
      const raw = await SettingService.getByKeys(tenantId, [...TENANT_BRANDING_KEYS]);
      const parsed = TenantBrandingSchema.parse(raw);
      await redis.setex(key, jitter(BRANDING_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
      return parsed;
    });
  }

  /**
   * Drop the consolidated branding cache (called after any settings write). A ROOT write drops every tenant's entry
   * too: a tenant that set no favicon, name or color of its own reads the root's (tenant_setting inheritance), and its
   * cached branding would otherwise show the root's old values until the TTL ran out.
   */
  private static async invalidate(tenantId: string): Promise<void> {
    await redis.del(cacheKey(tenantId)).catch(() => {});
    // notification_mail caches the allowlisted brand per tenant; its key is part of
    // that module's contract (notification_mail.brand.service), not imported here.
    await redis.del(`notification_mail:brand:${tenantId}`).catch(() => {});
    if (isRootTenant(tenantId)) {
      await sweep('tenant_branding:*');
      await sweep('notification_mail:brand:*');
    }
  }

  static async update(tenantId: string, data: Partial<TenantBranding>, actorId?: string): Promise<TenantBranding> {
    const updates: Record<string, string> = {};

    for (const key of TENANT_BRANDING_KEYS) {
      let value = data[key];
      if (value === undefined) continue;
      if (key === 'customCss') value = sanitizeCss(value);
      if (key === 'customJs') value = value.replace(/<\/?\s*script[^>]*>/gi, '/* blocked */');
      if (URL_KEYS.has(key)) assertSafeUrl(key, value);
      if (COLOR_KEYS.has(key)) assertHexColor(key, value);
      updates[key] = value;
    }

    if (Object.keys(updates).length > 0) {
      await SettingService.updateMany(tenantId, updates);
      await this.invalidate(tenantId);
    }

    if (actorId) {
      // tenant_branding.03 (fixed 2026-10-20): filed under the branded tenant, not under ROOT (the audit default without a tenantId).
      AuditLogService.log({
        tenantId,
        actorType: 'USER',
        actorId,
        action: AuditActions.SETTINGS_UPDATED,
        resourceType: 'tenant_branding',
        resourceId: tenantId,
        metadata: { tenantId, changedKeys: Object.keys(updates) },
      });
    }

    return this.get(tenantId);
  }

  static async reset(tenantId: string, actorId?: string): Promise<void> {
    for (const key of TENANT_BRANDING_KEYS) {
      await SettingService.delete(tenantId, key).catch(() => {});
    }
    await this.invalidate(tenantId);

    if (actorId) {
      AuditLogService.log({
        tenantId,
        actorType: 'USER',
        actorId,
        action: AuditActions.SETTINGS_UPDATED,
        resourceType: 'tenant_branding',
        resourceId: tenantId,
        metadata: { tenantId, reset: true },
      });
    }
  }
}
