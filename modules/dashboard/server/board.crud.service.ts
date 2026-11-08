import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { IsNull, type FindOptionsWhere, type QueryRunner } from 'typeorm'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import type { BoardListQuery, CreateBoardInput, UpdateBoardInput } from './dashboard.dto'
import { escapeLike } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { mintSlug } from './board-slug'
import { partitionCopyableRefs } from './board.acl'
import MSG from './dashboard.messages'
import { prepareBoardSettings } from './board-settings'
import { referencedParamKeys, removedParamKeys } from './board-window'
import { placementAliasKeys, placementFilterKeys } from './board-aliases'
import {
  BoardParamListSchema, assertEntityParamRefs, boardAliasKeys, boardWasLegacy, entityParamReadKeys, normalizeBoardParams,
  normalizeBoardRow, normalizeParamRefs, normalizePlacementRefs, withLegacyAliases, type BoardParam,
} from './board-params'
import { assertFilterParamsKnown, filterParamKeys, removedFilterKeys, type BoardFilter } from './board-filters'
import { referencedPlacementParamKeys } from './placement-references'
import type { SaveLayoutInput } from './dashboard.dto'
import DashboardInstanceService, { assertPlacementGuardsFor, placementKind, placementSettingsForSave } from './instance.crud.service'
import { isPlacementGuardRefusal } from './placement-guard'
import { dropElementCommandsWithoutPermission, elementCommandsOf, type ElementAuthoring } from './element-actions.registry'
import { normalizeGridCols, scaleLayout, perPage } from './grid-cols'
import { referencedActionPageKeys, removedPageKeys, pageInputParamKeys, pagesTakingParams, assertPageInputsKnown, placementsNewlyNeedingInputs, type BoardPage, type MainPage } from './board-pages'
import DashboardDisplayLinkService from './display-link.service'
import { deleteOverlaysForBoard } from './card-overlay.cleanup'
import { deleteHomesForBoard } from './user-home'
import { deleteSnapshotsForBoard, holdSnapshots, markSnapshotsChanged } from './board-snapshot'

/** Internal-only create inputs (never accepted from a client body — see `CreateBoardDTO`). */
export interface BoardCreateExtras {
  slug?: string
  settings?: Record<string, unknown> | null
  timeWindow?: Record<string, unknown> | null
  params?: Array<Record<string, unknown>> | null
  /**
   * Entity aliases (phase 36), an old shape: stored as the entity parameters they are (phase 41, `normalizeBoardParams`). A copy or
   * an import of today hands over its parameters only.
   */
  aliases?: Array<Record<string, unknown>> | null
  /** Key filters (phase 36.7): a copy or an import keeps its source's. */
  filters?: Array<Record<string, unknown>> | null
  /** 12 or 24 columns (21.10): a copy or an import keeps its source's; anything else is 12. */
  gridCols?: number
  /** In-board pages (D-1 (a)): a copy or an import keeps its source's. */
  pages?: BoardPage[] | null
  /** The main page's name and icon (phase 29): a copy or an import keeps its source's. */
  mainPage?: MainPage | null
}

/** Who is asking; a PRIVATE board is only ever visible to its owner. */
export interface BoardViewer {
  userId: string
}

/**
 * What a board is filed under (Faz 9, K2) — at most one of the two, enforced
 * by migration 095's CHECK and mirrored in `dashboard.dto.ts`'s
 * `CreateBoardDTO` refine. Neither field is the polymorphic `entityType`/
 * `entityId` seam (`00-master-plan.md` §A.2): both name a closed vocabulary
 * this module already understands (a `workspaces.config.ts` id, an installed
 * module id), not a surface it has never heard of.
 */
export interface BoardAnchor {
  workspace?: string | null
  moduleId?: string | null
}

/** `list()`'s filters (Faz 9, dilim 9.1 — the hub needs to ask each question separately). */
export interface BoardListFilter {
  anchor?: BoardAnchor
  scope?: 'TENANT' | 'PRIVATE'
  /** Only the caller's own boards (any scope). */
  mine?: boolean
  /**
   * When given, a board anchored to a module NOT in this set is excluded
   * (Faz 9, K15 — "hidden from the hub" applies to every list caller, not
   * only the hub UI). Omit to skip the filter entirely (workspace-anchored
   * and standalone boards are never affected either way).
   */
  enabledIds?: Set<string>
}

export default class DashboardBoardService {
  static async list(tenantId: string, viewer: BoardViewer, filter: BoardListFilter = {}): Promise<DashboardBoard[]> {
    return withTenantRepositoryFor(tenantId, DashboardBoard, async (repo) => {
    const qb = repo
      .createQueryBuilder('b')
      .where('b.tenantId = :tenantId', { tenantId })
      .orderBy('b.isDefault', 'DESC')
      .addOrderBy('b.title', 'ASC')

    // Visibility: a shared board is visible to everyone; a private one only to
    // its owner. `mine` narrows further to "and it is actually mine" — a
    // second AND, not a replacement, because `mine` should never smuggle in a
    // shared board that happens to have no owner.
    qb.andWhere('(b.scope = :shared OR b.ownerUserId = :userId)', { shared: 'TENANT', userId: viewer.userId })
    if (filter.mine) qb.andWhere('b.ownerUserId = :userId', { userId: viewer.userId })
    if (filter.scope) qb.andWhere('b.scope = :scope', { scope: filter.scope })

    if (filter.anchor?.workspace) qb.andWhere('b.workspace = :workspace', { workspace: filter.anchor.workspace })
    else if (filter.anchor?.moduleId) qb.andWhere('b.moduleId = :moduleId', { moduleId: filter.anchor.moduleId })
    // `anchor: {}` (both undefined) means "standalone only" — neither column set.
    else if (filter.anchor) qb.andWhere('b.workspace IS NULL AND b.moduleId IS NULL')

    if (filter.enabledIds) {
      // An empty set means no module is enabled — every module-anchored board
      // is excluded, and `IN ()` is invalid SQL, so that case skips straight
      // to the narrower clause instead of building an empty parameter list.
      if (filter.enabledIds.size === 0) qb.andWhere('b.moduleId IS NULL')
      else qb.andWhere('(b.moduleId IS NULL OR b.moduleId IN (:...enabledModuleIds))', {
        enabledModuleIds: [...filter.enabledIds],
      })
    }

    return (await qb.getMany()).map(normalizeBoardRow)
    })
  }

