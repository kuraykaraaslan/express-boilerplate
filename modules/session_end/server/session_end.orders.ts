import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity, QueryRunner } from 'typeorm';
import { withSharedTenantRepositoryFor, withSharedTenantTransactionFor, withSystemRLS } from '@kuraykaraaslan-labs/db';
import defaultRedis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { SessionEndOrder } from './entities/session_end_order.entity';
import {
  CACHE_DROP_STREAM, DELIVERY_TIMEOUT_MS, FAST_PATH_GRACE_MS, MAX_ATTEMPTS, RELAY_BATCH, nextAttemptDelayMs, payloadProblem,
  type RecordedSessionEndOrder, type SessionEndOrderInput, type SessionEndPayload,
} from './session_end.contract';
import { deliverPayload, withTimeout, type DeliveryRedis } from './session_end.deliver';

/**
 * The transactional outbox of "end this session" orders (docs/audits/2026-11-03-redis-outage.md §3, layer 1).
 *
 *   - **Record in the cause's transaction** (`recordOrders(inputs, { qr })`): when `qr` is a transaction on the shared database (a
 *     tenant that lives there, the common case) the rows are inserted in it, so the order commits with the change or not at all. A
 *     tenant with a database of its own changes its rows there; the order then goes into a transaction of its own on the shared
 *     database, opened and committed INSIDE the caller's (before its commit, the `iot_device_directory` pattern): if the change
 *     commits, the order exists; if the change then rolls back, the order is one session closed for nothing, never one left open.
 *   - **Fast path** (`deliverRecorded`): right after the commit the writer delivers each order and deletes its row. A failure is
 *     logged and left to the relay; it never fails the request.
 *   - **Relay** (`relayOrders`, every few seconds from `session_end.relay.ts`, and the HTTP twin): the due rows, oldest first, under
 *     the system context (one table for every tenant), each locked `FOR UPDATE SKIP LOCKED` so two relays never take the same row.
 *     A Redis that does not answer PING costs no attempt (the rows wait, the stale alert says so); a delivery that fails backs off
 *     (2 s doubling to a minute); after `MAX_ATTEMPTS` or with a payload that cannot be delivered the row is a dead letter (`deadAt`):
 *     kept, counted, alerted, never deleted automatically.
 *   - **Idempotent**: the stream entry carries the row's `orderId` as `oid`; a reader acts on an `oid` once, so a row delivered by the
 *     fast path and again by the relay (its delete failed) closes the same session once.
 */

type Row = Pick<SessionEndOrder, 'orderId' | 'tenantId' | 'kind' | 'payload' | 'attempts'>;

/** Builds the rows; a payload that could never be delivered is a bug in the producer and throws before anything is written. */
function rowsOf(inputs: readonly SessionEndOrderInput[], now: Date): SessionEndOrder[] {
  return inputs.map((input) => {
    const problem = payloadProblem(input.payload);
    if (problem) throw new Error(`[session_end] ${input.kind}: undeliverable order (${problem})`);
    const row = new SessionEndOrder();
    row.orderId = randomUUID();
    row.tenantId = input.tenantId;
    row.kind = input.kind;
    row.payload = input.payload;
    row.attempts = 0;
    // a cache drop is due at once (D253): another node's relay may deliver it while the writer cannot reach Redis
    row.nextAttemptAt = new Date(now.getTime() + (input.payload.stream === CACHE_DROP_STREAM ? 0 : FAST_PATH_GRACE_MS));
    row.deadAt = null;
    row.lastError = null;
    row.createdAt = now;
    return row;
  });
}

const recorded = (r: SessionEndOrder): RecordedSessionEndOrder => ({ orderId: r.orderId, tenantId: r.tenantId, kind: r.kind, payload: r.payload });

/**
 * Records orders (see the file comment). With `qr` they join that transaction when it is on the shared database, else they commit in
 * a shared-database transaction of their own before this returns. Every input of one call names the same tenant. Throws when the
 * rows cannot be written: inside the cause's transaction that rolls the change back, which is the point.
 */
export async function recordOrders(
  inputs: readonly SessionEndOrderInput[],
  o: { qr?: QueryRunner; now?: Date } = {},
): Promise<RecordedSessionEndOrder[]> {
  if (inputs.length === 0) return [];
  const tenantId = inputs[0].tenantId;
  if (inputs.some((i) => i.tenantId !== tenantId)) throw new Error('[session_end] one call records the orders of one tenant');
  const rows = rowsOf(inputs, o.now ?? new Date());
  // the jsonb payload is an open record, which TypeORM's deep-partial type cannot follow
  const values = rows as unknown as QueryDeepPartialEntity<SessionEndOrder>[];
  const qr = o.qr;
  if (qr && qr.isTransactionActive && qr.connection.hasMetadata(SessionEndOrder)) {
    await qr.manager.insert(SessionEndOrder, values);
  } else {
    await withSharedTenantTransactionFor(tenantId, (own) => own.manager.insert(SessionEndOrder, values));
  }
  return rows.map(recorded);
}

