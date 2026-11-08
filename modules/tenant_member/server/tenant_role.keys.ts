/** The Redis keys of a tenant's cached role set (tenant_role.cache.ts) and of its version (D253). Pure: auth_abac reads the version too. */

export function cacheKey(tenantId: string): string {
  return `tenant_roles:${tenantId}`;
}

/**
 * The version of a tenant's cached role set (D253, session_end.cache-guard.ts): the set, and every cached ABAC decision of the tenant,
 * is believed only while it carries the version read before the database read that filled it. Every role-set write bumps it in a
 * cache-drop order recorded in the write's own transaction, so a permission taken from a role holds on every node at once.
 */
export function rolesVersionKey(tenantId: string): string {
  return `tenant_roles:ver:${tenantId}`;
}
