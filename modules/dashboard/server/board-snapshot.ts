import 'reflect-metadata'
import { Not, type QueryRunner } from 'typeorm'
import { DashboardBoardSnapshot } from './entities/dashboard_board_snapshot.entity'

/**
 * The table side of a board's Discard copies (`DashboardBoardSnapshot`), kept apart from `board-snapshot.service.ts` so the board's
 * revision bump, its removal and the module purge sweep need only the table, not the restore path.
 */

/**
 * The lock on a board's copies, held to the end of the caller's transaction. Every write that changes the board takes it before
 * the board's cards (after the board's row, where it reads that), and a restore takes it before it reads its copy: a card write
 * and its mark then commit together before the restore reads the copy, or wait until the restore has committed. A card write that
 * marked the copies only in a later transaction (the revision bump) left a window where a restore wrote over it unasked.
 */
export async function holdSnapshots(qr: QueryRunner, tenantId: string, boardId: string): Promise<void> {
  await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:snapshots:${tenantId}:${boardId}`])
}

/**
 * A change to the board by `userId` (null: not known): every copy of the board that someone else took now names them, so that
 * person's Discard asks before it overwrites the change. On the caller's transaction, under `holdSnapshots`.
 */
export async function markSnapshotsChanged(qr: QueryRunner, tenantId: string, boardId: string, userId: string | null): Promise<void> {
  await holdSnapshots(qr, tenantId, boardId)
  const repo = qr.manager.getRepository(DashboardBoardSnapshot)
  const at = new Date()
  if (userId) await repo.update({ tenantId, boardId, userId: Not(userId) }, { otherUserId: userId, otherAt: at })
  else await repo.update({ tenantId, boardId }, { otherUserId: null, otherAt: at })
}

/**
 * A card write's mark (`markSnapshotsChanged`) on the surface it writes to, made on the write's own transaction: before the card
 * row is locked, after the board's row where the write reads it. Only a board has copies.
 */
export async function markSurfaceChanged(
  qr: QueryRunner, tenantId: string, surface: { entityType: string; entityId: string }, userId: string | null,
): Promise<void> {
  if (surface.entityType === 'DASHBOARD') await markSnapshotsChanged(qr, tenantId, surface.entityId, userId)
}

/** Every copy of a board, on the caller's transaction (the board is being deleted; `holdSnapshots` taken before its cards). */
export async function deleteSnapshotsForBoard(qr: QueryRunner, tenantId: string, boardId: string): Promise<void> {
  await holdSnapshots(qr, tenantId, boardId)
  await qr.manager.getRepository(DashboardBoardSnapshot).delete({ tenantId, boardId })
}
