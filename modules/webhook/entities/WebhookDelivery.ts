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
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid', { name: 'deliveryId' })
  deliveryId!: string;

  @Index()
  @Column({ type: 'varchar' })
  webhookId!: string;

  @Column({ type: 'varchar' })
  event!: string;

  @Column({ type: 'json', nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ type: 'varchar', default: 'PENDING' })
  status!: string;

  @Column({ type: 'int', nullable: true })
  statusCode?: number | null;

  @Column({ type: 'text', nullable: true })
  responseBody?: string | null;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt?: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
