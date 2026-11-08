import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * redis_idempotency.02: the DURABLE record of an Idempotency-Key claim. Redis stays the fast path (and keeps the replayable
 * response body); this row is what still holds when Redis is down, or when it lost the key (maxmemory eviction, a failover
 * to a replica without it). One row per claim key, the same `idempotency:<tenant>:<key>` the Redis record uses.
 */
@Entity('idempotency_claims')
// Named as its migration creates it, so a migrate-mode schema and the entity sync agree (db:schema:drift, integration lane 2).
@Index('IDX_idempotency_claims_expires', ['expiresAt'])
export class IdempotencyClaim {
  @PrimaryColumn({ type: 'varchar', length: 400 })
  claimKey!: string;

  /** 'pending' while the handler runs, 'completed' once it answered 2xx. */
  @Column({ type: 'varchar', length: 16 })
  status!: string;

  /** A pending claim lives as long as a handler may run (10 min), a completed one 24 h. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
