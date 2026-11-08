import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { sessionEndOrderSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/session_end.order_source';
import Logger from '@kuraykaraaslan-labs/logger';
import {
  SESSION_END_ORDER_SOURCE_POINT, causeForTenant, causeTenants, payloadProblem,
  type RecordedSessionEndOrder, type SessionEndCause, type SessionEndOrderInput, type SessionEndOrderSource,
} from './session_end.contract';
import { HostTransactionBroken, deliverRecorded, recordOrdersInTx } from './session_end.orders';
import type { DeliveryRedis } from './session_end.deliver';

/**
 * Session-ending orders recorded INSIDE the transaction of the change that causes them (D249, closing D247's window; docs/audits/
 * 2026-11-03-redis-outage.md §3.2). The hosts that end a person's access (`user_session` revoking sessions, `tenant_member` ending or
 * changing a membership, `tenant` suspending, deleting or purging a tenant) cannot depend on the modules whose live connections must
 * follow (the websocket gateway, through `websocket_session`); they depend on this Core module and its point
 * `session_end:order_source` instead:
 *
 *   1. before its commit the host calls `recordSessionEndInTx(qr, cause)` with its open transaction;
 *   2. each tenant's contributions (gate `data`, as the hosts' own hooks) are asked for the orders the cause needs. They only BUILD
 *      orders: no database, no Redis, never the host's transaction. An order naming another tenant, or one that could never be
 *      delivered, is refused (the contribution counts as failed);
 *   3. the orders are recorded in the host's transaction under a savepoint (`recordOrdersInTx`): the change commits with its orders or
 *      not at all (a dedicated-database tenant: D243's rule, the order commits on the shared database just before the change);
 *   4. after the commit the host calls `afterCommit()`: the fast path delivers each order and deletes its row (never throws); a crash
 *      before it leaves the rows to the relay.
 *
 * Ending access is never blocked by a broken satellite: a contribution that fails, answers something invalid, or whose orders the
 * database refuses is logged and counted (`session_end_in_tx_total{outcome="fallback"}`), the host's transaction goes on and
 * commits, and that contribution is left out of `orderedBy`, so the host's after-commit hook (today's recording, with its own retry)
 * does the work as before. `orderedBy(tenantId)` lists the modules whose orders for that tenant ARE in the transaction: the host
 * passes it to its after-commit hooks, which skip what is already recorded, so a drop is written once.
 *
 * The only error this throws is `HostTransactionBroken` (the savepoint could not be rolled back to: the connection is gone and the
 * host could not commit anyway).
 */

export interface SessionEndInTx {
  /** The modules whose orders for `tenantId` were recorded in the transaction (their after-commit hooks skip this change). */
  orderedBy(tenantId: string): string[];
  /** Orders recorded in the transaction. */
  readonly recorded: number;
  /** Contributions (per tenant) left to their after-commit path. */
  readonly fallbacks: number;
  /** The fast path, right after the host's commit: delivers the recorded orders. Never throws; what Redis did not take is relayed. */
  afterCommit(o?: { redis?: DeliveryRedis; timeoutMs?: number }): Promise<void>;
}

const counts = { recorded: 0, fallback: 0 };

/** The process's counts since it started (`session_end_in_tx_total`, scraped by the relay's metric sources). */
export function inTxCounts(): Readonly<typeof counts> {
  return { ...counts };
}

/** Test seam. */
export function resetInTxCounts(): void {
  counts.recorded = 0;
  counts.fallback = 0;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Why an answer cannot be recorded for `tenantId`, or null when it can. */
function answerProblem(value: unknown, tenantId: string): string | null {
  if (!Array.isArray(value)) return 'not a list of orders';
  for (const input of value as Partial<SessionEndOrderInput>[]) {
    if (!input || typeof input !== 'object') return 'an order that is not an object';
    // a contribution answers for the cause's tenant only: it may never have an order written into another tenant's rows
    if (input.tenantId !== tenantId) return 'an order for another tenant';
    if (typeof input.kind !== 'string' || !/^[a-z][a-z0-9_]*\.[a-z0-9_.]{1,40}$/.test(input.kind)) return 'an order without a valid kind';
    const problem = payloadProblem(input.payload);
    if (problem) return `an undeliverable order (${problem})`;
  }
  return null;
}

const noop: SessionEndInTx = { orderedBy: () => [], recorded: 0, fallbacks: 0, afterCommit: async () => {} };

/** See the file comment. `cause` names the tenants whose contributions are asked (one per tenant, each under its own gate). */
export async function recordSessionEndInTx(qr: QueryRunner, cause: SessionEndCause): Promise<SessionEndInTx> {
  const tenants = causeTenants(cause);
  if (tenants.length === 0) return noop;
  const recorded: RecordedSessionEndOrder[] = [];
  const ordered = new Map<string, string[]>();
  let fallbacks = 0;
  const fallBack = (n: number, what: string) => {
    fallbacks += n;
    counts.fallback += n;
    Logger.error(`[session_end] ${cause.type}: ${what}; left to the after-commit path`);
  };

  for (const tenantId of tenants) {
    const sub = causeForTenant(cause, tenantId);
    let answers: Array<{ moduleId: string; value: unknown }>;
    try {
      const out = await ext.aggregate<SessionEndOrderSource, SessionEndOrderInput[]>(
        SESSION_END_ORDER_SOURCE_POINT, tenantCtx(tenantId), sessionEndOrderSourceLoaders, (source) => source.ordersFor(sub),
      );
      for (const f of out.failed) fallBack(1, `order source ${f.moduleId} failed for tenant ${tenantId} (${f.reason}: ${f.message})`);
      answers = out.results.map((r) => ({ moduleId: r.contribution.moduleId, value: r.value }));
    } catch (err) {
      // the point could not be read at all: no contribution is in the transaction, every after-commit hook runs as before
      fallBack(1, `order sources could not be asked for tenant ${tenantId}: ${errText(err)}`);
      continue;
    }
    const inputs: SessionEndOrderInput[] = [];
    const by: string[] = [];
    for (const a of answers) {
      const problem = answerProblem(a.value, tenantId);
      if (problem) {
        fallBack(1, `order source ${a.moduleId} answered ${problem} for tenant ${tenantId}`);
        continue;
      }
      inputs.push(...(a.value as SessionEndOrderInput[]));
      by.push(a.moduleId);
    }
    if (by.length === 0) continue;
    try {
      recorded.push(...await recordOrdersInTx(qr, inputs));
      ordered.set(tenantId, by);
    } catch (err) {
      if (err instanceof HostTransactionBroken) throw err;
      fallBack(by.length, `${inputs.length} order(s) of ${by.join(', ')} not recorded for tenant ${tenantId}: ${errText(err)}`);
    }
  }
  counts.recorded += recorded.length;
  return {
    orderedBy: (tenantId) => [...(ordered.get(tenantId) ?? [])],
    recorded: recorded.length,
    fallbacks,
    async afterCommit(o = {}) {
      if (recorded.length === 0) return;
      try {
        await deliverRecorded(recorded, o);
      } catch (err) {
        // deliverRecorded never throws; belt and braces, a request is never failed here (the relay has the rows)
        Logger.warn(`[session_end] ${cause.type}: fast path failed, the relay delivers: ${errText(err)}`);
      }
    },
  };
}
