import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardEntityTypeLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.entity_type'
import { dashboardEntityRelationsLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.entity_relations'
import MSG from './dashboard.messages'
import type { AliasResolverDeps } from './alias-resolver'
import {
  ENTITY_RELATIONS_POINT, ENTITY_TYPE_POINT,
  type DashboardEntityRelations, type DashboardEntityType,
} from './entity-alias.types'

/**
 * The contributed entity types and relation providers (phase 36, E36-2), looked up like data sources: a key no
 * contribution in this build has is a 404; a known one whose module is off for the tenant (or failing) is the typed 409
 * `ProviderUnavailable`.
 */
async function selectOne<T>(point: string, loaders: typeof dashboardEntityTypeLoaders, tenantId: string, key: string, notFound: string): Promise<T> {
  let selected: { impl: T } | null
  try {
    selected = await ext.select<T>(point, tenantCtx(tenantId), loaders, { key })
  } catch (e) {
    if (e instanceof ProviderUnavailableError && e.state === 'not_installed') throw new AppError(notFound, 404, ErrorCode.NOT_FOUND)
    throw e
  }
  if (!selected) throw new AppError(notFound, 404, ErrorCode.NOT_FOUND)
  return selected.impl
}

export const selectEntityType = (tenantId: string, key: string): Promise<DashboardEntityType> =>
  selectOne<DashboardEntityType>(ENTITY_TYPE_POINT, dashboardEntityTypeLoaders, tenantId, key, MSG.ENTITY_TYPE_NOT_FOUND)

export const selectEntityRelations = (tenantId: string, key: string): Promise<DashboardEntityRelations> =>
  selectOne<DashboardEntityRelations>(ENTITY_RELATIONS_POINT, dashboardEntityRelationsLoaders, tenantId, key, MSG.ENTITY_RELATIONS_NOT_FOUND)

/** The resolver's dependencies for one request. */
export function entityTypeDeps(tenantId: string, authorize: (permission: string) => Promise<void>): AliasResolverDeps {
  let graphs: Promise<RelationHolding[]> | null = null
  const holdings = () => (graphs ??= activeRelationHoldings(tenantId))
  return {
    entityType: (key) => selectEntityType(tenantId, key),
    relations: (key) => selectEntityRelations(tenantId, key),
    // D112: the relation graphs active for the tenant, listed once per request (a slot handed a site walks them).
    relationProviders: async () => (await holdings()).map((g) => g.key),
    // 49b (W2-M4): with what each graph says a kind holds, so a slot walks only the graphs that can fill it
    relationHoldings: holdings,
    authorize,
  }
}

/** One active relation graph and what it says each kind holds (`DashboardEntityRelations.holds`, absent: anything). */
export interface RelationHolding { key: string; holds?: Readonly<Record<string, readonly string[]>> }

/** The `dashboard:entity_relations` contributions active for the tenant, by key, with their declared holdings (a failing one is left out). */
export async function activeRelationHoldings(tenantId: string): Promise<RelationHolding[]> {
  const relations = await ext.loadAll<DashboardEntityRelations>(ENTITY_RELATIONS_POINT, tenantCtx(tenantId), dashboardEntityRelationsLoaders)
  return relations.loaded
    .filter((x) => !!x.contribution.key)
    .map((x) => ({ key: x.contribution.key as string, ...(x.impl?.holds ? { holds: x.impl.holds } : {}) }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** The keys of the `dashboard:entity_relations` contributions active for the tenant (a failing one is left out). */
export async function activeRelationProviders(tenantId: string): Promise<string[]> {
  return (await activeRelationHoldings(tenantId)).map((g) => g.key)
}

/** Every entity type and relation provider active for the tenant, keyed by contribution (failures left out: the editor lists what works). */
export async function listEntityContributions(tenantId: string): Promise<{
  types: Array<{ key: string; impl: DashboardEntityType }>
  relations: Array<{ key: string; impl: DashboardEntityRelations }>
}> {
  const [types, relations] = await Promise.all([
    ext.loadAll<DashboardEntityType>(ENTITY_TYPE_POINT, tenantCtx(tenantId), dashboardEntityTypeLoaders),
    ext.loadAll<DashboardEntityRelations>(ENTITY_RELATIONS_POINT, tenantCtx(tenantId), dashboardEntityRelationsLoaders),
  ])
  const keyed = <T>(l: Array<{ contribution: { key?: string | null }; impl: T }>) =>
    l.filter((x) => !!x.contribution.key).map((x) => ({ key: x.contribution.key as string, impl: x.impl }))
  return { types: keyed(types.loaded), relations: keyed(relations.loaded) }
}

// D576 (phase 39.16): the locale an entity type is asked in is the person's app language, `appLocaleOf` of `board-template.locale.ts`;
// `requestLocaleOf` (the browser's Accept-Language) is gone: the app does not follow the browser.