  /**
   * One page of the dashboards list (`/admin/dashboards`; the phase 43 list contract, owner 2026-10-26: "paginate it, do not fetch every
   * board at once"): the boards the viewer may open (shared, or their own), of every workspace unless `workspace` names some (`none` =
   * standalone), never a module's (a module's boards live on its own pages), searched by title or description, sorted by a
   * whitelisted field with the board id as the tiebreak so equal values page in a stable order.
   */
  static async page(tenantId: string, viewer: BoardViewer, q: BoardListQuery): Promise<{ rows: DashboardBoard[]; total: number }> {
    return withTenantRepositoryFor(tenantId, DashboardBoard, async (repo) => {
      const qb = repo
        .createQueryBuilder('b')
        .where('b.tenantId = :tenantId', { tenantId })
        .andWhere('(b.scope = :shared OR b.ownerUserId = :userId)', { shared: 'TENANT', userId: viewer.userId })
        .andWhere('b.moduleId IS NULL')
      if (q.scope?.length) qb.andWhere('b.scope IN (:...scopes)', { scopes: q.scope })
      if (q.workspace?.length) {
        const named = q.workspace.filter((w) => w !== 'none')
        const either = [...(q.workspace.includes('none') ? ['b.workspace IS NULL'] : []), ...(named.length ? ['b.workspace IN (:...workspaces)'] : [])]
        qb.andWhere(`(${either.join(' OR ')})`, { workspaces: named })
      }
      if (q.search) qb.andWhere('(b.title ILIKE :text OR b.description ILIKE :text)', { text: `%${escapeLike(q.search)}%` })
      for (const s of q.sort ?? []) qb.addOrderBy(BOARD_LIST_SORT[s.field], s.dir === 'desc' ? 'DESC' : 'ASC')
      qb.addOrderBy('b.boardId', 'ASC').skip(q.page * q.pageSize).take(q.pageSize)
      const [rows, total] = await qb.getManyAndCount()
      return { rows: rows.map(normalizeBoardRow), total }
    })
  }

