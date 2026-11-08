import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('webhook_deliveries')
// The per-endpoint delivery log filters by tenant and endpoint and sorts newest first. Created (DESC) by
// migrations/001_deliveries_webhook_created_index.sql; named here so synchronize keeps it instead of dropping it.
@Index('idx_webhook_deliveries_tenant_webhook_created', ['tenantId', 'webhookId', 'createdAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid', { name: 'deliveryId' })
  deliveryId!: string;

  @Index()
  @Column({ type: 'uuid' })
  webhookId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  event!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  // PENDING | SUCCESS | FAILED | DEAD_LETTERED
  // FAILED → recoverable (will retry until attempts === maxAttempts)
  // DEAD_LETTERED → all retries exhausted, awaits manual replay
  @Index()
  @Column({ type: 'varchar', default: 'PENDING' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts!: number;

  @Column({ type: 'text' })
  requestBody!: string;

  @Column({ type: 'int', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'text', nullable: true })
  responseBody!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  // Round-trip time in milliseconds
  @Column({ type: 'int', nullable: true })
  duration!: number | null;

  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt!: Date | null;

  // The claim the row's queued job belongs to (41-ui-fixes/12 1.5): a fresh id on every enqueue and every redeliver /
  // replay claim, carried in the job's data; the worker sends only when the two match, so a stale job of an earlier
  // claim never sends once the row is PENDING again. NULL on rows written before migrations/071 (webhook.job-resolve.ts).
  @Column({ type: 'uuid', nullable: true })
  claimId!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
