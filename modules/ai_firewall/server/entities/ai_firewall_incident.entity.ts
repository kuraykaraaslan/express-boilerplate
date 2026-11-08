import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One incident (docs/phases/55-ai-firewall/01 §1.7, 02 §2.4): one actor's scored detections grouped into one case with its score, open
 * until a person closes it or it goes quiet. Written by the incident grouping (`incidents/ai_firewall.incident-store.ts`, D55-36): at
 * most one open or acknowledged incident per actor and tenant (`uq_ai_firewall_incidents_active`, migration 003). A closed incident is
 * deleted once `closedAt` is past the tenant's retention; an open one never, and one quiet for 24 h is closed as `expired` by the nightly
 * retention run (D55-37).
 *
 * Platform incidents are stored under the ROOT tenant (`ai_firewall.store.ts`). Personal data: `actorId` (a user id, an address),
 * `closedBy`, `acknowledgedBy`; `explanation` and `history` hold feature names and numbers only. Tenant-scoped (tenant RLS, FORCE).
 * Created in SQL by migrations 001 and 003 with the same names; `peakVectors` by migration 006 (03 §3.5); `models` and
 * `idx_ai_firewall_incidents_models` by migration 008 (04.6, 4.7).
 */
@Entity('ai_firewall_incidents')
@Index('idx_ai_firewall_incidents_status', ['tenantId', 'status', 'openedAt'])
@Index('idx_ai_firewall_incidents_actor', ['tenantId', 'actorKind', 'actorId'])
@Index('uq_ai_firewall_incidents_active', ['tenantId', 'actorKind', 'actorId'], { unique: true, where: `"status" IN ('open', 'acknowledged')` })
@Index('idx_ai_firewall_incidents_models', ['tenantId', 'lastSignalAt'], { where: '"models" IS NOT NULL' })
export class AiFirewallIncident {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_firewall_incidents' })
  incidentId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** `open` | `acknowledged` | `closed` (INCIDENT_STATUSES; closed = resolved, by a person or as expired). */
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: string;

  /** The highest severity among its signals. */
  @Column({ type: 'varchar', length: 8 })
  severity!: string;

  @Column({ type: 'varchar', length: 16 })
  actorKind!: string;

  @Column({ type: 'varchar', length: 128 })
  actorId!: string;

  /** The lane its signals came from (38 L-4), or `unknown`. */
  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  lane!: string;

  /** The latest score of the actor (0..100, the rule scorer's or a model's); null before the first scoring. */
  @Column({ type: 'double precision', nullable: true })
  score!: number | null;

  /** The highest score of the incident (0..100) and when it was reached (migration 003). */
  @Column({ type: 'double precision', nullable: true })
  peakScore!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  peakAt!: Date | null;

  /** How many scored detections joined it. */
  @Column({ type: 'integer', default: 0 })
  scorings!: number;

  /** Per detector id: `{ count, maxStrength, lastAt }`. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  detections!: Record<string, unknown>;

  /** The peak scoring's contributions (top features, detections with evidence shares); feature names and numbers only. */
  @Column({ type: 'jsonb', nullable: true })
  explanation!: Record<string, unknown> | null;

  /**
   * The behaviour.v1 and attack.v1 vectors of the peak scoring (03 §3.5, migration 006; `dataset/ai_firewall.vector-capture.ts`), for the
   * dataset export: numbers only. Kept only on a staging or demo install (INSTALL_ROLE); null on production.
   */
  @Column({ type: 'jsonb', nullable: true })
  peakVectors!: Record<string, unknown> | null;

  /**
   * 04.6: what the two tree models said about the actor in shadow (`incidents/ai_firewall.incident-model.ts` IncidentModels): per model its
   * latest and peak score, the peak's top contributions, the days it flagged the actor and the model file's short sha (migration 008).
   * Names and numbers only; the promotion gate (4.7) reads it.
   */
  @Column({ type: 'jsonb', nullable: true })
  models!: Record<string, unknown> | null;

  /** The scorings, bounded (HISTORY_MAX): the score timeline. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  history!: unknown[];

  /** A platform-scope finding (an address, an anonymous caller, a ROOT actor): shown in ROOT only (D55-24). */
  @Column({ type: 'boolean', default: false })
  platform!: boolean;

  /** A device or machine finding: an alert at most, never a human control (FWA-6). */
  @Column({ type: 'boolean', default: false })
  alertsOnly!: boolean;

  /** The latest scoring had no own baseline yet. */
  @Column({ type: 'boolean', default: false })
  coldStart!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  /** The person who acknowledged it. */
  @Column({ type: 'uuid', nullable: true })
  acknowledgedBy!: string | null;

  /** Signal kinds in the incident's window and their counts (not written by the grouping: the timeline counts them from the events). */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  kinds!: Record<string, number>;

  @Column({ type: 'integer', default: 0 })
  signalCount!: number;

  /** A stable reason code (dictionary key `ai_firewall.reason.<code>`), never free text. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  @Column({ type: 'timestamptz' })
  lastSignalAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** The person who closed it; null when the responder did or it is still open. */
  @Column({ type: 'uuid', nullable: true })
  closedBy!: string | null;

  /** A stable code: `resolved`, `false_positive` (a person), `expired` (quiet for 24 h, or older than 7 days). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  closeReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
