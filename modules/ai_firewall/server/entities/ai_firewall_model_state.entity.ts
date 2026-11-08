import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The promotion store (docs/phases/55-ai-firewall/04-tree-models.md 4.6, 4.7; FWD-12): one row per tree model of the request cascade
 * (`behaviour`, `attack`), the platform's, stored under the ROOT tenant like the rest of the platform's firewall rows. Written by the
 * automatic promotion gate (`promotion/ai_firewall.promotion.job.ts`, daily and at boot) and by a ROOT owner's hold
 * (`PUT /api/ai-firewall/models`); every change of state is an audit row (`ai_firewall.model_promoted`, `.model_demoted`, `.model_held`,
 * `.model_released`).
 *
 * No personal data (D55-111): the model file's sha256, times, the gate's verdict (criteria and counts) and the drift reference and report
 * (histogram counts). Who held a model and why is in the audit row only. Tenant-scoped (tenant RLS, FORCE from birth), created in SQL by
 * migration 008 with the same names.
 */
@Entity('ai_firewall_model_states')
export class AiFirewallModelState {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_ai_firewall_model_states' })
  tenantId!: string;

  /** `behaviour` | `attack`. */
  @PrimaryColumn({ type: 'varchar', length: 16, primaryKeyConstraintName: 'PK_ai_firewall_model_states' })
  model!: string;

  /** The sha256 of the model file this state is about (lowercase hex); null when no model is loaded. A new file starts a new shadow. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  modelSha256!: string | null;

  /** `shadow` | `promoted`. */
  @Column({ type: 'varchar', length: 16, default: 'shadow' })
  state!: string;

  /** When this model file was first seen in shadow on this install (the 14-day shadow period counts from here). */
  @Column({ type: 'timestamptz', nullable: true })
  shadowStartedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  promotedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  demotedAt!: Date | null;

  /** The failing criteria of the last demotion, or `model_changed`, `model_unloaded`, `held`. */
  @Column({ type: 'varchar', length: 256, nullable: true })
  demotedReason!: string | null;

  /** A ROOT owner holds the model in shadow since then; null when not held. */
  @Column({ type: 'timestamptz', nullable: true })
  heldAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastEvaluatedAt!: Date | null;

  /** The gate's last verdict: every criterion with its status, value and target, and the counts it read. */
  @Column({ type: 'jsonb', nullable: true })
  verdict!: Record<string, unknown> | null;

  /** The drift reference week (histogram counts) and the latest weekly report. */
  @Column({ type: 'jsonb', nullable: true })
  drift!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
