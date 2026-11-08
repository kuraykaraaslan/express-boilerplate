import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, BeforeInsert, BeforeUpdate } from 'typeorm';

// D28: replacing the same device's earlier session looks sessions up by (user, tenant, device).
@Index('IDX_user_sessions_device', ['userId', 'tenantId', 'deviceId'])
@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid', { name: 'userSessionId' })
  userSessionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  // The tenant this session is scoped to. A session is only ever valid for
  // requests against this exact tenant — see tenant_session.authenticate.next.ts,
  // which rejects a mismatch instead of falling back to a membership re-check.
  // A user with N tenant memberships holds N separate UserSession rows.
  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'text' })
  accessToken!: string;

  @Index()
  @Column({ type: 'text' })
  refreshToken!: string;

  @Column({ nullable: true, type: 'varchar' })
  deviceFingerprint?: string;

  // D28: the browser's device-id cookie (user_session.device-id.ts). One live session per user, tenant and deviceId. Null on older rows and on
  // sessions that do not come from a sign-in (impersonation, break-glass).
  @Column({ nullable: true, type: 'varchar', length: 64 })
  deviceId?: string | null;

  @Column({ nullable: true, type: 'text' })
  userAgent?: string;

  @Column({ nullable: true, type: 'varchar' })
  ipAddress?: string;

  @Column({ type: 'varchar', default: 'ACTIVE' })
  sessionStatus!: string;

  @Column({ type: 'boolean', default: false })
  otpVerifyNeeded!: boolean;

  @Column({ type: 'timestamp' })
  sessionExpiry!: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: unknown;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date();
  }
}
