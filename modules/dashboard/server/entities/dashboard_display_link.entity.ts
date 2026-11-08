import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Check } from 'typeorm'

/**
 * A display link: a revocable, expiring credential that shows ONE shared board on a screen with no session (owner
 * decision 2026-10-17 #10; docs/phases/07-dashboard/20 items 20.2c and 20.2d; `server/display-token.ts`).
 *
 * Only the SHA-256 of the token is kept (`tokenHash`); `tokenHint` is its last characters, so a list can tell links
 * apart without holding anything that opens a screen. The link acts with its ISSUER's authority, capped by it on
 * every request (`server/display-principal.ts`): `createdByUserId` must still be an active member who may manage
 * and read boards, or the screen stops.
 *
 * `boardId` is a bare uuid with no foreign key, like the placements: deleting a board deletes its links in the same
 * transaction (`DashboardBoardService.remove`, the module purge sweep). Not part of the tenant export nor the board
 * package: a credential is not configuration. Created in SQL by migration 008 (same names as here).
 */
@Entity('dashboard_display_links')
@Index('IDX_dashboard_display_links_tenant_board', ['tenantId', 'boardId'])
@Index('UQ_dashboard_display_links_token_hash', ['tokenHash'], { unique: true })
@Check('ck_dashboard_display_links_values', `"tokenHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "createdAt"`)
export class DashboardDisplayLink {
  /**
   * Migration 008 defaults it to `gen_random_uuid()` (built in) rather than the `uuid_generate_v4()` a synchronize pass
   * writes: a module migration runs with only its own schema on the search path, where the `uuid-ossp` function is not
   * found. TypeORM reads either default as a generated uuid, so the two modes do not drift.
   */
  @PrimaryGeneratedColumn('uuid', { name: 'displayLinkId', primaryKeyConstraintName: 'PK_dashboard_display_links' })
  displayLinkId!: string

  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  boardId!: string

  /** SHA-256 hex of the raw token. */
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string

  /** The token's last characters, for telling links apart in a list. */
  @Column({ type: 'varchar', length: 8 })
  tokenHint!: string

  /** Where the screen hangs ("Lobby TV"). */
  @Column({ type: 'varchar', length: 80 })
  label!: string

  /** The issuer: the member whose authority the screen borrows, and caps at. */
  @Column({ type: 'uuid' })
  createdByUserId!: string

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @Column({ type: 'timestamp' })
  expiresAt!: Date

  @Column({ type: 'timestamp', nullable: true })
  revokedAt!: Date | null

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId!: string | null

  /** Last time a screen used the link, at most once a minute (`LAST_USED_GRANULARITY_SECONDS`). No IP is kept. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt!: Date | null
}
