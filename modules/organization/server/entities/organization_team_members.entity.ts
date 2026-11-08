import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

export type TeamMemberRole = 'LEADER' | 'MEMBER' | 'OBSERVER'

/**
 * One person's membership of one team.
 *
 * A row, not a many-to-many join: `teamMemberId` is a stable id that assignment
 * capacity and round-robin counters hang off. Starting with a plain m2m would
 * have meant no place to put them later without a migration.
 *
 * Membership is CLOSED, never deleted — `isActive=false` plus `leftAt`. Past
 * assignments and capacity history reference the row, and deleting it would
 * make "who owned this deal in March" unanswerable.
 */
@Entity('organization_team_members')
// A user may belong to many teams, but only once per team at a time.
@Index(['tenantId', 'teamId', 'userId'], { unique: true, where: '"isActive" AND "deletedAt" IS NULL' })
// At most one active leader per team.
@Index(['tenantId', 'teamId'], { unique: true, where: `role = 'LEADER' AND "isActive" AND "deletedAt" IS NULL` })
export class OrganizationTeamMember {
  @PrimaryGeneratedColumn('uuid', { name: 'teamMemberId' })
  teamMemberId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Index()
  @Column({ type: 'uuid' })
  teamId!: string

  /** A platform user — NOT an employee; `hr` may not be installed. */
  @Index()
  @Column({ type: 'uuid' })
  userId!: string

  @Column({ type: 'varchar', length: 24, default: 'MEMBER' })
  role!: TeamMemberRole

  /** A calendar day: 'YYYY-MM-DD'. Joining a team has no clock time. */
  @Column({ type: 'date' })
  joinedAt!: string

  @Index()
  @Column({ type: 'date', nullable: true })
  leftAt?: string | null

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
