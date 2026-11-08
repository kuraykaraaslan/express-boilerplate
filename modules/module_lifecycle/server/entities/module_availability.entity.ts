import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, UpdateDateColumn, Check } from 'typeorm';
import type { AvailabilityState } from '../module-lifecycle.types';

/**
 * Platform-wide availability of a module for customer tenants
 * (docs/phases/25-marketplace/03-module-governance/03): an operator decision,
 * not tenant data, so the table has no `tenantId` and lives in the ROOT
 * datasource (exempt from tenant RLS, like `catalog_products`). An absent row
 * means `available`.
 */
@Entity('module_availability')
@Check('ck_module_availability_state', `"state" IN ('available', 'unlisted', 'hidden', 'retired')`)
export class ModuleAvailability {
  @PrimaryColumn({ type: 'varchar' })
  moduleId!: string;

  @Column({ type: 'varchar', default: 'available' })
  state!: AvailabilityState;

  /** Why the operator set this state; shown to tenants that are refused. */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
