import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * A tenant-scoped role/group and the permission ids it grants. Built-in roles
 * (OWNER/ADMIN/USER) are seeded from the static PERMISSION_MATRIX with
 * `isBuiltin = true` (non-deletable, non-renamable — only their grants are
 * editable). Custom groups are `isBuiltin = false`. The Odoo-style access-rights
 * matrix is the transpose view: rows = the module permission catalog, columns =
 * these roles, cell = `permissions.includes(permissionId)`.
 *
 * Absence of rows for a tenant is meaningful: the tenant has never edited access
 * control, so enforcement falls back to the static PERMISSION_MATRIX (see
 * TenantRoleService.hasPermission → undefined).
 */
@Entity('tenant_roles')
@Unique('uq_tenant_roles_tenant_key', ['tenantId', 'key'])
export class TenantRole {
  @PrimaryGeneratedColumn('uuid', { name: 'tenantRoleId' })
  tenantRoleId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  // Stable role key. Built-ins: 'OWNER' | 'ADMIN' | 'USER'. Custom: e.g. 'content.editor'.
  @Column({ type: 'varchar' })
  key!: string;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Granted permission ids (from the module permission catalog). AND-free set.
  @Column({ type: 'jsonb', nullable: true })
  permissions!: string[] | null;

  // Built-in roles cannot be deleted or renamed; only their grants are editable.
  @Column({ type: 'boolean', default: false })
  isBuiltin!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
