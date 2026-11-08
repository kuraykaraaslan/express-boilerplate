import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, Unique,
} from 'typeorm'
import type { BoardPage, MainPage } from '../board-pages'

/**
 * A named board: an arrangement of widget instances a tenant (or one person) owns.
 *
 * `workspace` ties a board to a `workspaces.config.ts` id so the admin home can
 * pick the right one when the switcher moves; `moduleId` does the same for a
 * module's own board (Faz 9, K2). A board carries AT MOST ONE of the two —
 * migration 095's CHECK enforces it — because they answer two different closed
 * questions (which workspace, which module) and a shared `EntityRef` pair would
 * pretend they are one polymorphic surface when neither is a bare uuid pointing
 * at a table this module has never heard of; both are registry slugs it already
 * knows the shape of. A board with neither is standalone and reached by
 * `boardId` (Faz 9, K1) — pre-Faz-9 code called this "reached by slug", back
 * when `slug` was still client-supplied and doubled as the address; K6 moved
 * addressing to `boardId` and the server now mints `slug` itself.
 *
 * `scope` is TENANT or PRIVATE only. There is deliberately no SYSTEM: a system
 * board would have to live in the root tenant, and `tenantDataSourceFor` routes
 * tenants to their own physical database, so such a row is unreachable rather
 * than merely awkward. See docs/phases/07-dashboard/01-data-model.md §1.6.
 */
@Unique(['tenantId', 'slug'])
@Entity('dashboard_boards')
export class DashboardBoard {
  @PrimaryGeneratedColumn('uuid', { name: 'boardId' })
  boardId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar' })
  slug!: string

  @Column({ type: 'varchar' })
  title!: string

  @Column({ nullable: true, type: 'text' })
  description?: string | null

  @Column({ nullable: true, type: 'varchar' })
  icon?: string | null

  /** Workspace id from app_shell's catalogue; null = not workspace-anchored. */
  @Index()
  @Column({ nullable: true, type: 'varchar' })
  workspace?: string | null

  /**
   * Module id this board belongs to (Faz 9, K2) — mutually exclusive with
   * `workspace` (migration 095's CHECK). A module's own board, independent of
   * which workspace(s) surface it.
   */
  @Index()
  @Column({ nullable: true, type: 'varchar' })
  moduleId?: string | null

  /** 'TENANT' (everyone in the tenant) | 'PRIVATE' (only `ownerUserId`). */
  @Column({ type: 'varchar', default: 'TENANT' })
  scope!: string

  /**
   * The owning user for a PRIVATE board — the axis record-level visibility scopes
   * on, the same one `organization.record-scope` resolves OWN/TEAM/ALL against.
   */
  @Index()
  @Column({ nullable: true, type: 'uuid' })
  ownerUserId?: string | null

  /**
   * The board the admin home opens for this (tenant, workspace, owner). Enforced
   * as a PARTIAL unique index in migration 090 — TypeORM's @Unique cannot express
   * "unique among rows where isDefault".
   */
  @Column({ type: 'boolean', default: false })
  isDefault!: boolean

  @Column({ type: 'int', default: 12 })
  gridCols!: number

  /**
   * Phase 21: the board's own settings (`core:board` template, stamped `$v`): grid row height and gap,
   * background colour or image (any CSS colour or a theme token; empty = no backdrop colour, the page
   * background shows through), card defaults, toolbar, default refresh. `null` = the defaults.
   */
  @Column({ type: 'jsonb', nullable: true })
  settings?: Record<string, unknown> | null

  /**
   * Who opened this board (Faz 9). Informational only — write authority comes
   * from `scope` + `dashboard.boards.manage` (`board.acl.ts`'s `assertCanWrite`),
   * never from "did you create it": an ADMIN demoted off the role must not keep
   * a private lane into a board they can no longer manage.
   */
  @Column({ nullable: true, type: 'uuid' })
  createdByUserId?: string | null

  /**
   * `1` = geometry written before the free-positioning grid (Faz 9, K8) — every
   * row before migration 095 defaults here. The editor repacks such a board by
   * `order` on first open, writes it back in one `PUT .../layout`, and bumps
   * this to `2`; `x`/`y`/`h` from a `1` board are not meaningful until then.
   */
  @Column({ type: 'int', default: 2 })
  layoutVersion!: number

  /**
   * Board-wide time window (docs/phases/07-dashboard/10): `{ mode: 'relative', last }` |
   * `{ mode: 'absolute', from, to }` plus `interval` / `aggregation` / `timezone`.
   * Null = no board window (queries use their own params). Shape enforced by
   * `board-window.ts` and migration 001's `jsonb_typeof` CHECK.
   */
  @Column({ type: 'jsonb', nullable: true })
  timeWindow?: Record<string, unknown> | null

  /** Typed viewer parameters, at most 16 (`BoardParamsSchema`); null = none. */
  @Column({ type: 'jsonb', nullable: true })
  params?: Array<Record<string, unknown>> | null

  /** Entity aliases, at most 32 (`BoardAliasesSchema`, phase 36); null = none. */
  @Column({ type: 'jsonb', nullable: true })
  aliases?: Array<Record<string, unknown>> | null

  /** Key filters, at most 16 (`BoardFiltersSchema`, phase 36.7); null = none. */
  @Column({ type: 'jsonb', nullable: true })
  filters?: Array<Record<string, unknown>> | null

  /** Optimistic-lock counter; a stale `expectedRevision` on save 409s. */
  /** In-board pages (D-1 (a), `board-pages.ts`): the ordered extra pages; null = only the main page. */
  @Column({ type: 'jsonb', nullable: true })
  pages?: Array<BoardPage> | null

  /** The main page's name and icon (phase 29, `MainPageSchema`); null = "Main", no icon. */
  @Column({ type: 'jsonb', nullable: true })
  mainPage?: MainPage | null

  @Column({ type: 'int', default: 0 })
  revision!: number

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
