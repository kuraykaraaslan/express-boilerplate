import { NextResponse } from 'next/server';
import { getDataSource, getSystemDataSource } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import { Queue } from 'bullmq';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';

type CheckStatus = 'ok' | 'error';

interface ServiceCheck {
  status: CheckStatus;
  latencyMs: number;
  message?: string;
}

interface QueueCheck {
  status: CheckStatus;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  message?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    system_db: ServiceCheck;
    tenant_db: ServiceCheck;
    redis: ServiceCheck;
    queues: Record<string, QueueCheck>;
  };
}

/**
 * observability.02: the route is public, so a failing check answers a fixed word; the driver text (hosts, ports, roles)
 * goes to the server log only.
 */
function unavailable(what: string, e: unknown): string {
  Logger.warn(`[health] ${what} check failed: ${e instanceof Error ? e.message : String(e)}`);
  return 'unavailable';
}

// `getSystemDataSource()` bypasses RLS (cross-tenant cron/migrations); the
// admin UI reports it separately from the regular tenant-scoped connection
// so an RLS-bypass-only outage doesn't get folded into "the database is fine".
async function checkSystemDb(): Promise<ServiceCheck> {
  const t0 = Date.now();
  try {
    const ds = await getSystemDataSource();
    await ds.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { status: 'error', latencyMs: Date.now() - t0, message: unavailable('db', e) };
  }
}

async function checkTenantDb(): Promise<ServiceCheck> {
  const t0 = Date.now();
  try {
    const ds = await getDataSource();
    await ds.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { status: 'error', latencyMs: Date.now() - t0, message: unavailable('db', e) };
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  const t0 = Date.now();
  try {
    await redis.ping();
    return { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { status: 'error', latencyMs: Date.now() - t0, message: unavailable('db', e) };
  }
}

async function checkQueue(name: string): Promise<QueueCheck> {
  // Closed in `finally`: this runs on every probe, and a Queue left open when `getJobCounts` throws (Redis down is exactly
  // when probes fail) keeps its listeners and timers alive, one more per probe.
  const q = new Queue(name, { connection: getBullMQConnection() });
  try {
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      status: 'ok',
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  } catch (e: any) {
    return { status: 'error', waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, message: unavailable(`queue ${name}`, e) };
  } finally {
    try { await q.close(); } catch { /* the probe result stands */ }
  }
}

const QUEUE_NAMES = ['mailQueue', 'webhookDeliveryQueue', 'systemWebhookDeliveryQueue', 'subscription-expire'];

/**
 * observability.02: the public probe answers from a short cache, so a flood of anonymous calls costs one round of checks
 * (three DB / Redis queries and four queue connections) per window instead of one per call. Concurrent callers share the
 * round in progress.
 */
const HEALTH_CACHE_MS = 5_000;
let cached: { at: number; result: Promise<{ body: HealthResponse; status: number }> } | null = null;

/** Test seam: forget the cached answer. */
export function resetHealthCacheForTests(): void { cached = null; }

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at >= HEALTH_CACHE_MS) {
    const result = computeHealth();
    cached = { at: now, result };
    result.catch(() => { if (cached?.result === result) cached = null; });
  }
  const { body, status } = await cached.result;
  return NextResponse.json(body, { status });
}

async function computeHealth(): Promise<{ body: HealthResponse; status: number }> {
  const [systemDb, tenantDb, redisCheck, ...queueChecks] = await Promise.all([
    checkSystemDb(),
    checkTenantDb(),
    checkRedis(),
    ...QUEUE_NAMES.map(checkQueue),
  ]);

  const queues: Record<string, QueueCheck> = {};
  QUEUE_NAMES.forEach((name, i) => { queues[name] = queueChecks[i]; });

  const coreOk = systemDb.status === 'ok' && tenantDb.status === 'ok' && redisCheck.status === 'ok';
  const queuesOk = Object.values(queues).every((q) => q.status === 'ok');

  const overallStatus: HealthResponse['status'] = coreOk
    ? (queuesOk ? 'healthy' : 'degraded')
    : 'unhealthy';

  const body: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    checks: {
      system_db: systemDb,
      tenant_db: tenantDb,
      redis: redisCheck,
      queues,
    },
  };

  return { body, status: overallStatus === 'unhealthy' ? 503 : 200 };
}
