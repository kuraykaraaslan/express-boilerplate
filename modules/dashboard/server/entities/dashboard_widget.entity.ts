import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, Unique,
} from 'typeorm'
import type { TenantMigrationStep } from '../tenant-template'

/**
 * A tenant-authored widget definition.
 *
 * The thirteen columns this shares with `dynamic_page_blocks` carry BYTE-IDENTICAL
 * names on purpose. The tables are not merged — the 60% test was computed and the
 * union came out at 48%, below the AGENTS.md §10.1 bar (see
 * docs/phases/07-dashboard/00-master-plan.md §A.4) — but the shared half is genuinely the
 * same concept, so if a third authorable-definition store ever appears the merge
 * is a rename rather than a rewrite. `column-parity.test.ts` fails loudly if
 * either side drifts.
 *
 * Three of dp's columns are deliberately NOT carried:
 *   - `script`  — an admin surface will not execute author JS on the host page;
 *                 a template runs opaque-origin, so its script travels inside it.
 *   - `serverHandler` — dp runs it under Node `vm`, which its own POSTURE.md
 *                 records as not a security boundary. Server-side tenant code has
 *                 exactly one home here, and it is `plugin_runtime`.
 *   - `allowedCollections` — a CMS collection binding, meaningless on a board.
 */
@Unique(['tenantId', 'type'])
@Entity('dashboard_widgets')
export class DashboardWidget {
  @PrimaryGeneratedColumn('uuid', { name: 'widgetId' })
  widgetId!: string

  // ── shared shape with dynamic_page_blocks (names are load-bearing) ─────────
  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** Open slug — NOT an enum. The spec's 15 widget types are seeded widgets. */
  @Column({ type: 'varchar' })
  type!: string

  @Column({ type: 'varchar' })
  label!: string

  @Column({ type: 'varchar', default: 'General' })
  category!: string

  @Column({ nullable: true, type: 'text' })
  description?: string

  /** `Record<string, FieldSchema>` — rendered by common/ui/schema-form. */
  @Column({ type: 'jsonb', default: '{}' })
  schema!: object

  @Column({ type: 'jsonb', default: '{}' })
  defaultProps!: object

  /** Tier 2 only: the HTML document, `{{token}}`-interpolated, run opaque-origin. */
  @Column({ type: 'text', default: '' })
  template!: string

  /** Roles allowed to INSERT this widget (null/empty = everyone). */
  @Column({ type: 'jsonb', nullable: true })
  allowedRoles?: string[] | null

  /** Seeded or marketplace-materialized; protected from delete and import overwrite. */
  @Column({ type: 'boolean', default: false })
  isSystem!: boolean

  @Column({ type: 'varchar', nullable: true })
  source?: string | null

  @Column({ type: 'uuid', nullable: true })
  listingId?: string | null

  @Column({ type: 'varchar', nullable: true })
  listingVersion?: string | null

  // ── widget-only ───────────────────────────────────────────────────────────
  /**
   * Which renderer runs this: `component` (first-party React), `template`
   * (tenant-authored HTML in an opaque-origin frame) or `iframe` (a third-party
   * bundle via plugin_runtime, phase 6).
   *
   * A closed, slug-validated set is correct here and is NOT the MIS-05/06
   * anti-pattern: that rule targets taxonomies a TENANT extends. A tenant cannot
   * author a fourth renderer — each value maps to a component we ship.
   */
  @Column({ type: 'varchar', default: 'template' })
  renderTier!: string

  /** Tier 1: key into the generated client component map. */
  @Column({ type: 'varchar', nullable: true })
  componentId?: string | null

  /** Tier 3 (phase 6): the plugin_runtime listing to frame. */
  @Column({ type: 'uuid', nullable: true })
  frameListingId?: string | null

  /** Abstract data slots this widget needs; bound per placement (phase 4). */
  @Column({ type: 'jsonb', nullable: true })
  dataSpec?: object | null

  @Column({ type: 'int', default: 6 })
  defaultW!: number

  @Column({ type: 'int', default: 4 })
  defaultH!: number

  /** 'TENANT' | 'PRIVATE'. SYSTEM is a provenance (`isSystem`), not a visibility. */
  @Column({ type: 'varchar', default: 'TENANT' })
  visibility!: string

  @Index()
  @Column({ type: 'uuid', nullable: true })
  ownerUserId?: string | null

  /** DRAFT | PUBLISHED | ARCHIVED. */
  @Column({ type: 'varchar', default: 'DRAFT' })
  status!: string

  @Column({ type: 'int', default: 0 })
  revision!: number

  /** The version a placement follows when it pins nothing. */
  @Column({ type: 'int', nullable: true })
  publishedVersion?: number | null

  @Column({ type: 'varchar', nullable: true })
  icon?: string | null

  @Column({ type: 'jsonb', nullable: true })
  tags?: string[] | null

  /**
   * K12: the `db:<uuid>` platform builtin this preset was created from, or
   * `null` for an ordinary tenant-authored widget. Only ever set at CREATE
   * time by `widget.crud.service.ts` (resolved against `findRootPublishedWidget`,
   * never from an untrusted request body directly) — `renderTier`/`componentId`/
   * `schema`/`dataSpec` above are copied from it once and then belong to this
   * row like any other field; a preset does not re-resolve its base on read.
   */
  @Column({ type: 'varchar', nullable: true })
  baseWidgetRef?: string | null

  /**
   * Phase 21: the settings template this definition's placements are validated and migrated with,
   * `{ id, version }` (e.g. `{ id: 'builtin:gauge', version: 1 }`). `null` on a builtin row means:
   * derive `builtin:<type>` from the type, at the code's current version. Code is the authority for
   * code-owned templates; `schema` above is a display cache for them.
   */
  @Column({ type: 'jsonb', nullable: true })
  settingsTemplate?: { id: string; version: number } | null

  /**
   * Phase 21.8: a tenant-authored widget's settings template steps (`tenant:<type>`), append-only,
   * declarative ops only (`tenant-template.ts`). Written by the publish service alone, never by the
   * authoring DTOs; travels in the published snapshot. `null` = no step yet (v1).
   */
  @Column({ type: 'jsonb', nullable: true })
  settingsMigrations?: TenantMigrationStep[] | null

  /**
   * K12: what a FRESH placement of this widget starts bound to — copied onto
   * `dashboard_widget_instances.dataBinding` when the widget is added to a
   * board (`board-view.component.tsx`'s `addWidget`), never read at render
   * time from here. A pointer (source + query + params), not a credential —
   * the query runner re-checks the viewer's own permission on every execution
   * regardless of who set this default (`03-data-binding.md` §3.6).
   */
  @Column({ type: 'jsonb', nullable: true })
  defaultDataBinding?: object | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
