import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One label (docs/phases/55-ai-firewall/03 §3.1, §3.2): what a source whose truth we know says about one incident or one stored event, the
 * examples the tree models of 04 learn from. Written by the fw:signals consumer's label producer (honeytoken touches, bans an operator
 * placed or lifted; `labels/ai_firewall.label-producer.ts`) and by the incident pages (a person's verdict, the false alarm close;
 * `ai_firewall.incident.service.ts`). At most one label per reference and source (`uq_ai_firewall_labels_ref`).
 *
 * Platform labels are stored under the ROOT tenant, as the rest of the store. Personal data: `actorId` (a user, session or key id, an
 * address) and `labelledBy` (a person): exported with redaction, erased and purged by the module's contributions, deleted by the retention
 * once `refAt` (or `labelledAt`) is older than the tenant's (D55-97). Tenant-scoped (tenant RLS, FORCE). Created in SQL by migration 004
 * with the same names (the CHECK constraints of the closed lists live there); `runId` by migration 005 (the probe lane's and benign
 * traffic's labels, 03 §3.3); `vectors` by migration 006 (the dataset export, 03 §3.5); `idx_ai_firewall_labels_ref_at` by migration 007
 * (the retention by `refAt`, the export's reads).
 */
@Entity('ai_firewall_labels')
@Index('uq_ai_firewall_labels_ref', ['tenantId', 'refKind', 'refId', 'source'], { unique: true })
@Index('idx_ai_firewall_labels_labelled', ['tenantId', 'labelledAt'])
@Index('idx_ai_firewall_labels_actor', ['tenantId', 'actorKind', 'actorId'])
@Index('idx_ai_firewall_labels_run', ['tenantId', 'runId'], { where: '"runId" IS NOT NULL' })
@Index('idx_ai_firewall_labels_ref_at', ['tenantId', 'refAt'])
export class AiFirewallLabel {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_firewall_labels' })
  labelId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** `incident` | `event` (LABEL_REF_KINDS). */
  @Column({ type: 'varchar', length: 16 })
  refKind!: string;

  /** The incident's uuid as text, or the event's signal id. */
  @Column({ type: 'varchar', length: 128 })
  refId!: string;

  /** When the labelled behaviour happened: the incident's opening, the event's time. */
  @Column({ type: 'timestamptz' })
  refAt!: Date;

  @Column({ type: 'varchar', length: 16 })
  actorKind!: string;

  @Column({ type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'varchar', length: 32, default: 'unknown' })
  lane!: string;

  /** The event's signal kind; null for an incident. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  kind!: string | null;

  /** The incident's detectors, strongest first (`score.rules` when none held); empty for an event. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  detectors!: string[];

  /** LABEL_CLASSES: benign, the detector ids of 02, honeytoken_touch, other. */
  @Column({ type: 'varchar', length: 32 })
  labelClass!: string;

  /** A person's verdict: `true_positive` | `false_positive` | `unsure`; null for a system source. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  verdict!: string | null;

  /** LABEL_SOURCES: honeytoken | admin | ban_confirmed | synthetic | benign_traffic. */
  @Column({ type: 'varchar', length: 16 })
  source!: string;

  /** 0..1. */
  @Column({ type: 'double precision' })
  confidence!: number;

  /** The person who labelled (a user id); cleared by the erasure. */
  @Column({ type: 'uuid', nullable: true })
  labelledBy!: string | null;

  /** The producer when no person labelled (`honeytoken_watch`, …). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  labelledBySystem!: string | null;

  @Column({ type: 'timestamptz' })
  labelledAt!: Date;

  /** The probe or benign-traffic run of a `synthetic` / `benign_traffic` label (03 §3.3, §3.4; migration 005); null otherwise. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  runId!: string | null;

  /**
   * The vectors of the labelled behaviour (03 §3.5, migration 006; `dataset/ai_firewall.vector-capture.ts`): an incident's peak vectors,
   * or the actor's vectors read when an event label was produced. Numbers only; kept only on a staging or demo install, null elsewhere.
   */
  @Column({ type: 'jsonb', nullable: true })
  vectors!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
