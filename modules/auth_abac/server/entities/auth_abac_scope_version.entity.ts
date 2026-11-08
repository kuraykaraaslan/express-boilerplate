import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * organization.34: the database-held version of a tenant's cached record scopes (VisibilityService). A membership or
 * role-matrix change bumps it in the SAME transaction as the change, and the version is part of every scope cache key,
 * so a cache purge that Redis swallowed cannot serve the old scope afterwards: the next read looks under a new key.
 */
@Entity('abac_scope_versions')
export class AbacScopeVersion {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'integer', default: 0 })
  version!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
