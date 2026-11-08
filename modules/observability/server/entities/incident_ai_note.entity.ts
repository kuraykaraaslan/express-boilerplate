import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * One run of an AI feature (observability phase 20): an investigator analysis, a status-update or post-mortem draft, a natural-language
 * query. The row is the record of the run (who asked, which provider and model, what it cost in tokens, how the citation filter treated the
 * model's answer) and, for an analysis or a draft, the stored result next to the evidence it cited. It is also what the daily cap counts,
 * failed runs included, because a failed call still costs.
 *
 * The incident timeline gets a small `AI_NOTE` event that points here; the full, structured result lives in this row because timeline event
 * data is bounded to a few scalar fields. APPEND-ONLY apart from the thumbs feedback, which a person sets once per row.
 */
@Index('idx_incident_ai_notes_incident', ['tenantId', 'incidentId', 'createdAt'])
@Index('idx_incident_ai_notes_day', ['tenantId', 'createdAt'])
@Entity('incident_ai_notes')
export class IncidentAiNote {
  @PrimaryGeneratedColumn('uuid', { name: 'noteId' })
  noteId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** Null for a run that belongs to no incident (a natural-language query). */
  @Column({ type: 'uuid', nullable: true })
  incidentId?: string | null

  /** `INVESTIGATION` | `STATUS_DRAFT` | `POSTMORTEM_DRAFT` | `NL_QUERY`. */
  @Column({ type: 'varchar', length: 20 })
  kind!: string

  /** `OK` | `EMPTY` (nothing to analyse, no model call) | `FAILED`. */
  @Column({ type: 'varchar', length: 8 })
  status!: string

  /** `MANUAL` (a person asked) | `AUTO` (the delayed run after the incident opened) | `RESOLVE` (the one run when it resolved). */
  @Column({ type: 'varchar', length: 8, default: 'MANUAL' })
  trigger!: string

  @Column({ type: 'uuid', nullable: true })
  requestedBy?: string | null

  @Column({ type: 'varchar', length: 60, nullable: true })
  provider?: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  model?: string | null

  /** The prompt version the answer was made with (`ai.prompt.ts`), so a change of wording is traceable. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  promptVersion?: string | null

  @Column({ type: 'int', default: 0 })
  inputTokens!: number

  @Column({ type: 'int', default: 0 })
  outputTokens!: number

  /** The cited result: `{ summary, hypotheses, dropped }`, a draft's text, or a query and its explanation. Null for a failed run. */
  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, unknown> | null

  /** The evidence items the result cites from (a person opens them from here). Scrubbed before it was ever sent to the model. */
  @Column({ type: 'jsonb', nullable: true })
  evidence?: unknown[] | null

  /** Why a run failed, in our words (never the provider's raw message). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  failure?: string | null

  /** Thumbs: 1 up, -1 down, null not rated. */
  @Column({ type: 'smallint', nullable: true })
  feedback?: number | null

  @Column({ type: 'uuid', nullable: true })
  feedbackBy?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  feedbackAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
