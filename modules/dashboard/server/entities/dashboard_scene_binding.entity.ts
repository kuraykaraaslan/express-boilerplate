import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm'
import type { SceneMapEntry } from '../scene-binding'

/**
 * A scene binding (docs/phases/07-dashboard/42, D42-1..D42-3): "subject S shows document X in slot L, with these devices in these
 * roles". The subject is a bare (type, id) like a card overlay's (`type` a contributed `dashboard:entity_type` key); the document is a
 * bare uuid of a kind a module contributes through `dashboard:scene_kind` (`design`, later `diagram`), verified through that kind at
 * write time, never through a table of this module. A binding is the subject's, not a card's: no boardId, no instanceId.
 *
 * `devices` maps a role to a device id (`""` is the main role); `map` holds only the exceptions of the key = element auto-match (scene
 * key -> `{ deviceId, element }`); `hidden` the keys this subject hides; `view` the level and focus a building page shows; `rules` the
 * rules of D42-11, stored and judged for shape and size only. `status` is `unresolved` when the document or a key it names is gone
 * (never dropped silently). Size caps live in `scene-binding.ts`.
 *
 * No foreign keys, as in the other dashboard tables. Created in SQL by migration 019 (same names as here).
 */
@Entity('dashboard_scene_bindings')
@Index('UQ_dashboard_scene_bindings_subject_slot_kind', ['tenantId', 'subjectType', 'subjectId', 'slot', 'kind'], { unique: true })
@Index('IDX_dashboard_scene_bindings_document', ['tenantId', 'kind', 'documentId'])
@Index('IDX_dashboard_scene_bindings_subject', ['tenantId', 'subjectType', 'subjectId'])
@Check('ck_dashboard_scene_bindings_subject', `"subjectType" ~ '^[a-z][a-z0-9_.-]{0,59}$' AND "subjectId" ~ '^[A-Za-z0-9_-]{1,64}$'`)
@Check('ck_dashboard_scene_bindings_slot_kind', `"slot" ~ '^[a-z][a-z0-9_-]{0,31}$' AND "kind" ~ '^[a-z][a-z0-9_]{0,31}$'`)
@Check('ck_dashboard_scene_bindings_status', `"status" IN ('ok', 'unresolved')`)
export class DashboardSceneBinding {
  /** Migration 019 defaults it to `gen_random_uuid()`, like 014. */
  @PrimaryGeneratedColumn('uuid', { name: 'bindingId', primaryKeyConstraintName: 'PK_dashboard_scene_bindings' })
  bindingId!: string

  @Column({ type: 'uuid' })
  tenantId!: string

  /** The subject's entity type, as a page's param names it (`iot_device`, `iot_asset`). */
  @Column({ type: 'varchar', length: 60 })
  subjectType!: string

  @Column({ type: 'varchar', length: 64 })
  subjectId!: string

  /** Which scene of the subject (a card names its slot); `main` unless a page draws several. */
  @Column({ type: 'varchar', length: 32, default: 'main' })
  slot!: string

  /** The `dashboard:scene_kind` contribution key (`design`). */
  @Column({ type: 'varchar', length: 32 })
  kind!: string

  /** The document, a bare uuid of the kind's own store. */
  @Column({ type: 'uuid' })
  documentId!: string

  /** The kind's fingerprint of the document when the binding was written (informational); null when the kind has none. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  documentHash!: string | null

  /** Role -> device id (`""` the main role). */
  @Column({ type: 'jsonb', default: '{}' })
  devices!: Record<string, string>

  /** Exceptions to the auto-match: scene key -> `{ deviceId, element }`, and since phase 45 (D45-3) `{ deviceId?, element?, fields? }`; no row changed, the old shape is a valid entry. */
  @Column({ type: 'jsonb', default: '{}' })
  map!: Record<string, SceneMapEntry>

  /** Scene keys this subject hides. */
  @Column({ type: 'jsonb', nullable: true })
  hidden!: string[] | null

  /** What a building page shows of the document: `{ level?, focus? }` (D42-6). */
  @Column({ type: 'jsonb', nullable: true })
  view!: { level?: string; focus?: string } | null

  /** The rules of D42-11, stored as given (shape and size judged only). */
  @Column({ type: 'jsonb', nullable: true })
  rules!: Array<Record<string, unknown>> | null

  @Column({ type: 'varchar', length: 16, default: 'ok' })
  status!: 'ok' | 'unresolved'

  /** Bumped on every write; a save names the revision it started from (409 when another save came first). */
  @Column({ type: 'int', default: 1 })
  revision!: number

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date
}
