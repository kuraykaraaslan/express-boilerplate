import { env } from '@kuraykaraaslan-labs/env';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';

/**
 * `tenant_domain:base_domain_scope`: the zone domains this deployment's tenants' base domains must sit inside (docs/phases/02-fleet/14, F43). An address
 * under `hermetry.eu` must mean "data in the EU", so on a fleet node a base domain outside its region's zones is refused. `tenant_domain` imports no fleet
 * module: `fleet_agent` answers on a node from its installed trust bundle.
 *
 * `null` = no restriction (not a node, no contribution, or no zone named for this region yet). `'unavailable'` = a contribution failed (fail closed for
 * new base domains; existing ones keep serving).
 */
export const BASE_DOMAIN_SCOPE_POINT = 'tenant_domain:base_domain_scope';
export type BaseDomainScope = { zones: string[] } | null;
export type BaseDomainScopeProvider = () => Promise<BaseDomainScope>;

export async function baseDomainScope(): Promise<BaseDomainScope | 'unavailable'> {
  if (env.FLEET_ROLE !== 'node') return null;
  const ctx = systemCtx('the base-domain scope of this deployment, no tenant');
  if ((await ext.contributions(BASE_DOMAIN_SCOPE_POINT, ctx, { keepQuarantined: true })).length === 0) return null;
  const { tenantDomainBaseDomainScopeLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/tenant_domain.base_domain_scope');
  const { results, blocked } = await ext.guard<BaseDomainScopeProvider, BaseDomainScope>(BASE_DOMAIN_SCOPE_POINT, ctx, tenantDomainBaseDomainScopeLoaders, (scope) => scope());
  if (blocked) return 'unavailable';
  // Several answers narrow each other: a name must sit inside a zone of every scope that names any.
  const named = results.map((r) => r.value).filter((v): v is { zones: string[] } => !!v && Array.isArray(v.zones) && v.zones.length > 0);
  if (!named.length) return null;
  const zones = named.reduce<string[]>((acc, v, i) => (i === 0 ? v.zones : acc.filter((z) => v.zones.includes(z))), []);
  return { zones };
}

/** Whether `name` is one of the zones or a name under one. */
export function insideScope(name: string, scope: { zones: string[] }): boolean {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  return scope.zones.some((z) => n === z || n.endsWith(`.${z}`));
}
