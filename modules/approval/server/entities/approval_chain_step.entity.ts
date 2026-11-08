import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * One step of a multi-step approval chain (migration 173;
 * docs/phases/05-hr/03-time-off/README.md `leave_approval_steps`, generalised into `approval`
 * by the 2026-09-11 alignment note).
 *
 * Polymorphic on `(entityType, entityId)` like the queue itself: the owning
 * module defines the chain and says who each step's approver is; `approval`
 * runs it. Each ACTIVE step is its own queue item (entityType
 * `approval_chain_step`, entityId = this row), so a step is reviewed, audited
 * and hash-chained exactly like any other queue item. The queue table is not
 * changed, so its hash chain is untouched.
 *
 * Steps run in `stepIndex` order: one PENDING, the rest WAITING. A rejection
 * SKIPs the rest; the owner settling the entity another way CANCELs them.
 */
@Entity('approval_chain_steps')
@Index('idx_approval_chain_entity', ['tenantId', 'entityType', 'entityId', 'purpose'])
@Index('idx_approval_chain_approver', ['tenantId', 'approverUserId', 'status'])
// One live step per position; a finished chain may be followed by a new one.
@Index('uq_approval_chain_open_step', ['tenantId', 'entityType', 'entityId', 'purpose', 'stepIndex'], {
  unique: true,
  where: "\"status\" IN ('WAITING', 'PENDING')",
})
export class ApprovalChainStep {
  @PrimaryGeneratedColumn('uuid', { name: 'stepId' })
  stepId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  entityType!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  /** Several chains can run on one entity over its life (a request, later its cancellation). */
  @Column({ type: 'varchar', length: 32, default: 'REQUEST' })
  purpose!: string;

  @Column({ type: 'int' })
  stepIndex!: number;

  /** The owner's name for the level ("MANAGER", "HR"); opaque here. */
  @Column({ type: 'varchar', length: 32 })
  level!: string;

  /** Who decides: a named user, or (null) anyone the owner's `approverPermission` admits. */
  @Column({ type: 'uuid', nullable: true })
  approverUserId?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  approverPermission?: string | null;

  /** WAITING | PENDING | APPROVED | REJECTED | SKIPPED | CANCELLED */
  @Column({ type: 'varchar', length: 16, default: 'WAITING' })
  status!: string;

  /** The queue item this step was submitted as, once it became PENDING. */
  @Column({ type: 'uuid', nullable: true })
  approvalItemId?: string | null;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ type: 'uuid', nullable: true })
  submittedByUserId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  decidedByUserId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt?: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
