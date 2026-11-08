/** The Redis keys of a tenant's cached policy set (auth_abac.policy.service.ts) and of its version (D253). Pure. */

export function policiesCacheKey(tenantId: string): string {
  return `abac_policies:${tenantId}`;
}

/**
 * The version of a tenant's cached policy set (D253): the set, and every cached decision of the tenant (auth_abac.decision.cache.ts),
 * is believed only while it carries the version read before the database read that filled it. A policy write bumps it in a cache-drop
 * order recorded in the write's own transaction (session_end.cache-guard.ts), so a DENY added or a PERMIT removed holds on every node
 * at once, also when the drop reaches Redis late.
 */
export function policiesVersionKey(tenantId: string): string {
  return `abac_policies:ver:${tenantId}`;
}
