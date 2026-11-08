import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';

/**
 * Which tenants exist, for the fw:signals consumer (docs/phases/55-ai-firewall/02 §2.6 review, D55-71). An anonymous producer (a trap
 * touch, a rate-limit refusal, a refused callback, an unknown invitation token) stamps its signal with the tenant segment of the URL, and
 * the dispatcher answers an unknown path with its 404 before any store is asked about that tenant; so a scanner looping over random
 * tenant uuids would otherwise get rows stored under tenants that do not exist, rows no tenant's retention ever reaches. The consumer asks
 * this cache before it stores a tenant's rows and drops, acknowledges and counts the rows of a tenant that does not exist
 * (`unknown_tenant`), never storing them.
 *
 * One lookup per read for the ids it does not know (one query, `= ANY`), the answers cached in process: a known tenant for
 * `KNOWN_TENANT_TTL_MS` (short, so a tenant purged meanwhile stops being stored soon after), an unknown one for `UNKNOWN_TENANT_TTL_MS`
 * (a flood of random ids costs one query per id per minute at most), at most `KNOWN_TENANTS_CACHE_MAX` ids (then the cache starts over).
 * The ROOT tenant (the platform's rows) is always known. A lookup that throws throws to the consumer, which leaves the entries pending.
 */
export type TenantLookup = (tenantIds: readonly string[]) => Promise<ReadonlySet<string>>;
export type KnownTenants = (tenantIds: readonly string[]) => Promise<ReadonlySet<string>>;

export const KNOWN_TENANT_TTL_MS = 60_000;
export const UNKNOWN_TENANT_TTL_MS = 60_000;
export const KNOWN_TENANTS_CACHE_MAX = 10_000;

/** A cache over `lookup` (see the header). Answers the ids of `tenantIds` that exist (lower case). */
export function knownTenantsCache(lookup: TenantLookup, now: () => number = Date.now): KnownTenants {
  const cache = new Map<string, { known: boolean; until: number }>();
  return async (tenantIds) => {
    const t = now();
    const known = new Set<string>();
    const ask: string[] = [];
    for (const raw of new Set(tenantIds.map((id) => id.toLowerCase()))) {
      if (raw === ROOT_TENANT_ID) { known.add(raw); continue; }
      const hit = cache.get(raw);
      if (hit && hit.until > t) { if (hit.known) known.add(raw); continue; }
      ask.push(raw);
    }
    if (ask.length === 0) return known;
    const found = await lookup(ask);
    const exists = new Set([...found].map((id) => id.toLowerCase()));
    if (cache.size + ask.length > KNOWN_TENANTS_CACHE_MAX) cache.clear();
    for (const id of ask) {
      const yes = exists.has(id);
      cache.set(id, { known: yes, until: t + (yes ? KNOWN_TENANT_TTL_MS : UNKNOWN_TENANT_TTL_MS) });
      if (yes) known.add(id);
    }
    return known;
  };
}

/** The real lookup: the `tenants` table on the system DataSource (tenant.sweep), soft-deleted tenants included (their rows live on). */
export const lookupTenantsLazily: TenantLookup = async (tenantIds) =>
  (await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')).existingTenantIds(tenantIds);
