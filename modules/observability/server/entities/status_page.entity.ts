import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/**
 * One public (or audience-restricted) status page of a tenant (observability phase 15.1).
 *
 * The tenant's original single page is the DEFAULT page. It does not need a row to exist: with no row the default page is the
 * virtual "everything public, PUBLIC audience" page, which is exactly what the page was before this table, so no migration has to
 * guess at a tenant's intent and an old install keeps serving its old URLs. A row appears the first time an operator edits the page.
 *
 * `passwordHash` is a bcrypt hash and NEVER leaves the server: no serializer on this module reads it into an output.
 */
@Entity('status_pages')
@Index('uq_status_page_slug', ['tenantId', 'slug'], { unique: true })
@Index('uq_status_page_default', ['tenantId'], { unique: true, where: '"isDefault" = true' })
@Index('uq_status_page_domain', ['tenantId', 'domain'], { unique: true, where: '"domain" IS NOT NULL' })
export class StatusPage {
  @PrimaryGeneratedColumn('uuid', { name: 'pageId' })
  pageId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** URL segment. `default` for the default page. Lowercase letters, digits and dashes only (see `status.page.rules.ts`). */
  @Column({ type: 'varchar', length: 64 })
  slug!: string

  @Column({ type: 'varchar', length: 200 })
  name!: string

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean

  /** A page can be switched off on its own; the tenant-wide `observabilityStatusPageEnabled` setting still gates all of them. */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** PUBLIC | PASSWORD | AUTHENTICATED | IP. Anything not allowed answers the same 404 as a page that does not exist. */
  @Column({ type: 'varchar', length: 16, default: 'PUBLIC' })
  audience!: string

  @Column({ type: 'varchar', length: 100, nullable: true })
  passwordHash?: string | null

  /** CIDR blocks and addresses for the IP audience. */
  @Column({ type: 'jsonb', nullable: true })
  ipAllowlist?: string[] | null

  /** A host this page wants to be served at. Bound through `tenant_domain` (see `status.domain.service.ts`), never trusted on its own. */
  @Column({ type: 'varchar', length: 253, nullable: true })
  domain?: string | null

  /** AUTO | LIGHT | DARK. Colour scheme only: a theme never repaints a status indicator. */
  @Column({ type: 'varchar', length: 8, default: 'AUTO' })
  theme!: string

  /** Extra languages offered besides the tenant's primary language. */
  @Column({ type: 'jsonb', nullable: true })
  languages?: string[] | null

  /** Components shown. null = every component marked public. A PUBLIC page can never show a component that is not public. */
  @Column({ type: 'jsonb', nullable: true })
  componentIds?: string[] | null

  /** Origins allowed to frame this page's widget. Empty = nobody (`frame-ancestors 'none'`). */
  @Column({ type: 'jsonb', nullable: true })
  embedOrigins?: string[] | null

  /** Whether a PUBLIC page publishes its static snapshot to storage (15.9). */
  @Column({ type: 'boolean', default: true })
  snapshotEnabled!: boolean

  @Column({ type: 'timestamptz', nullable: true })
  snapshotAt?: Date | null

  /** The object names the last publish wrote (HTML and JSON per language), so a retraction deletes exactly those and nothing else. */
  @Column({ type: 'jsonb', nullable: true })
  snapshotFiles?: string[] | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  snapshotHash?: string | null

  /** The last snapshot failure, for the admin screen. Never carries a secret: it is the error class and a short message. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  snapshotError?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
