import 'reflect-metadata';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { SharedDatabaseOnly } from '@kuraykaraaslan-labs/db/server/db.shared-database';
import type { SessionEndPayload } from '../session_end.contract';

/**
 * One "end this session" order (docs/audits/2026-11-03-redis-outage.md §3, layer 1): a device kick for `iot:kicks`, a websocket
 * control order for `ws:control:stream`. It is written in the same database transaction as the change that causes it (a device
 * deleted, a credential revoked, a session revoked), so a committed change always has its order. The writer delivers it right after
 * the commit and deletes the row; a row that is still here is delivered by the relay (`session_end.orders.ts`), oldest first, until
 * Redis takes it. `orderId` is carried in the stream entry (`oid`), so a reader acts on an order once however often it is delivered.
 *
 * Pinned to the shared database (`@SharedDatabaseOnly`, the `iot_device_directory` precedent): the relay reads one database for
 * every tenant, wherever the tenant's own data lives. Tenant-keyed with the generated RLS policy pair, FORCE from birth (migration
 * 001); a row is written in its tenant's context, the relay reads and changes rows under the system context.
 */
@SharedDatabaseOnly()
@Entity('session_end_orders')
@Index('idx_session_end_orders_due', ['nextAttemptAt'], { where: '"deadAt" IS NULL' })
@Index('idx_session_end_orders_dead', ['deadAt'], { where: '"deadAt" IS NOT NULL' })
export class SessionEndOrder {
  /** The order's stable id, chosen by the writer; the stream entry carries it as `oid`. */
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_session_end_orders' })
  orderId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** What the order is, for the operator and the metric labels (`iot_device.kick`, `websocket.control`). */
  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  /** What delivering it writes to Redis (`SessionEndPayload`). */
  @Column({ type: 'jsonb' })
  payload!: SessionEndPayload;

  /** Delivery attempts the relay made while Redis answered (the writer's fast path is not counted). */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  /** When the relay may take it: the commit plus the fast path's grace, then the backoff after each failed attempt. */
  @Column({ type: 'timestamptz' })
  nextAttemptAt!: Date;

  /** Set when the relay gave up (`MAX_ATTEMPTS`, or a payload it cannot deliver): a dead letter an operator sees; never deleted automatically. */
  @Column({ type: 'timestamptz', nullable: true })
  deadAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
