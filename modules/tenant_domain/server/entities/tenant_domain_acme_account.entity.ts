import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * The platform's ACME account at one certificate authority (phase 51.3): one row per directory URL, so the staging account and the
 * production account never mix. Platform data, not tenant data (no `tenantId`, no RLS): the account orders for every tenant's hosts.
 * The account key is a node-key field envelope (`encryptField`); it is never selected into a DTO, an export or a log line.
 */
@Entity('tenant_domain_acme_accounts')
export class TenantDomainAcmeAccount {
  @PrimaryGeneratedColumn('uuid', { name: 'accountId' })
  accountId!: string;

  @Index('UQ_tenant_domain_acme_accounts_directory', { unique: true })
  @Column({ type: 'varchar' })
  directoryUrl!: string;

  /** `encryptField` envelope of the PKCS#8 PEM account key (P-256). */
  @Column({ type: 'text' })
  accountKeyEnc!: string;

  @Column({ type: 'varchar', nullable: true })
  contactEmail?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
