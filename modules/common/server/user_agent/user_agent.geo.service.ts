import { isBlockedIp } from '../ip-guard';
import { isIP } from 'net';
import { randomUUID } from 'crypto';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { ROOT_TENANT_ID } from '../tenant-constants';
import { GeoLocation, GeoLocationSchema } from './user_agent.types';

const NULL_GEO: GeoLocation = { city: null, state: null, country: null, countryCode: null, latitude: null, longitude: null };
const GEO_CACHE_TTL = 60 * 60 * 24;       // 24h per-IP geo cache
// A failed provider call, or a lookup made while the Tor list was missing, is
// cached briefly instead: a 24 h entry would pin "no country, not Tor" for a day.
const GEO_MISS_TTL = 60 * 10;
const TOR_LIST_TTL = 60 * 60 * 6;         // refresh Tor exit list every 6h
const TOR_SET_KEY = 'geoip:tor:exitnodes';
// One refresher at a time across processes; outlives the 8 s list fetch.
const TOR_LOCK_KEY = 'geoip:tor:refresh-lock';
const TOR_LOCK_TTL = 60;
// After a failed refresh nobody retries for a while, so a blocked egress does
// not cost every lookup another 8 s fetch attempt.
const TOR_FAILED_KEY = 'geoip:tor:refresh-failed';
const TOR_FAILED_TTL = 60 * 10;

/** This process's running background refresh, so a burst of lookups starts one. */
let torRefreshInFlight: Promise<number> | null = null;

export function isPrivateOrReservedIp(ip: string): boolean {
  // common.28: the shared SSRF classifier (every IANA special-purpose range, IPv4-mapped IPv6 included) instead of string
  // prefixes that missed 127.0.0.2+, 100.64/10, 198.18/15, multicast, 0/8 and mapped addresses. Something that is not an
  // address at all is never sent to the geo provider either.
  if (!ip || ip === 'localhost') return true;
  if (isIP(ip) === 0) return true;
  return isBlockedIp(ip);
}

/** The providers the lookup knows; anything else reads as the keyless default. */
export const GEO_IP_PROVIDERS = ['ip-api', 'ipinfo', 'ipgeolocation'] as const;
export type GeoIpProvider = (typeof GEO_IP_PROVIDERS)[number];
/**
 * MS-34: the default is ipinfo, whose keyless https endpoint answers. ip-api's free tier is http only (its https endpoint
 * answers 403 without a key), so ip-api is used only with a key, through its paid https endpoint.
 */
export const DEFAULT_GEO_IP_PROVIDER: GeoIpProvider = 'ipinfo';
const DEFAULT_GEO_CONFIG: { provider: GeoIpProvider; apiKey: string | null } = { provider: DEFAULT_GEO_IP_PROVIDER, apiKey: null };

/** A stored provider name -> one of GEO_IP_PROVIDERS (case and spaces ignored); empty or unknown -> the default (ipinfo). */
export function sanitizeGeoIpProvider(raw: string | null | undefined): GeoIpProvider {
  const v = (raw ?? '').trim().toLowerCase();
  return (GEO_IP_PROVIDERS as readonly string[]).includes(v) ? (v as GeoIpProvider) : DEFAULT_GEO_IP_PROVIDER;
}

let warnedKeylessIpApi = false;
/**
 * The provider the lookup actually asks (MS-34). ip-api without a key would resolve nothing (no keyless https, and the
 * lookup never uses plain http), which silently turns the impossible-travel and new-country checks off; it reads as the
 * keyless default instead, with one warning per process. Every other choice is kept as stored.
 */
export function effectiveGeoIpConfig(provider: GeoIpProvider, apiKey: string | null): { provider: GeoIpProvider; apiKey: string | null } {
  if (provider === 'ip-api' && !apiKey) {
    if (!warnedKeylessIpApi) {
      warnedKeylessIpApi = true;
      Logger.warn('[user_agent] geoIpProvider is ip-api without geoIpApiKey; ip-api has no keyless https endpoint, so the lookup uses keyless ipinfo. Set an ip-api key or choose another provider on /admin/settings/geo-ip.');
    }
    return { provider: DEFAULT_GEO_IP_PROVIDER, apiKey: null };
  }
  return { provider, apiKey };
}

