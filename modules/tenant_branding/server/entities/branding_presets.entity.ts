import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/**
 * A named bundle of branding values, owned by whoever made it.
 *
 * ### Why it lives here and not in `agency`
 *
 * A preset IS a set of branding fields, and `tenant_branding` owns those fields.
 * Putting it in `agency` would give the same values a second home whose schema
 * has to be kept in step with this module's setting keys by hand.
 *
 * ### The seam (§10.2 traps a + b, pinned 2026-08-16)
 *
 * `ownerTenantId` is a **bare uuid** with no foreign key, and there is
 * deliberately no `agencyTenantId` column, no `agency` import and no `agency`
 * entry in this module's `requires`. An agency is only the first owner anybody
 * thought of: a platform operator, a marketplace theme, or a future `msp` module
 * can own presets on exactly the same terms. `agency_clients` stores only a
 * preset id, also bare.
 *
 * ### Why the values are a jsonb blob rather than columns
 *
 * The branding fields themselves live in `settings`, not in a table — there is
 * no schema here to mirror. Storing the bundle as `values` keeps this row a
 * *copy of a settings map*, which is exactly what `clonePreset` writes back, and
 * means adding a branding key does not need a migration in two places. Unknown
 * keys are dropped on write, so a stale preset cannot resurrect a setting the
 * module has retired.
 */
@Entity('branding_presets')
@Index('idx_branding_presets_owner', ['ownerTenantId', 'isActive'])
export class BrandingPreset {
  @PrimaryGeneratedColumn('uuid', { name: 'brandingPresetId' })
  brandingPresetId!: string

  /**
   * Who owns this preset — a bare uuid, see the class note. NOT `tenantId`: the
   * name would suggest this row belongs to the tenant it is applied TO, which is
   * the opposite of what it means.
   */
  @Index()
  @Column({ type: 'uuid' })
  ownerTenantId!: string

  @Column({ type: 'varchar', length: 140 })
  name!: string

  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string | null

  /** The branding settings map this preset carries. Unknown keys are dropped. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  values!: Record<string, string>

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @Column({ type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date
}
