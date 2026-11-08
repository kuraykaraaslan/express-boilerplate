import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm'

/**
 * A person's own home dashboard (phase 20.2e, owner 2026-10-26: "a shared dashboard can be made just my home too"): the board this
 * person lands on at the admin home, any standalone board they can open, a shared one included. One per person and tenant; choosing
 * another replaces it. It wins over the older form of "my home" (`isDefault` on a personal board) and over the shared home
 * (`isDefault` on a shared board), which stays the fallback for everyone without a choice of their own.
 *
 * `boardId` is a bare uuid with no foreign key, like the overlays: deleting a board deletes the pointers to it in the same transaction
 * (`DashboardBoardService.remove`, the module purge sweep), and a pointer to a board the person can no longer open is skipped by the
 * landing. Created in SQL by migration 015 (same names as here).
 */
@Entity('dashboard_user_homes')
@Index('UQ_dashboard_user_homes_user', ['tenantId', 'userId'], { unique: true })
@Index('IDX_dashboard_user_homes_board', ['tenantId', 'boardId'])
export class DashboardUserHome {
  /** Migration 015 defaults it to `gen_random_uuid()`, like 014. */
  @PrimaryGeneratedColumn('uuid', { name: 'homeId', primaryKeyConstraintName: 'PK_dashboard_user_homes' })
  homeId!: string

  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  userId!: string

  /** The board (`dashboard_boards.boardId`). */
  @Column({ type: 'uuid' })
  boardId!: string

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
