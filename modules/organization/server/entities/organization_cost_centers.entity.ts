import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/**
 * A cost center (Odoo's analytic account used as one). Hierarchical, but the
 * tree is queried through the materialised `path` (`/GY/SAT/IST`) rather than a
 * recursive CTE: one `LIKE 'path/%'` predicate answers "everything under this
 * node" in a single index scan, and the service is the only writer of `path`.
 *
 * This is company-wide analytics, not an HR concept — a ledger line, a purchase
 * order and a project all slice by it. Storing it in an HR module was how
 * booking a cost center came to require installing HR.
 *
 * `glAccountId` is a BARE uuid — `accounting` is deliberately NOT a dependency,
 * so `organization` stays installable without a general ledger.
 */
@Entity('organization_cost_centers')
@Index('idx_organization_cost_centers_tenant_path', ['tenantId', 'path'])
@Index('uq_organization_cost_centers_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class CostCenter {
  @PrimaryGeneratedColumn('uuid', { name: 'costCenterId' })
  costCenterId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar' })
  code!: string

  @Column({ type: 'varchar' })
  name!: string

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentId?: string

  /**
   * Materialised ancestry, slash-delimited by `code`, always leading-slashed and
   * never trailing-slashed: `/GY`, `/GY/SAT`. Maintained by CostCenterService on
   * every create/update; descendants are rewritten when a node is re-parented.
   */
  @Column({ type: 'varchar', default: '' })
  path!: string

  /** Bare uuid into a ledger account — accounting is not a dependency. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  glAccountId?: string

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date
}
