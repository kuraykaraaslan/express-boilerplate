import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/**
 * A legal entity of the tenant itself — the party that signs, invoices and
 * files. This is the row that used to be smeared across three settings
 * families (`invoice.company*`, `terms_consent.legalSeller*`,
 * `payment.taxId/vatNumber/billing*`); `organization` is now the editor and
 * projects itself back onto those keys (see organization.legal-entity.projection.ts).
 *
 * Distinguish carefully:
 *   `tenant`          = the SaaS account (who pays us)
 *   `contact.Company` = an external counterparty (customer, supplier)
 *   `LegalEntity`     = one of the tenant's OWN legal persons
 *
 * A group with a holding plus two operating companies has three rows here and
 * one `tenant` row. `isDefault` marks the one whose details print on documents
 * that do not name an entity explicitly.
 */
@Entity('organization_legal_entities')
@Index('idx_organization_legal_entities_tenant_active', ['tenantId', 'isActive'])
// Codes are the human key operators type; unique per tenant while the row is
// live. Partial index so a soft-deleted row releases its code.
@Index('uq_organization_legal_entities_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
// Exactly one default per tenant, enforced by the database rather than by a
// service that could be raced: the projection to the legacy settings keys reads
// "the default", and two defaults would make the seller on an invoice a coin flip.
@Index('uq_organization_legal_entities_default', ['tenantId'], {
  unique: true,
  where: '"isDefault" = true AND "deletedAt" IS NULL',
})
export class LegalEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'legalEntityId' })
  legalEntityId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar' })
  code!: string

  /** Registered name exactly as it appears on the trade register. */
  @Column({ type: 'varchar' })
  legalName!: string

  /** Brand / trading name when it differs from the registered one. */
  @Column({ type: 'varchar', nullable: true })
  tradeName?: string

  /** A.Ş. · Ltd. Şti. · şahıs · GmbH · Inc. — free text, jurisdiction-specific. */
  @Column({ type: 'varchar', nullable: true })
  legalForm?: string

  /** ISO-3166-1 alpha-2 of the jurisdiction the entity is registered in. */
  @Column({ type: 'char', length: 2 })
  countryCode!: string

  /** VKN / TCKN / EIN / SIRET — the tax administration's identifier. */
  @Column({ type: 'varchar', nullable: true })
  taxId?: string

  /** TR: vergi dairesi. Empty elsewhere. */
  @Column({ type: 'varchar', nullable: true })
  taxOffice?: string

  /** EU VAT number when it differs from `taxId` (cross-border invoicing). */
  @Column({ type: 'varchar', nullable: true })
  vatNumber?: string

  /** MERSİS / Companies House / trade-register number. */
  @Column({ type: 'varchar', nullable: true })
  registrationNumber?: string

  /** `{ line1, line2, city, region, postalCode, countryCode }` — open by design. */
  @Column({ type: 'jsonb', nullable: true })
  addressJson?: Record<string, unknown>

  @Column({ type: 'varchar', nullable: true })
  email?: string

  @Column({ type: 'varchar', nullable: true })
  phone?: string

  @Column({ type: 'varchar', nullable: true })
  website?: string

  @Column({ type: 'varchar', nullable: true })
  iban?: string

  @Column({ type: 'varchar', nullable: true })
  bankName?: string

  /** Storage key (or absolute URL) of the letterhead logo. */
  @Column({ type: 'varchar', nullable: true })
  logoStorageKey?: string

  /** The entity used when a document does not name one. See the partial index above. */
  @Column({ type: 'boolean', default: false })
  isDefault!: boolean

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date
}
