import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { SharedDatabaseOnly } from '@kuraykaraaslan-labs/db/server/db.shared-database';

/**
 * Tenant-configurable catalogue of API-key scopes. The runtime scope grammar
 * (coarse verbs + `resource:action`) lives in `api_key.enums.ts`; this table is
 * descriptive master-data that lets a tenant document, label and group the
 * scopes their integrations are expected to use, and drives the scope picker /
 * detail views in the admin UI. It never widens what a key may actually be
 * granted (that is still gated by the plan allowlist in `api_key.policy.ts`).
 */
// Pinned with api_keys (02-fleet F8): the whole api_key module lives on the shared database.
@SharedDatabaseOnly()
@Entity('api_key_scope_definitions')
@Unique(['tenantId', 'scope'])
export class ApiKeyScopeDefinition {
  @PrimaryGeneratedColumn('uuid', { name: 'apiKeyScopeDefinitionId' })
  apiKeyScopeDefinitionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  // The scope token, e.g. `read`, `write`, `invoices:read`, `orders:*`.
  @Column({ type: 'varchar' })
  scope!: string;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Grouping bucket for the admin UI (e.g. "Core", "Billing", "SCIM").
  @Column({ type: 'varchar', default: 'General' })
  category!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