/** The savepoint `recordOrdersInTx` writes under, so a refused insert never aborts the host's transaction. */
const SAVEPOINT = 'session_end_orders';

/** The host's transaction could not be returned to the savepoint: it is broken, and the host must not commit (D249). */
export class HostTransactionBroken extends Error {
  constructor(readonly rollbackError: unknown) {
    super(`[session_end] the host's transaction could not be rolled back to its savepoint: ${(rollbackError as Error)?.message ?? String(rollbackError)}`);
    this.name = 'HostTransactionBroken';
  }
}

/**
 * Records one tenant's orders in a HOST's open transaction (D249, `session_end:order_source`): the host is `user_session`,
 * `tenant_member` or `tenant`, whose transaction is not one of this tenant's own (a revocation runs without a tenant context, a
 * cross-tenant sign-out spans several). On the shared database the rows go in under a savepoint, with the tenant set for the insert
 * (`app.current_tenant`, the RLS policy's `WITH CHECK`) and the host's own setting put back after it; a refused insert rolls back to
 * the savepoint (which also restores the setting) and is thrown, and the host's transaction goes on as if nothing had been tried.
 * A transaction on a tenant's own database (no `session_end_orders` there), or none at all, gets the orders in a shared-database
 * transaction committed before this returns (D243: a change that then rolls back closes a session for nothing, never leaves one open).
 * Throws `HostTransactionBroken` only when the savepoint cannot be rolled back to.
 */
export async function recordOrdersInTx(
  qr: QueryRunner,
  inputs: readonly SessionEndOrderInput[],
  o: { now?: Date } = {},
): Promise<RecordedSessionEndOrder[]> {
  if (inputs.length === 0) return [];
  const tenantId = inputs[0].tenantId;
  if (inputs.some((i) => i.tenantId !== tenantId)) throw new Error('[session_end] one call records the orders of one tenant');
  if (!qr.isTransactionActive || !qr.connection.hasMetadata(SessionEndOrder)) return recordOrders(inputs, { now: o.now });
  const rows = rowsOf(inputs, o.now ?? new Date());
  const values = rows as unknown as QueryDeepPartialEntity<SessionEndOrder>[];
  await qr.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const [setting] = (await qr.query(`SELECT current_setting('app.current_tenant', true) AS "tenant"`)) as Array<{ tenant: string | null }>;
    await qr.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await qr.manager.insert(SessionEndOrder, values);
    await qr.query(`SELECT set_config('app.current_tenant', $1, true)`, [setting?.tenant ?? '']);
    await qr.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (err) {
    try {
      await qr.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      await qr.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    } catch (rollbackErr) {
      throw new HostTransactionBroken(rollbackErr);
    }
    throw err;
  }
  return rows.map(recorded);
}

async function deleteDelivered(order: RecordedSessionEndOrder): Promise<void> {
  try {
    await withSharedTenantRepositoryFor(order.tenantId, SessionEndOrder, (repo) => repo.delete({ orderId: order.orderId, tenantId: order.tenantId }));
  } catch (err) {
    // the relay delivers it once more; its readers skip the `oid` they already handled
    Logger.warn(`[session_end] ${order.kind} ${order.orderId} delivered but its row not deleted: ${(err as Error).message}`);
  }
}

/** The fast path: delivers each order now and deletes its row. Never throws; what Redis did not take is left to the relay. */
export async function deliverRecorded(
  orders: readonly RecordedSessionEndOrder[],
  o: { redis?: DeliveryRedis; timeoutMs?: number } = {},
): Promise<{ delivered: number; left: number }> {
  const client = o.redis ?? (defaultRedis as unknown as DeliveryRedis);
  let delivered = 0;
  let left = 0;
  for (const order of orders) {
    try {
      await deliverPayload(client, order.orderId, order.payload, o.timeoutMs ?? DELIVERY_TIMEOUT_MS);
    } catch (err) {
      left += 1;
      Logger.warn(`[session_end] ${order.kind} ${order.orderId} (tenant ${order.tenantId}) not delivered now, the relay delivers it: ${(err as Error).message}`);
      continue;
    }
    delivered += 1;
    await deleteDelivered(order);
  }
  return { delivered, left };
}

/**
 * For a change that has no transaction of its own to join (a tenant hook, a firewall kick): records the orders in a shared-database
 * transaction, then delivers them. When even the record fails (the database does not answer), the orders are delivered directly as a
 * last resort and the record's error is thrown, so the caller's own retry (the tenant hook runner, the revocation outbox) runs again.
 */
