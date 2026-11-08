import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * What a board looked like when someone started customising it (owner 2026-10-27: "add Discard to the dashboard editor"). Customise
 * saves every change as it is confirmed, so Discard puts this copy back (`board-snapshot.service.ts`): the board's document, its cards
 * and their overlays, as the server read them. One per Customise sitting: a person keeps at most `MAX_SNAPSHOTS_PER_PERSON` of one
 * board (another tab's sitting keeps its own), and a copy older than a day is dropped when the next one is taken.
 *
 * `otherUserId` / `otherAt`: the last person who changed the board after the copy was taken, when that was not its owner (every
 * card or overlay write, and every revision bump, marks the board's copies of the others). Discard then asks before it overwrites their change.
 *
 * `boardId` is a bare uuid with no foreign key, like the overlays: deleting a board deletes its copies in the same transaction
 * (`DashboardBoardService.remove`, the module purge sweep). Created in SQL by migration 017 (same names as here).
 */
@Entity('dashboard_board_snapshots')
@Index('IDX_dashboard_board_snapshots_board_user', ['tenantId', 'boardId', 'userId'])
export class DashboardBoardSnapshot {
  /** Migration 017 defaults it to `gen_random_uuid()`, like 014. */
  @PrimaryGeneratedColumn('uuid', { name: 'snapshotId', primaryKeyConstraintName: 'PK_dashboard_board_snapshots' })
  snapshotId!: string

  @Column({ type: 'uuid' })
  tenantId!: string

  /** The board (`dashboard_boards.boardId`). */
  @Column({ type: 'uuid' })
  boardId!: string

  /** Who started customising. Only they can read, restore or drop the copy. */
  @Column({ type: 'uuid' })
  userId!: string

  /** The board's revision when the copy was taken. */
  @Column({ type: 'int' })
  revision!: number

  /** `{ board, instances, overlays }` (`BoardSnapshotDocument`). */
  @Column({ type: 'jsonb' })
  document!: Record<string, unknown>

  @Column({ type: 'uuid', nullable: true })
  otherUserId!: string | null

  @Column({ type: 'timestamp', nullable: true })
  otherAt!: Date | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date
}
