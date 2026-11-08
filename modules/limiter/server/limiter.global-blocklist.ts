/**
 * Platform-global IP blocklist (docs/phases/38-security 2.2): the ROOT-tenant setting `globalIpBlacklist` (addresses and CIDR blocks, set
 * by the platform operator only), consulted for lanes that take part in IP bans: on every request at the proxy (limiter.ban-gate.ts,
 * phase 55 00 §0.2) and again on the auth surfaces (Limiter.checkRateLimit). Cached briefly in process, already split into its rules,
 * so the lookup costs nothing on the hot path; a settings outage fails open (the strike store and the limiter are the other layers).
 * Only the operator writes it: a repeat offender gets the longest automatic ban instead, with an end (limiter.ban-promotion.ts).
 */
import { ipInSubnet, parseSubnetString } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';

export const GLOBAL_BLOCKLIST_KEY = 'globalIpBlacklist';
export const GLOBAL_BLOCKLIST_CACHE_MS = 30_000;

let cache: { at: number; rules: string[] } | null = null;

/** Drops the cached list (a settings write, tests). */
export function resetGlobalBlocklistCache(): void {
  cache = null;
}

async function loadRules(): Promise<string[]> {
  const now = performance.now();
  if (cache && now - cache.at < GLOBAL_BLOCKLIST_CACHE_MS) return cache.rules;
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    const value = (await SettingService.getValue(ROOT_TENANT_ID, GLOBAL_BLOCKLIST_KEY)) ?? null;
    cache = { at: now, rules: parseSubnetString(value) };
    return cache.rules;
  } catch {
    return cache?.rules ?? [];
  }
}

/** Whether the address is inside the platform-global blocklist. No address, no list or an unreadable list is "not blocked". */
export async function isGloballyBlocked(ip: string | null | undefined): Promise<boolean> {
  if (!ip || ip === 'unknown') return false;
  const rules = await loadRules();
  return rules.length > 0 && rules.some((rule) => ipInSubnet(ip, rule));
}
