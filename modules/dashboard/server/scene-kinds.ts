import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardSceneKindLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.scene_kind'
import MSG from './dashboard.messages'
import { SCENE_KIND_POINT, type DashboardSceneKind } from './scene-binding.types'

/**
 * The contributed scene kinds (phase 42, D42-3), looked up like entity types: a key no contribution in this build has is a 404; a
 * known one whose module is off for the tenant (or failing) is the typed 409 `ProviderUnavailable`.
 */
export async function selectSceneKind(tenantId: string, key: string): Promise<DashboardSceneKind> {
  let selected: { impl: DashboardSceneKind } | null
  try {
    selected = await ext.select<DashboardSceneKind>(SCENE_KIND_POINT, tenantCtx(tenantId), dashboardSceneKindLoaders, { key })
  } catch (e) {
    if (e instanceof ProviderUnavailableError && e.state === 'not_installed') throw new AppError(MSG.SCENE_KIND_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    throw e
  }
  if (!selected) throw new AppError(MSG.SCENE_KIND_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  return selected.impl
}

/** Every scene kind active for the tenant, keyed by contribution (failures left out: a list shows what works). */
export async function listSceneKinds(tenantId: string): Promise<Array<{ key: string; impl: DashboardSceneKind }>> {
  const { loaded } = await ext.loadAll<DashboardSceneKind>(SCENE_KIND_POINT, tenantCtx(tenantId), dashboardSceneKindLoaders)
  return loaded.filter((x) => !!x.contribution.key).map((x) => ({ key: x.contribution.key as string, impl: x.impl }))
}
