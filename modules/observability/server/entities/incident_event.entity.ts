import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * The incident's internal timeline (observability phase 14): what happened, in order, and who did it. APPEND-ONLY: nothing updates or deletes a
 * row. This is a state-machine history with a fixed set of event types, NOT a polymorphic activity table: it has no `relatedType` /
 * `relatedId` reach (audit §3.2). Free-text notes are `comments` records (subject `incident`), not rows here. Public progress messages stay
 * in `incident_updates`; the timeline only records THAT one was posted.
 */
@Index('idx_incident_events_incident', ['tenantId', 'incidentId', 'createdAt'])
@Entity('incident_events')
export class IncidentEvent {
  @PrimaryGeneratedColumn('uuid', { name: 'eventId' })
  eventId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  incidentId!: string

  /** One of `INCIDENT_EVENT_TYPES` (`incident.enums.ts`). */
  @Column({ type: 'varchar', length: 24 })
  type!: string

  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null

  /** Small, typed-by-event detail (never free-form user text beyond a short title). */
  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown> | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
