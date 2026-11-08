// Whose storage account holds an object (docs/phases/53-setting-levels, 53.5), and the discovery scope that reaches it again.

import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'

/** The platform's storage (the root tenant's provider, counted against the plan) or the tenant's own. */
export type StorageSource = 'platform' | 'tenant'

/**
 * The bridge scope of an object's recorded source: 'platform' is the root tenant's side, 'tenant' the tenant's own. Undefined
 * (follow the tenant's setting level, as before) for the root tenant itself and for an object stored before sources were recorded.
 */
export function scopeOfSource(tenantId: string, source: string | null | undefined): 'own' | 'root' | undefined {
  if (isRootTenant(tenantId) || (source !== 'platform' && source !== 'tenant')) return undefined
  return source === 'platform' ? 'root' : 'own'
}
