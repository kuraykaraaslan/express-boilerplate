import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * A platform host a tenant left (phase 56, D347): its free subdomain was renamed by a base-domain change or a slug rename. For 30 days the
 * proxy answers the old host with a 308 to `toHost`, the path kept, so links and bookmarks keep working; then the row expires. Read by host
 * name before any tenant is known, so platform data in the system context (no RLS), like the TLS lookups; the tenant purge deletes a
 * tenant's rows.
 */
@Entity('tenant_domain_host_moves')
@Index('IDX_tenant_domain_host_moves_tenant', ['tenantId'])
export class TenantDomainHostMove {
  @PrimaryColumn({ type: 'varchar', length: 253 })
  fromHost!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 253 })
  toHost!: string;

  /** `base_change` or `slug_change`. */
  @Column({ type: 'varchar', length: 20 })
  reason!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
