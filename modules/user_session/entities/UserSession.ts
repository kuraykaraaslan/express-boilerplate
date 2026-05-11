import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';

@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid', { name: 'userSessionId' })
  userSessionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'text' })
  accessToken!: string;

  @Index()
  @Column({ type: 'text' })
  refreshToken!: string;

  @Column({ type: 'timestamp' })
  sessionExpiry!: Date;

  @Column({ nullable: true, type: 'varchar' })
  deviceFingerprint?: string;

  @Column({ type: 'boolean', default: false })
  otpVerifyNeeded!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  otpVerifiedAt?: Date;

  @Column({ nullable: true, type: 'varchar' })
  ip?: string;

  @Column({ nullable: true, type: 'varchar' })
  os?: string;

  @Column({ nullable: true, type: 'varchar' })
  device?: string;

  @Column({ nullable: true, type: 'varchar' })
  browser?: string;

  @Column({ nullable: true, type: 'varchar' })
  city?: string;

  @Column({ nullable: true, type: 'varchar' })
  state?: string;

  @Column({ nullable: true, type: 'varchar' })
  country?: string;

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
