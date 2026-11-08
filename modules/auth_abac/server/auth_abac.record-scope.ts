import type { ScopeMode } from '@kuraykaraaslan-labs/common/server/common.crm-contracts'

export const RECORD_SCOPE_POINT = 'auth_abac:record_scope'

/** How wide one user's read is on one permission. */
export interface RecordScope {
  /** OWN = only their own · TEAM = their own plus `scopeIds` · ALL = unrestricted. */
  mode: ScopeMode
  /**
   * For `mode === 'TEAM'`, the OPAQUE id list the caller turns into a predicate.
   *
   * auth_abac does not know what these ids are: user ids in CRM, department ids
   * in procurement, site ids in inventory. That ignorance is the point — the
   * moment this module knows, every workspace's notion of "my team" has to be
   * expressed here instead of where it belongs.
   *
   * An empty array means "only their own" and is equivalent to OWN.
   * `undefined` when mode is not TEAM.
   */
  scopeIds?: string[]
}

/** `null` means "this permission is not mine to answer for". */
export type RecordScopeProvider = (
  tenantId: string,
  userId: string,
  permissionId: string,
) => Promise<RecordScope | null>

const RANK: Record<ScopeMode, number> = { OWN: 0, TEAM: 1, ALL: 2 }

/**
 * Of two answers, the NARROWER one wins.
 *
 * Two modules resolving the same permission is a configuration mistake, and the
 * safe side of a mistake about who can see a customer list is the narrow side.
 * Note this takes the narrower mode's `scopeIds` wholesale rather than
 * intersecting: an intersection would invent a scope neither resolver claimed.
 */
export function narrower(a: RecordScope, b: RecordScope): RecordScope {
  return RANK[a.mode] <= RANK[b.mode] ? a : b
}

/**
 * The permission that grants an unrestricted read of the same resource.
 *
 * `crm_lead.leads.read` → `crm_lead.leads.read_all`. ALL comes from holding a
 * permission, never from a resolver — a resolver can only narrow.
 */
export function readAllTwin(permissionId: string): string {
  return `${permissionId}_all`
}
