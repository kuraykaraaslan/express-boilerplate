import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm'

/**
 * A card overlay (docs/phases/07-dashboard/38, E38-7): a card's settings for one subject entity, the device a page shows, kept as a
 * JSON merge patch on the card's own settings (`server/card-overlay.ts`), and optionally its own title. One station's diagram or 3D
 * design differs from the board's; everything else the card does (its data, its actions, its visibility) stays the board's.
 *
 * `instanceId` and `boardId` are bare uuids with no foreign key, like the placements: deleting a card or a board deletes its overlays in
 * the same transaction (`DashboardInstanceService.remove`, `DashboardBoardService.remove`, the module purge sweep). The subject is a
 * bare (type, id): an overlay whose subject is gone is never read (nothing asks for it). Not part of a template or a board package (a
 * template is for another tenant's entities). Created in SQL by migration 014 (same names as here).
 */
@Entity('dashboard_card_overlays')
@Index('UQ_dashboard_card_overlays_card_subject', ['tenantId', 'instanceId', 'subjectType', 'subjectId'], { unique: true })
@Index('IDX_dashboard_card_overlays_board_subject', ['tenantId', 'boardId', 'subjectType', 'subjectId'])
@Check('ck_dashboard_card_overlays_subject', `"subjectType" ~ '^[a-z][a-z0-9_.-]{0,59}$' AND "subjectId" ~ '^[A-Za-z0-9_-]{1,64}$'`)
export class DashboardCardOverlay {
  /** Migration 014 defaults it to `gen_random_uuid()`, like 008 (see `DashboardDisplayLink`). */
  @PrimaryGeneratedColumn('uuid', { name: 'overlayId', primaryKeyConstraintName: 'PK_dashboard_card_overlays' })
  overlayId!: string

  @Column({ type: 'uuid' })
  tenantId!: string

  /** The board the card is on: the viewer reads a subject's overlays per board. */
  @Column({ type: 'uuid' })
  boardId!: string

  /** The card (`dashboard_widget_instances.instanceId`). */
  @Column({ type: 'uuid' })
  instanceId!: string

  /** The subject's entity type, as the page's param names it (`iot_device`). */
  @Column({ type: 'varchar', length: 60 })
  subjectType!: string

  @Column({ type: 'varchar', length: 64 })
  subjectId!: string

  /** The merge patch on the card's settings (`{}`: only the title differs). */
  @Column({ type: 'jsonb', default: '{}' })
  settings!: Record<string, unknown>

  /** The card's title for this subject; null = the card's own. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title!: string | null

  /** Bumped on every write; a save names the revision it started from (409 when another save came first). */
  @Column({ type: 'int', default: 1 })
  revision!: number

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
