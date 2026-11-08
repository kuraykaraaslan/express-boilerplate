import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// tenant_domain.02: a name is unique per tenant, and globally only among PROVEN rows (verifiedAt set): an unverified claim no
// longer holds a competitor's domain against its real owner. A platform subdomain stays first-come (checked in create()).
@Entity('tenant_domains')
@Index('UQ_tenant_domains_tenant_domain', ['tenantId', 'domain'], { unique: true })
@Index('UQ_tenant_domains_proven_domain', ['domain'], { unique: true, where: '"verifiedAt" IS NOT NULL' })
export class TenantDomain {
  @PrimaryGeneratedColumn('uuid', { name: 'tenantDomainId' })
  tenantDomainId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  // Named as its migration creates it, so a migrate-mode schema and the entity sync agree (db:schema:drift, integration lane 2).
  @Index('IDX_tenant_domains_domain')
  @Column({ type: 'varchar' })
  domain!: string;

  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;

  /**
   * Which website of the tenant this domain serves — a bare uuid, no FK, because
   * the sites live in `dynamic_page` and this module must not depend on it.
   * NULL = the tenant's default site, which is every domain's behaviour from
   * before multi-site. An id that no longer names a site simply falls back to
   * the default (the renderer validates it), so deleting a site cannot break a domain.
   */
  @Index()
  @Column({ nullable: true, type: 'uuid' })
  siteId?: string | null;

  @Column({ type: 'varchar', default: 'PENDING' })
  domainStatus!: string;

  @Column({ nullable: true, type: 'varchar' })
  verificationToken?: string;

  @Column({ nullable: true, type: 'timestamp' })
  verifiedAt?: Date;

  /**
   * Who set this domain up on the tenant's behalf — a bare uuid, no FK.
   *
   * The distinction this records is the one that matters when a delegate's
   * arrangement with a tenant ends (an agency's engagement with its client was
   * the first source, before its 2026-09 removal): a customer's OWN domain
   * simply stays, but a subdomain provisioned by the delegate (e.g.
   * `client.delegate.com`) is not the customer's to keep. Nothing in the schema
   * knew the difference before, so there was no way to tell anybody which
   * domains were about to become somebody else's problem when the arrangement
   * that provisioned them ended.
   *
   * NULL is the ordinary case — the tenant added it themselves.
   */
  @Index()
  @Column({ nullable: true, type: 'uuid' })
  provisionedByTenantId?: string | null;

  // ─── SSL / TLS certificate state ───────────────────────────────────────────
  // The cert itself is provisioned by an external reverse proxy (Caddy /
  // Traefik / cert-manager) via Let's Encrypt — this entity stores only
  // observability fields that the platform admin can see.
  //
  // - sslStatus: lifecycle  DISABLED → PENDING → ACTIVE → EXPIRING → FAILED
  // - sslIssuedAt / sslExpiresAt: parsed from the leaf cert on TLS handshake
  // - sslIssuer: e.g. "Let's Encrypt Authority X3"
  // - sslLastCheckedAt: when the daily cron last ran a handshake against this
  //                     host. Helps the admin distinguish "we haven't checked
  //                     yet" from "we checked and it really is broken".

  @Column({ type: 'varchar', default: 'DISABLED' })
  sslStatus!: string;

  @Column({ nullable: true, type: 'timestamp' })
  sslIssuedAt?: Date;

  @Column({ nullable: true, type: 'timestamp' })
  sslExpiresAt?: Date;

  @Column({ nullable: true, type: 'varchar' })
  sslIssuer?: string;

  @Column({ nullable: true, type: 'timestamp' })
  sslLastCheckedAt?: Date;

  // ─── Plan suspension ────────────────────────────────────────────────────────
  // A custom domain the plan no longer includes is SUSPENDED by tenant_domain.reconcile, never deleted. These record
  // when, and the status to restore when the plan includes it again (an ACTIVE domain goes back to ACTIVE, and so
  // back into the DNS and SSL sweeps). Both NULL while the domain is not suspended. Migration 001.

  @Column({ nullable: true, type: 'timestamp' })
  suspendedAt?: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  statusBeforeSuspension?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
