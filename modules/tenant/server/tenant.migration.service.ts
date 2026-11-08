import 'reflect-metadata';
import { IsNull, type QueryRunner } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant as TenantEntity } from './entities/tenant.entity';
import { clearCache } from './tenant.helpers';
import { deliverTenantCacheDrop, recordTenantCacheDrop } from './tenant.cache-drop';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';
import { announceSuspension } from './tenant.extension-points';

/**
 * The fleet migration's moves of a tenant's status on its node (docs/phases/02-fleet/05 section 6.2): the ONLY way into and out of the contract statuses,
 * which `update` refuses. Called by the node's migration steps (`fleet_agent`), never by a route.
 *
 * They run in the system context, not the tenant's: a MIGRATING tenant's own transactions are opened read only by the write fence (`db.write-fence.ts`),
 * which is the point of the freeze, so the move back out could not run there. Nothing here writes the tenant's audit chain: a row written after the export's
 * snapshot would be lost with the move; the node's command receipts record the steps instead.
 */

/** What a migration export may freeze (05 section 6.1: a live tenant; a suspended one moves too and stays suspended). */
export const FREEZABLE_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type FreezableStatus = (typeof FREEZABLE_STATUSES)[number];

export type FreezeResult =
  | { ok: true; /** The status it was frozen from; null when it was MIGRATING already (a retried export). */ prior: FreezableStatus | null }
  | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'LEGAL_HOLD' };

/**
 * ACTIVE or SUSPENDED -> MIGRATING (the write fence then refuses its writes everywhere). A tenant under a legal hold is never frozen for a move.
 * `record` runs in the SAME transaction once the tenant is frozen (not on a repeat): the caller writes what an abort needs (the status it was frozen
 * from), so a tenant is never left frozen without that record. A `record` that throws leaves the tenant as it was.
 */
export async function freezeForMigration(
  tenantId: string, now: Date = new Date(), record?: (qr: QueryRunner, prior: FreezableStatus) => Promise<void>,
): Promise<FreezeResult> {
  if (isReservedTenant(tenantId)) return { ok: false, reason: 'WRONG_STATE' };
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr): Promise<FreezeResult> => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return { ok: false, reason: 'NOT_FOUND' };
    if (t.tenantStatus === 'MIGRATING') return { ok: true, prior: null };
    if (!(FREEZABLE_STATUSES as readonly string[]).includes(t.tenantStatus)) return { ok: false, reason: 'WRONG_STATE' };
    // a fenced old home (decision F1) holds stale rows: they are never exported as the tenant
    if (t.fencedAt) return { ok: false, reason: 'WRONG_STATE' };
    if (t.legalHoldUntil && t.legalHoldUntil > now) return { ok: false, reason: 'LEGAL_HOLD' };
    await repo.update({ tenantId }, { tenantStatus: 'MIGRATING' });
    drops = await recordTenantCacheDrop(qr, tenantId);
    await record?.(qr, t.tenantStatus as FreezableStatus);
    return { ok: true, prior: t.tenantStatus as FreezableStatus };
  });
  if (r.ok && r.prior) await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  return r;
}

/**
 * Ends a freeze that did not lead to a move (an abort before the cutover): back to the status it was frozen from. A tenant frozen from
 * SUSPENDED served its members while MIGRATING (only the write fence applied), so going back into SUSPENDED is announced like any other
 * move into it (`tenant:suspension`): the sessions and sockets opened during the freeze end, and the websocket fence is raised again.
 */
export async function unfreezeAfterMigration(tenantId: string, to: FreezableStatus): Promise<'UNFROZEN' | 'NOT_FROZEN' | 'NOT_FOUND'> {
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return 'NOT_FOUND' as const;
    if (t.tenantStatus !== 'MIGRATING') return 'NOT_FROZEN' as const;
    await repo.update({ tenantId }, { tenantStatus: to });
    drops = await recordTenantCacheDrop(qr, tenantId);
    return 'UNFROZEN' as const;
  });
  if (r === 'UNFROZEN') await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  if (r === 'UNFROZEN' && to === 'SUSPENDED') await announceSuspension({ tenantId, suspended: true });
  return r;
}

