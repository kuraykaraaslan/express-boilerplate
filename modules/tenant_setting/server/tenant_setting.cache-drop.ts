import type { QueryRunner } from 'typeorm';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';
import { getCacheKey, getModulesEnabledCacheKey, writeTouchesModules } from './tenant_setting.cache';
import { settingsGenerationKey } from './tenant_setting.generation';

// session_end is an OPTIONAL edge (it requires common, which reaches tenant_setting through tenant_branding and storage: a `requires` would
// be a cycle), loaded on first write. A build without it has no guarded reader either (auth_abac requires session_end), so a write there
// keeps the best-effort invalidation alone; with it, a drop that cannot be recorded fails the write.
async function loadOutbox(): Promise<{
  cacheDropOrders: typeof import('@kuraykaraaslan-labs/session_end/server/session_end.cache-guard').cacheDropOrders
  recordOrders: typeof import('@kuraykaraaslan-labs/session_end/server/session_end.orders').recordOrders
  deliverRecorded: typeof import('@kuraykaraaslan-labs/session_end/server/session_end.orders').deliverRecorded
} | null> {
  let guard: typeof import('@kuraykaraaslan-labs/session_end/server/session_end.cache-guard')
  let orders: typeof import('@kuraykaraaslan-labs/session_end/server/session_end.orders')
  try {
    [guard, orders] = await Promise.all([
      import('@kuraykaraaslan-labs/session_end/server/session_end.cache-guard'),
      import('@kuraykaraaslan-labs/session_end/server/session_end.orders'),
    ]);
  } catch (err) {
    // only a module missing from this build is a quiet "not here" (the optional-module rule of EXT-14); anything else fails the write
    const code = (err as { code?: string } | null)?.code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return null;
    throw err;
  }
  return { cacheDropOrders: guard.cacheDropOrders, recordOrders: orders.recordOrders, deliverRecorded: orders.deliverRecorded };
}

/**
 * The durable cache drop of a setting write (D270, docs/audits/2026-11-03-redis-outage.md §6.10 "Not covered"): every write of a
 * tenant's setting rows records, in its own transaction, a session_end cache-drop order (`session_end.cache-guard.ts`) that deletes
 * the tenant's map (and its resolved module set when a module switch was written) and bumps the tenant's settings GENERATION
 * (`settings:<tenant>:gen`). The writer delivers it right after the commit; what Redis did not take, the session_end relay delivers.
 *
 * The generation is what a guarded cache built FROM settings seals its entries with (today: auth_abac's runtime settings, shadow mode
 * and the decision log, `auth_abac.settings.service.ts`): a write retires every such entry of the tenant on every node at once, and a
 * reader believes none while the drop is pending. A ROOT write bumps ROOT's generation, which every tenant's guarded entry also carries
 * (ROOT's values are every tenant's defaults and its shadow-mode switch is the platform's).
 *
 * The map itself (`settings:<tenant>:all`) stays a plain cache with its 120-s TTL and refill fence: the drop makes its invalidation
 * durable (deleted when Redis is back), the guard is for what an access decision reads.
 */

export { settingsGenerationKey };

/** What a write of `keys` for `tenantId` drops. Pure. The legacy per-key entries stay with the best-effort `invalidateWrite`. */
export function settingsDrop(tenantId: string, keys: readonly string[]): { del: string[]; bump: string[] } {
  return { del: [getCacheKey(tenantId), ...(writeTouchesModules(keys) ? [getModulesEnabledCacheKey(tenantId)] : [])], bump: [settingsGenerationKey(tenantId)] };
}

/** The order(s) of a write of `keys` for `tenantId` (null without session_end in the build). */
export async function settingsDropOrders(tenantId: string, keys: readonly string[]) {
  const outbox = await loadOutbox();
  return outbox ? outbox.cacheDropOrders(tenantId, 'tenant_setting.cache_drop', [settingsDrop(tenantId, keys)]) : null;
}

/**
 * Records the drop of a write of `keys` in the write's transaction (`qr`, the query runner the write's repository runs on). Throws when
 * it cannot be recorded: the write rolls back. Without a transaction the order commits on its own first (session_end's rule).
 */
export async function recordSettingsDrop(qr: QueryRunner | undefined, tenantId: string, keys: readonly string[]): Promise<RecordedSessionEndOrder[]> {
  const outbox = await loadOutbox();
  if (!outbox) return [];
  return outbox.recordOrders(outbox.cacheDropOrders(tenantId, 'tenant_setting.cache_drop', [settingsDrop(tenantId, keys)]), { qr });
}

/** After the write's commit: delivers the drop (the fast path; the relay has it otherwise, and a failure never fails the write). */
export async function deliverSettingsDrop(drops: readonly RecordedSessionEndOrder[]): Promise<void> {
  if (drops.length) await (await loadOutbox())?.deliverRecorded(drops);
}
