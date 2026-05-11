import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid', { name: 'auditLogId' })
  auditLogId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  userId?: string | null;

  @Index()
  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  resourceType?: string | null;

  @Column({ type: 'varchar', nullable: true })
  resourceId?: string | null;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