/**
 * The TARGET's side once a migrated tenant's rows are in and verified (05 section 6.2 IMPORTING / VERIFYING): the imported row still says MIGRATING (it
 * is the source's row, byte for byte, which is what the verification compared); it becomes IMPORTING, still fenced and not routable here (its home is
 * still the source) until the cutover makes it live.
 */
export async function markImported(tenantId: string): Promise<'MARKED' | 'ALREADY' | 'NOT_FOUND' | 'WRONG_STATE'> {
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return 'NOT_FOUND' as const;
    if (t.tenantStatus === 'IMPORTING') return 'ALREADY' as const;
    if (t.tenantStatus !== 'MIGRATING') return 'WRONG_STATE' as const;
    await repo.update({ tenantId }, { tenantStatus: 'IMPORTING' });
    drops = await recordTenantCacheDrop(qr, tenantId);
    return 'MARKED' as const;
  });
  if (r === 'MARKED') await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  return r;
}

/** The status of the tenant row with this id on this node, soft-deleted rows included (an id is never reused), or null when there is none. */
export async function tenantStatusForMigration(tenantId: string): Promise<string | null> {
  return withSystemRLS(async (qr) => (await qr.manager.getRepository(TenantEntity).findOne({ where: { tenantId }, withDeleted: true, select: { tenantId: true, tenantStatus: true } }))?.tenantStatus ?? null);
}

/**
 * The TARGET's cutover (05 section 6.2 CUTOVER): the imported tenant leaves IMPORTING and lives here, with the status it has in the directory (a suspended
 * tenant stays suspended), at the directory's next assignment version in this node's region. Repeating it with the same version is a no-op.
 */
export async function goLiveAfterImport(
  tenantId: string, live: { status: FreezableStatus; homeNodeId: string; homeRegionId: string; assignmentVersion: number },
): Promise<'LIVE' | 'ALREADY' | 'NOT_FOUND' | 'WRONG_STATE'> {
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return 'NOT_FOUND' as const;
    if (t.tenantStatus === live.status && t.homeNodeId === live.homeNodeId && t.assignmentVersion === live.assignmentVersion && !t.fencedAt) return 'ALREADY' as const;
    if (t.tenantStatus !== 'IMPORTING') return 'WRONG_STATE' as const;
    // the signed cutover is the only way out of a fence (a failback onto the old home, decision F1)
    await repo.update({ tenantId }, { tenantStatus: live.status, homeNodeId: live.homeNodeId, homeRegionId: live.homeRegionId, assignmentVersion: live.assignmentVersion, fencedAt: null });
    drops = await recordTenantCacheDrop(qr, tenantId);
    return 'LIVE' as const;
  });
  if (r === 'LIVE') await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  // A tenant that lands here suspended is announced like any move into SUSPENDED: no imported session or pre-minted ticket outlives it.
  if (r === 'LIVE' && live.status === 'SUSPENDED') await announceSuspension({ tenantId, suspended: true });
  return r;
}

/**
 * The SOURCE's cutover: the frozen tenant becomes a tombstone (RELOCATED) pointing at its new home until `tombstoneUntil`; routing then redirects its
 * strays there (`proxy/fleet-home.ts`). Its rows stay, frozen in effect, for the source's retention. Repeating it is a no-op.
 */
export async function relocateAfterMigration(
  tenantId: string, to: { nodeId: string; baseUrl: string; at: Date; tombstoneUntil: Date },
): Promise<'RELOCATED' | 'ALREADY' | 'NOT_FOUND' | 'WRONG_STATE'> {
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return 'NOT_FOUND' as const;
    if (t.tenantStatus === 'RELOCATED' && t.relocatedToNodeId === to.nodeId) return 'ALREADY' as const;
    if (t.tenantStatus !== 'MIGRATING') return 'WRONG_STATE' as const;
    await repo.update({ tenantId }, { tenantStatus: 'RELOCATED', relocatedToNodeId: to.nodeId, relocatedToBaseUrl: to.baseUrl, relocatedAt: to.at, tombstoneUntil: to.tombstoneUntil });
    drops = await recordTenantCacheDrop(qr, tenantId);
    return 'RELOCATED' as const;
  });
  if (r === 'RELOCATED') await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  return r;
}

