import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/**
 * One widget placed on one surface, with its own settings and geometry.
 *
 * THE POLYMORPHIC SEAM is `entityType`/`entityId` — which surface this sits on.
 * It is a bare label plus a bare uuid with no foreign key: today the only value
 * is `'DASHBOARD'` pointing at a `dashboard_boards.boardId`, and tomorrow a
 * report, portal page or kiosk screen hosts the same widget without this module
 * learning those exist. That is how the source spec's §25 promise ("the widget
 * platform must be usable by surfaces other than dashboards") is paid for inside
 * one module instead of two — see docs/phases/07-dashboard/00-master-plan.md §A.2. The
 * spelling is fixed by `common.crm-contracts.ts`'s EntityRef; inventing a synonym
 * (`surfaceType`, `refType`, …) is what that register forbids.
 *
 * `widgetRef` is a PREFIXED reference rather than two nullable id columns with a
 * CHECK between them: `manifest:<widgetId>` for a widget declared in a module.json
 * and resolved through the generated component map, `db:<uuid>` for a
 * tenant-authored definition from phase 3. One column, no dangling uuid pointing
 * at a table that does not exist yet, and nothing to migrate when the second kind
 * arrives — placing, favouriting and counting usages never branch on which it is.
 */
@Index(['tenantId', 'entityType', 'entityId'])
@Entity('dashboard_widget_instances')
export class DashboardWidgetInstance {
  @PrimaryGeneratedColumn('uuid', { name: 'instanceId' })
  instanceId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** Open slug (ENTITY_TYPE_PATTERN), NOT an enum. `'DASHBOARD'` today. */
  @Column({ type: 'varchar' })
  entityType!: string

  /** The surface's own id. A bare uuid — never a foreign key. */
  @Column({ type: 'uuid' })
  entityId!: string

  /** `manifest:<id>` | `db:<uuid>` — see the class comment. */
  @Column({ type: 'varchar' })
  widgetRef!: string

  /**
   * Which published version of a `db:` widget this placement follows.
   * `null` = the latest published one. A pinned placement keeps rendering the
   * snapshot it names, which is what stops a new version from silently rewriting
   * every board that already carries the widget.
   */
  @Column({ type: 'int', nullable: true })
  pinnedVersion?: number | null

  // ── geometry, in the board's grid units ────────────────────────────────────
  @Column({ type: 'int', default: 0 })
  x!: number

  @Column({ type: 'int', default: 0 })
  y!: number

  @Column({ type: 'int', default: 6 })
  w!: number

  @Column({ type: 'int', default: 4 })
  h!: number

  @Column({ type: 'int', default: 100 })
  order!: number

  // ── configuration ─────────────────────────────────────────────────────────
  /** Validated against the widget definition's `schema` before it is stored. */
  @Column({ type: 'jsonb', default: '{}' })
  settings!: object

  /**
   * Per-placement data binding (phase 4b): slotKey → (sourceKey, queryKey,
   * params). Slots come from the widget definition's `dataSpec`; the runner
   * route re-authorizes every execution, so this jsonb never carries authority
   * — and it never carries a URL.
   */
  @Column({ type: 'jsonb', nullable: true })
  dataBinding?: object | null

  /**
   * Per-placement actions (phase 5 §4.3, phase 16): the legacy `{ onClick }` or v2
   * `{ v: 2, sources: { <source>: entries[] } }`, read through `instance-actions.ts`.
   * Every action is one of the closed `WidgetActionSchema` kinds, each a handler the
   * HOST implements. Configured by the authenticated board editor and validated
   * server-side (`navigate` is an internal path, `openUrl` is http(s), a `command`
   * passes the authoring gate); a widget frame can only ask the host to run the action
   * already configured for this placement, never choose a destination — see
   * `modules/dashboard/POSTURE.md` §8 and §9.
   */
  @Column({ type: 'jsonb', nullable: true })
  actions?: object | null

  /**
   * Shown only while a condition on the board's parameters holds (phase 35, migration 010): `{ when: EntryCondition }`
   * on the `param` source (`PlacementVisibilitySchema`); null = always. The view judges it per frame, a display
   * screen's server against the board's defaults; the reference check (E9) covers its parameter like an entry's.
   */
  @Column({ type: 'jsonb', nullable: true })
  visibility?: object | null

  /**
   * The placement's compute script (phase 35.5, ADR-0017, migration 011): `{ v: 1, enabled, script, timeoutMs?,
   * onError }` (`TransformSchema`), or null. Text the server never evaluates: it runs in a Worker inside the board
   * view's compute frame and only DERIVES what the card draws (POSTURE §14). A placement field on purpose: not a
   * setting (§6 validates settings against the widget's template) and not a definition column (§2).
   */
  @Column({ type: 'jsonb', nullable: true })
  transform?: object | null

  /** Per-placement title override; null = the widget's own name. */
  @Column({ nullable: true, type: 'varchar' })
  title?: string | null

  @Column({ nullable: true, type: 'int' })
  refreshSeconds?: number | null

  /**
   * Optimistic-lock counter (15.3c, migration 004). Every write to this placement bumps it
   * (create sets 1); a PATCH carrying a stale `expectedRevision` is a 409 naming the current one.
   */
  /** The in-board page this card sits on (D-1 (a), `board-pages.ts`); null = the board's main page. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  pageKey?: string | null

  @Column({ type: 'int', default: 1 })
  revision!: number

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
