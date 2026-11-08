import 'reflect-metadata'
import { ILike, In, MoreThan, Not, type EntityManager, type Repository } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { lockTenantKind } from './organization.code'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OrganizationTeam } from './entities/organization_teams.entity'
import { OrganizationTeamMember, type TeamMemberRole } from './entities/organization_team_members.entity'
import { ORGANIZATION_MESSAGES } from './organization.messages'
import { auditOrganization } from './organization.audit'
import { buildPath, descendantsLike, rewriteDescendants, wouldCycle } from './organization.path'

const PG_UNIQUE_VIOLATION = '23505'

/** Today as 'YYYY-MM-DD' — a membership date has no clock time. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface CreateTeamInput {
  name: string
  code: string
  purpose?: string
  parentTeamId?: string | null
  leaderUserId?: string | null
  legalEntityId?: string | null
  siteId?: string | null
  costCenterId?: string | null
  colour?: string | null
  sequence?: number
  isActive?: boolean
}

/**
 * Teams and their membership.
 *
 * The tree is maintained through the SHARED path helpers rather than a second
 * copy of the cost-center algorithm — two trees that disagree about what a
 * subtree is would be worse than either.
 */
export default class OrganizationTeamService {
  static async list(
    tenantId: string,
    query: { search?: string; purpose?: string; isActive?: boolean } = {},
  ): Promise<OrganizationTeam[]> {
    const base: Record<string, unknown> = { tenantId }
    if (query.purpose) base['purpose'] = query.purpose
    if (query.isActive !== undefined) base['isActive'] = query.isActive
    const where = query.search
      ? [{ ...base, name: ILike(`%${query.search}%`) }, { ...base, code: ILike(`%${query.search}%`) }]
      : base

    // Ordering by path yields a depth-first tree the UI can indent directly.
    return withTenantRepositoryFor(tenantId, OrganizationTeam, (repo) => repo.find({ where, order: { path: 'ASC' } }))
  }

