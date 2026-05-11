import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Unique(['tenantId'])
@Entity('tenant_subscriptions')
export class TenantSubscription {
  @PrimaryGeneratedColumn('uuid', { name: 'subscriptionId' })
  subscriptionId!: string;

  @Index()
  @Column({ type: 'uuid', unique: true })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  planId?: string | null;

  @Column({ type: 'varchar', default: 'TRIAL' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  trialEndsAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodStart?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd?: Date | null;

  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: 'varchar', nullable: true })
  externalSubscriptionId?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