export async function endSessions(
  inputs: readonly SessionEndOrderInput[],
  o: { redis?: DeliveryRedis; timeoutMs?: number } = {},
): Promise<void> {
  if (inputs.length === 0) return;
  let orders: RecordedSessionEndOrder[];
  try {
    orders = await recordOrders(inputs);
  } catch (err) {
    Logger.error(`[session_end] ${inputs[0].kind}: order not recorded (tenant ${inputs[0].tenantId}), delivered without a record: ${(err as Error).message}`);
    await deliverRecorded(inputs.map((i) => ({ ...i, orderId: randomUUID() })), o);
    throw err;
  }
  await deliverRecorded(orders, o);
}

export interface RelayReport {
  /** Redis did not answer PING: nothing was attempted. */
  redisDown: boolean;
  delivered: number;
  failed: number;
  dead: number;
  /** The pass took a full batch: more rows may be due. */
  more: boolean;
}

/** The part of an ioredis client the relay uses. */
export type RelayRedis = DeliveryRedis & { ping(): Promise<unknown> };

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** One relay pass over the due rows (see the file comment). Throws only when the database does not answer. */
export async function relayOrders(o: { redis?: RelayRedis; now?: Date; batch?: number; timeoutMs?: number } = {}): Promise<RelayReport> {
  const client = o.redis ?? (defaultRedis as unknown as RelayRedis);
  const timeoutMs = o.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  const batch = o.batch ?? RELAY_BATCH;
  const report: RelayReport = { redisDown: false, delivered: 0, failed: 0, dead: 0, more: false };
  try {
    await withTimeout(client.ping(), timeoutMs);
  } catch {
    report.redisDown = true;
    return report;
  }
  const now = o.now ?? new Date();
  return withSystemRLS(async (qr) => {
    const rows = (await qr.query(
      `SELECT "orderId", "tenantId", "kind", "payload", "attempts" FROM "session_end_orders"
        WHERE "deadAt" IS NULL AND "nextAttemptAt" <= $1
        ORDER BY "createdAt", "orderId" LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [now, batch],
    )) as Row[];
    report.more = rows.length >= batch;
    for (const row of rows) {
      const problem = payloadProblem(row.payload);
      if (problem) {
        await qr.query(`UPDATE "session_end_orders" SET "deadAt" = $2, "lastError" = $3 WHERE "orderId" = $1`, [row.orderId, now, `undeliverable: ${problem}`]);
        report.dead += 1;
        Logger.error(`[session_end] ${row.kind} ${row.orderId} (tenant ${row.tenantId}) is undeliverable (${problem}): dead-lettered`);
        continue;
      }
      try {
        await deliverPayload(client, row.orderId, row.payload as SessionEndPayload, timeoutMs);
      } catch (err) {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await qr.query(
          `UPDATE "session_end_orders" SET "attempts" = $2, "nextAttemptAt" = $3, "lastError" = $4, "deadAt" = $5 WHERE "orderId" = $1`,
          [row.orderId, attempts, new Date(now.getTime() + nextAttemptDelayMs(attempts)), errText(err), giveUp ? now : null],
        );
        if (giveUp) {
          report.dead += 1;
          Logger.error(`[session_end] ${row.kind} ${row.orderId} (tenant ${row.tenantId}) still not delivered after ${attempts} attempts: dead-lettered`);
        } else {
          report.failed += 1;
        }
        // Redis went away during the pass (or refuses this order): the rest waits for the next pass instead of failing one by one
        report.more = false;
        break;
      }
      await qr.query(`DELETE FROM "session_end_orders" WHERE "orderId" = $1`, [row.orderId]);
      report.delivered += 1;
    }
    return report;
  });
}

export interface OrderStats {
  pending: number;
  dead: number;
  /** Age of the oldest pending row, or null when none is pending. */
  oldestPendingMs: number | null;
}

/** Counts every tenant's rows (system context). Throws when the database does not answer. */
export async function orderStats(now: Date = new Date()): Promise<OrderStats> {
  const [r] = (await withSystemRLS((qr) => qr.query(
    `SELECT count(*) FILTER (WHERE "deadAt" IS NULL) AS pending, count(*) FILTER (WHERE "deadAt" IS NOT NULL) AS dead,
            min("createdAt") FILTER (WHERE "deadAt" IS NULL) AS oldest
       FROM "session_end_orders"`,
  ))) as Array<{ pending: string | number; dead: string | number; oldest: Date | string | null }>;
  const oldest = r?.oldest ? new Date(r.oldest).getTime() : null;
  return { pending: Number(r?.pending ?? 0), dead: Number(r?.dead ?? 0), oldestPendingMs: oldest === null ? null : Math.max(0, now.getTime() - oldest) };
}
