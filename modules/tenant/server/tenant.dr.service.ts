import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant as TenantEntity } from './entities/tenant.entity';
import { clearCache } from './tenant.helpers';
import { recordLifecycle } from './tenant.extension-points';
import { FENCEABLE_STATUSES } from './tenant.migration.service';

/**
 * A node taking tenants over in disaster recovery (decision F1, 07 section 6.1), run by the node app when its agent executes a verified class-3
 * `node.failover` / `node.failback` or a regional-operator failover order, after the database is promoted:
 *  - DR_FAILOVER (on the paired DR_STANDBY, whose database is the failed primary's replica): every tenant homed on the failed primary becomes homed
 *    HERE, one assignment version higher, unfenced, and stamped with the primary it came from (`drTakenFromNodeId`);
 *  - DR_FAILBACK (on the primary, its database resynced from the standby): exactly the tenants homed on the standby AND stamped with THIS node's id
 *    come back, one version higher, stamped with the standby. A tenant the standby holds for any other reason is never taken.
 * Platform tenants, deleted rows and tenants in a migration or deletion state are never touched. Each tenant taken (and each one already taken by an
 * earlier run of the same takeover) gets a lifecycle receipt, so a retried takeover re-sends what a lost receipt never delivered; the directory treats
 * a repeat from the node that already is the home as evidence. The directory alone decides whether the home moves (`fleet_directory.dr.ts`): until
 * it accepts, the old home is not fenced, and a refused receipt leaves both nodes believing they hold the tenant, which the alert and the drill catch.
 */
export type DrTakeoverType = 'DR_FAILOVER' | 'DR_FAILBACK';

export interface DrTakeoverInput {
  type: DrTakeoverType;
  selfNodeId: string;
  /** The node the tenants come from: the failed primary (failover) or the standby (failback). */
  fromNodeId: string;
  /** The verified command that caused it (the normal path). */
  commandJti?: string;
  /** The regional-operator order that caused it (failover only, the fallback path): forwarded in each receipt. */
  failoverOrder?: Record<string, unknown>;
  now?: Date;
}

export interface DrTakeoverResult { moved: number; already: number }

const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function takeOverTenantsForDr(i: DrTakeoverInput): Promise<DrTakeoverResult> {
  if (!NODE_ID.test(i.selfNodeId) || !NODE_ID.test(i.fromNodeId) || i.selfNodeId === i.fromNodeId) throw new Error('takeOverTenantsForDr: bad node ids');
  if (!!i.commandJti === !!i.failoverOrder) throw new Error('takeOverTenantsForDr: exactly one authority (a command or a regional order)');
  if (i.type === 'DR_FAILBACK' && i.failoverOrder) throw new Error('takeOverTenantsForDr: a failback has no regional path');
  const now = i.now ?? new Date();
  const taken = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantEntity);
    const candidates = await repo.find({
      where: [{ homeNodeId: i.fromNodeId, deletedAt: IsNull() }, { homeNodeId: i.selfNodeId, deletedAt: IsNull() }],
      select: { tenantId: true, tenantStatus: true, homeNodeId: true, assignmentVersion: true, drTakenFromNodeId: true },
      order: { tenantId: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const out: { tenantId: string; assignmentVersion: number; moved: boolean }[] = [];
    for (const t of candidates) {
      if (isReservedTenant(t.tenantId) || !(FENCEABLE_STATUSES as readonly string[]).includes(t.tenantStatus)) continue;
      const stampOk = i.type === 'DR_FAILOVER' ? true : t.drTakenFromNodeId === i.selfNodeId;
      if (t.homeNodeId === i.fromNodeId && stampOk) {
        const assignmentVersion = t.assignmentVersion + 1;
        await repo.update({ tenantId: t.tenantId }, { homeNodeId: i.selfNodeId, assignmentVersion, fencedAt: null, drTakenFromNodeId: i.fromNodeId });
        out.push({ tenantId: t.tenantId, assignmentVersion, moved: true });
      } else if (t.homeNodeId === i.selfNodeId && t.drTakenFromNodeId === i.fromNodeId) {
        // taken by an earlier run of the same takeover: its receipt is sent again below (a lost delivery must not strand the tenant)
        out.push({ tenantId: t.tenantId, assignmentVersion: t.assignmentVersion, moved: false });
      }
    }
    return out;
  });
  for (const t of taken) {
    if (t.moved) await clearCache(t.tenantId);
    await recordLifecycle({
      tenantId: t.tenantId, type: i.type, occurredAt: now,
      payload: { assignmentVersion: t.assignmentVersion, ...(i.commandJti ? { commandJti: i.commandJti } : {}), ...(i.failoverOrder ? { failoverOrder: i.failoverOrder } : {}) },
    });
  }
  // a tenant fenced here before (a returning primary taking its tenants back) must stop being read-only at once
  if (taken.some((t) => t.moved)) await import('@kuraykaraaslan-labs/db/server/db.write-fence').then((m) => m.refreshWriteFence()).catch(() => {});
  return { moved: taken.filter((t) => t.moved).length, already: taken.filter((t) => !t.moved).length };
}
