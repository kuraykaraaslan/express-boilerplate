/**
 * Asks the `observability:tenant_home` contributions where a tenant lives (see `observability.home.types.ts`). One place, so the data-region guard and the
 * retention sweep read the same answer, and neither knows who contributes. Never throws: no contributor, a slow one and a broken one all read as "no answer".
 */
import type { TenantHome, TenantHomeProvider } from './observability.home.types'

export type HomeReader = (tenantId: string) => Promise<TenantHome | null>

const defaultReader: HomeReader = async (tenantId) => {
  const [{ ext, tenantCtx }, { observabilityTenantHomeLoaders }] = await Promise.all([
    import('@kuraykaraaslan-labs/common/server/extensions/ext'),
    import('@kuraykaraaslan-labs/common/server/generated/extensions/observability.tenant_home'),
  ])
  const hit = await ext.first<TenantHomeProvider, TenantHome>('observability:tenant_home', tenantCtx(tenantId), observabilityTenantHomeLoaders, (p) => p.homeOf(tenantId))
  return hit?.value ?? null
}

let reader: HomeReader = defaultReader
/** Test seam. */
export function setHomeReader(fn?: HomeReader): void { reader = fn ?? defaultReader }

export async function tenantHome(tenantId: string): Promise<TenantHome | null> {
  try { return await reader(tenantId) } catch { return null }
}
