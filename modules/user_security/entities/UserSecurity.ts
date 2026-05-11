import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_securities')
export class UserSecurity {
  @PrimaryGeneratedColumn('uuid', { name: 'userSecurityId' })
  userSecurityId!: string;

  @Index()
  @Column({ unique: true, type: 'varchar' })
  userId!: string;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ nullable: true, type: 'timestamp' })
  lockedUntil?: Date;

  @Column({ type: 'simple-array', default: '' })
  otpMethods!: string[];

  @Column({ nullable: true, type: 'varchar' })
  otpSecret?: string;

  @Column({ type: 'simple-array', nullable: true })
  otpBackupCodes?: string[];

  @Column({ nullable: true, type: 'timestamp' })
  emailVerifiedAt?: Date;

  @Column({ nullable: true, type: 'timestamp' })
  lastLoginAt?: Date;

  @Column({ nullable: true, type: 'varchar' })
  lastLoginIp?: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
