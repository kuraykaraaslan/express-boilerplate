import 'reflect-metadata'
import { isDeepStrictEqual } from 'node:util'
import { LessThan, type QueryRunner } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { DashboardCardOverlay } from './entities/dashboard_card_overlay.entity'
import { DashboardBoardSnapshot } from './entities/dashboard_board_snapshot.entity'
import DashboardBoardService, { assertNoPrivateWidgetCards, type BoardViewer } from './board.crud.service'
import { holdWidgetIfPresent, placementKind } from './instance.crud.service'
import { builtinSceneContract } from './widget-kind-groups'
import { holdSnapshots, markSnapshotsChanged } from './board-snapshot'
import MSG from './dashboard.messages'

/**
 * Discard in Customise (owner 2026-10-27: "add Discard to the dashboard editor"). Customise saves every change as it is confirmed (a
 * card's settings, a move, pages, parameters, the board's settings), so throwing the changes away means putting the board back: the
 * editor takes a copy when Customise starts (`take`), asks what changed since (`status`), and Discard restores it (`restore`).
 *
 * The copy is the server's own read of the rows (the board's document, its cards, their overlays), never a body the client sends, so a
 * restore writes back only what the board already held. What is restored: the board's content (title, description, icon, settings,
 * columns, window, parameters, filters, pages, main page), every card (a card added since is removed, one removed since comes back with
 * its id, one changed gets its old fields) and every card overlay. What is not: who the board is shared with, whether it is a home or
 * a default, its slug and anchor. Those are not edits of the board's content, and Customise does not change them.
 *
 * A change someone else made after the copy was taken marks it (`markSnapshotsChanged`, on the change's own transaction for a card
 * or an overlay, on every revision bump): the restore is then a 409 naming them and when, and goes ahead only with `overwrite`. An
 * overwrite puts back cards the caller did not take away themselves, so a card whose actions it writes passes the command authoring
 * gate first (`CardGate`), as a hand edit would.
 *
 * A card that comes back must still have its widget: one whose library widget was deleted since (a delete is allowed once no card
 * uses it, and the caller's own removal was that last use) is left out, with its overlays, and named in `skipped`.
 */

/** A copy is kept for a day: Customise is a sitting, not a draft. */
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The copies one person keeps of one board: a sitting in another tab takes its own copy and leaves the first tab's alone (board-discard
 * review), up to this many; a newer one then drops the oldest, whose Discard answers 404 ("the copy … is gone").
 */
export const MAX_SNAPSHOTS_PER_PERSON = 5

/** The board fields a restore puts back. Sharing, home and default, slug and anchor are left as they are. */
const BOARD_FIELDS = [
  'title', 'description', 'icon', 'settings', 'gridCols', 'timeWindow', 'params', 'aliases', 'filters', 'pages', 'mainPage',
] as const

/** A card's stored content: everything but its identity, surface, revision and timestamps. */
const CARD_FIELDS = [
  'widgetRef', 'pinnedVersion', 'x', 'y', 'w', 'h', 'order', 'settings', 'dataBinding', 'actions', 'visibility', 'transform',
  'title', 'refreshSeconds', 'pageKey',
] as const

const OVERLAY_FIELDS = ['instanceId', 'subjectType', 'subjectId', 'settings', 'title'] as const

type Row = Record<string, unknown>

/** What the copy holds: the board's content and its rows, as JSON. */
export interface BoardSnapshotDocument {
  board: Row
  instances: Row[]
  overlays: Row[]
}

/** What changed since the copy, counted for the Discard question: one per board field, card and overlay. */
export interface SnapshotChanges {
  changes: number
  board: number
  cards: number
  overlays: number
}

/** Someone else's change after the copy (who: null when the change could not be attributed). */
export interface SnapshotConflict {
  userId: string | null
  at: string
}

/** Checks a card an overwrite writes actions back onto (the route's command authoring gate); throws to refuse. */
export type CardGate = (card: { instanceId: string; actions: unknown; kindType: string | undefined }) => Promise<void>

