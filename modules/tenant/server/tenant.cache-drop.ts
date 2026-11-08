import type { QueryRunner } from 'typeorm';
import { cacheDropOrders } from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { deliverRecorded, recordOrders } from '@kuraykaraaslan-labs/session_end/server/session_end.orders';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';

/**
 * The tenant profile cache under the D253 rule (D270, docs/audits/2026-11-03-redis-outage.md §6.10 "Not covered"): the cached tenant
 * row (`tenant:id:<tenant>`, `getById`) is what an API key's standing check reads for the tenant's status (S15: a key of a suspended,
 * deleted or moving workspace is refused), and the device and session paths read the same entry. A change of the status takes effect
 * at once, also during and after a Redis outage:
 *
 *   - every write that moves the status (or removes the row) records a cache drop in its own transaction: DEL the profile and the fleet
 *     routing row, INCR the tenant's profile version `tenant:ver:<tenant>` (session_end's outbox; delivered after the commit, else by
 *     the relay);
 *   - `getById` believes an entry only when it is sealed with the stamp of its read (the Redis instance + that version, read before the
 *     database read that filled it) and no drop is pending for the tenant (`session_end.cache-guard.ts`).
 */

export function tenantProfileKey(tenantId: string): string {
  return `tenant:id:${tenantId}`;
}

/** The fleet routing row (`tenant.fleet-route.ts`), dropped with the profile as `clearCache` does. */
const routeKey = (tenantId: string) => `tenant:route:${tenantId}`;

export function tenantProfileVersionKey(tenantId: string): string {
  return `tenant:ver:${tenantId}`;
}

/** The order of a status write of `tenantId`. Pure. */
export function tenantDropOrders(tenantId: string) {
  return cacheDropOrders(tenantId, 'tenant.cache_drop', [{ del: [tenantProfileKey(tenantId), routeKey(tenantId)], bump: [tenantProfileVersionKey(tenantId)] }]);
}

/** Records the drop in the write's transaction (throws when it cannot: the write rolls back). */
export function recordTenantCacheDrop(qr: QueryRunner | undefined, tenantId: string): Promise<RecordedSessionEndOrder[]> {
  return recordOrders(tenantDropOrders(tenantId), { qr });
}

/** After the commit: the fast path (a failure is left to the relay, never fails the write). */
export async function deliverTenantCacheDrop(drops: readonly RecordedSessionEndOrder[]): Promise<void> {
  if (drops.length) await deliverRecorded(drops);
}
