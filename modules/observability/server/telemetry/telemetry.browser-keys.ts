/**
 * Browser ingest keys (phase 18.7). A browser key is PUBLIC: it sits in the page source of every visitor. That cannot be fixed, so the key is
 * made nearly useless to anyone who copies it:
 *
 *  - Its own scope, `telemetry:browser:write`. It is not `telemetry:write`: the scope the server-side exporters use never works from a page, and
 *    this one never works for traces. A browser key can write METRICS named `browser_*` and logs, nothing else.
 *  - An Origin allow-list, per key, kept here (the `api_key` entity has no such field and is not this module's to change): a request whose
 *    `Origin` header is not exactly one of the listed origins is refused. A key with no entry here is refused outright (fail closed).
 *  - A low rate limit per key (default 60 requests a minute) and a small body (64 KB, 200 data points).
 *
 * Honest limit: `Origin` is set by browsers and by nothing else we can trust. A script outside a browser can send any `Origin` it likes, so the
 * allow-list stops copy-and-paste abuse from other WEBSITES and casual use, not a determined attacker. What bounds that attacker is everything
 * else here: the scope, the metric-name rule, the rate limit, the body cap, the plan's daily volume, and that the key can be revoked in one click.
 * The data a visitor's browser sends contains no personal data by construction (see `web-vitals.snippet.ts`).
 */
import { z } from 'zod';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';

export const BROWSER_SCOPE = 'telemetry:browser:write';
/** Metric names a browser key may write. */
export const BROWSER_METRIC_PREFIX = 'browser_';
export const BROWSER_LIMITS = { maxBodyBytes: 64 * 1024, maxItems: 200, defaultRatePerMinute: 60, maxRatePerMinute: 600, maxOriginsPerKey: 10, maxKeys: 20 } as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * An origin as a browser sends it in the `Origin` header: scheme, host and optional port, lower-cased, nothing else. `https` only, except
 * `http` for localhost (development). No wildcard, no path, no credentials, no `null`. Returns `null` for anything else.
 */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256 || raw !== raw.trim() || raw.includes('*')) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const origin = u.origin.toLowerCase();
  if (origin === 'null' || u.username || u.password) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return null;
  // `https://a.test/`, `https://a.test/path` and `https://a.test:443` are not what a browser sends as an Origin: refuse them instead of silently trimming.
  if (raw.toLowerCase() !== origin) return null;
  return origin;
}

export const BrowserKeyInputSchema = z.object({
  apiKeyId: z.string().uuid(),
  origins: z.array(z.string()).min(1).max(BROWSER_LIMITS.maxOriginsPerKey),
  ratePerMinute: z.number().int().min(1).max(BROWSER_LIMITS.maxRatePerMinute).default(BROWSER_LIMITS.defaultRatePerMinute),
}).strict();

export interface BrowserKeyConfig { origins: string[]; ratePerMinute: number; updatedAt: string }
type Store = Record<string, BrowserKeyConfig>;

function parseStore(raw: string | null): Store {
  if (!raw) return {};
  try {
    const doc = JSON.parse(raw) as { v?: number; items?: unknown };
    if (doc?.v !== 1 || !doc.items || typeof doc.items !== 'object' || Array.isArray(doc.items)) return {};
    const out: Store = {};
    for (const [id, c] of Object.entries(doc.items as Record<string, Partial<BrowserKeyConfig>>)) {
      if (!z.string().uuid().safeParse(id).success || !c || !Array.isArray(c.origins)) continue;
      const origins = c.origins.map(normalizeOrigin).filter((o): o is string => o !== null);
      if (origins.length === 0) continue; // a damaged entry reads as "not configured": the key is refused, never opened up
      const rate = typeof c.ratePerMinute === 'number' && Number.isInteger(c.ratePerMinute) ? Math.min(BROWSER_LIMITS.maxRatePerMinute, Math.max(1, c.ratePerMinute)) : BROWSER_LIMITS.defaultRatePerMinute;
      out[id] = { origins: [...new Set(origins)], ratePerMinute: rate, updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '' };
    }
    return out;
  } catch { return {}; }
}

