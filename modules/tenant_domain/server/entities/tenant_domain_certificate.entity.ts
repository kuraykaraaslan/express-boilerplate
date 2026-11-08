import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * The certificate the platform itself obtained for one domain (phase 51). One row per domain row (`tenantDomainId`, a bare uuid, no
 * foreign key: it is deleted in the same transaction as the domain and by the tenant purge). The private key is a node-key field
 * envelope (`encryptField`): Caddy asks for a certificate by host name before any tenant is known, so a tenant data key cannot open it.
 * It is never selected into a DTO, an export or a log line.
 *
 * `status`: PENDING (an order is wanted or running, no certificate yet), ACTIVE (a certificate is held), FAILED (the last order failed;
 * `lastError` says why, `attempts` drives the back-off, an ACTIVE certificate that a renewal failed on stays ACTIVE with `lastError` set).
 */
@Entity('tenant_domain_certificates')
@Index('UQ_tenant_domain_certificates_domain_id', ['tenantDomainId'], { unique: true })
export class TenantDomainCertificate {
  @PrimaryGeneratedColumn('uuid', { name: 'certificateId' })
  certificateId!: string;

  @Index('IDX_tenant_domain_certificates_tenant')
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  tenantDomainId!: string;

  @Index('IDX_tenant_domain_certificates_domain')
  @Column({ type: 'varchar' })
  domain!: string;

  @Column({ type: 'varchar', default: 'PENDING' })
  status!: string;

  /** Leaf first, then the chain, as the CA sent it. Public. */
  @Column({ type: 'text', nullable: true })
  certPem?: string | null;

  /** The authority directory that issued it (phase 51.5): a row from another directory than the configured one counts as no certificate. */
  @Column({ type: 'varchar', nullable: true })
  directoryUrl?: string | null;

  /** `encryptField` envelope of the PKCS#8 PEM private key. */
  @Column({ type: 'text', nullable: true })
  privateKeyEnc?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  notBefore?: Date | null;

  @Index('IDX_tenant_domain_certificates_not_after')
  @Column({ type: 'timestamp', nullable: true })
  notAfter?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  issuedAt?: Date | null;

  /** When the sweep starts renewing: `notAfter` minus the renew-before window at the time of issue. */
  @Column({ type: 'timestamp', nullable: true })
  renewAfter?: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt?: Date | null;

  /** Do not order again before this (back-off after a failure, or a rate limit's Retry-After). */
  @Column({ type: 'timestamp', nullable: true })
  retryAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
