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
import type { PolicyRule, PolicyTarget } from '../auth_abac.types';
import type { PolicyEffect } from '../auth_abac.enums';

/**
 * A tenant-scoped access policy. The PDP loads every active policy for a tenant,
 * orders them by `priority` (ascending — lower runs first) and applies
 * deny-overrides: the first matching `deny` short-circuits, otherwise the first
 * matching `permit` grants. A policy matches when its `target` covers the
 * request and every rule in `rules` (AND-ed) holds. See {@link evaluatePolicies}.
 */
@Entity('abac_policies')
@Unique('uq_abac_policies_tenant_name', ['tenantId', 'name'])
export class AbacPolicy {
  @PrimaryGeneratedColumn('uuid', { name: 'policyId' })
  policyId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // 'permit' | 'deny' — deny always wins under deny-overrides.
  @Column({ type: 'varchar', default: 'permit' })
  effect!: PolicyEffect;

  // Lower runs first. Deterministic ordering for the combining algorithm.
  @Column({ type: 'integer', default: 100 })
  priority!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // `{ resourceTypes: string[], actions: string[] }` — empty arrays match all.
  @Column({ type: 'jsonb', nullable: true })
  target!: PolicyTarget | null;

  // AND-ed conditions; each `{ attribute, operator, value }`.
  @Column({ type: 'jsonb', nullable: true })
  rules!: PolicyRule[] | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