export async function listBrowserKeys(tenantId: string): Promise<Array<{ apiKeyId: string } & BrowserKeyConfig>> {
  const store = parseStore(await (await settings()).getValue(tenantId, TELEMETRY_SETTING_KEYS.BROWSER_KEYS));
  return Object.entries(store).map(([apiKeyId, c]) => ({ apiKeyId, ...c }));
}

/** The config of one key of this tenant, or `null` (not configured: the ingest path refuses the key). */
export async function getBrowserKeyConfig(tenantId: string, apiKeyId: string): Promise<BrowserKeyConfig | null> {
  return parseStore(await (await settings()).getValue(tenantId, TELEMETRY_SETTING_KEYS.BROWSER_KEYS))[apiKeyId] ?? null;
}

/** Loaded when first used: the ingest path imports this file for its constants and must not pull the settings service (and its database) in with them. */
const settings = async () => (await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')).default;

async function write(tenantId: string, store: Store, actorId?: string): Promise<void> {
  await (await settings()).create(tenantId, TELEMETRY_SETTING_KEYS.BROWSER_KEYS, JSON.stringify({ v: 1, items: store }), 'observability', 'json', actorId ? { actorId } : undefined);
}

async function audit(tenantId: string, actorId: string | undefined, action: string, metadata: Record<string, unknown>): Promise<void> {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  await AuditLogService.log({ tenantId, ...(actorId ? { actorId } : {}), actorType: 'USER', action, resourceType: 'telemetry', resourceId: tenantId, metadata }).catch(() => {});
}

/** Allow-list the origins of one browser key (replacing its list). Every origin must be a real, exact origin; a bad one refuses the whole request. */
export async function setBrowserKey(tenantId: string, actorId: string | undefined, input: unknown): Promise<{ apiKeyId: string } & BrowserKeyConfig> {
  const dto = BrowserKeyInputSchema.parse(input);
  const origins = dto.origins.map(normalizeOrigin);
  const badIndex = origins.findIndex((o) => o === null);
  if (badIndex >= 0) throw new AppError('Each origin must be https://host[:port] exactly (http only for localhost), with no path and no wildcard', 400, ErrorCode.VALIDATION_ERROR, { details: { index: badIndex } });
  const store = parseStore(await (await settings()).getValue(tenantId, TELEMETRY_SETTING_KEYS.BROWSER_KEYS));
  if (!store[dto.apiKeyId] && Object.keys(store).length >= BROWSER_LIMITS.maxKeys) throw new AppError(`A workspace may configure at most ${BROWSER_LIMITS.maxKeys} browser keys`, 409, ErrorCode.CONFLICT);
  const config: BrowserKeyConfig = { origins: [...new Set(origins as string[])], ratePerMinute: dto.ratePerMinute, updatedAt: new Date().toISOString() };
  store[dto.apiKeyId] = config;
  await write(tenantId, store, actorId);
  await audit(tenantId, actorId, 'observability.telemetry.browser_key_set', { apiKeyId: dto.apiKeyId, origins: config.origins, ratePerMinute: config.ratePerMinute });
  return { apiKeyId: dto.apiKeyId, ...config };
}

export async function removeBrowserKey(tenantId: string, actorId: string | undefined, apiKeyId: string): Promise<boolean> {
  const store = parseStore(await (await settings()).getValue(tenantId, TELEMETRY_SETTING_KEYS.BROWSER_KEYS));
  if (!store[apiKeyId]) return false;
  delete store[apiKeyId];
  await write(tenantId, store, actorId);
  await audit(tenantId, actorId, 'observability.telemetry.browser_key_removed', { apiKeyId });
  return true;
}

export type BrowserRequestVerdict = { ok: true; origin: string } | { ok: false; reason: 'no_config' | 'no_origin' | 'origin_not_allowed' };

/** The Origin check: the header must be present and be exactly one of the key's origins. */
export function checkBrowserOrigin(config: BrowserKeyConfig | null, originHeader: string | null): BrowserRequestVerdict {
  if (!config) return { ok: false, reason: 'no_config' };
  const origin = normalizeOrigin(originHeader ?? '');
  if (!origin) return { ok: false, reason: 'no_origin' };
  return config.origins.includes(origin) ? { ok: true, origin } : { ok: false, reason: 'origin_not_allowed' };
}
