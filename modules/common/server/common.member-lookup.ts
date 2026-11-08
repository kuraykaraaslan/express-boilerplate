import { ext, loadLogger, tenantCtx } from './extensions/ext'
import { commonMemberLookupLoaders } from './generated/extensions/common.member_lookup'

/**
 * Who a bare user id is, for modules that store one (a loyalty account's `userId`, an award's subject) without owning people. Membership is
 * `tenant_member`'s and the person is `user`'s; a module that only needs "find a member by name or e-mail" and "show the member's name" must not
 * require either of them for that (docs/phases/17-loyalty/06-ui-fixes 3.5, owner decision 2026-11-01). `tenant_member` contributes the lookup
 * (`tenant_member/server/tenant_member.member-lookup`); without it, or with it failing, a search finds nobody and an id resolves to nothing, so the
 * consumer shows the bare id as before.
 *
 * Hosted by `common` so every edition can read it without importing a user module. Declared in common/module.json `extensionPoints`.
 *
 * Privacy: a MemberRef carries an e-mail. A consumer shows it only behind an admin-level permission (the loyalty accounts list needs
 * `loyalty.accounts.read`, ADMIN); never on a surface a member-level permission reaches.
 */
export const MEMBER_LOOKUP_POINT = 'common:member_lookup'

/** At most this many members per search, and per resolve call. */
export const MEMBER_SEARCH_MAX = 25
export const MEMBER_RESOLVE_MAX = 200

/** One ACTIVE member of the tenant: the user id, the profile name when there is one, the account e-mail. */
export interface MemberRef {
  userId: string
  name: string | null
  email: string | null
}

/** What a search matches: the name or the e-mail (default), or the name only. */
export type MemberSearchMatch = 'any' | 'name'

export interface MemberLookup {
  /**
   * The tenant's ACTIVE members whose name or e-mail contains `text` (case-insensitive), at most `limit` (never more than
   * {@link MEMBER_SEARCH_MAX}). Never a person of another tenant, never a removed, invited or suspended member.
   * `match: 'name'` matches the name only, never the e-mail: for a caller not allowed to see e-mails, whom an e-mail
   * match would let probe who owns an address (drive's member picker, docs/phases/41-ui-fixes/10 3.3).
   */
  search(tenantId: string, text: string, opts: { limit: number; match?: MemberSearchMatch }): Promise<MemberRef[]>
  /** The ACTIVE members of the tenant among `userIds` (at most {@link MEMBER_RESOLVE_MAX} ids); an id that is not one is left out. */
  resolve(tenantId: string, userIds: string[]): Promise<MemberRef[]>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The tenant's contributed lookup, or `null` when no module active for the tenant provides one. A lookup that cannot be loaded is a failure the
 * runtime logs and skips, so it answers `null` as well.
 */
export async function loadMemberLookup(tenantId: string): Promise<MemberLookup | null> {
  const found = await ext.first<MemberLookup, MemberLookup>(
    MEMBER_LOOKUP_POINT, tenantCtx(tenantId), commonMemberLookupLoaders, (lookup) => lookup,
  )
  return found?.value ?? null
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** A contributor's row, shaped and bounded; null for one without a user id. */
function asRef(v: unknown): MemberRef | null {
  const r = v as Partial<MemberRef> | null
  if (!r || typeof r.userId !== 'string' || !r.userId) return null
  return { userId: r.userId, name: str(r.name, 200), email: str(r.email, 320) }
}

async function warn(what: string, error: unknown): Promise<void> {
  try {
    const Logger = await loadLogger()
    Logger.warn(`[common.member-lookup] ${what} failed, answering nobody: ${error instanceof Error ? error.message : String(error)}`)
  } catch { /* logging must never break the caller */ }
}

/**
 * The tenant's ACTIVE members matching `text` (name or e-mail; the name only with `match: 'name'`), at most `limit` (default and ceiling {@link MEMBER_SEARCH_MAX}). `[]` for blank
 * text, when no lookup is installed or active for the tenant, or when it fails (logged, never thrown): the consumer then finds nobody.
 */
export async function searchMembers(
  tenantId: string,
  text: string,
  opts: { limit?: number; match?: MemberSearchMatch } = {},
): Promise<MemberRef[]> {
  const q = typeof text === 'string' ? text.trim().slice(0, 200) : ''
  if (!q) return []
  const limit = Math.min(MEMBER_SEARCH_MAX, Math.max(1, Math.floor(opts.limit ?? MEMBER_SEARCH_MAX)))
  try {
    const lookup = await loadMemberLookup(tenantId)
    if (!lookup) return []
    const rows = await lookup.search(tenantId, q, opts.match === 'name' ? { limit, match: 'name' } : { limit })
    return (Array.isArray(rows) ? rows : []).map(asRef).filter((r): r is MemberRef => r !== null).slice(0, limit)
  } catch (error) {
    await warn('search', error)
    return []
  }
}

/**
 * Who these users are, keyed by user id: only the ACTIVE members of the tenant among them (deduplicated, non-uuid ids dropped, at most
 * {@link MEMBER_RESOLVE_MAX}). An empty map when no lookup is installed or active, or when it fails (logged, never thrown): the consumer then
 * shows the bare id. An answer for an id that was not asked is ignored.
 */
export async function resolveMembers(tenantId: string, userIds: Array<string | null | undefined>): Promise<Map<string, MemberRef>> {
  const out = new Map<string, MemberRef>()
  // Lower-case, as Postgres answers a uuid: the map is read with the ids the consumer's own rows carry.
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))]
    .slice(0, MEMBER_RESOLVE_MAX)
  if (ids.length === 0) return out
  try {
    const lookup = await loadMemberLookup(tenantId)
    if (!lookup) return out
    const asked = new Set(ids)
    const rows = await lookup.resolve(tenantId, ids)
    for (const row of Array.isArray(rows) ? rows : []) {
      const ref = asRef(row)
      const key = ref?.userId.toLowerCase()
      if (ref && key && asked.has(key)) out.set(key, { ...ref, userId: key })
    }
    return out
  } catch (error) {
    await warn('resolve', error)
    return new Map()
  }
}
