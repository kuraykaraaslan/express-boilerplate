import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { STALE_AFTER_MS } from './session_end.contract';
import { orderStats, type OrderStats } from './session_end.orders';

/**
 * `session_end`'s contribution to `observability:alert-source`: the session-ending outbox is behind, platform-wide, listed for the
 * ROOT tenant only (every other tenant gets an empty list), one alert per condition (the `iot_telemetry` precedent):
 *
 *  - `session-end-orders-stale` (MAJOR, opens an incident under the default policy): an order older than a minute is still not in
 *    Redis, so a deleted device or a revoked session may still be connected.
 *  - `session-end-orders-dead` (CRITICAL): the relay gave up on an order (dead letter): an operator must look at it.
 *
 * Labels: `category=security`, `component=session_end`; never a tenant. A count that cannot be read throws: "could not look" leaves the
 * open alerts as they are, it is never "all clear".
 */

type Severity = 'INFO' | 'WARNING' | 'MINOR' | 'MAJOR' | 'CRITICAL';
export interface SessionEndAlertSpec { key: string; title: string; severity: Severity; labels: Record<string, string>; annotations: Record<string, string> }

/** What the counts make fire. Pure. */
export function firingOf(s: OrderStats): SessionEndAlertSpec[] {
  const out: SessionEndAlertSpec[] = [];
  const labels = { category: 'security', component: 'session_end' };
  if (s.oldestPendingMs !== null && s.oldestPendingMs > STALE_AFTER_MS) {
    out.push({
      key: 'session-end-orders-stale', title: 'Session-ending orders are not reaching Redis (sessions that should have ended may be open)', severity: 'MAJOR',
      labels, annotations: { pending: String(s.pending), oldestSeconds: String(Math.round(s.oldestPendingMs / 1000)) },
    });
  }
  if (s.dead > 0) {
    out.push({
      key: 'session-end-orders-dead', title: 'Session-ending orders were given up (dead letters in session_end_orders)', severity: 'CRITICAL',
      labels, annotations: { dead: String(s.dead) },
    });
  }
  return out;
}

const provider = {
  async listFiring(tenantId: string): Promise<SessionEndAlertSpec[]> {
    if (!isRootTenant(tenantId)) return [];
    return firingOf(await orderStats());
  },
};

export default provider;