/** A JSON value as stored and read back (undefined gone, dates as strings), so a row and its copy compare equal when they say the same. */
const plain = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
const same = (a: unknown, b: unknown): boolean => isDeepStrictEqual(plain(a), plain(b))
const pick = (row: Row, fields: readonly string[]): Row => Object.fromEntries(fields.map((f) => [f, plain(row[f])]))

function conflictOf(snap: DashboardBoardSnapshot): SnapshotConflict | null {
  return snap.otherAt ? { userId: snap.otherUserId ?? null, at: new Date(snap.otherAt).toISOString() } : null
}

function conflictError(conflict: SnapshotConflict): AppError {
  return new AppError(MSG.BOARD_RESTORE_CONFLICT, 409, ErrorCode.CONFLICT, { details: { changedBy: conflict.userId, changedAt: conflict.at } })
}

/** The board's cards and overlays; `forUpdate` for a restore, which writes them (the board's row lock is already held). */
async function readRows(
  qr: QueryRunner, tenantId: string, boardId: string, forUpdate = false,
): Promise<{ instances: DashboardWidgetInstance[]; overlays: DashboardCardOverlay[] }> {
  const lock = forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}
  const instances = await qr.manager.getRepository(DashboardWidgetInstance).find({ where: { tenantId, entityType: 'DASHBOARD', entityId: boardId }, ...lock })
  const overlays = await qr.manager.getRepository(DashboardCardOverlay).find({ where: { tenantId, boardId }, ...lock })
  return { instances, overlays }
}

/** The plan of a restore: which rows go, come back or change, and how many changes that is. */
function planRestore(doc: BoardSnapshotDocument, board: Row, instances: Row[], overlays: Row[]) {
  const boardFields = BOARD_FIELDS.filter((f) => !same(board[f], doc.board[f]))
  const diff = (now: Row[], then: Row[], id: string, fields: readonly string[]) => {
    const thenById = new Map(then.map((r) => [r[id] as string, r]))
    const nowById = new Map(now.map((r) => [r[id] as string, r]))
    return {
      removed: now.filter((r) => !thenById.has(r[id] as string)),
      restored: then.filter((r) => !nowById.has(r[id] as string)),
      changed: then.filter((r) => {
        const cur = nowById.get(r[id] as string)
        return !!cur && fields.some((f) => !same(cur[f], r[f]))
      }),
    }
  }
  const cards = diff(instances, doc.instances, 'instanceId', CARD_FIELDS)
  const marks = diff(overlays, doc.overlays, 'overlayId', OVERLAY_FIELDS)
  const count = (d: typeof cards) => d.removed.length + d.restored.length + d.changed.length
  const changes: SnapshotChanges = {
    board: boardFields.length, cards: count(cards), overlays: count(marks),
    changes: boardFields.length + count(cards) + count(marks),
  }
  return { boardFields, cards, overlays: marks, changes }
}

/**
 * A scene binding owns what the widget's contribution declares in `sceneOwnedSettings` (phase 42, D42-5 / D42-13): an overlay of an old
 * copy that still carries those keys (taken before the conversion) must not bring them back, so they are taken out of the overlays the
 * restore writes (changed and restored), generically through the widget's own declaration. An overlay left with nothing (no settings, no
 * title) is not re-created. The copy itself is never edited.
 */
