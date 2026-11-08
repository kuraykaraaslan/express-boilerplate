import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One proposal of a registered action (docs/phases/55-ai-firewall/01 §1.7, 05): `proposed` -> `executed` -> `undone` / `expired`, or
 * ended without a change (`rejected`, `refused`, `failed`, `noop`); the moves are `canTransition` (`store/ai_firewall.store.ts`).
 * `proposalId` is the idempotency key the responder hands the action (`FirewallActionContext.proposalId`): a retried run must not act
 * twice. `undoData` is what the action's `execute` said its `undo` needs (small, non-secret facts: a ban id, a session id). Written by
 * the responder of 05; this step builds the table, its retention (only an ended action, once `endedAt` is past the tenant's retention),
 * its export and its erasure.
 *
 * Platform actions are stored under the ROOT tenant (`ai_firewall.store.ts`). Personal data: `actorId`, `subjectId`, `decidedBy`,
 * `undoneBy`, `undoData`. Tenant-scoped (tenant RLS, FORCE). Created in SQL by migration 001 with the same names.
 */
@Entity('ai_firewall_actions')
@Index('idx_ai_firewall_actions_status', ['tenantId', 'status', 'proposedAt'])
@Index('idx_ai_firewall_actions_actor', ['tenantId', 'actorKind', 'actorId'])
@Index('idx_ai_firewall_actions_incident', ['tenantId', 'incidentId'])
export class AiFirewallAction {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_firewall_actions' })
  proposalId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The incident it answers; null for an action the cascade proposed on one request. */
  @Column({ type: 'uuid', nullable: true })
  incidentId!: string | null;

  /** The registered action (`ai_firewall:action`), `<module>.<verb>`, e.g. `user_session.end_session`. */
  @Column({ type: 'varchar', length: 128 })
  actionId!: string;

  /** Its rung on the ladder (FIREWALL_RUNGS). */
  @Column({ type: 'varchar', length: 24 })
  rung!: string;

  @Column({ type: 'varchar', length: 32 })
  lane!: string;

  @Column({ type: 'varchar', length: 16 })
  actorKind!: string;

  @Column({ type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectType!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectId!: string | null;

  /** ACTION_STATUSES. */
  @Column({ type: 'varchar', length: 16, default: 'proposed' })
  status!: string;

  /** The mode the decision was made under: `observe` | `suggest` | `auto`. */
  @Column({ type: 'varchar', length: 8 })
  mode!: string;

  /** A stable reason code (dictionary key `ai_firewall.reason.<code>`), never free text. */
  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  /** What the owning module answered (`FirewallActionResult.reason`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  resultReason!: string | null;

  /** The TTL the responder chose, in seconds (at most the platform cap of 30 days). */
  @Column({ type: 'integer' })
  ttlSeconds!: number;

  @Column({ type: 'jsonb', nullable: true })
  undoData!: Record<string, string | number | boolean | null> | null;

  @Column({ type: 'timestamptz' })
  proposedAt!: Date;

  /** When a person (Suggest) or the responder (Auto) decided. */
  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  /** The person who approved or rejected it; null for the responder. */
  @Column({ type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  /** When an executed action lapses on its own. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  /** When it reached its final status (undone, expired, rejected, refused, failed, noop): the retention's clock. */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  /** The person who undid it; null for an expiry, the kill switch or the responder. */
  @Column({ type: 'uuid', nullable: true })
  undoneBy!: string | null;

  /** `expired` | `manual` | `kill_switch` (FirewallUndoContext.why). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  undoWhy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
