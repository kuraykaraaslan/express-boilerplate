import type { QueryRunner } from 'typeorm';

/** What the count needs of a connection: a query runner, an entity manager or a data source all have it (their `query` overloads differ, this is the common part). */
export type CeilingQuery = { query(sql: string, parameters?: unknown[]): Promise<unknown> };
import { FLEET_TENANT_ID, ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import {
  deploymentCap, deploymentLimitError, evaluateDeploymentLimit, recordLimitBlocked,
} from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.deployment-limit';
import type { EntitlementFeature } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.types';

/**
 * The `tenants` ceiling at tenant creation (fleet step 3b.11, owner rule S11 rules 3, 4 and 7).
 *
 * The deployment's license may cap how many CUSTOMER tenants this deployment holds. `feature_gate` answers the cap (the
 * stricter of every ceiling contributor; nothing when no license caps it); this module counts its own rows, because the
 * count and the insert must be one decision: two concurrent creations under `tenants: 3` with two tenants present must
 * not both pass. So the count runs inside the insert's transaction under a transaction-scoped advisory lock, and the
 * second creation recounts after the first committed.
 *
 * What counts (rule 3): every tenant row that is not soft-deleted, except the root and fleet tenants and a RELOCATED
 * tombstone (the tenant now lives on another node, which counts it). A tenant inside its deletion grace period
 * (PENDING_DELETION, `deletedAt` unset) still counts: it can be restored. Only NEW creations ask (rule 4): a lapsed or
 * lowered license never touches a tenant that exists.
 *
 * A tenant migrated INTO this node is a new tenant here (rules 3 and 6: a node counts its own tenants and enforces the lease it was given): the
 * migration import asks the same cap, under the same lock, before its rows go in (`path: 'migration_import'`), and so does a rollback coming home,
 * whose RELOCATED tombstone never counted. The source keeps counting its MIGRATING copy until the cutover turns it into a tombstone.
 */

export const TENANT_CEILING_KEY = 'tenants';

/** One transaction-scoped advisory lock key for every tenant creation that is capped (`hashtext` keeps it readable in `pg_locks`). */
const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('tenant:create:tenants-ceiling'))`;

/** The customer tenants this deployment counts against the `tenants` cap. */
export const COUNT_CUSTOMER_TENANTS_SQL = `SELECT COUNT(*)::int AS n FROM "tenants"
  WHERE "deletedAt" IS NULL AND "tenantId" NOT IN ($1, $2) AND "tenantStatus" <> 'RELOCATED'`;

/** `schema`: count in that schema's `tenants` (a caller whose connection does not set the search path, the migration import); else the search path's. */
export async function countCustomerTenants(qr: CeilingQuery | Pick<QueryRunner, 'query'>, schema?: string): Promise<number> {
  const sql = schema ? COUNT_CUSTOMER_TENANTS_SQL.replace('FROM "tenants"', `FROM "${schema.replace(/"/g, '""')}"."tenants"`) : COUNT_CUSTOMER_TENANTS_SQL;
  const rows = await (qr as CeilingQuery).query(sql, [ROOT_TENANT_ID, FLEET_TENANT_ID]) as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}

/** The count a fleet step reports for a creation or an import the `tenants` cap refused (`REJECTED`, `{ DEPLOYMENT_LIMIT: 1 }`). */
export const TENANT_CEILING_REFUSAL = 'DEPLOYMENT_LIMIT';

/** Whether an error is the cap's refusal ({@link enforceTenantCeiling}'s 403), so a fleet executor can answer it as a refusal, not a crash. */
export function isTenantCeilingRefusal(e: unknown): boolean {
  const x = e as { statusCode?: unknown; details?: { reason?: unknown } } | null;
  return !!x && x.statusCode === 403 && x.details?.reason === TENANT_CEILING_REFUSAL;
}

/**
 * The cap, read BEFORE the transaction opens (resolving it may call a license provider; no lock is held meanwhile).
 * `undefined` when nothing caps tenants, and then {@link enforceTenantCeiling} takes no lock at all.
 */
export function tenantCeiling(): Promise<EntitlementFeature | undefined> {
  return deploymentCap(TENANT_CEILING_KEY);
}

/**
 * Inside the creating transaction: lock, recount, refuse at the cap. A refusal is audited
 * (`fleet.license.limit_blocked`) and thrown as the 403 `assertFeatureAccess` answers; the transaction rolls back.
 */
export async function enforceTenantCeiling(
  qr: CeilingQuery | Pick<QueryRunner, 'query'>,
  cap: EntitlementFeature | undefined,
  ctx: { actorId?: string | null; path: 'create' | 'personal' | 'fleet_provision' | 'migration_import'; schema?: string },
): Promise<void> {
  if (!cap) return;
  await qr.query(LOCK_SQL);
  const check = evaluateDeploymentLimit(TENANT_CEILING_KEY, cap, await countCustomerTenants(qr, ctx.schema));
  if (check.allowed) return;
  recordLimitBlocked(check, { enforcedBy: 'tenant', actorId: ctx.actorId ?? null, details: { path: ctx.path } });
  throw deploymentLimitError(check);
}

/**
 * The migration import's early answer, before anything is written or a stale tombstone of a rollback is dropped: whether the cap leaves room for
 * one more tenant now. Advisory only (no lock): the import's own transaction decides under the lock with {@link enforceTenantCeiling}. A refusal
 * here is audited like the transactional one.
 */
export async function tenantCeilingAdmitsImport(qr: CeilingQuery | Pick<QueryRunner, 'query'>, schema?: string, actorId: string | null = null): Promise<boolean> {
  const cap = await tenantCeiling();
  if (!cap) return true;
  const check = evaluateDeploymentLimit(TENANT_CEILING_KEY, cap, await countCustomerTenants(qr, schema));
  if (check.allowed) return true;
  recordLimitBlocked(check, { enforcedBy: 'tenant', actorId, details: { path: 'migration_import' } });
  return false;
}
