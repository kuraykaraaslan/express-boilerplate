import 'reflect-metadata';
import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One actor's baseline, or one role's cold-start prior (docs/phases/55-ai-firewall/02 §2.1): what is usual for a person or an API key in
 * a tenant (hours, countries, ASNs, devices, request volume per route class, exports, subjects, admin writes, addresses), written once a
 * day by the baseline job from the feature store's day profiles (`features/ai_firewall.baseline.job.ts`), read by the feature vector.
 *
 * `actorKind` is `user`, `apiKey` or `role`; `actorKey` is the keyed hash of the actor's id (`features/ai_firewall.feature-id.ts`, never
 * the raw id) or, for a prior, the role name (`OWNER`, `ADMIN`, `USER`, …, `API_KEY` for keys). A prior holds no country, ASN or device.
 *
 * Platform actors are stored under the ROOT tenant, as the event store does. Tenant-scoped (tenant RLS, FORCE). Personal data: an
 * actor's row is pseudonymous (keyed hash) and holds location (countries), network (ASNs) and device classes: exported with redaction
 * and erased by the module's contributions. Created in SQL by migration 002 with the same names.
 */
@Entity('ai_firewall_baselines')
@Index('idx_ai_firewall_baselines_day', ['tenantId', 'lastDay'])
export class AiFirewallBaseline {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_ai_firewall_baselines' })
  tenantId!: string;

  /** `user` | `apiKey` | `role`. */
  @PrimaryColumn({ type: 'varchar', length: 16, primaryKeyConstraintName: 'PK_ai_firewall_baselines' })
  actorKind!: string;

  /** The keyed hash of the actor's id, or the role name of a prior. */
  @PrimaryColumn({ type: 'varchar', length: 64, primaryKeyConstraintName: 'PK_ai_firewall_baselines' })
  actorKey!: string;

  /** The member's role on the last day folded (the prior it belongs to); null for a key or a prior. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  role!: string | null;

  /** Days folded in. */
  @Column({ type: 'integer', default: 0 })
  days!: number;

  /** The last UTC day folded, `YYYYMMDD` (the job never folds a day twice). */
  @Column({ type: 'varchar', length: 8 })
  lastDay!: string;

  /** `BaselineData` (features/ai_firewall.baseline.ts). */
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