/**
 * Where a tombstoned tenant moved to (its `relocatedToNodeId` while RELOCATED), or null. A migration bringing the tenant back FROM that node is its
 * rollback (05 section 6.2 ROLLED_BACK): the frozen rows kept here since the move are stale then, and are replaced by the returning bundle.
 */
export async function relocatedToOf(tenantId: string): Promise<string | null> {
  return withSystemRLS(async (qr) => {
    const t = await qr.manager.getRepository(TenantEntity).findOne({ where: { tenantId }, select: { tenantId: true, tenantStatus: true, relocatedToNodeId: true } });
    return t?.tenantStatus === 'RELOCATED' ? t.relocatedToNodeId ?? null : null;
  });
}

/** The node statuses a directory move fences (the migration and deletion states are decided by their own signed flows). */
export const FENCEABLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING'] as const;

/**
 * The FENCING of an old home (decision F1): the directory homes this tenant on another node at a higher assignment version (a disaster-recovery failover
 * while this node was away, or any move it missed), so this node records that home and version and stamps `fencedAt`. From then on the old home is
 * read-only for every writer, not only HTTP:
 *  - the write fence (`db.write-fence.ts`) opens every tenant-scoped transaction of a stamped tenant READ ONLY, whatever its status, so cron and boot
 *    tasks, queue workers and in-app executors fail in PostgreSQL itself (refreshed here at once, in other processes within `FENCE_REFRESH_MS`);
 *  - routing refuses the tenant (`tenant.fleet-route.ts`: FENCED, 409); its reads are the new home's to serve, this node's copy is stale;
 *  - what is still open ends like on a suspension (`tenant:suspension`): its sessions are revoked and its live sockets dropped behind the socket fence.
 * The tenant's own rows stay, untouched, for the failback's resync (a session row is not the tenant's data: it is revoked). Only ever restricts: a
 * tenant this node does not consider its own, a lower or equal version, or a tenant in a migration or deletion state is left alone. Repeating it is a
 * no-op.
 */
export async function fenceAfterDirectoryMove(
  tenantId: string, selfNodeId: string, to: { homeNodeId: string; assignmentVersion: number }, now: Date = new Date(),
): Promise<'FENCED' | 'ALREADY' | 'NOT_FOUND' | 'WRONG_STATE'> {
  // the platform tenants live on every node: no entry ever fences one
  if (isReservedTenant(tenantId)) return 'WRONG_STATE';
  let drops: RecordedSessionEndOrder[] = [];
  const r = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return 'NOT_FOUND' as const;
    if (t.homeNodeId === to.homeNodeId && t.assignmentVersion >= to.assignmentVersion) return 'ALREADY' as const;
    if (to.homeNodeId === selfNodeId || t.homeNodeId !== selfNodeId || t.assignmentVersion >= to.assignmentVersion) return 'WRONG_STATE' as const;
    if (!(FENCEABLE_STATUSES as readonly string[]).includes(t.tenantStatus)) return 'WRONG_STATE' as const;
    await repo.update({ tenantId }, { homeNodeId: to.homeNodeId, assignmentVersion: to.assignmentVersion, fencedAt: now });
    drops = await recordTenantCacheDrop(qr, tenantId);
    return 'FENCED' as const;
  });
  if (r !== 'FENCED') return r;
  await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  // this process stops writing at once; a failed reload is retried by the next check (the database refuses nothing yet, routing already does)
  await import('@kuraykaraaslan-labs/db/server/db.write-fence').then((m) => m.refreshWriteFence()).catch(() => {});
  await announceSuspension({ tenantId, suspended: true });
  return r;
}
