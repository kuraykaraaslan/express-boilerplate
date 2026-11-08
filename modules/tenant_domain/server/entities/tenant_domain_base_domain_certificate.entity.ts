import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * The wildcard certificate the platform holds for one managed base domain (phase 56, D343): names `<base>` and `*.<base>`, served by
 * `tls-cert` for any name one label under the base. Platform data (no tenant column, no RLS), one row per base domain (`baseDomainId`,
 * deleted with it). The private key is a node-key field envelope (`encryptField`) and the most valuable secret the platform holds for
 * the base: a leak would impersonate every tenant under it. It is never selected into a DTO, an export or a log line.
 *
 * `domain` is the base domain's name when the certificate was ordered (a row of another name counts as none, like phase 51's rows);
 * the timing and back-off columns are phase 51's and follow the same policy (`tenant_domain.certificates.policy`).
 */
@Entity('tenant_domain_base_domain_certificates')
@Index('UQ_tenant_domain_base_domain_certificates_base', ['baseDomainId'], { unique: true })
export class TenantDomainBaseDomainCertificate {
  @PrimaryGeneratedColumn('uuid', { name: 'certificateId' })
  certificateId!: string;

  @Column({ type: 'uuid' })
  baseDomainId!: string;

  @Column({ type: 'varchar', length: 253 })
  domain!: string;

  /** The certificate's names, comma-separated (`dev.roltek.xyz,*.dev.roltek.xyz`). */
  @Column({ type: 'varchar', length: 600, default: '' })
  names!: string;

  /** PENDING, ACTIVE (a certificate is held), FAILED (the last order failed and none is held). */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  certPem?: string | null;

  @Column({ type: 'varchar', nullable: true })
  directoryUrl?: string | null;

  /** `encryptField` envelope of the PKCS#8 PEM private key. */
  @Column({ type: 'text', nullable: true })
  privateKeyEnc?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  notBefore?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  notAfter?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  issuedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  renewAfter?: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  retryAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
