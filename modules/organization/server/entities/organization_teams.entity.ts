import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/**
 * A working group inside the tenant.
 *
 * This lives in `organization` rather than in a `team` or `crm_team` module
 * because `organization` already owns "the tenant's own internal shape" — legal
 * entities, sites, cost centers. A team is the fourth such dimension, and a
 * second module for internal grouping would be an §10.0/3 violation.
 *
 * The sales-specific parts (capacity, routing rules, round-robin state) are NOT
 * here — they sit in `crm_assignment_*`. The generic shape is roughly a quarter
 * of the concept; extracting the rest would have produced a module whose only
 * real content is what its single consumer bolts on.
 */
@Entity('organization_teams')
@Index(['tenantId', 'code'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('idx_organization_teams_tenant_path', ['tenantId', 'path'])
export class OrganizationTeam {
  @PrimaryGeneratedColumn('uuid', { name: 'teamId' })
  teamId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar' })
  name!: string

  @Column({ type: 'varchar', length: 40 })
  code!: string

  /**
   * An open slug (`SALES`, `SUPPORT`, `DELIVERY`, …), not a closed enum.
   *
   * It is a FILTER, never a permission: `purpose='SALES'` grants a team nothing,
   * it only pre-filters the pickers CRM shows. Treating it as authority would
   * put an access rule in a field anyone can edit.
   */
  @Index()
  @Column({ type: 'varchar', length: 40, default: 'GENERAL' })
  purpose!: string

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentTeamId?: string | null

  /**
   * Materialised ancestry (`/SAT/SAT_IST`) — the same device
   * `organization_cost_centers` uses, and now the same CODE: the algorithm was
   * extracted to `organization.path.ts` rather than copied.
   */
  @Column({ type: 'varchar', default: '' })
  path!: string

  /**
   * A platform USER, not an employee. `hr` may not be installed, and a team is
   * a platform concept — the same mistake `calendar` made with `employeeId`.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  leaderUserId?: string | null

  @Index()
  @Column({ type: 'uuid', nullable: true })
  legalEntityId?: string | null

  @Index()
  @Column({ type: 'uuid', nullable: true })
  siteId?: string | null

  @Index()
  @Column({ type: 'uuid', nullable: true })
  costCenterId?: string | null

  @Column({ type: 'varchar', length: 9, nullable: true })
  colour?: string | null

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @Column({ type: 'int', default: 100 })
  sequence!: number

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