  static async get(tenantId: string, boardId: string, viewer: BoardViewer): Promise<DashboardBoard> {
    const board = await withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.findOne({ where: { tenantId, boardId } }))
    return visibleOr404(board, viewer)
  }

  /** The board, LOCKED, on the caller's transaction — same visibility rule as `get`. */
  static async lock(qr: QueryRunner, tenantId: string, boardId: string, viewer: BoardViewer): Promise<DashboardBoard> {
    const board = await qr.manager.getRepository(DashboardBoard).findOne({
      where: { tenantId, boardId },
      lock: { mode: 'pessimistic_write' },
    })
    return visibleOr404(board, viewer)
  }

  /** The board the admin home (or a module page) opens, or null when none exists yet. */
  static async findDefault(
    tenantId: string,
    viewer: BoardViewer,
    anchor: BoardAnchor,
  ): Promise<DashboardBoard | null> {
    const where = anchorWhere(anchor)
    return withTenantRepositoryFor(tenantId, DashboardBoard, async (repo) => {
      // A personal default wins over the shared one — that is what "personal
      // dashboard" means; the shared board stays the fallback for everyone else.
      const mine = await repo.findOne({
        where: { ...where, tenantId, isDefault: true, scope: 'PRIVATE', ownerUserId: viewer.userId },
      })
      if (mine) return normalizeBoardRow(mine)
      const shared = await repo.findOne({ where: { ...where, tenantId, isDefault: true, scope: 'TENANT' } })
      return shared ? normalizeBoardRow(shared) : null
    })
  }

  /**
   * `dto.slug`, when a caller passes one, is an internal escape hatch — the
   * deterministic slugs the workspace/module "customise" routes and
   * `BoardTemplateService.apply` write (`ws-<id>`, `template-<key>`, each with
   * a `-<userId>` suffix for a caller's personal fallback). The public
   * `CreateBoardDTO` never carries `slug` at all (Faz 9, K6), so for every
   * caller that matters this branch always mints one from the title.
   */
  static async create(
    tenantId: string,
    dto: CreateBoardInput & BoardCreateExtras,
    viewer: BoardViewer,
  ): Promise<DashboardBoard> {
    return withTenantTransactionFor(tenantId, (qr) => this.createOn(qr, tenantId, dto, viewer))
  }

  /**
   * Create on the caller's transaction. The slug check and the default demote
   * + insert run under a per-tenant board advisory lock: two creates of the
   * same slug used to pass the check together (the unique index then 500'd),
   * and two "make default" boards on one anchor could both end up default.
   */
  private static async createOn(
    qr: QueryRunner,
    tenantId: string,
    dto: CreateBoardInput & BoardCreateExtras,
    viewer: BoardViewer,
  ): Promise<DashboardBoard> {
    await lockBoards(qr, tenantId)
    const repo = qr.manager.getRepository(DashboardBoard)
    await assertHeadroomUnderLock(qr, tenantId, dto.scope, viewer.userId)
    const slug = dto.slug ?? mintSlug(dto.title)
    if (await repo.findOne({ where: { tenantId, slug } })) {
      throw new AppError(MSG.BOARD_SLUG_TAKEN, 409, ErrorCode.CONFLICT)
    }
    const ownerUserId = dto.scope === 'PRIVATE' ? viewer.userId : null
    const anchor: BoardAnchor = { workspace: dto.workspace ?? null, moduleId: dto.moduleId ?? null }
    if (dto.isDefault) await clearDefault(qr, tenantId, anchor, ownerUserId)
    return repo.save(repo.create({
      tenantId,
      slug,
      title: dto.title,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      workspace: anchor.workspace,
      moduleId: anchor.moduleId,
      scope: dto.scope,
      ownerUserId,
      createdByUserId: viewer.userId,
      isDefault: dto.isDefault,
      gridCols: normalizeGridCols(dto.gridCols),
      settings: prepareBoardSettings(dto.settings ?? null),
      timeWindow: dto.timeWindow ?? null,
      params: createdParams(dto),
      aliases: null,
      filters: dto.filters && dto.filters.length > 0 ? dto.filters : null,
      pages: dto.pages && dto.pages.length > 0 ? dto.pages : null,
      mainPage: dto.mainPage ?? null,
    }))
  }

  static async update(
    tenantId: string,
    boardId: string,
    dto: UpdateBoardInput,
    viewer: BoardViewer,
  ): Promise<DashboardBoard> {
    // The revision gate is checked on the LOCKED row: two edits carrying the
    // same `expectedRevision` used to both pass on unlocked reads, the second
    // silently overwriting the first — the exact case the gate exists for.
    return withTenantTransactionFor(tenantId, async (qr) => {
      // The board-set lock for a new default, and for a share: the shared quota is counted under it, as a create counts it.
      if (dto.isDefault === true || dto.scope === 'TENANT') await lockBoards(qr, tenantId)
      const board = await this.lock(qr, tenantId, boardId, viewer)
      // The Discard copies' lock before any card is read for update (a column change rescales them), the order a card write takes.
      await holdSnapshots(qr, tenantId, board.boardId)
      assertFresh(board, dto.expectedRevision)
      if (dto.scope === 'TENANT' && board.scope !== 'TENANT') {
        // Phase 39 (UX-1): a personal board shared with the workspace. A personal default stands in for a shared board at its
        // anchor, and the shared default there would clash with it: such a board is copied as a shared one instead.
        // 422, not 409: a 409 reads as "changed elsewhere" to the editor, which reloads instead of saying why (phase 39 review).
        if (board.isDefault || dto.isDefault === true) throw new AppError(MSG.BOARD_SHARE_PERSONAL_DEFAULT, 422, ErrorCode.VALIDATION_ERROR)
        await assertHeadroomUnderLock(qr, tenantId, 'TENANT', viewer.userId)
        // K10 again under the board's row lock: a card placed after the route's check is seen here, and a placement that has not
        // committed yet waits for this row and then finds a shared board (`DashboardInstanceService.create`).
        await assertNoPrivateWidgetCards(qr, tenantId, board.boardId)
        board.scope = 'TENANT'
        board.ownerUserId = null
      }

      if (dto.title !== undefined) board.title = dto.title
      if (dto.description !== undefined) board.description = dto.description
      if (dto.icon !== undefined) board.icon = dto.icon
      if (dto.settings !== undefined) board.settings = prepareBoardSettings(dto.settings, board.settings ?? null)
      if (dto.gridCols !== undefined && dto.gridCols !== normalizeGridCols(board.gridCols)) {
        await rescalePlacements(qr, tenantId, board.boardId, normalizeGridCols(board.gridCols), dto.gridCols)
        board.gridCols = dto.gridCols
      }
      if (dto.timeWindow !== undefined) board.timeWindow = dto.timeWindow
      // The board's cards, read once when its parameters or pages change, or when the row is in an old shape: a row read before
      // phase 41 is saved in the new one (`normalizeBoardRow`), its cards' `{ $alias }` references with it (D41-7).
      const legacy = boardWasLegacy(board)
      const placed = legacy || dto.params !== undefined || dto.pages !== undefined || dto.aliases !== undefined || dto.filters !== undefined
        ? await qr.manager.getRepository(DashboardWidgetInstance).find({ where: { tenantId, entityType: 'DASHBOARD', entityId: boardId } })
        : []
      if (legacy) await rewritePlacementRefs(qr, placed, boardAliasKeys(board))
      // What the cards' `openPage` actions had before this save: only what the save takes away from them is refused below.
      const before = { pages: board.pages ?? null, params: board.params ?? null }
      // Phase 41: one parameter list. `params` is the whole list; an old `aliases` write (phase 36) replaces the entity
      // parameters the editor's legacy view shows as aliases, and with `params` the two are the legacy pair.
      let nextParams: BoardParam[] | null | undefined = dto.params === undefined ? undefined : (dto.params ?? null)
      if (dto.aliases !== undefined) {
        nextParams = withLegacyAliases(nextParams !== undefined ? nextParams : (board.params as BoardParam[] | null), dto.aliases)
      }
      if (nextParams !== undefined) {
        const list = nextParams ?? []
        // `params` was checked by the DTO; a list merged with old aliases is checked here (a key both use, the combined cap).
        const checked = dto.aliases !== undefined ? BoardParamListSchema.safeParse(list) : null
        if (checked && !checked.success) {
          const issue = checked.error.issues[0]
          throw new AppError(`${issue.path.join('.')}: ${issue.message}`, 400, ErrorCode.VALIDATION_ERROR)
        }
        // A parameter a card still reads cannot be removed: every bound query would then 422 as unresolved (15.5a).
        const gone = removedParamKeys(board.params as Array<{ key: string }> | null, list)
        if (gone.length > 0) {
          const aliasKeys = boardAliasKeys(board)
          const readBy = (i: DashboardWidgetInstance): Set<string> => {
            const keys = referencedParamKeys([i.dataBinding as never])
            // ...a binding or a command's target, named the phase 36 way (a card not rewritten yet)...
            for (const k of placementAliasKeys(i)) keys.add(Object.prototype.hasOwnProperty.call(aliasKeys, k) ? aliasKeys[k] : k)
            // ...or a card's actions or rules (phase 35, E9): a `setParams` key, a `{ $param }`, a condition, a `{{param_}}`
            // token, a scene rule; they would dangle silently.
            for (const k of referencedPlacementParamKeys({ actions: i.actions, settings: i.settings, visibility: i.visibility })) keys.add(k)
            return keys
          }
          const users = placed.filter((i) => { const keys = readBy(i); return gone.some((k) => keys.has(k)) })
          const used = new Set(users.flatMap((i) => [...readBy(i)]))
          // ...nor one a page takes as an input (phase 29), unless the same save drops that input too.
          const pagesAfter = dto.pages !== undefined ? dto.pages : board.pages
          for (const k of pageInputParamKeys(pagesAfter)) used.add(k)
          // ...nor one an entity parameter reads (a page value, a relation root; phase 36's alias rule), unless it goes too.
          for (const k of entityParamReadKeys(list)) used.add(k)
          // ...nor one a key filter reads as a `{ $param }` value (36.7), unless the same save drops that filter.
          for (const k of filterParamKeys((dto.filters !== undefined ? dto.filters : board.filters) as BoardFilter[] | null)) used.add(k)
          const blocking = gone.filter((k) => used.has(k))
          if (blocking.length > 0) {
            throw new AppError(`${MSG.BOARD_PARAM_IN_USE}: '${blocking.join("', '")}'`, 409, ErrorCode.CONFLICT, {
              // The cards and the pages that read it, so the editor names them (a page by its title).
              details: {
                params: blocking,
                placements: users.map((i) => ({ instanceId: i.instanceId, title: i.title ?? null })),
                pages: pagesTakingParams(pagesAfter, blocking),
              },
            })
          }
        }
        board.params = list.length > 0 ? list : null
      }
      board.aliases = null
      if (dto.pages !== undefined) {
        // A page that still holds cards cannot be removed (D-1 (a)): its cards would vanish from every view.
        const gone = removedPageKeys(board.pages ?? null, dto.pages)
        if (gone.length > 0) {
          // ...nor one an `openPage` action still opens: the action would silently do nothing.
          const opened = referencedActionPageKeys(placed.map((i) => i.actions))
          const blocking = gone.filter((k) => placed.some((i) => i.pageKey === k) || opened.has(k))
          if (blocking.length > 0) {
            throw new AppError(`${MSG.BOARD_PAGE_IN_USE}: '${blocking.join("', '")}'`, 409, ErrorCode.CONFLICT)
          }
        }
        board.pages = dto.pages && dto.pages.length > 0 ? dto.pages : null
      }
      if (dto.pages !== undefined || nextParams !== undefined) {
        // Every page input names a board param (phase 29), checked on what the board holds after this save.
        assertPageInputsKnown(board.pages ?? null, board.params ?? null)
        // ...and every stored `openPage` still gives its target page what it needs (E9): an input marked required later,
        // or a default taken away, is refused naming the cards, the way the placement write would have been. Only what
        // THIS save takes away counts (F3): a card already short of an input (a row from before the check, a card moved
        // off the page that held the value) does not block an unrelated change, or the board could never be edited again.
        const needing = placementsNewlyNeedingInputs(placed, before, { pages: board.pages ?? null, params: board.params ?? null })
        if (needing.length > 0) {
          throw new AppError(`${MSG.BOARD_PLACEMENTS_NEED_INPUT}: '${needing.map((p) => p.title || p.instanceId).join("', '")}'`, 409, ErrorCode.CONFLICT, { details: { placements: needing } })
        }
      }
      if (dto.filters !== undefined) {
        // A filter a binding still names cannot be removed (36.7): its queries would 422.
        const gone = removedFilterKeys(board.filters as Array<{ key: string }> | null, dto.filters)
        if (gone.length > 0) {
          const users = placed.filter((i) => gone.some((k) => placementFilterKeys(i).has(k)))
          if (users.length > 0) {
            const blocking = gone.filter((k) => users.some((i) => placementFilterKeys(i).has(k)))
            throw new AppError(`${MSG.FILTER_IN_USE}: '${blocking.join("', '")}'`, 409, ErrorCode.CONFLICT, {
              details: { filters: blocking, placements: users.map((i) => ({ instanceId: i.instanceId, title: i.title ?? null })) },
            })
          }
        }
        board.filters = dto.filters && dto.filters.length > 0 ? dto.filters : null
      }
      if (nextParams !== undefined || dto.filters !== undefined) {
        // What every entity parameter reads is one of the board's parameters after this save (E36-7)...
        assertEntityParamRefs(board.params as BoardParam[] | null)
        // ...and so is every param a key filter reads (36.7).
        assertFilterParamsKnown(board.filters as BoardFilter[] | null, board.params as Array<{ key: string }> | null)
      }
      if (dto.mainPage !== undefined) board.mainPage = dto.mainPage
      if (dto.isDefault === true && !board.isDefault) {
        await clearDefault(
          qr, tenantId, { workspace: board.workspace ?? null, moduleId: board.moduleId ?? null }, board.ownerUserId ?? null,
        )
        board.isDefault = true
      } else if (dto.isDefault === false) {
        board.isDefault = false
      }
      board.revision += 1
      await markSnapshotsChanged(qr, tenantId, board.boardId, viewer.userId)
      return qr.manager.getRepository(DashboardBoard).save(board)
    })
  }

  /**
   * Copy a board's placements onto a fresh one (Faz 9, dilim 9.1 — "start from
   * an existing board" and the personal-copy half of K4).
   *
   * Every placement is re-resolved for `viewer` (the same rule
   * `dashboard-boards-board-id-instances.route.ts` applies to a manual
   * placement): a copy is a shortcut for placing each widget again, not an
   * exemption from checking whether this caller may see it. A placement that
   * does not resolve is dropped and reported BY NAME (`widgetRef`) rather than
   * silently vanishing, so whoever copied the board knows something is
   * missing and why. Geometry, settings, data bindings and actions all carry
   * over unchanged; `pinnedVersion` too, since the copy is a snapshot of what
   * the source board was showing, not a promise to track its future edits.
   * Every copied card is a new placement for `dashboard:placement_guard` (31, C4):
   * a guard's refusal fails the whole copy (422), nothing is written.
   */
  static async duplicate(
    tenantId: string,
    sourceBoardId: string,
    input: { title: string; scope: 'TENANT' | 'PRIVATE'; anchor?: BoardAnchor },
    viewer: BoardViewer,
    resolvableRefs: Set<string>,
    /**
     * Rewrites each copied placement's stored `actions` (the route drops command entries the caller may not
     * author, `command-verdicts.ts`); absent = copied as is.
     */
    rewriteActions?: (actions: unknown) => unknown,
    /**
     * Whether the caller holds a permission a `dashboard:element_actions` provider names for authoring commands on the
     * elements of its widget (a symbol of a process diagram). A copy is a new placement the caller authors, so without it
     * the copy drops those entries (counted in `droppedElementCommands`); absent = the caller holds nothing.
     */
    authoring?: ElementAuthoring,
  ): Promise<{ board: DashboardBoard; skipped: string[]; droppedElementCommands: number }> {
    // Board + its copied placements in ONE transaction: a failed copy no
    // longer leaves an empty duplicate board behind.
    return withTenantTransactionFor(tenantId, async (qr) => {
    // The board-set lock before the source row, in the order `update` takes them: the other way round, a share and a duplicate of
    // one board deadlocked (phase 39 review). `createOn` takes it again, which an advisory lock allows.
    await lockBoards(qr, tenantId)
    const source = await this.lock(qr, tenantId, sourceBoardId, viewer)
    const instanceRepo = qr.manager.getRepository(DashboardWidgetInstance)
    const sourceInstances = await instanceRepo.find({
      where: { tenantId, entityType: 'DASHBOARD', entityId: source.boardId },
      order: { order: 'ASC', y: 'ASC', x: 'ASC' },
    })

    const anchor = input.anchor ?? { workspace: source.workspace ?? null, moduleId: source.moduleId ?? null }
    const board = await this.createOn(
      qr,
      tenantId,
      {
        title: input.title,
        description: source.description ?? null,
        icon: source.icon ?? null,
        workspace: anchor.workspace ?? null,
        moduleId: anchor.moduleId ?? null,
        scope: input.scope,
        isDefault: false,
        // A copy keeps what the source board shows by default: its look (settings), window and parameters.
        settings: (source.settings as Record<string, unknown> | null) ?? null,
        timeWindow: source.timeWindow ?? null,
        params: source.params ?? null,
        filters: source.filters ?? null,
        pages: source.pages ?? null,
        mainPage: source.mainPage ?? null,
        // The copied geometry was made on the source's columns.
        gridCols: normalizeGridCols(source.gridCols),
      },
      viewer,
    )

    const { keep, skipped } = partitionCopyableRefs(sourceInstances.map((i) => i.widgetRef), resolvableRefs)
    const keepSet = new Set(keep)
    const rows: DashboardWidgetInstance[] = []
    let droppedElementCommands = 0
    for (const i of sourceInstances.filter((row) => keepSet.has(row.widgetRef))) {
      const settings = await copiedSettings(qr, tenantId, i)
      const rewritten = rewriteActions ? rewriteActions(i.actions ?? null) : i.actions
      const kept = await dropElementCommandsWithoutPermission(
        tenantId, elementCommandsOf(rewritten).length > 0 ? await placementKind(qr, tenantId, i.widgetRef) : undefined, rewritten, authoring,
      )
      droppedElementCommands += kept.dropped
      rows.push(instanceRepo.create({
        tenantId,
        entityType: 'DASHBOARD',
        entityId: board.boardId,
        widgetRef: i.widgetRef,
        pinnedVersion: i.pinnedVersion ?? null,
        x: i.x, y: i.y, w: i.w, h: i.h, order: i.order,
        settings,
        // The copy's cards name the copied parameters the phase 41 way (D41-7), whatever age the source's are.
        dataBinding: normalizeParamRefs(i.dataBinding ?? null, boardAliasKeys(source)).value,
        actions: normalizeParamRefs((kept.actions ?? null) as object | null, boardAliasKeys(source)).value,
        title: i.title ?? null,
        refreshSeconds: i.refreshSeconds ?? null,
        pageKey: i.pageKey ?? null,
        visibility: i.visibility ?? null,
        transform: i.transform ?? null,
        // A copy is a new placement with its own history (15.3c).
        revision: 1,
      }))
    }
    if (rows.length) await instanceRepo.save(rows)

    return { board, skipped, droppedElementCommands }
    })
  }

  /**
   * "Return to the shared board": delete the caller's own PRIVATE default at
   * this anchor. A no-op (not a 404) when they have none — asking to stop
   * overriding something you were never overriding is not an error.
   */
  static async removePersonalDefault(tenantId: string, anchor: BoardAnchor, userId: string): Promise<void> {
    const board = await withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.findOne({
      where: { ...anchorWhere(anchor), tenantId, scope: 'PRIVATE', ownerUserId: userId, isDefault: true },
    }))
    if (!board) return
    await this.remove(tenantId, board.boardId, { userId })
  }

  /**
   * Delete a board and everything placed on it. The placements are removed by an
   * explicit query rather than a cascade: `entityId` is a bare uuid with no
   * foreign key (that is what makes the surface seam polymorphic), so the database
   * has nothing to cascade along. Its display links and its cards' overlays (phase 38) go in the same transaction: neither may outlive
   * its board.
   */
  static async remove(tenantId: string, boardId: string, viewer: BoardViewer): Promise<void> {
    await withTenantTransactionFor(tenantId, async (qr) => {
      const board = await this.lock(qr, tenantId, boardId, viewer)
      // The Discard copies' lock before the cards, as every card write takes them; the copies go below.
      await holdSnapshots(qr, tenantId, board.boardId)
      await qr.manager.getRepository(DashboardWidgetInstance).delete({
        tenantId, entityType: 'DASHBOARD', entityId: board.boardId,
      })
      await DashboardDisplayLinkService.deleteForBoard(qr, tenantId, board.boardId)
      await deleteOverlaysForBoard(qr, tenantId, board.boardId)
      await deleteHomesForBoard(qr, tenantId, board.boardId)
      await deleteSnapshotsForBoard(qr, tenantId, board.boardId)
      await qr.manager.getRepository(DashboardBoard).delete({ tenantId, boardId: board.boardId })
    })
  }

  /**
   * How many SHARED boards this tenant holds — the number the plan limit (K5)
   * is checked against. A tenant's headroom is spent by boards everyone can
   * see, not by however many personal copies members have made for
   * themselves; see `countPersonal` for that separate, per-user cap.
   */
  static async countShared(tenantId: string): Promise<number> {
    return withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.count({ where: { tenantId, scope: 'TENANT' } }))
  }

  /** How many PRIVATE boards this one user holds — checked against `MAX_PERSONAL_BOARDS_PER_USER`. */
  static async countPersonal(tenantId: string, userId: string): Promise<number> {
    return withTenantRepositoryFor(tenantId, DashboardBoard, (repo) =>
      repo.count({ where: { tenantId, scope: 'PRIVATE', ownerUserId: userId } }))
  }

  /**
   * Bump a board's revision so a concurrent editor's next save 409s.
   *
   * `markLayoutV2`, set ONLY by the full-board layout PUT (never by adding,
   * patching or deleting a single instance): that route is the sole place
   * that writes real x/y/w/h for the whole board, which is exactly what
   * `layoutVersion: 1` → `2` is supposed to mean (dashboard_board.entity.ts).
   * Without this, a `1` board's editor-run repack (board-layout.ts's
   * `planLayoutMigration`) writes once through this same endpoint expecting
   * the server to advance the version — and until this fix, nothing did, so
   * the repack re-ran (and re-clobbered any real drag) on every load.
   *
   * `byUserId`: who changed the board. The Discard copies other people took of it then name them (`markSnapshotsChanged`); without
   * it every copy is marked, so a Discard asks rather than silently overwrite a change it cannot attribute.
   */
  static async touch(tenantId: string, boardId: string, opts?: { markLayoutV2?: boolean; byUserId?: string }): Promise<number> {
    // Locked read + column update: two card edits touching at once used to
    // read the same revision and both write N+1 — an increment lost, so a
    // client holding N+1 could overwrite the other edit without a 409.
    return withTenantTransactionFor(tenantId, (qr) => bumpRevision(qr, tenantId, boardId, opts))
  }

  /**
   * Save a board's whole layout, gated by its revision — ATOMICALLY: the
   * board is locked, `expectedRevision` checked, every card moved and the
   * revision bumped in one transaction. The route used to check freshness on
   * an unlocked read, then save, then touch: two people arranging the same
   * board both passed the check and the later save silently won.
   */
  static async saveLayout(
    tenantId: string,
    boardId: string,
    dto: SaveLayoutInput,
    viewer: BoardViewer,
    authorize?: (board: DashboardBoard) => void,
  ): Promise<{ revision: number }> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const board = await this.lock(qr, tenantId, boardId, viewer)
      authorize?.(board)
      assertFresh(board, dto.expectedRevision)
      // The Discard copies' lock before the cards (the bump below marks them), the order a card write takes.
      await holdSnapshots(qr, tenantId, board.boardId)
      // `applyLayout` bounds every item by the board's columns (21.10).
      await DashboardInstanceService.applyLayout(qr, tenantId, { entityType: 'DASHBOARD', entityId: board.boardId }, dto)
      return { revision: await bumpRevision(qr, tenantId, boardId, { markLayoutV2: true, byUserId: viewer.userId }) }
    })
  }
}

