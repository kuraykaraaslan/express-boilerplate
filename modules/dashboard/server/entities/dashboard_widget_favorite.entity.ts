import 'reflect-metadata'
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * One person's starred widget.
 *
 * `widgetRef` is the same prefixed reference placements use, so favouriting works
 * identically across manifest and tenant-authored widgets and nothing branches on
 * which kind it is. It is also why this stays polymorphic from birth: when a
 * platform `pins` domain eventually exists — favourite reports, favourite pages —
 * moving these rows is a rename, not a remodelling. Until that domain has a second
 * consumer, extracting it would be the empty shell AGENTS.md §10.1 warns about.
 */
@Index(['tenantId', 'userId'])
@Entity('dashboard_widget_favorites')
export class DashboardWidgetFavorite {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string

  @PrimaryColumn({ type: 'uuid' })
  userId!: string

  /** `manifest:<id>` | `db:<uuid>`. */
  @PrimaryColumn({ type: 'varchar' })
  widgetRef!: string

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date
}