  static async getById(tenantId: string, teamId: string): Promise<OrganizationTeam> {
    const row = await withTenantRepositoryFor(tenantId, OrganizationTeam, (repo) => repo.findOne({ where: { tenantId, teamId } }))
    if (!row) throw new AppError(ORGANIZATION_MESSAGES.TEAM_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return row
  }

  /** A team and everything beneath it — one prefix scan. */
  static async subtree(tenantId: string, teamId: string): Promise<OrganizationTeam[]> {
    return withTenantRepositoryFor(tenantId, OrganizationTeam, async (repo) => {
      const root = await repo.findOne({ where: { tenantId, teamId } })
      if (!root) throw new AppError(ORGANIZATION_MESSAGES.TEAM_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const descendants = await repo.find({
        where: { tenantId, path: ILike(descendantsLike(root.path)) },
        order: { path: 'ASC' },
      })
      return [root, ...descendants]
    })
  }

  static async create(tenantId: string, data: CreateTeamInput, actorId?: string): Promise<OrganizationTeam> {
    // Under the tenant's team lock (docs/phases/10-db Faz 3), like every tree write.
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'team')
      const repo = qr.manager.getRepository(OrganizationTeam)
      const path = await buildPath(
        repo, tenantId, data.code, data.parentTeamId ?? null, 'teamId',
        () => { throw new AppError(ORGANIZATION_MESSAGES.PARENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND) },
      )

      const row = await repo.save(repo.create({
        tenantId,
        ...data,
        purpose: data.purpose ?? 'GENERAL',
        path,
      }))

      // A named leader is also a member: the leadership row is what capacity and
      // round-robin hang off, and a leader missing from the roster would be
      // invisible to both.
      if (row.leaderUserId) {
        await OrganizationTeamService.upsertMembership(qr.manager.getRepository(OrganizationTeamMember), tenantId, row.teamId, row.leaderUserId, 'LEADER')
      }
      return row
    }).catch((error: unknown) => {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(ORGANIZATION_MESSAGES.TEAM_CODE_TAKEN, 409, ErrorCode.CONFLICT)
      }
      throw error
    })

    auditOrganization(tenantId, actorId, 'organization.team.created', 'Team', saved.teamId, {
      code: saved.code, name: saved.name,
    })
    return saved
  }

  static async update(
    tenantId: string,
    teamId: string,
    data: Partial<CreateTeamInput>,
    actorId?: string,
  ): Promise<OrganizationTeam> {
    // The cycle check and the subtree rewrite run under the tenant's team lock
    // (docs/phases/10-db Faz 3): two concurrent moves (A under B, B under A) each
    // passed the cycle check in their own transaction and made a cycle.
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'team')
      const repo = qr.manager.getRepository(OrganizationTeam)
      const row = await repo.findOne({ where: { tenantId, teamId } })
      if (!row) throw new AppError(ORGANIZATION_MESSAGES.TEAM_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

      const nextCode = data.code ?? row.code
      const nextParentId = data.parentTeamId !== undefined ? data.parentTeamId : (row.parentTeamId ?? null)

      if (nextParentId) {
        // Both self-parenting and descendant-parenting produce a path that can
        // never be reached from the root. Reject before writing anything.
        if (nextParentId === teamId) {
          throw new AppError(ORGANIZATION_MESSAGES.TEAM_CYCLE, 422, ErrorCode.VALIDATION_ERROR)
        }
        const parent = await repo.findOne({ where: { tenantId, teamId: nextParentId } })
        if (!parent) throw new AppError(ORGANIZATION_MESSAGES.PARENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
        if (wouldCycle(row.path, parent.path)) {
          throw new AppError(ORGANIZATION_MESSAGES.TEAM_CYCLE, 422, ErrorCode.VALIDATION_ERROR)
        }
      }

      const oldPath = row.path
      const nextPath = await buildPath(
        repo, tenantId, nextCode, nextParentId, 'teamId',
        () => { throw new AppError(ORGANIZATION_MESSAGES.PARENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND) },
      )

      Object.assign(row, data)
      row.code = nextCode
      row.parentTeamId = nextParentId
      row.path = nextPath
      const updated = await repo.save(row)

      if (nextPath !== oldPath) await rewriteDescendants(repo, tenantId, oldPath, nextPath)

      if (data.leaderUserId) {
        await OrganizationTeamService.upsertMembership(
          qr.manager.getRepository(OrganizationTeamMember), tenantId, teamId, data.leaderUserId, 'LEADER',
        )
      }
      return updated
    })

    auditOrganization(tenantId, actorId, 'organization.team.updated', 'Team', teamId, {
      changedKeys: Object.keys(data),
    })
    return saved
  }

  /**
   * Soft delete, refused while the team still has active members.
   *
   * Callers should run `organization:reference_check` with `kind: 'TEAM'` first —
   * CRM contributes counts of opportunities, stages and routing rules pointing
   * here, and a team that vanishes underneath those leaves dangling uuids.
   */
  static async delete(tenantId: string, teamId: string, actorId?: string): Promise<void> {
    // Member/child counts and the removal under the team lock: a member added
    // or a child created in between can no longer end up on a deleted team.
    const row = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'team')
      const repo = qr.manager.getRepository(OrganizationTeam)
      const found = await repo.findOne({ where: { tenantId, teamId } })
      if (!found) throw new AppError(ORGANIZATION_MESSAGES.TEAM_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

      const members = await qr.manager.getRepository(OrganizationTeamMember)
        .count({ where: { tenantId, teamId, isActive: true } })
      if (members) throw new AppError(ORGANIZATION_MESSAGES.TEAM_HAS_MEMBERS, 409, ErrorCode.CONFLICT)

      // `count` already excludes soft-deleted rows — the entity has a
      // @DeleteDateColumn, so an explicit predicate would be redundant.
      const children = await repo.count({ where: { tenantId, parentTeamId: teamId } })
      if (children) throw new AppError(ORGANIZATION_MESSAGES.TEAM_HAS_CHILDREN, 409, ErrorCode.CONFLICT)

      await repo.softRemove(found)
      return found
    })
    auditOrganization(tenantId, actorId, 'organization.team.deleted', 'Team', teamId, { code: row.code })
  }

  // ── Membership ─────────────────────────────────────────────────────────────

  static async members(tenantId: string, teamId: string, opts: { includePast?: boolean } = {}): Promise<OrganizationTeamMember[]> {
    const where: Record<string, unknown> = { tenantId, teamId }
    if (!opts.includePast) where['isActive'] = true
    return withTenantRepositoryFor(tenantId, OrganizationTeamMember, (repo) => repo.find({ where, order: { role: 'ASC', joinedAt: 'ASC' } }))
  }

  /** Every team a user currently belongs to — the input to a TEAM visibility scope. */
  static async teamIdsForUser(tenantId: string, userId: string): Promise<string[]> {
    const rows = await withTenantRepositoryFor(tenantId, OrganizationTeamMember, (repo) =>
      repo.find({ where: { tenantId, userId, isActive: true } }))
    return rows.map((r) => r.teamId)
  }

  static async addMember(
    tenantId: string,
    teamId: string,
    userId: string,
    role: TeamMemberRole = 'MEMBER',
    actorId?: string,
  ): Promise<OrganizationTeamMember> {
    // Under the team lock (docs/phases/10-db Faz 3): two concurrent adds of one user
    // both saw no active row and inserted twice; two concurrent LEADER adds
    // both demoted "the incumbent" and left two leaders (or hit the index).
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'team')
      const team = await qr.manager.getRepository(OrganizationTeam).findOne({ where: { tenantId, teamId } })
      if (!team) throw new AppError(ORGANIZATION_MESSAGES.TEAM_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const membership = await OrganizationTeamService.upsertMembership(
        qr.manager.getRepository(OrganizationTeamMember), tenantId, teamId, userId, role,
      )
      // organization.34: the scope version moves with the membership, in its transaction.
      await OrganizationTeamService.bumpScopeVersion(tenantId, qr.manager)
      return membership
    })
    // Membership IS the record scope, so a cached scope is now wrong. Clearing
    // for the whole team, not just this user: everyone already on the team can
    // now see the newcomer's records too.
    await OrganizationTeamService.invalidateScopes(tenantId)
    auditOrganization(tenantId, actorId, 'organization.team.member_added', 'Team', teamId, { userId, role })
    return saved
  }

  /**
   * Remove somebody from a team — by CLOSING the row, never deleting it.
   *
   * Capacity counters and past assignments reference this row; deleting it would
   * make "who owned this deal in March" unanswerable.
   */
  /**
   * Closes the person's active row on the team. Answers the closed row as this write saved it (its id and `updatedAt`), so a caller that
   * must find the same row again later (phase 55: the AI firewall's `organization.remove_from_teams` keeps it as its undo marker,
   * D55-222) needs no second read that could fail after the row is already closed.
   */
  static async removeMember(tenantId: string, teamId: string, userId: string, actorId?: string): Promise<OrganizationTeamMember> {
    const closed = await withTenantRepositoryFor(tenantId, OrganizationTeamMember, async (repo) => {
      const row = await repo.findOne({ where: { tenantId, teamId, userId, isActive: true }, lock: { mode: 'pessimistic_write' } })
      if (!row) throw new AppError(ORGANIZATION_MESSAGES.TEAM_MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      row.isActive = false
      row.leftAt = today()
      const saved = await repo.save(row)
      // organization.34: bumped in the removal's transaction, so the removed member's cached TEAM scope is unreachable
      // even when the Redis purge below fails.
      await OrganizationTeamService.bumpScopeVersion(tenantId, (repo as { manager?: EntityManager }).manager)
      return saved
    })
    // The urgent direction. A stale scope after an ADD shows slightly less than
    // it could; a stale scope after a REMOVE keeps showing somebody records
    // they were just cut off from, which is the case worth paying a cache
    // flush for.
    await OrganizationTeamService.invalidateScopes(tenantId)
    auditOrganization(tenantId, actorId, 'organization.team.member_removed', 'Team', teamId, { userId })
    return closed
  }

  /**
   * Reopen one membership row that `removeMember` closed — THE SAME ROW, so the
   * assignment capacity and round-robin counters that hang off its
   * `teamMemberId` carry on (phase 55: the undo of the AI firewall's
   * `organization.remove_from_teams`, D55-222).
   *
   * Only while the row is exactly as that removal left it: still closed, its
   * `updatedAt` equal to `closedAt` (no writer touches a closed row, so a later
   * stamp is somebody else's), the person not back on the team through a newer
   * row, the team not deleted, and — for a LEADER — no other leader since.
   * Answers false, changing nothing, otherwise. Audited as an add.
   */
  static async reopenMember(tenantId: string, teamMemberId: string, closedAt: string, actorId?: string): Promise<boolean> {
    const reopened = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'team')
      const repo = qr.manager.getRepository(OrganizationTeamMember)
      const row = await repo.findOne({ where: { tenantId, teamMemberId } })
      if (!row || row.isActive || !row.updatedAt || new Date(row.updatedAt).toISOString() !== closedAt) return null
      const team = await qr.manager.getRepository(OrganizationTeam).findOne({ where: { tenantId, teamId: row.teamId } })
      if (!team) return null
      const { teamId, userId } = row
      const since = await repo.count({ where: [
        { tenantId, teamId, userId, isActive: true },
        { tenantId, teamId, userId, teamMemberId: Not(teamMemberId), createdAt: MoreThan(row.createdAt) },
      ] })
      if (since) return null
      if (row.role === 'LEADER' && await repo.count({ where: { tenantId, teamId, role: 'LEADER', isActive: true } })) return null
      row.isActive = true
      row.leftAt = null
      await repo.save(row)
      await OrganizationTeamService.bumpScopeVersion(tenantId, qr.manager)
      return row
    })
    if (!reopened) return false
    await OrganizationTeamService.invalidateScopes(tenantId)
    auditOrganization(tenantId, actorId, 'organization.team.member_added', 'Team', reopened.teamId, { userId: reopened.userId, role: reopened.role })
    return true
  }

  /**
   * Everybody who shares a team with this user, including the user.
   *
   * This is the raw material of a TEAM record scope, and it is deliberately a
   * FLAT peer set rather than a subtree walk: being in Sales/Istanbul does not
   * mean seeing Sales/Ankara, and being in Sales does not mean seeing everything
   * beneath it. Managerial reach across a subtree is a different, deliberate
   * grant (`read_all`), not a side effect of sitting on a node with children.
   *
   * Returns `[userId]` when the user is in no team — a scope of "just me",
   * which is what OWN means anyway.
   */
  static async teammateIdsFor(tenantId: string, userId: string): Promise<string[]> {
    const teamIds = await OrganizationTeamService.teamIdsForUser(tenantId, userId)
    if (!teamIds.length) return [userId]

    const rows = await withTenantRepositoryFor(tenantId, OrganizationTeamMember, (repo) =>
      repo.find({ where: { tenantId, teamId: In(teamIds), isActive: true } }))

    // organization.14 (decision: the strict reading): a teammate is an ACTIVE member of the tenant. A removed or suspended
    // member whose team row was never closed widens nobody's scope. A membership lookup that fails narrows (the caller
    // and the teams only), never widens.
    const others = [...new Set(rows.map((r) => r.userId).filter((u) => u && u !== userId))]
    let activeOthers: string[] = []
    if (others.length) {
      try {
        const { TenantMember } = await import('@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity')
        const members = await withTenantRepositoryFor(tenantId, TenantMember, (repo) =>
          repo.find({ where: { tenantId, userId: In(others) } }))
        const active = new Set(members.filter((m) => String(m.memberStatus) === 'ACTIVE' && !(m as { deletedAt?: Date | null }).deletedAt).map((m) => m.userId))
        activeOthers = others.filter((u) => active.has(u))
      } catch {
        activeOthers = []
      }
    }

    // The teams themselves are in the set too: a record may be owned by a TEAM
    // rather than a person, and the caller ORs this list against both columns.
    return [...new Set([userId, ...teamIds, ...activeOthers])]
  }

  /**
   * Drop cached record scopes after a membership change.
   *
   * Loaded dynamically and failure-tolerant: `organization` works perfectly well
   * in a deployment with no ABAC, and a team edit must not fail because a cache
   * it does not own is unreachable. A missed flush costs 60 s of staleness, the
   * TTL that exists for exactly this reason.
   */
  private static async invalidateScopes(tenantId: string): Promise<void> {
    try {
      const { default: VisibilityService } = await import(
        '@kuraykaraaslan-labs/auth_abac/server/auth_abac.visibility.service'
      )
      await VisibilityService.invalidate(tenantId)
    } catch {
      // No ABAC installed, or Redis is down. Both are survivable.
    }
  }

  /**
   * organization.34: bump the record-scope version (auth_abac) inside the membership change's transaction. Skipped when ABAC
   * is not installed; a failure of the bump itself throws, so the change rolls back and the caller retries.
   */
  private static async bumpScopeVersion(tenantId: string, manager: EntityManager | undefined): Promise<void> {
    let VisibilityService: { bumpScopeVersion?: (t: string, m?: EntityManager) => Promise<void> } | undefined
    try {
      ({ default: VisibilityService } = await import('@kuraykaraaslan-labs/auth_abac/server/auth_abac.visibility.service'))
    } catch {
      return // no ABAC installed: there is no scope cache to version
    }
    if (typeof VisibilityService?.bumpScopeVersion !== 'function') return
    await VisibilityService.bumpScopeVersion(tenantId, manager)
  }

  /** Re-activate or create; the partial unique index makes this idempotent. */
  private static async upsertMembership(
    repo: Repository<OrganizationTeamMember>,
    tenantId: string,
    teamId: string,
    userId: string,
    role: TeamMemberRole,
  ): Promise<OrganizationTeamMember> {
    const active = await repo.findOne({ where: { tenantId, teamId, userId, isActive: true } })
    if (active) {
      if (active.role !== role) {
        // Only one active leader per team — demote the incumbent first, or the
        // partial unique index rejects the write.
        if (role === 'LEADER') {
          const incumbent = await repo.findOne({
            where: { tenantId, teamId, role: 'LEADER', isActive: true, userId: Not(userId) },
          })
          if (incumbent) {
            incumbent.role = 'MEMBER'
            await repo.save(incumbent)
          }
        }
        active.role = role
        await repo.save(active)
      }
      return active
    }

    if (role === 'LEADER') {
      const incumbent = await repo.findOne({ where: { tenantId, teamId, role: 'LEADER', isActive: true } })
      if (incumbent) {
        incumbent.role = 'MEMBER'
        await repo.save(incumbent)
      }
    }
    return repo.save(repo.create({ tenantId, teamId, userId, role, joinedAt: today(), isActive: true }))
  }
}
