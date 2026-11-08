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

/**
 * Push subscription is tenant-scoped: the same physical browser endpoint
 * may be subscribed to multiple tenants the user belongs to. Composite
 * uniqueness on (tenantId, endpoint) lets the same endpoint be re-used
 * across tenants while preventing duplicates within a tenant.
 */
@Entity('push_subscriptions')
@Unique('UQ_push_sub_tenant_endpoint', ['tenantId', 'endpoint'])
@Unique('UQ_push_sub_tenant_user_endpoint', ['tenantId', 'userId', 'endpoint'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  // Web Push: the push-service URL. Expo: the `ExponentPushToken[…]` itself. Either way the
  // one thing that addresses the device, so the (tenantId, endpoint) uniqueness holds for both.
  @Column({ type: 'varchar' })
  endpoint!: string;

  // Which backend delivers to this row: 'webpush' (a browser) or 'expo' (a native app).
  @Column({ type: 'varchar', length: 16, default: 'webpush' })
  provider!: string;

  // Web Push encryption keys. Null for token-addressed providers (Expo), which have none.
  @Column({ type: 'varchar', nullable: true })
  p256dh!: string | null;

  @Column({ type: 'varchar', nullable: true })
  auth!: string | null;

  // Native app install id, so a rotated token replaces the old row instead of piling up.
  @Index()
  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceId?: string | null;

  // The session a native app registered under. Revoking that session (logout, sign out
  // everywhere, password change) removes the row, so a signed-out phone stops getting the
  // account's notifications. Null for browser subscriptions, which outlive a session.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userSessionId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  platform?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  appVersion?: string | null;

  // Per-category subscription preferences (empty/null = subscribed to all).
  @Column({ type: 'jsonb', nullable: true })
  categories?: string[] | null;

  // Explicit push-permission consent timestamp (GDPR / audit).
  @Column({ nullable: true, type: 'timestamp' })
  consentAt?: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