/**
 * Geo-IP resolution with a configurable provider (ip-api / ipinfo /
 * ipgeolocation), Redis caching, and privacy-network detection (proxy/hosting
 * from the provider + real Tor-exit-node list matching). No mock: providers are
 * real public APIs; Tor detection uses the public Tor bulk exit list.
 *
 * The provider is an INSTALLATION setting (2026-10-27): `geoIpProvider` and
 * `geoIpApiKey` are read from the ROOT tenant only, whatever tenant the lookup is
 * for. They are owned by user_session (user_session.setting.keys.ts, the ROOT
 * page /admin/settings/geo-ip). They used to be read per tenant with no owner and
 * no page, so a tenant ADMIN could point its own lookups at a provider that
 * answers nothing, which turns the login-risk check off for that tenant
 * (user_session.login-risk.service.ts answers NO_RISK on an empty geo), and the
 * per-IP cache `geoip:<ip>` is shared by every tenant, so one tenant's provider
 * answer (an empty miss included) was served to all the others. One provider for
 * the whole installation matches the one shared cache. A tenant's own row of
 * either key is never read.
 *
 * MS-34: the default provider is ipinfo (its keyless https endpoint answers). ip-api's keyless endpoint answers https
 * with 403 `{"status":"fail"}` (the free tier is http only), so ip-api is used ONLY with `geoIpApiKey`, through its
 * paid https endpoint (pro.ip-api.com); a stored ip-api without a key reads as keyless ipinfo
 * ({@link effectiveGeoIpConfig}). The lookup never uses plain http.
 */
export default class UserAgentGeoService {

  /** The installation's provider (ROOT tenant). `_tenantId` is the caller's tenant: not read, kept for the callers' signature. */
  private static async config(_tenantId?: string): Promise<{ provider: GeoIpProvider; apiKey: string | null }> {
    // Soft dependency: common stays installable without tenant_setting — the
    // provider degrades to the keyless ipinfo default when the settings module
    // is absent or unreachable (§10 bare-install rule).
    try {
      const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
      const s = await SettingService.getByKeys(ROOT_TENANT_ID, ['geoIpProvider', 'geoIpApiKey']).catch(() => ({} as Record<string, string | null>));
      const apiKey = (s?.geoIpApiKey ?? '').trim();
      return effectiveGeoIpConfig(sanitizeGeoIpProvider(s?.geoIpProvider), apiKey || null);
    } catch {
      return { ...DEFAULT_GEO_CONFIG };
    }
  }

