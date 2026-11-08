import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { In, IsNull, MoreThan, type QueryRunner } from 'typeorm'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardDisplayLink } from './entities/dashboard_display_link.entity'
import { DashboardBoard } from './entities/dashboard_board.entity'
import type { CreateDisplayLinkInput } from './display-link.dto'
import {
  DISPLAY_TOKEN_RE, LAST_USED_GRANULARITY_SECONDS, MAX_ACTIVE_LINKS_PER_BOARD,
  expiryFrom, generateDisplayToken, hashDisplayToken,
} from './display-token'
import MSG from './dashboard.messages'

/** Characters of the token a list shows, so two links of one board can be told apart. */
const HINT_LENGTH = 6

/**
 * Display links of a board (owner decision 2026-10-17 #10). Every read and write goes through the tenant-scoped
 * repository or transaction, so RLS keeps one tenant's links out of another's reach even for a lookup by hash.
 *
 * Whether a link may still show its board is NOT decided here: `resolve` only says whether the row is live, and the
 * display principal (`display-principal.ts`) then checks the tenant, the board and the issuer on every request.
 */
export default class DashboardDisplayLinkService {
  /**
   * Mint a link for a SHARED board, or for a PRIVATE board its owner mints (owner decision INC-03, 2026-10-27: the routes
   * already ask `dashboard.boards.manage`, and the display principal keeps asking it of the issuer). The active-link cap is
   * counted under a per-board advisory lock, so two creates at the last free slot cannot both pass. Returns the raw token
   * ONCE; only its hash is stored.
   */
  static async create(
    tenantId: string,
    board: Pick<DashboardBoard, 'boardId' | 'scope'> & { ownerUserId?: string | null },
    dto: CreateDisplayLinkInput,
    userId: string,
    now: Date = new Date(),
  ): Promise<{ link: DashboardDisplayLink; token: string }> {
    if (board.scope !== 'TENANT' && board.ownerUserId !== userId) {
      throw new AppError(MSG.DISPLAY_LINK_PRIVATE_BOARD, 422, ErrorCode.VALIDATION_ERROR)
    }
    return withTenantTransactionFor(tenantId, async (qr) => {
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:display-links:${board.boardId}`])
      const repo = qr.manager.getRepository(DashboardDisplayLink)
      const active = await repo.count({ where: { tenantId, boardId: board.boardId, revokedAt: IsNull(), expiresAt: MoreThan(now) } })
      if (active >= MAX_ACTIVE_LINKS_PER_BOARD) throw new AppError(MSG.DISPLAY_LINK_LIMIT, 409, ErrorCode.CONFLICT)
      const token = generateDisplayToken()
      const link = await repo.save(repo.create({
        tenantId,
        boardId: board.boardId,
        tokenHash: hashDisplayToken(token),
        tokenHint: token.slice(-HINT_LENGTH),
        label: dto.label,
        createdByUserId: userId,
        createdAt: now,
        expiresAt: expiryFrom(dto.expiresInDays, now),
        revokedAt: null,
        revokedByUserId: null,
        lastUsedAt: null,
      }))
      return { link, token }
    })
  }

  /** Every link of a board, newest first (revoked and expired ones too: the list is also the history). */
  static async list(tenantId: string, boardId: string): Promise<DashboardDisplayLink[]> {
    return withTenantRepositoryFor(tenantId, DashboardDisplayLink, (repo) =>
      repo.find({ where: { tenantId, boardId }, order: { createdAt: 'DESC' } }))
  }

  /**
   * The live links on personal boards of the tenant, newest first, each with its board's owner (phase 39 review). A private board
   * is invisible to everyone but its owner, so these links are listed here for every manager to see and revoke
   * (`dashboard-display-links.route.ts`) without the board itself being read.
   */
  static async listOnPersonalBoards(tenantId: string, now: Date = new Date()): Promise<Array<{ link: DashboardDisplayLink; ownerUserId: string | null }>> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const live = await qr.manager.getRepository(DashboardDisplayLink).find({
        where: { tenantId, revokedAt: IsNull(), expiresAt: MoreThan(now) },
        order: { createdAt: 'DESC' },
      })
      if (live.length === 0) return []
      const personal = await qr.manager.getRepository(DashboardBoard).find({
        where: { tenantId, boardId: In([...new Set(live.map((l) => l.boardId))]), scope: 'PRIVATE' },
      })
      const owners = new Map(personal.map((b) => [b.boardId, b.ownerUserId ?? null] as const))
      return live.filter((l) => owners.has(l.boardId)).map((link) => ({ link, ownerUserId: owners.get(link.boardId) ?? null }))
    })
  }

  /** Revoke a link by its id alone, whatever board it shows (a manager stopping a screen of someone's personal board). */
  static async revokeById(tenantId: string, displayLinkId: string, userId: string, now: Date = new Date()): Promise<{ link: DashboardDisplayLink; changed: boolean }> {
    const link = await withTenantRepositoryFor(tenantId, DashboardDisplayLink, (repo) => repo.findOne({ where: { tenantId, displayLinkId } }))
    if (!link) throw new AppError(MSG.DISPLAY_LINK_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return this.revoke(tenantId, link.boardId, displayLinkId, userId, now)
  }

  /** Revoke a link of THIS board. Idempotent: revoking a revoked link changes nothing. Another board's link is a 404. */
  static async revoke(
    tenantId: string, boardId: string, displayLinkId: string, userId: string, now: Date = new Date(),
  ): Promise<{ link: DashboardDisplayLink; changed: boolean }> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardDisplayLink)
      const link = await repo.findOne({ where: { tenantId, boardId, displayLinkId }, lock: { mode: 'pessimistic_write' } })
      if (!link) throw new AppError(MSG.DISPLAY_LINK_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      if (link.revokedAt) return { link, changed: false }
      await repo.update({ tenantId, displayLinkId }, { revokedAt: now, revokedByUserId: userId })
      return { link: { ...link, revokedAt: now, revokedByUserId: userId }, changed: true }
    })
  }

  /** The link a raw token names in this tenant, live or not, or null. Tenant-scoped: another tenant's token is unknown. */
  static async lookup(tenantId: string, rawToken: string): Promise<DashboardDisplayLink | null> {
    if (!DISPLAY_TOKEN_RE.test(rawToken)) return null
    const tokenHash = hashDisplayToken(rawToken)
    return withTenantRepositoryFor(tenantId, DashboardDisplayLink, (repo) => repo.findOne({ where: { tenantId, tokenHash } }))
  }

  /** 410 for a revoked or an expired link (a screen can say which); silent for a live one. */
  static assertLive(link: Pick<DashboardDisplayLink, 'revokedAt' | 'expiresAt'>, now: Date = new Date()): void {
    if (link.revokedAt) throw new AppError(MSG.DISPLAY_LINK_REVOKED, 410, ErrorCode.CONFLICT)
    if (new Date(link.expiresAt).getTime() <= now.getTime()) throw new AppError(MSG.DISPLAY_LINK_EXPIRED, 410, ErrorCode.CONFLICT)
  }

  /**
   * The live link a raw token names in this tenant. Unknown → 404, revoked or expired → 410.
   * A lookup by a unique hash leaks nothing through timing worth defending, so no constant-time compare.
   */
  static async resolve(tenantId: string, rawToken: string, now: Date = new Date()): Promise<DashboardDisplayLink> {
    const link = await this.lookup(tenantId, rawToken)
    if (!link) throw new AppError(MSG.DISPLAY_LINK_INVALID, 404, ErrorCode.NOT_FOUND)
    this.assertLive(link, now)
    return link
  }

  /** Record that a screen used the link, at most once per `LAST_USED_GRANULARITY_SECONDS` (one conditional UPDATE). */
  static async touch(tenantId: string, displayLinkId: string, now: Date = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - LAST_USED_GRANULARITY_SECONDS * 1000)
    await withTenantRepositoryFor(tenantId, DashboardDisplayLink, (repo) => repo.createQueryBuilder()
      .update()
      .set({ lastUsedAt: now })
      .where('"tenantId" = :tenantId', { tenantId })
      .andWhere('"displayLinkId" = :displayLinkId', { displayLinkId })
      .andWhere('("lastUsedAt" IS NULL OR "lastUsedAt" < :cutoff)', { cutoff })
      .execute())
  }

  /**
   * Delete every link of a board, on the caller's transaction (board delete, module purge). Deleted rather than
   * revoked: the board is gone, and the audit log keeps the links' history.
   */
  static async deleteForBoard(qr: QueryRunner, tenantId: string, boardId: string): Promise<void> {
    await qr.manager.getRepository(DashboardDisplayLink).delete({ tenantId, boardId })
  }
}
