import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Check } from 'typeorm';
import type { ModulePolicyKind } from '../module-lifecycle.types';

/**
 * A platform operator's policy for ONE module in ONE tenant
 * (docs/phases/25-marketplace/03-module-governance/04). `block`: the tenant can
 * neither install nor reactivate the module, and an active copy was closed when
 * the block was set. Written only by ROOT routes; tenant-scoped (RLS) like the
 * `installs` ledger it sits beside.
 */
@Entity('module_policies')
@Check('ck_module_policies_policy', `"policy" IN ('block')`)
export class ModulePolicy {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar' })
  moduleId!: string;

  @Column({ type: 'varchar', default: 'block' })
  policy!: ModulePolicyKind;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** The sysadmin who set it. */
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