async function stripSceneOwned(
  plan: ReturnType<typeof planRestore>, widgetRefOf: ReadonlyMap<string, string>,
  /** The owned settings of a `db:` placement's builtin kind (phase 42.5, its group's declaration); asked once per placement ref. */
  ownedOfKind: (widgetRef: string, settings: Row) => Promise<string[]>,
): Promise<void> {
  const { sceneOwnedKeysIn } = await import('./ext-widget')
  const byRef = new Map<string, Promise<string[]>>()
  const strip = async (o: Row): Promise<Row> => {
    const settings = o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? (o.settings as Row) : null
    const ref = widgetRefOf.get(o.instanceId as string)
    if (!settings || !ref) return o
    const own = ref.startsWith('db:') ? await (byRef.get(ref) ?? byRef.set(ref, ownedOfKind(ref, settings)).get(ref)!) : sceneOwnedKeysIn(ref, settings)
    const owned = own.filter((k) => Object.hasOwn(settings, k))
    return owned.length === 0 ? o : { ...o, settings: Object.fromEntries(Object.entries(settings).filter(([k]) => !owned.includes(k))) }
  }
  plan.overlays.changed = await Promise.all(plan.overlays.changed.map(strip))
  plan.overlays.restored = (await Promise.all(plan.overlays.restored.map(strip))).filter((o) => {
    const settings = o.settings && typeof o.settings === 'object' ? Object.keys(o.settings as Row) : []
    return settings.length > 0 || !!o.title
  })
}

