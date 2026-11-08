import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/** Who is doing what on an incident (observability phase 14). One role per person per incident; at most ONE commander (partial unique index). */
@Index('uq_incident_participant', ['tenantId', 'incidentId', 'userId'], { unique: true })
@Index('uq_incident_one_commander', ['tenantId', 'incidentId'], { unique: true, where: `"role" = 'COMMANDER'` })
@Entity('incident_participants')
export class IncidentParticipant {
  @PrimaryGeneratedColumn('uuid', { name: 'participantId' })
  participantId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  incidentId!: string

  @Column({ type: 'uuid' })
  userId!: string

  @Column({ type: 'varchar', length: 12 })
  role!: string

  @Column({ type: 'uuid', nullable: true })
  assignedBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  assignedAt!: Date
}
