import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { accessRel } from '@kuraykaraaslan-labs/db/server/db.time-series.rollup';
import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { ACTIONS_TABLE, EVENTS_TABLE, INCIDENTS_TABLE } from './store/ai_firewall.store';
import { BASELINES_TABLE } from './features/ai_firewall.baseline.store';
import { LABELS_TABLE } from './labels/ai_firewall.label-store';
import { MODEL_STATES_TABLE } from './promotion/ai_firewall.promotion-store';

/**
 * `tenant:purge_step`: every row of the purged tenant in the firewall's store (docs/phases/55-ai-firewall/01 §1.7) and its feature
 * store's baselines (02 §2.1), its labels (03 §3.1) and the tree models' promotion states (04.7, ROOT's only), in the tenant's own
 * scope (RLS applies; the events through the time-series access view, which the app role is the only way to reach in Timescale mode).
 * A purge is rare and the cascade runs it detached, so one statement per table is enough.
 */
export interface PurgeDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
}

const defaultDeps: PurgeDeps = { inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)), accessRel };

export async function purgeTenantStore(tenantId: string, deps: PurgeDeps = defaultDeps): Promise<void> {
  await deps.inTenant(tenantId, async (db) => {
    await db.query(`DELETE FROM ${await deps.accessRel(db, EVENTS_TABLE)} WHERE "tenantId" = $1`, [tenantId]);
    await db.query(`DELETE FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    await db.query(`DELETE FROM "${ACTIONS_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    await db.query(`DELETE FROM "${BASELINES_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    await db.query(`DELETE FROM "${LABELS_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    // 04.7: the tree models' promotion states live under the ROOT tenant only; deleted with it like every other row of the store
    await db.query(`DELETE FROM "${MODEL_STATES_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
  });
}

const step: TenantPurgeStep = { purge: (tenantId) => purgeTenantStore(tenantId) };
export default step;