export default class DashboardBoardSnapshotService {
  /**
   * Copies the board for `viewer`, who is starting to customise it. Their copies of it from other sittings (another tab) stay, up to
   * `MAX_SNAPSHOTS_PER_PERSON` with this one; copies older than a day are dropped on the way. Read on the locked board, so the copy is one moment of it. `authorize` refuses a caller who may not write it.
   */
  static async take(
    tenantId: string, boardId: string, viewer: BoardViewer, authorize: (board: DashboardBoard) => void,
  ): Promise<{ snapshotId: string; revision: number }> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      await DashboardBoardService.lock(qr, tenantId, boardId, viewer)
      // The stored row, not the normalised read: a restore writes back exactly what was there.
      const board = await qr.manager.getRepository(DashboardBoard).findOne({ where: { tenantId, boardId } })
      if (!board) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      authorize(board)
      await holdSnapshots(qr, tenantId, boardId)
      const { instances, overlays } = await readRows(qr, tenantId, boardId)
      const repo = qr.manager.getRepository(DashboardBoardSnapshot)
      await repo.delete({ tenantId, createdAt: LessThan(new Date(Date.now() - SNAPSHOT_TTL_MS)) })
      const mine = await repo.find({ where: { tenantId, boardId, userId: viewer.userId }, select: { snapshotId: true, createdAt: true } })
      const oldest = mine.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(MAX_SNAPSHOTS_PER_PERSON - 1)
      for (const old of oldest) await repo.delete({ tenantId, snapshotId: old.snapshotId })
      const document: BoardSnapshotDocument = {
        board: pick(board as unknown as Row, BOARD_FIELDS),
        instances: instances.map((i) => plain(i) as Row),
        overlays: overlays.map((o) => plain(o) as Row),
      }
      const saved = await repo.save(repo.create({
        tenantId, boardId, userId: viewer.userId, revision: board.revision, document: document as unknown as Record<string, unknown>,
        // The app's clock, the one the age check above reads.
        otherUserId: null, otherAt: null, createdAt: new Date(),
      }))
      return { snapshotId: saved.snapshotId, revision: board.revision }
    })
  }

  /** What changed since `viewer`'s copy, and whether someone else changed the board meanwhile. 404 for a copy that is not theirs. */
  static async status(
    tenantId: string, boardId: string, snapshotId: string, viewer: BoardViewer,
  ): Promise<{ revision: number; changes: SnapshotChanges; conflict: SnapshotConflict | null }> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const board = await qr.manager.getRepository(DashboardBoard).findOne({ where: { tenantId, boardId } })
      const snap = await ownSnapshot(qr, tenantId, boardId, snapshotId, viewer)
      if (!board) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const { instances, overlays } = await readRows(qr, tenantId, boardId)
      const plan = planRestore(snap.document as unknown as BoardSnapshotDocument, board as unknown as Row, instances as unknown as Row[], overlays as unknown as Row[])
      // Nothing to put back overwrites nobody: the restore then writes nothing (`restore`).
      return { revision: snap.revision, changes: plan.changes, conflict: plan.changes.changes > 0 ? conflictOf(snap) : null }
    })
  }

  /**
   * Puts `viewer`'s copy back, in one transaction under the board's row lock: the board's content, its cards and their overlays as
   * they were, the board's revision bumped (an editor elsewhere then reloads), every card the restore writes given a new revision (an
   * open settings drawer on it then conflicts instead of saving over it). The copy is used up. A change by someone else since the copy
   * is a 409 (`changedBy`, `changedAt`) unless `overwrite`, and then the cards whose actions come back pass `gateCard`. A copy the
   * board already matches writes nothing (no bump, no mark, no conflict) and is dropped. `skipped`: the cards left out because their
   * widget is gone.
   */
  static async restore(
    tenantId: string, boardId: string, snapshotId: string, viewer: BoardViewer,
    opts: { overwrite?: boolean; authorize: (board: DashboardBoard) => void; gateCard: CardGate },
  ): Promise<{ revision: number; changes: SnapshotChanges; skipped: string[] }> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      await DashboardBoardService.lock(qr, tenantId, boardId, viewer)
      const boardRepo = qr.manager.getRepository(DashboardBoard)
      const board = await boardRepo.findOne({ where: { tenantId, boardId } })
      if (!board) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      opts.authorize(board)
      // The copies' lock before the copy is read: a card or overlay write that marked it has committed, or waits for this restore.
      await holdSnapshots(qr, tenantId, boardId)
      const snap = await ownSnapshot(qr, tenantId, boardId, snapshotId, viewer, true)
      const doc = snap.document as unknown as BoardSnapshotDocument
      const { instances, overlays } = await readRows(qr, tenantId, boardId, true)
      const plan = planRestore(doc, board as unknown as Row, instances as unknown as Row[], overlays as unknown as Row[])
      const snapshotRepo = qr.manager.getRepository(DashboardBoardSnapshot)
      if (plan.changes.changes === 0) {
        // The board is as the copy holds it: nothing is written, nobody's copy is marked, and the copy is used up.
        await snapshotRepo.delete({ tenantId, snapshotId: snap.snapshotId })
        return { revision: board.revision, changes: plan.changes, skipped: [] }
      }
      // the settings a scene binding owns do not come back through an old copy's overlays
      // (a builtin kind's own scene settings: its group declares them, and the declaration is per kind, so the keys asked for are the owned list of the ref's kind)
      await stripSceneOwned(
        plan, new Map([...doc.instances, ...(instances as unknown as Row[])].map((i) => [i.instanceId as string, String(i.widgetRef ?? '')])),
        async (ref) => (await builtinSceneContract(tenantId, await placementKind(qr, tenantId, ref)))?.owned ?? [],
      )
      const conflict = conflictOf(snap)
      if (conflict && !opts.overwrite) throw conflictError(conflict)

      // A card that comes back keeps pointing at its widget only while the widget is there (read FOR SHARE, as a new placement
      // reads it, so a delete running now waits for this restore and then counts the card); one whose widget is gone stays out.
      const skipped: string[] = []
      for (const c of plan.cards.restored) {
        if (!(await holdWidgetIfPresent(qr, tenantId, c.widgetRef as string))) skipped.push(c.instanceId as string)
      }
      if (skipped.length > 0) {
        const out = new Set(skipped)
        plan.cards.restored = plan.cards.restored.filter((c) => !out.has(c.instanceId as string))
        plan.overlays.restored = plan.overlays.restored.filter((o) => !out.has(o.instanceId as string))
      }

      const cardRepo = qr.manager.getRepository(DashboardWidgetInstance)
      const markRepo = qr.manager.getRepository(DashboardCardOverlay)
      if (conflict) {
        // Someone else's change is being overwritten: a card's actions that come back are checked as the caller's own edit.
        const current = new Map(instances.map((i) => [i.instanceId, i]))
        for (const card of [...plan.cards.restored, ...plan.cards.changed]) {
          const cur = current.get(card.instanceId as string)
          if (cur && same(cur.actions, card.actions)) continue
          if (card.actions == null) continue
          await opts.gateCard({
            instanceId: card.instanceId as string, actions: card.actions, kindType: await placementKind(qr, tenantId, card.widgetRef as string),
          })
        }
      }

      // Deletes first: a card or an overlay that came back under a new id must not meet the one it replaces (the overlay's
      // card-and-subject key is unique).
      for (const o of plan.overlays.removed) await markRepo.delete({ tenantId, overlayId: o.overlayId as string })
      for (const c of plan.cards.removed) {
        await markRepo.delete({ tenantId, instanceId: c.instanceId as string })
        await cardRepo.delete({ tenantId, instanceId: c.instanceId as string })
      }
      const revisionOf = new Map(instances.map((i) => [i.instanceId, i.revision ?? 1]))
      for (const c of plan.cards.changed) {
        await cardRepo.update(
          { tenantId, instanceId: c.instanceId as string },
          { ...pick(c, CARD_FIELDS), revision: (revisionOf.get(c.instanceId as string) ?? 1) + 1 } as never,
        )
      }
      for (const c of plan.cards.restored) {
        await cardRepo.save(cardRepo.create({
          ...pick(c, CARD_FIELDS),
          instanceId: c.instanceId as string, tenantId, entityType: 'DASHBOARD', entityId: boardId,
          revision: ((c.revision as number | undefined) ?? 1) + 1,
          ...(c.createdAt ? { createdAt: new Date(c.createdAt as string) } : {}),
        } as Partial<DashboardWidgetInstance>))
      }
      const markRevision = new Map(overlays.map((o) => [o.overlayId, o.revision ?? 1]))
      for (const o of plan.overlays.changed) {
        await markRepo.update(
          { tenantId, overlayId: o.overlayId as string },
          { settings: o.settings, title: o.title ?? null, revision: (markRevision.get(o.overlayId as string) ?? 1) + 1, updatedByUserId: viewer.userId } as never,
        )
      }
      for (const o of plan.overlays.restored) {
        await markRepo.save(markRepo.create({
          ...pick(o, OVERLAY_FIELDS),
          overlayId: o.overlayId as string, tenantId, boardId,
          revision: ((o.revision as number | undefined) ?? 1) + 1, updatedByUserId: viewer.userId,
          ...(o.createdAt ? { createdAt: new Date(o.createdAt as string) } : {}),
        } as Partial<DashboardCardOverlay>))
      }

      const patch: Row = Object.fromEntries(plan.boardFields.map((f) => [f, doc.board[f] ?? null]))
      const revision = board.revision + 1
      await boardRepo.update({ tenantId, boardId }, { ...patch, revision } as never)
      // K10 on what the board now holds: a card that came back must not show a widget private to its author on a shared board.
      if (board.scope === 'TENANT' && plan.cards.restored.length + plan.cards.changed.length > 0) {
        await assertNoPrivateWidgetCards(qr, tenantId, boardId)
      }
      // The restore is a change like any other for the people customising the board elsewhere.
      await markSnapshotsChanged(qr, tenantId, boardId, viewer.userId)
      await snapshotRepo.delete({ tenantId, snapshotId: snap.snapshotId })
      return { revision, changes: plan.changes, skipped }
    })
  }

  /** `viewer`'s copy is no longer wanted (Customise is done). Nothing when there is none. */
  static async drop(tenantId: string, boardId: string, snapshotId: string, viewer: BoardViewer): Promise<void> {
    await withTenantRepositoryFor(tenantId, DashboardBoardSnapshot, (repo) => repo.delete({ tenantId, boardId, snapshotId, userId: viewer.userId }))
  }
}

/** The caller's own copy of this board, or 404: another person's copy is not theirs to read or restore. */
async function ownSnapshot(
  qr: QueryRunner, tenantId: string, boardId: string, snapshotId: string, viewer: BoardViewer, forUpdate = false,
): Promise<DashboardBoardSnapshot> {
  const lock = forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}
  const snap = await qr.manager.getRepository(DashboardBoardSnapshot).findOne({ where: { tenantId, boardId, snapshotId, userId: viewer.userId }, ...lock })
  if (!snap) throw new AppError(MSG.BOARD_SNAPSHOT_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  return snap
}
