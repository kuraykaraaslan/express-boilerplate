import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * The write-up of an incident (observability phase 14): blameless by default, one per incident. The timeline is imported from the incident
 * when the draft is made; the action items are `tasks` records linked to the incident, listed beside it. Publishing it outward (so the status
 * page can show it) is a separate, narrow permission, like publishing an incident.
 */
@Index('uq_incident_postmortem', ['tenantId', 'incidentId'], { unique: true })
@Entity('incident_postmortems')
export class IncidentPostmortem {
  @PrimaryGeneratedColumn('uuid', { name: 'postmortemId' })
  postmortemId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  incidentId!: string

  /** `DRAFT` | `IN_REVIEW` | `PUBLISHED`. */
  @Column({ type: 'varchar', length: 12, default: 'DRAFT' })
  status!: string

  @Column({ type: 'varchar', length: 2000, nullable: true })
  summary?: string | null

  @Column({ type: 'text', nullable: true })
  impact?: string | null

  @Column({ type: 'text', nullable: true })
  rootCause?: string | null

  @Column({ type: 'text', nullable: true })
  contributingFactors?: string | null

  @Column({ type: 'text', nullable: true })
  wentWell?: string | null

  @Column({ type: 'text', nullable: true })
  wentPoorly?: string | null

  /** The timeline as it stood when the draft was made, editable, so the story can be corrected without touching the record. */
  @Column({ type: 'text', nullable: true })
  timelineText?: string | null

  @Column({ type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Column({ type: 'uuid', nullable: true })
  reviewerUserId?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt?: Date | null

  /** The `document` record the published write-up lives in (additive, migration 066). Null until the first publication or when `document` is not in use. */
  @Column({ type: 'uuid', nullable: true })
  documentId?: string | null

  /** The version number of the document version the last publication created. A republication adds the next one; a published version is never edited. */
  @Column({ type: 'smallint', nullable: true })
  documentVersionNo?: number | null

  /** The `approval` queue item the review went through; null when the built-in review was used. */
  @Column({ type: 'uuid', nullable: true })
  approvalItemId?: string | null

  /** `APPROVAL` (the review went through the `approval` module) | `BUILTIN` (the module is not in use: the original two-state check). */
  @Column({ type: 'varchar', length: 10, nullable: true })
  reviewMode?: string | null

  /** `APPROVED` | `REJECTED`: the reviewer's decision, mapped back from the approval queue. Null while undecided and for the built-in review. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  reviewOutcome?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
