import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A base domain the platform manages (phase 56, D340): tenants live at `<label>.<baseDomain>` under the platform's wildcard certificate
 * for it, or (`purpose = 'wildcard_only'`, e.g. the LoRaWAN network server's `lns.roltek.xyz`) the name only gets the wildcard and never
 * holds a tenant. Platform data, not tenant data (no `tenantId`, no RLS): the operator (the root tenant) adds, proves and switches these.
 * The first row is seeded from `TENANT_WILDCARD_DOMAIN` at boot (`seedBaseDomainFromEnv`); after that the table rules.
 */
@Entity('tenant_domain_base_domains')
@Index('UQ_tenant_domain_base_domains_default', ['isDefault'], { unique: true, where: '"isDefault" = true' })
export class TenantDomainBaseDomain {
  @PrimaryGeneratedColumn('uuid', { name: 'baseDomainId' })
  baseDomainId!: string;

  /** Lower case, no port, no trailing dot, e.g. `dev.roltek.xyz`. */
  @Index('UQ_tenant_domain_base_domains_name', { unique: true })
  @Column({ type: 'varchar', length: 253 })
  baseDomain!: string;

  /** `tenants`: free subdomains are minted under it; `wildcard_only`: it only gets the wildcard certificate. */
  @Column({ type: 'varchar', length: 20, default: 'tenants' })
  purpose!: string;

  /** The base a new tenant gets when it chooses none. Exactly one `tenants` row (a partial unique index). */
  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** Offered in the onboarding picker while the root tenant lets tenants choose (`baseDomainChoice = tenant`). */
  @Column({ type: 'boolean', default: true })
  selectable!: boolean;

  /** `PENDING_DNS` until both DNS records are proven, `ACTIVE`, `DISABLED`. Only ACTIVE rows mint, are offered, or are served. */
  @Column({ type: 'varchar', length: 20, default: 'PENDING_DNS' })
  status!: string;

  /** `delegated`: `_acme-challenge.<base>` is a CNAME into the platform's challenge zone; `zone`: the TXT is written in the base's own zone. */
  @Column({ type: 'varchar', length: 20, default: 'delegated' })
  challengeMode!: string;

  @Column({ type: 'timestamp', nullable: true })
  dnsCheckedAt?: Date | null;

  /** What the last DNS check found wrong, bounded; null when it passed. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastDnsError?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
