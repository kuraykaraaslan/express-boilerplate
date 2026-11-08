import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm'

/**
 * An immutable snapshot of a widget definition, written on every publish.
 *
 * This is what stops a new version from silently rewriting every board that
 * already carries the widget: a placement may pin a version, and a pinned
 * placement keeps rendering the snapshot it names no matter what the author does
 * next. Same role as `dynamic_page_versions`, same shape of answer.
 *
 * Versions are monotonic ints, not semver. Semver in this repo belongs to
 * marketplace listings, which are published artefacts with a compatibility
 * contract; a tenant's own widget has an author and an undo, and asking them to
 * reason about major/minor would be ceremony without a consumer.
 */
@Unique(['widgetId', 'version'])
@Entity('dashboard_widget_versions')
export class DashboardWidgetVersion {
  @PrimaryGeneratedColumn('uuid', { name: 'versionId' })
  versionId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Index()
  @Column({ type: 'uuid' })
  widgetId!: string

  @Column({ type: 'int' })
  version!: number

  /** The whole definition row as it stood at publish time. */
  @Column({ type: 'jsonb' })
  snapshot!: object

  @Column({ nullable: true, type: 'text' })
  changelog?: string | null

  @Column({ nullable: true, type: 'uuid' })
  publishedByUserId?: string | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date
}
