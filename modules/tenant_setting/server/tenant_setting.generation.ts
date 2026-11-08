/**
 * The tenant's settings generation (D270): bumped by the cache drop every setting write records (`tenant_setting.cache-drop.ts`); a
 * guarded cache built from settings seals its entries with it (auth_abac's runtime settings). A leaf: a reader needs no database,
 * Redis client or outbox to name the key.
 */
export function settingsGenerationKey(tenantId: string): string {
  return `settings:${tenantId}:gen`;
}
