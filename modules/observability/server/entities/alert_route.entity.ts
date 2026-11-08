import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/** An ordered routing rule (observability phase 11): label matchers decide whether it claims an alert, the rest says what to do with it. */
@Index('idx_alert_routes_order', ['tenantId', 'position'])
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Entity('alert_routes')
export class AlertRoute {
  @PrimaryGeneratedColumn('uuid', { name: 'routeId' })
  routeId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 120 })
  name!: string

  @Column({ type: 'int', default: 0 })
  position!: number

  @Column({ type: 'jsonb', default: () => "'[]'" })
  matchers!: unknown[]

  /** Labels that define a group; empty means one group per alert. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  groupBy!: string[]

  @Column({ type: 'int', default: 0 })
  groupWaitSeconds!: number

  @Column({ type: 'int', default: 300 })
  groupIntervalSeconds!: number

  /** `[{ type: 'notify' | 'webhook' | 'on_call' | 'drop', ... }]`, validated by `alert.route.service`. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  targets!: unknown[]

  /** Overrides the incident policy for alerts this route claims: `auto` | `never`. Null = follow the policy. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  incident?: string | null

  /** After this route claims an alert, keep looking at later routes too. */
  @Column({ type: 'boolean', default: false })
  continueMatching!: boolean

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** `code:<key>`: the stable key of a code-managed row (the file's identity for it). Null for rows nobody applied from code. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
