import Logger from '@kuraykaraaslan-labs/logger';
import { registerDrainHook, registerHealthCheck, registerMetricSource, type MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { RELAY_EVERY_MS, STALE_AFTER_MS } from './session_end.contract';
import { orderStats, relayOrders, type RelayReport } from './session_end.orders';
import { inTxCounts } from './session_end.in-tx';

/**
 * The relay of the session-ending outbox (docs/audits/2026-11-03-redis-outage.md §3): a timer every `RELAY_EVERY_MS` in every process
 * that runs background jobs (`common:boot_task`, phase `scheduler`, `parallel`: the rows are locked `SKIP LOCKED`, so several relays
 * share the work and none takes a row twice). A timer rather than a BullMQ repeat job: BullMQ lives in Redis, and the relay is what
 * must keep trying while Redis is gone and start delivering the moment it is back (a repeat job is also lost with a Redis that lost
 * its data). Deployments without background jobs call the HTTP twin (`cron-session-end-relay.route.ts`) every minute.
 *
 * Each pass takes up to 10 batches while they come back full. Once a minute it reads the counts: the gauges, the process health
 * (`degraded` with a pending row older than a minute or a dead letter) and an error log line say what the alert
 * (`session_end.alert-source.ts`) says.
 */

const MAX_BATCHES_PER_PASS = 10;
const STATS_EVERY_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let lastStats: { at: number; pending: number; dead: number; oldestPendingMs: number | null } | null = null;
let redisDownSince: number | null = null;

/** One relay pass: batches while they come back full. Exported for the HTTP twin and the tests. */
export async function relayPass(o: Parameters<typeof relayOrders>[0] = {}): Promise<RelayReport> {
  const total: RelayReport = { redisDown: false, delivered: 0, failed: 0, dead: 0, more: false };
  for (let i = 0; i < MAX_BATCHES_PER_PASS; i += 1) {
    const r = await relayOrders(o);
    total.redisDown = r.redisDown;
    total.delivered += r.delivered;
    total.failed += r.failed;
    total.dead += r.dead;
    total.more = r.more;
    if (!r.more) break;
  }
  return total;
}

async function readStats(now: number): Promise<void> {
  try {
    const s = await orderStats(new Date(now));
    lastStats = { at: now, ...s };
    if (s.oldestPendingMs !== null && s.oldestPendingMs > STALE_AFTER_MS) {
      Logger.error(`[session_end] ${s.pending} session-ending order(s) pending, the oldest for ${Math.round(s.oldestPendingMs / 1000)} s: sessions that should have ended may still be open`);
    }
    if (s.dead > 0) Logger.error(`[session_end] ${s.dead} session-ending order(s) dead-lettered: an operator must look (table session_end_orders, "deadAt" set)`);
  } catch (err) {
    Logger.warn(`[session_end] order counts unreadable: ${(err as Error).message}`);
  }
}

async function tick(): Promise<void> {
  const now = Date.now();
  try {
    const r = await relayPass();
    if (r.redisDown) {
      if (redisDownSince === null) {
        redisDownSince = now;
        Logger.warn('[session_end] Redis does not answer: session-ending orders wait in the outbox and are relayed once it is back');
      }
    } else {
      if (redisDownSince !== null) Logger.info(`[session_end] Redis answers again after ${Math.round((now - redisDownSince) / 1000)} s: relaying`);
      redisDownSince = null;
    }
    if (r.delivered || r.failed || r.dead) Logger.info(`[session_end] relay: delivered=${r.delivered} failed=${r.failed} dead=${r.dead}`);
  } catch (err) {
    Logger.warn(`[session_end] relay pass failed (database): ${(err as Error).message}`);
  }
  if (!lastStats || now - lastStats.at >= STATS_EVERY_MS) await readStats(now);
}

/** Bounded label sets only (the state), never a tenant. */
export const SESSION_END_METRIC_SOURCES: MetricSource[] = [
  {
    name: 'session_end_orders', help: 'Session-ending orders in the outbox, by state (pending: not yet in Redis; dead: given up)', labelNames: ['state'],
    async read() {
      const s = await orderStats();
      return [{ labels: { state: 'pending' }, value: s.pending }, { labels: { state: 'dead' }, value: s.dead }];
    },
  },
  {
    name: 'session_end_orders_oldest_pending_seconds', help: 'Age of the oldest session-ending order not yet in Redis (0 when none)', labelNames: [],
    async read() {
      const s = await orderStats();
      return [{ labels: {}, value: s.oldestPendingMs === null ? 0 : s.oldestPendingMs / 1000 }];
    },
  },
  {
    // D249: orders recorded inside the host's transaction, and order-source contributions left to their after-commit path
    name: 'session_end_in_tx_total', help: 'Session-ending orders asked inside the causing transaction since the process started (recorded: orders written with the change; fallback: contributions left to the after-commit path)', labelNames: ['outcome'],
    async read() {
      const c = inTxCounts();
      return [{ labels: { outcome: 'recorded' }, value: c.recorded }, { labels: { outcome: 'fallback' }, value: c.fallback }];
    },
  },
];

/** `common:boot_task` (scheduler, parallel): starts the relay timer, its metrics and its health check. Idempotent. */
export async function startSessionEndRelay(): Promise<void> {
  if (timer) return;
  for (const s of SESSION_END_METRIC_SOURCES) registerMetricSource(s);
  // the Next process's /internal/api/metrics registry, when observability is installed (optional)
  await import('@kuraykaraaslan-labs/observability/server/metrics')
    .then((m) => { for (const s of SESSION_END_METRIC_SOURCES) m.registerGaugeSource(s); })
    .catch(() => { /* observability not installed: the process_host registry carries them */ });
  registerHealthCheck('session_end', () => {
    if (!lastStats) return { status: 'ok' };
    if (lastStats.dead > 0) return { status: 'degraded', detail: `${lastStats.dead} dead-lettered session-ending order(s)` };
    if (lastStats.oldestPendingMs !== null && lastStats.oldestPendingMs > STALE_AFTER_MS) {
      return { status: 'degraded', detail: `session-ending orders pending for ${Math.round(lastStats.oldestPendingMs / 1000)} s` };
    }
    return { status: 'ok' };
  });
  timer = setInterval(() => {
    if (running) return;
    running = tick().finally(() => { running = null; });
  }, RELAY_EVERY_MS);
  timer.unref?.();
  registerDrainHook('session_end:relay', async () => {
    if (timer) clearInterval(timer);
    timer = null;
    await running;
  });
  Logger.info(`[session_end] relay started (every ${RELAY_EVERY_MS / 1000} s)`);
}

/** Test seam. */
export function stopSessionEndRelay(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastStats = null;
  redisDownSince = null;
}
