import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/**
 * A physical place the tenant operates from: office, branch, warehouse, plant,
 * store — or the notional "remote" site. One master list, because a branch that
 * employs people is the same building the stock sits in and the invoice is
 * addressed from; keeping three tables of it was how `hr_work_locations`,
 * `inventory_warehouses` and `fulfillment_warehouses` each grew their own.
 *
 * `kind` is a free-form tag, not an enum column, precisely so a consumer can add
 * its own vocabulary without a migration in this module.
 *
 * NOT here: `legalEntityName` / `taxNumber` (they belong to the legal entity,
 * which this row references) and `sgkWorkplaceCode` (a Turkish payroll
 * registration, reborn in `hr_payroll_tr.tr_workplaces` as `siteId` + `sgkSicilNo`).
 */
@Entity('organization_sites')
@Index('idx_organization_sites_tenant_active', ['tenantId', 'isActive'])
@Index('idx_organization_sites_tenant_kind', ['tenantId', 'kind'])
@Index('uq_organization_sites_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class Site {
  @PrimaryGeneratedColumn('uuid', { name: 'siteId' })
  siteId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar' })
  code!: string

  @Column({ type: 'varchar' })
  name!: string

  /**
   * OFFICE | BRANCH | WAREHOUSE | PLANT | STORE | REMOTE — a tag, deliberately
   * open: inventory filters on WAREHOUSE, HR does not care, and a consumer that
   * needs DEPOT should not have to migrate this module.
   */
  @Column({ type: 'varchar', default: 'OFFICE' })
  kind!: string

  /** Bare uuid into `organization_legal_entities` — the employer/operator here. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  legalEntityId?: string

  /** Postal address parts; shape stays open because it is country-specific. */
  @Column({ type: 'jsonb', nullable: true })
  addressJson?: Record<string, unknown>

  /** ISO-3166-1 alpha-2. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  countryCode?: string

  @Column({ type: 'varchar', nullable: true })
  city?: string

  /** IANA zone (e.g. Europe/Istanbul) — attendance and shift maths need it. */
  @Column({ type: 'varchar', nullable: true })
  timezone?: string

  @Column({ type: 'boolean', default: false })
  isHeadquarters!: boolean

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date
}
