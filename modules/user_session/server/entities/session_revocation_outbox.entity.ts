import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * common.29: the durable record of a `user_session:session_revoked` notification that did not complete (a hook threw, or
 * did not answer within the point's 2 s budget and was abandoned). The worker drain (user_session.revocation.outbox.ts)
 * replays it until every hook answers, so a native push token or other session-bound access is not left alive because a
 * satellite was slow once. A platform table (system data source): one revocation can concern several workspaces.
 */
@Entity('session_revocation_outbox')
// Named as its migration creates it, so a migrate-mode schema and the entity sync agree (db:schema:drift, integration lane 2).
@Index('IDX_session_revocation_outbox_next', ['nextAttemptAt'])
export class SessionRevocationOutbox {
  @PrimaryGeneratedColumn('uuid', { name: 'outboxId' })
  outboxId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The revoked sessions of this workspace, as the hooks are told them. */
  @Column({ type: 'jsonb' })
  sessions!: Array<{ userSessionId: string; userId: string; tenantId: string }>;

  /** The contributions that failed the last attempt (for the operator; the replay tells every hook again, they are idempotent). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  failedContributions!: string[];

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz' })
  nextAttemptAt!: Date;

  /** Set when the replay gave up (MAX_ATTEMPTS): a dead letter an operator can see; never deleted automatically. */
  @Column({ type: 'timestamptz', nullable: true })
  deadAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
