import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/** One step of an incident's public progress:
 *  INVESTIGATING → IDENTIFIED → MONITORING → RESOLVED, each with the message
 *  shown on the status page.
 *
 *  This is a STATE MACHINE HISTORY (public status messages), not a timeline in
 *  the `activity`/`calendar` sense (audit §3.2): it never builds a CRM-like
 *  relatedType/relatedId view and does not duplicate `activity`. */
@Entity('incident_updates')
export class IncidentUpdate {
  @PrimaryGeneratedColumn('uuid', { name: 'updateId' })
  updateId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Index()
  @Column({ type: 'uuid' })
  incidentId!: string

  @Column({ type: 'varchar', length: 16 })
  status!: string

  @Column({ type: 'varchar', length: 2000 })
  publicMessage!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