/** The tenant's board-set lock: slug uniqueness and one default per anchor. */
/**
 * The quota check again, on the creating transaction and under `lockBoards` (dashboard.15). The
 * route's `assertBoardHeadroom` ran before this transaction, so two creates at the last free slot
 * both passed it; here the second one counts after the first committed (a new statement under
 * READ COMMITTED, behind the same advisory lock) and is refused. Lazy import: the entitlement
 * module imports this service for its counts.
 */
async function assertHeadroomUnderLock(qr: QueryRunner, tenantId: string, scope: 'TENANT' | 'PRIVATE', userId: string): Promise<void> {
  const { resolveBoardLimit, boardLimitError, MAX_PERSONAL_BOARDS_PER_USER } = await import('./dashboard.entitlement')
  const repo = qr.manager.getRepository(DashboardBoard)
  if (scope === 'PRIVATE') {
    const used = await repo.count({ where: { tenantId, scope: 'PRIVATE', ownerUserId: userId } })
    if (used >= MAX_PERSONAL_BOARDS_PER_USER) throw boardLimitError('PRIVATE', used, MAX_PERSONAL_BOARDS_PER_USER)
    return
  }
  const limit = await resolveBoardLimit(tenantId)
  if (limit === Infinity) return
  const used = await repo.count({ where: { tenantId, scope: 'TENANT' } })
  if (used >= limit) throw boardLimitError('TENANT', used, limit)
}

