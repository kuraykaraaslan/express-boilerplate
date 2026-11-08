import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * A key an outside system uses to send alerts (observability phase 11). The key is a credential: only its hash is stored, it is shown
 * once, and the tenant, the source and the highest severity it may send are all fixed HERE, not by the payload.
 */
@Index('uq_alert_integration_key', ['keyHash'], { unique: true })
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Entity('alert_integrations')
export class AlertIntegration {
  @PrimaryGeneratedColumn('uuid', { name: 'integrationId' })
  integrationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 120 })
  name!: string

  @Column({ type: 'varchar', length: 14, default: 'GENERIC' })
  kind!: string

  @Column({ type: 'varchar', length: 64 })
  keyHash!: string

  /** First characters of the key, to recognise it in a list. Not a credential. */
  @Column({ type: 'varchar', length: 12 })
  keyPrefix!: string

  @Column({ type: 'varchar', length: 10, default: 'MAJOR' })
  severityCeiling!: string

  /** Labels added to every alert from this key (the key's labels win over the payload's on a clash). */
  @Column({ type: 'jsonb', nullable: true })
  defaultLabels?: Record<string, string> | null

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** `code:<key>`: the stable key of a code-managed row (the file's identity for it). Null for rows nobody applied from code. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