  /** Resolve geo-location for an IP with caching + Tor/proxy flags. */
  static async lookup(ip: string, tenantId?: string): Promise<GeoLocation> {
    if (!isIP(ip) || isPrivateOrReservedIp(ip)) return NULL_GEO;

    const cacheKey = `geoip:${ip}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { const p = GeoLocationSchema.safeParse(JSON.parse(cached)); if (p.success) return p.data; }
    } catch { /* ignore cache errors */ }

    // The Tor check is independent of the provider (and of its settings read),
    // so it runs side by side with them rather than adding its latency.
    const torCheck = this.torStatus(ip);
    const { provider, apiKey } = await this.config(tenantId);
    const [resolved, tor] = await Promise.all([this.viaProvider(provider, apiKey, ip), torCheck]);
    const geo = tor === true ? { ...resolved, isTor: true } : resolved;

    // The providers answer NULL_GEO itself when they have nothing (non-OK reply,
    // failed status, missing key, network error).
    const ttl = resolved === NULL_GEO || tor === null ? GEO_MISS_TTL : GEO_CACHE_TTL;
    try { await redis.setex(cacheKey, ttl, JSON.stringify(geo)); } catch { /* ignore */ }
    return geo;
  }

  private static async viaProvider(provider: string, apiKey: string | null, ip: string): Promise<GeoLocation> {
    try {
      return provider === 'ipinfo' ? await this.viaIpinfo(ip, apiKey)
          : provider === 'ipgeolocation' ? await this.viaIpgeolocation(ip, apiKey)
          : await this.viaIpApi(ip, apiKey);
    } catch (e) {
      Logger.warn(`[user_agent] geo lookup failed (${provider}): ${e instanceof Error ? e.message : e}`);
      return NULL_GEO;
    }
  }

  private static async viaIpApi(ip: string, apiKey: string | null = null): Promise<GeoLocation> {
    // MS-34: only the paid https endpoint, only with a key (config() never selects keyless ip-api). Never plain http.
    if (!apiKey) return NULL_GEO;
    const fields = 'fields=status,country,countryCode,region,city,lat,lon,proxy,hosting';
    const url = `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}&${fields}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NULL_GEO;
    const raw = await res.json();
    if (raw.status !== 'success') return NULL_GEO;
    return GeoLocationSchema.parse({
      city: raw.city || null, state: raw.region || null, country: raw.country || null, countryCode: raw.countryCode || null,
      latitude: raw.lat ?? null, longitude: raw.lon ?? null,
      isProxy: Boolean(raw.proxy), isHosting: Boolean(raw.hosting),
    });
  }

  private static async viaIpinfo(ip: string, apiKey: string | null): Promise<GeoLocation> {
    const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${apiKey ? `?token=${encodeURIComponent(apiKey)}` : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NULL_GEO;
    const raw = await res.json();
    const [lat, lon] = (raw.loc || ',').split(',');
    return GeoLocationSchema.parse({
      city: raw.city || null, state: raw.region || null, country: raw.country || null, countryCode: raw.country || null,
      latitude: lat ? Number(lat) : null, longitude: lon ? Number(lon) : null,
      isProxy: Boolean(raw.privacy?.proxy), isHosting: Boolean(raw.privacy?.hosting), isVpn: Boolean(raw.privacy?.vpn), isTor: Boolean(raw.privacy?.tor),
    });
  }

  private static async viaIpgeolocation(ip: string, apiKey: string | null): Promise<GeoLocation> {
    if (!apiKey) return NULL_GEO;
    const res = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(ip)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return NULL_GEO;
    const raw = await res.json();
    return GeoLocationSchema.parse({
      city: raw.city || null, state: raw.state_prov || null, country: raw.country_name || null, countryCode: raw.country_code2 || null,
      latitude: raw.latitude ? Number(raw.latitude) : null, longitude: raw.longitude ? Number(raw.longitude) : null,
    });
  }

  /** Match an IP against the cached public Tor exit-node list (refreshed 6h). */
  static async isTorExit(ip: string): Promise<boolean> {
    return (await this.torStatus(ip)) === true;
  }

  /**
   * true / false from the cached exit list, or null when there is no list yet.
   * A missing list starts a background refresh instead of fetching it inline:
   * the inline fetch held the upload or device-info request behind an 8 s
   * download on every first-seen IP while the list was cold.
   */
  private static async torStatus(ip: string): Promise<boolean | null> {
    try {
      if (!(await redis.exists(TOR_SET_KEY))) {
        this.scheduleTorRefresh();
        return null;
      }
      return (await redis.sismember(TOR_SET_KEY, ip)) === 1;
    } catch { return null; }
  }

  /** Start a background Tor list refresh unless one is already running here. */
  static scheduleTorRefresh(): Promise<number> {
    if (!torRefreshInFlight) {
      torRefreshInFlight = this.refreshTorListOnce().finally(() => { torRefreshInFlight = null; });
    }
    return torRefreshInFlight;
  }

  /**
   * Refresh under a cross-process lock, skipping while a recent failure is
   * remembered. The lock is left to expire: after a success the list exists,
   * after a failure the sentinel holds everyone off, so no early release is needed.
   */
  private static async refreshTorListOnce(): Promise<number> {
    try {
      if (await redis.exists(TOR_FAILED_KEY)) return 0;
      if ((await redis.set(TOR_LOCK_KEY, '1', 'EX', TOR_LOCK_TTL, 'NX')) !== 'OK') return 0;
    } catch { return 0; }
    const count = await this.refreshTorList();
    if (count === 0) {
      try { await redis.set(TOR_FAILED_KEY, '1', 'EX', TOR_FAILED_TTL); } catch { /* ignore */ }
    }
    return count;
  }

  /**
   * Fetch the public Tor bulk exit list and swap it in. The new set is built
   * under a temporary key and RENAMEd over the live one inside MULTI, so readers
   * never see an empty or half-filled set (DEL then SADD left a gap).
   */
  static async refreshTorList(): Promise<number> {
    try {
      const res = await fetch('https://check.torproject.org/torbulkexitlist', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return 0;
      const text = await res.text();
      const ips = text.split('\n').map((l) => l.trim()).filter((l) => l && isIP(l) > 0);
      if (ips.length === 0) return 0;
      const tmpKey = `${TOR_SET_KEY}:build:${randomUUID()}`;
      const tx = redis.multi();
      // chunk to keep the command size sane
      for (let i = 0; i < ips.length; i += 1000) tx.sadd(tmpKey, ...ips.slice(i, i + 1000));
      tx.expire(tmpKey, TOR_LIST_TTL); // RENAME carries the TTL over to the live key
      tx.rename(tmpKey, TOR_SET_KEY);
      await tx.exec();
      return ips.length;
    } catch (e) {
      Logger.warn(`[user_agent] Tor list refresh failed: ${e instanceof Error ? e.message : e}`);
      return 0;
    }
  }
}