/** K10 for a share (phase 39, UX-1): no card of the board may show a widget private to its author; 422 naming them. */
export async function assertNoPrivateWidgetCards(qr: QueryRunner | undefined, tenantId: string, boardId: string): Promise<void> {
  const personal = await DashboardInstanceService.privateWidgetCards(tenantId, boardId, qr)
  if (personal.length === 0) return
  const names = [...new Set(personal.map((i) => i.title || i.widgetName))]
  throw new AppError(`${MSG.WIDGET_PRIVATE_ON_SHARED}: '${names.join("', '")}'`, 422, ErrorCode.VALIDATION_ERROR, {
    details: { placements: personal.map((i) => ({ instanceId: i.instanceId, title: i.title })) },
  })
}

async function lockBoards(qr: QueryRunner, tenantId: string): Promise<void> {
  await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:boards:${tenantId}`])
}

function visibleOr404(board: DashboardBoard | null, viewer: BoardViewer): DashboardBoard {
  // Another user's private board reads as absent: a 403 would confirm it exists.
  if (!board || (board.scope === 'PRIVATE' && board.ownerUserId !== viewer.userId)) {
    throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  }
  // Phase 41 (D41-7): every read sees one parameter list, whatever age the row is.
  return normalizeBoardRow(board)
}

async function bumpRevision(
  qr: QueryRunner,
  tenantId: string,
  boardId: string,
  opts?: { markLayoutV2?: boolean; byUserId?: string },
): Promise<number> {
  const repo = qr.manager.getRepository(DashboardBoard)
  const board = await repo.findOne({ where: { tenantId, boardId }, lock: { mode: 'pessimistic_write' } })
  if (!board) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  const revision = board.revision + 1
  await repo.update({ tenantId, boardId }, {
    revision,
    ...(opts?.markLayoutV2 && board.layoutVersion !== 2 ? { layoutVersion: 2 } : {}),
  })
  await markSnapshotsChanged(qr, tenantId, boardId, opts?.byUserId ?? null)
  return revision
}

async function clearDefault(
  qr: QueryRunner,
  tenantId: string,
  anchor: BoardAnchor,
  ownerUserId: string | null,
): Promise<void> {
  {
    // Done BEFORE the insert/update that sets the new default, because migration
    // 090/095's partial unique index would otherwise reject it.
    const workspace = anchor.workspace ?? null
    const moduleId = anchor.moduleId ?? null
    await qr.manager.getRepository(DashboardBoard)
      .createQueryBuilder()
      .update()
      .set({ isDefault: false })
      .where('"tenantId" = :tenantId', { tenantId })
      .andWhere('"isDefault" = true')
      .andWhere(workspace === null ? '"workspace" IS NULL' : '"workspace" = :workspace', { workspace })
      .andWhere(moduleId === null ? '"moduleId" IS NULL' : '"moduleId" = :moduleId', { moduleId })
      .andWhere(ownerUserId === null ? '"ownerUserId" IS NULL' : '"ownerUserId" = :ownerUserId', { ownerUserId })
      .execute()
  }
}

/** `{workspace, moduleId}` → a TypeORM `where` fragment. Both null means standalone. */
/** The list's public sort fields (`BoardListQueryDTO`) and the columns they order by. */
const BOARD_LIST_SORT: Record<'title' | 'updatedAt' | 'scope' | 'workspace', string> = {
  title: 'b.title', updatedAt: 'b.updatedAt', scope: 'b.scope', workspace: 'b.workspace',
}

function anchorWhere(anchor: BoardAnchor): Pick<FindOptionsWhere<DashboardBoard>, 'workspace' | 'moduleId'> {
  // TypeORM's typed `FindOptionsWhere` wants `IsNull()`, not a literal `null`,
  // for nullable-column equality (the `IsNull()` precedent elsewhere in the
  // tree, e.g. `asset.assignment.service.ts`).
  return {
    workspace: anchor.workspace ? anchor.workspace : IsNull(),
    moduleId: anchor.moduleId ? anchor.moduleId : IsNull(),
  }
}

/**
 * Re-express every placement of a board from `from` to `to` columns (21.10) on the caller's
 * transaction, the board already locked. The cards are read FOR UPDATE, like a layout save; a card
 * whose geometry changes gets its revision bumped, so an open settings drawer holding the old one
 * 409s instead of writing its stale `x`/`w` back.
 */
async function rescalePlacements(qr: QueryRunner, tenantId: string, boardId: string, from: number, to: number): Promise<void> {
  const repo = qr.manager.getRepository(DashboardWidgetInstance)
  const rows = await repo.find({
    where: { tenantId, entityType: 'DASHBOARD', entityId: boardId },
    lock: { mode: 'pessimistic_write' },
  })
  // Each in-board page is its own grid: an overlap on one page never pushes a card of another down (D-1 (a)).
  const scaled = perPage(
    rows.map((r) => ({ id: r.instanceId, x: r.x, y: r.y, w: r.w, h: r.h, pageKey: r.pageKey ?? null })),
    (r) => r.pageKey,
    (page) => scaleLayout(page, from, to),
  )
  for (const [i, row] of rows.entries()) {
    const g = scaled[i]
    if (g.x === row.x && g.y === row.y && g.w === row.w) continue
    await repo.update(
      { tenantId, instanceId: row.instanceId, entityType: 'DASHBOARD', entityId: boardId },
      { x: g.x, y: g.y, w: g.w, revision: (row.revision ?? 1) + 1 },
    )
  }
}

/** 409 when the editor's loaded revision is behind the stored one. */
export function assertFresh(board: { revision: number }, expectedRevision?: number): void {
  if (expectedRevision !== undefined && expectedRevision !== board.revision) {
    throw new AppError(MSG.BOARD_CONFLICT, 409, ErrorCode.CONFLICT)
  }
}

// K3's write checks live in `board.acl.ts`, kept import-light so a unit test can
// call them without booting env/db; re-exported here so every route that already
// imports this service gets them from the same place.
export { assertCanWrite, canWrite, assertModuleReachable } from './board.acl'

/**
 * A copied placement's settings (owner decision 2026-10-18 #17): the same validate-then-prune path every placement
 * write takes, so a key its widget's schema no longer declares is not carried into the copy. A stored value that
 * path would now refuse (a legacy value a stricter check rejects, a part saved by a newer version, a site since
 * taken off the embed allow-list, an old row over the size cap) is copied as stored: the source already holds it,
 * and a board copy must not fail on a card nobody edited.
 *
 * A copy is a new placement, so the `dashboard:placement_guard` guards of its kind are asked either way (31, C4): their
 * refusal (422 `placement_guard_refused`) is rethrown, never swallowed like the other 422s, and a guard that cannot answer
 * (503) stops the copy too.
 */
async function copiedSettings(qr: QueryRunner, tenantId: string, row: DashboardWidgetInstance): Promise<object> {
  const stored = (row.settings as Record<string, unknown> | null) ?? {}
  try {
    return await placementSettingsForSave(qr, tenantId, row.widgetRef, stored, null, row.pinnedVersion)
  } catch (e) {
    if (isPlacementGuardRefusal(e)) throw e
    if (e instanceof AppError && (e.statusCode === 422 || e.statusCode === 409)) {
      // Copied as stored, but still a new placement: the guards judge the stored value.
      await assertPlacementGuardsFor(qr, tenantId, row.widgetRef, stored, null, row.pinnedVersion)
      return stored
    }
    throw e
  }
}

/**
 * The parameters a new board is created with (phase 41): one list, an old `aliases` taken in as entity parameters (an import or
 * a copy of an old shape), nothing stored in the old column.
 */
function createdParams(dto: { params?: Array<Record<string, unknown>> | null; aliases?: Array<Record<string, unknown>> | null }): Array<Record<string, unknown>> | null {
  const { params } = normalizeBoardParams({ params: dto.params, aliases: dto.aliases })
  return params.length > 0 ? (params as unknown as Array<Record<string, unknown>>) : null
}

/** A legacy board's cards with their references in the new shape (D41-7), saved on the caller's transaction; `placed` updated in place. */
async function rewritePlacementRefs(qr: QueryRunner, placed: DashboardWidgetInstance[], aliasKeys: Record<string, string>): Promise<void> {
  const changed: DashboardWidgetInstance[] = []
  for (const i of placed) {
    const n = normalizePlacementRefs({ dataBinding: i.dataBinding ?? null, actions: i.actions ?? null }, aliasKeys)
    if (!n.changed) continue
    i.dataBinding = n.placement.dataBinding as object | null
    i.actions = n.placement.actions as object | null
    changed.push(i)
  }
  if (changed.length > 0) await qr.manager.getRepository(DashboardWidgetInstance).save(changed)
}
