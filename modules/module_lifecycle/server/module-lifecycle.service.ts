// Module lifecycle orchestration: per-tenant install / activate / deactivate /
// uninstall of feature modules (audit-fix Faz 5). It used to live inside the
// `marketplace` storefront, which made a vitrin module the platform's lifecycle
// driver; the store is now a pure consumer. Shared dependency-closure,
// install-state and table helpers live in ./module-lifecycle.helpers; the
// entitlement question goes through ./module-lifecycle.entitlement.
//
// SINGLE WRITER (audit-fix Faz 3): these mutations are the only code that writes
// the `installs` ledger's module rows AND the `module.<id>.enabled` setting —
// the ledger is the authority, the setting is the hot-path read projection
// (getEnabledModuleIds stays a Redis-cached settings read). Ledger and
// projection are always written back-to-back in the same mutation; a crash
// between the two writes is the drift scripts/verify-install-ledger.mjs exists
// to flag. install/purge write ledger first; setActive lets setModuleEnabled
// run first because its dependency guard is the stricter of the two (see there).

import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { runModuleHook } from '@kuraykaraaslan-labs/common/server/module-hooks';
import {
  setModuleEnabled,
  moduleEnabledKey,
  defaultEnabled,
  getEnabledModuleIds,
  isPlatformOnlyModule,
} from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import Logger from '@kuraykaraaslan-labs/logger';
import { withSharedTenantTransactionFor, withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { isPinnedToSharedDatabase } from '@kuraykaraaslan-labs/db/server/db.shared-database';
import type { QueryRunner } from 'typeorm';
import { LessThan } from 'typeorm';
import { env } from '@kuraykaraaslan-labs/env';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID, isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Install } from './entities/install.entity';
import { getModuleLifecyclePolicy } from './module_lifecycle.settings-policy';
import {
  isInstallableModule,
  resolveRequiresClosure,
  resolveInstallClosure,
  activeDependents,
  installedIds,
  tenantTablesFor,
  nonTenantTablesFor,
} from './module-lifecycle.helpers';
import { assertEntitled, checkEntitlement } from './module-lifecycle.entitlement';
import { assertModuleAllowed } from './module-lifecycle.gate';
import { assertNotHiddenFromTenant } from './module-lifecycle.hidden';
import { listAvailability, writeAvailability, type AvailabilityEntry } from './module-lifecycle.availability';
import { getPolicy, writeBlock, deleteBlock } from './module-lifecycle.policy';
import { getPlatformDefaultModules } from './module-lifecycle.defaults';
import type { InstallOrigin, ClosedReason, AvailabilityState } from './module-lifecycle.types';

export interface InstallOptions {
  /**
   * Who is installing (docs/phases/25-marketplace/03-module-governance/06), recorded on
   * the ledger rows this install creates. Default 'tenant': the tenant's own admin.
   */
  origin?: InstallOrigin;
}
import { referencesTo, sweepReferencesTo, type ReferenceImpact } from './module-lifecycle.references';

/**
 * Refuse an unknown (404) or core (400) module id as a caller's mistake, not a 500. An unknown id is not echoed:
 * it is whatever the caller put in the URL.
 */
function assertInstallable(moduleId: string): void {
  if (isInstallableModule(moduleId)) return;
  if (!moduleRegistry.getModule(moduleId)) throw new AppError('No such module.', 404, ErrorCode.NOT_FOUND);
  throw new AppError(`"${moduleId}" is a core module: it is always on and cannot be installed, switched or removed.`, 400, ErrorCode.VALIDATION_ERROR);
}

/**
 * Install a module (and its non-protected required deps): write ledger rows and
 * enable each. Idempotent — re-installing just ensures rows + enabled.
 *
 * The governance gate runs first, for the module and every dependency, before
 * anything is written (and the entitlement check, for the module and every
 * dependency not already on): an operator-only, hidden, retired or blocked module (or
 * dependency) refuses the whole install, and an unlisted module refuses a
 * tenant's own install (a plan, the operator or the default list may).
 */
export async function install(tenantId: string, moduleId: string, actorId?: string, opts: InstallOptions = {}): Promise<void> {
  assertInstallable(moduleId);
  const origin = opts.origin ?? 'tenant';
  await assertModuleAllowed(tenantId, moduleId, { origin });
  await assertEntitled(tenantId, moduleId);
  const targets = [moduleId, ...resolveInstallClosure(tenantId, moduleId)];
  // Every dependency the install pulls in is switched on too, so each one also asks the plan: a covered module must
  // not bring an uncovered one along for free. A dependency this install switches on is a new activation, so it also
  // answers the entitlement contributors (the platform edition ceiling, fleet 3b.8 / F22); one already on is not re-asked.
  const alreadyOn = await getEnabledModuleIds(tenantId);
  for (const dep of targets.slice(1)) {
    await assertModuleAllowed(tenantId, dep, { origin: 'dependency' });
    if (!alreadyOn.has(dep)) await assertEntitled(tenantId, dep);
  }
  for (const id of targets) {
    const mod = moduleRegistry.getModule(id);
    if (!mod) continue;
    // A copy whose restore window has passed is data the tenant asked to delete: finish that purge first (as the daily
    // job would) so the install starts empty instead of reviving it.
    const prior = await withTenantRepositoryFor(tenantId, Install, (repo) => repo.findOne({ where: { tenantId, artifactType: 'module', artifactId: id } }));
    if (prior?.uninstalledAt && prior.restorableUntil && prior.restorableUntil.getTime() < Date.now()) {
      await purge(tenantId, id, actorId, false, { requestedBy: 'operator' });
    }
    // The ledger row, serialised per (tenant, module): two concurrent installs
    // used to both find no row and race the composite key (a 500). Column-only
    // on an existing row.
    const upgradedFrom = await withTenantTransactionFor(tenantId, async (qr) => {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`marketplace:module:${tenantId}:${id}`]);
      const repo = qr.manager.getRepository(Install);
      const existing = await repo.findOne({ where: { tenantId, artifactType: 'module', artifactId: id } });
      if (!existing) {
        await repo.save(repo.create({ tenantId, artifactType: 'module', artifactId: id, version: mod.version, active: true, origin, closedReason: null }));
        return null;
      }
      // Version changed since last install → record it and fire onUpgrade below.
      // The origin stays the one recorded when the row was created.
      const from = existing.version !== mod.version ? existing.version : null;
      // Inside an uninstall's restore window, installing again is a restore: the rows are still there.
      await repo.update({ tenantId, artifactType: 'module', artifactId: id }, { version: mod.version, active: true, closedReason: null, uninstalledAt: null, restorableUntil: null });
      return from;
    });
    await setModuleEnabled(tenantId, id, true, actorId);
    // onInstall seeds sensible starting content (default theme, collections,
    // storefront pages). Idempotent + best-effort — safe to run on re-install and
    // never blocks activation. Runs after enable so the module is already active.
    await runModuleHook(id, 'onInstall', { tenantId });
    // onEnable fires on every activation (install implies enable); no-op unless
    // the module declares an onEnable handler (phases/monetization/3.md §3.4).
    await runModuleHook(id, 'onEnable', { tenantId });
    // onUpgrade fires only when the installed version actually changed.
    if (upgradedFrom) await runModuleHook(id, 'onUpgrade', { tenantId });
  }
  await AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    action: 'marketplace.install',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { installed: targets, origin },
  });
}

export interface SetActiveOptions {
  /** Who is switching it ON (the gate's question). Default 'tenant'. */
  origin?: InstallOrigin;
  /** Why the PLATFORM is switching it off; a person deactivating leaves it unset. */
  closedReason?: ClosedReason;
}

/** Activate (enable) or deactivate (disable, keep data) an installed module. */
export async function setActive(
  tenantId: string,
  moduleId: string,
  active: boolean,
  actorId?: string,
  opts: SetActiveOptions = {},
): Promise<void> {
  assertInstallable(moduleId);
  const installed = await installedIds(tenantId);
  if (!installed.has(moduleId)) {
    // The catalog counts a module as installed when it is protected, enabled, or
    // has a ledger row (listCatalog) — so the default-on modules
    // (blog/seo/dynamic_page) show as installed with no ledger row and used to be
    // impossible to toggle from here. Backfill the row instead of rejecting;
    // anything that is neither enabled nor default-on genuinely is not installed.
    const enabled = await getEnabledModuleIds(tenantId);
    if (!enabled.has(moduleId) && !defaultEnabled(moduleId)) {
      throw new AppError(`Module "${moduleId}" is not installed.`, 404, ErrorCode.NOT_FOUND);
    }
    const mod = moduleRegistry.getModule(moduleId)!;
    // Backfill records the CURRENT state (getEnabledModuleIds already folds the
    // defaultEnabled fallback in), not the target — the toggle below can still
    // be rejected by the dependency guard, and a rejected toggle must leave the
    // ledger and the projection telling the same story.
    await withTenantRepositoryFor(tenantId, Install, (repo) => repo.createQueryBuilder().insert().values({
      tenantId, artifactType: 'module', artifactId: moduleId,
      version: mod.version, active: enabled.has(moduleId),
    }).orIgnore().execute());
  }
  if (!active) {
    const deps = await activeDependents(tenantId, moduleId);
    if (deps.length) {
      throw new AppError(`Cannot deactivate "${moduleId}" — still required by: ${deps.join(', ')}.`, 409, ErrorCode.CONFLICT);
    }
  }
  // Reactivation passes the governance gate (a hidden, retired, blocked or
  // operator-only module stays off; an unlisted one the tenant already has may
  // come back) and is entitlement-gated when monetization is on (no double
  // charge — this is an access check, not a payment).
  if (active) {
    await assertModuleAllowed(tenantId, moduleId, { origin: opts.origin ?? 'tenant', reactivate: true });
    await assertEntitled(tenantId, moduleId);
    // Activating an uninstalled module is restoring it, possible while its data still exists (EXT-4).
    const row = await withTenantRepositoryFor(tenantId, Install, (repo) => repo.findOne({ where: { tenantId, artifactType: 'module', artifactId: moduleId } }));
    if (row?.uninstalledAt) {
      if (row.restorableUntil && row.restorableUntil.getTime() < Date.now()) {
        throw new AppError(`"${moduleId}" can no longer be restored: its data is being purged. Install it again to start empty.`, 410, ErrorCode.CONFLICT);
      }
      await withTenantRepositoryFor(tenantId, Install, (repo) =>
        repo.update({ tenantId, artifactType: 'module', artifactId: moduleId }, { uninstalledAt: null, restorableUntil: null }));
    }
  }
  // Projection writer first here: setModuleEnabled carries the stricter
  // dependency guard (enabledDependentsOf also counts protected/default-on
  // dependents that hold no ledger row), so a rejected toggle must leave the
  // ledger untouched. The ledger write follows immediately after it passes.
  await setModuleEnabled(tenantId, moduleId, active, actorId);
  await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.update(
      { tenantId, artifactType: 'module', artifactId: moduleId },
      { active, closedReason: active ? null : (opts.closedReason ?? null) },
    ));
  // Fire the matching lifecycle hook (no-op unless the module declares one).
  await runModuleHook(moduleId, active ? 'onEnable' : 'onDisable', { tenantId });
  await AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    action: active ? 'marketplace.activate' : 'marketplace.deactivate',
    resourceType: 'module',
    resourceId: moduleId,
    ...(opts.closedReason ? { metadata: { closedReason: opts.closedReason } } : {}),
  });
}

/** Refuse (409) if any of `moduleIds` was installed by a plan that still covers it. */
async function assertNotPlanDelivered(tenantId: string, moduleIds: string[]): Promise<void> {
  const rows = await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.find({ where: { tenantId, artifactType: 'module' } }));
  for (const id of moduleIds) {
    if (rows.find((r) => r.artifactId === id)?.origin !== 'plan') continue;
    const verdict = await checkEntitlement(tenantId, id);
    if (verdict.entitled && verdict.source === 'plan') {
      throw new AppError(
        `Module "${id}" comes with your plan and cannot be uninstalled while the plan includes it. Deactivate it instead.`,
        409,
        ErrorCode.CONFLICT,
      );
    }
  }
}

/** The boot configuration's restore window (MODULE_RESTORE_WINDOW_DAYS, default 30; 0 = purge at once). */
export function envRestoreWindowDays(): number {
  const days = Number(env.MODULE_RESTORE_WINDOW_DAYS ?? 30);
  return Number.isFinite(days) && days >= 0 ? days : 30;
}

/**
 * Days an uninstalled module stays restorable: the ROOT tenant's `moduleRestoreWindowDays` (1..3650) when set, else
 * the boot configuration's window (module_lifecycle.settings-policy.ts).
 */
export async function restoreWindowDays(): Promise<number> {
  return (await getModuleLifecyclePolicy(envRestoreWindowDays())).restoreWindowDays;
}

/**
 * Uninstall a module for a tenant, restorably (docs/phases/37-extensions/08, EXT-4): it is switched off at once —
 * routes, menus, slots and contributions stop like any deactivation — and its data is KEPT until `restorableUntil`.
 * Activating it again inside the window (or installing it again) brings it back with everything it had; after the
 * window the purge job removes the data. With a window of 0 days this is the old immediate purge.
 */
export async function uninstall(
  tenantId: string,
  moduleId: string,
  actorId?: string,
  cascade = false,
  opts: { requestedBy?: 'tenant' | 'operator' } = {},
): Promise<{
  moduleId: string;
  restorableUntil: string | null;
  purged: boolean;
  /** With a 0-day window: what the immediate purge removed (the same counts a purge-now answers with). */
  tablesPurged?: string[];
  rowsDeleted?: number;
  skippedTables?: string[];
}> {
  assertInstallable(moduleId);
  const requestedBy = opts.requestedBy ?? 'tenant';
  const days = await restoreWindowDays();
  if (days === 0) {
    const purgedResult = await purge(tenantId, moduleId, actorId, cascade, { requestedBy });
    return { moduleId, restorableUntil: null, purged: true, ...purgedResult };
  }
  const deps = await activeDependents(tenantId, moduleId);
  if (deps.length && !cascade) {
    throw new AppError(`Cannot remove "${moduleId}" — still required by: ${deps.join(', ')}. Pass cascade to remove them too.`, 409, ErrorCode.CONFLICT);
  }
  // An uninstall is the start of a purge, so it follows the purge's rule (MG-7): a tenant cannot remove a module its
  // plan delivered while the plan still covers it; the operator can.
  if (requestedBy === 'tenant') {
    // config/modules.ts hides it from the tenants: not theirs to remove, nor a dependent the cascade would take along
    assertNotHiddenFromTenant(tenantId, cascade ? [moduleId, ...deps] : [moduleId]);
    await assertNotPlanDelivered(tenantId, cascade ? [moduleId, ...deps] : [moduleId]);
  }
  for (const dep of cascade ? deps : []) await uninstall(tenantId, dep, actorId, true, { requestedBy });

  // setActive(false) is the ordinary deactivation: dependency guard, ledger backfill, projection, onDisable, audit.
  await setActive(tenantId, moduleId, false, actorId);
  const at = new Date();
  const until = new Date(at.getTime() + days * 24 * 60 * 60 * 1000);
  await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.update({ tenantId, artifactType: 'module', artifactId: moduleId }, { uninstalledAt: at, restorableUntil: until }));
  await AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    action: 'marketplace.uninstall',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { restorableUntil: until.toISOString(), cascadeDependents: cascade ? deps : [] },
  });
  return { moduleId, restorableUntil: until.toISOString(), purged: false };
}

/** Bring an uninstalled module back inside its window, data intact (entitlement re-checked by setActive). */
export async function restore(tenantId: string, moduleId: string, actorId?: string): Promise<void> {
  const row = await withTenantRepositoryFor(tenantId, Install, (repo) => repo.findOne({ where: { tenantId, artifactType: 'module', artifactId: moduleId } }));
  if (!row?.uninstalledAt) throw new AppError(`"${moduleId}" is not uninstalled.`, 404, ErrorCode.NOT_FOUND);
  await setActive(tenantId, moduleId, true, actorId);
  await AuditLogService.log({ tenantId, actorId: actorId ?? null, action: 'marketplace.restore', resourceType: 'module', resourceId: moduleId });
}

/**
 * The daily job: purge every uninstalled module whose restore window has passed, in every tenant. One failure does
 * not stop the rest; it stays uninstalled and is retried the next day (its row keeps `restorableUntil`).
 */
export async function purgeExpiredUninstalls(now = new Date()): Promise<{ purged: Array<{ tenantId: string; moduleId: string }>; failed: Array<{ tenantId: string; moduleId: string; error: string }> }> {
  const due = await withSystemRLS((qr) => qr.manager.getRepository(Install).find({
    where: { artifactType: 'module', restorableUntil: LessThan(now) },
    select: { tenantId: true, artifactId: true },
  }));
  const purged: Array<{ tenantId: string; moduleId: string }> = [];
  const failed: Array<{ tenantId: string; moduleId: string; error: string }> = [];
  for (const row of due) {
    try {
      // The platform finishes an uninstall that was allowed when it was asked for (the plan check ran then).
      await purge(row.tenantId, row.artifactId, undefined, true, { requestedBy: 'operator' });
      purged.push({ tenantId: row.tenantId, moduleId: row.artifactId });
    } catch (e) {
      failed.push({ tenantId: row.tenantId, moduleId: row.artifactId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { purged, failed };
}

/**
 * Uninstall a module for a tenant and PURGE its data: delete every row scoped to
 * this tenant from the module's tenantId-bearing tables, clear `module.<id>.*`
 * settings, and remove the install-ledger row. Blocked if active modules still
 * depend on it (unless `cascade`, which uninstalls the dependents first).
 *
 * A TENANT cannot uninstall a module its plan installed while that plan still
 * covers it (MG-7, docs/phases/25-marketplace/03-module-governance/06): it may
 * deactivate it instead. The operator (`requestedBy: 'operator'`) may.
 */
export async function purge(
  tenantId: string,
  moduleId: string,
  actorId?: string,
  cascade = false,
  opts: { requestedBy?: 'tenant' | 'operator' } = {},
): Promise<{ tablesPurged: string[]; rowsDeleted: number; skippedTables: string[] }> {
  assertInstallable(moduleId);
  const requestedBy = opts.requestedBy ?? 'tenant';

  const deps = await activeDependents(tenantId, moduleId);
  if (deps.length && !cascade) {
    throw new AppError(`Cannot delete "${moduleId}" — still required by: ${deps.join(', ')}. Pass cascade to remove them too.`, 409, ErrorCode.CONFLICT);
  }
  if (requestedBy === 'tenant') {
    // config/modules.ts hides it from the tenants: not theirs to remove, nor a dependent the cascade would take along
    assertNotHiddenFromTenant(tenantId, cascade ? [moduleId, ...deps] : [moduleId]);
    await assertNotPlanDelivered(tenantId, cascade ? [moduleId, ...deps] : [moduleId]);
  }
  // Cascade: uninstall dependents first (deepest first is unnecessary — each purge
  // re-checks remaining dependents).
  if (cascade) {
    for (const dep of deps) {
      await purge(tenantId, dep, actorId, true, { requestedBy });
    }
  }

  // Step 1 of the purge order (docs/phases/37-extensions/08): other modules drop or reset what they hold that points
  // at this module (flow nodes, board widgets, page blocks, provider settings) while its rows still exist.
  const swept = await sweepReferencesTo(tenantId, moduleId);
  if (swept.failed.length) {
    Logger.warn(`[module_lifecycle] purge of ${moduleId} in ${tenantId}: references not swept by ${swept.failed.map((f) => f.holder).join(', ')}`);
  }

  // onUninstall runs BEFORE the per-tenant table purge so a module can clean up
  // rows it seeded in OTHER modules' tables (e.g. storefront pages/bindings that
  // live in dynamic_page's tables, which this module's own table purge never
  // touches). Best-effort — a hook failure never blocks the uninstall.
  await runModuleHook(moduleId, 'onUninstall', { tenantId });

  const tables = tenantTablesFor(moduleId);
  const skippedTables = nonTenantTablesFor(moduleId);
  let rowsDeleted = 0;
  const tablesPurged: string[] = [];
  // Inside the tenant's block: every statement of the purge runs with this
  // tenant set, so under RLS it can only ever reach this tenant's rows.
  const purgeTables = async (qr: QueryRunner, batch: typeof tables) => {
    const mgr = qr.manager;
    // Defer FK checks so intra-module parent/child delete order does not matter.
    // A SAVEPOINT keeps a refused SET (non-PG / no deferrable FKs) from
    // aborting the transaction the deletes run in.
    await qr.query('SAVEPOINT defer_fk');
    try { await qr.query('SET CONSTRAINTS ALL DEFERRED'); } catch { await qr.query('ROLLBACK TO SAVEPOINT defer_fk'); }
    for (const t of batch) {
      const meta = mgr.connection.entityMetadatas.find((m) => m.tableName === t.tableName);
      if (!meta) continue; // table not mapped to a registered entity — skip safely
      const res = await mgr
        .createQueryBuilder()
        .delete()
        .from(meta.target)
        .where('"tenantId" = :tid', { tid: tenantId })
        .execute();
      rowsDeleted += res.affected ?? 0;
      tablesPurged.push(t.tableName);
    }
  };
  // Tables pinned to the shared database (@SharedDatabaseOnly, e.g. api_keys: 02-fleet F8) are not mapped on a
  // dedicated tenant's own DataSource, so the per-tenant block would silently skip them and leave rows that still
  // verify. They are purged on the shared database, still tenant-keyed and with the tenant set.
  const pinnedTables = tables.filter((t) => isPinnedToSharedDatabase(t.tableName));
  const routedTables = tables.filter((t) => !isPinnedToSharedDatabase(t.tableName));
  await withTenantTransactionFor(tenantId, (qr) => purgeTables(qr, routedTables));
  if (pinnedTables.length) {
    await withSharedTenantTransactionFor(tenantId, async (qr) => {
      await purgeTables(qr, pinnedTables);
      // A pinned table the shared DataSource does not map either is a wiring bug, not a table to skip: rows left
      // here keep authenticating after the purge.
      const missing = pinnedTables.filter((t) => !tablesPurged.includes(t.tableName));
      if (missing.length) {
        throw new Error(`[module_lifecycle] purge of ${moduleId}: shared-database tables not mapped: ${missing.map((t) => t.tableName).join(', ')}`);
      }
    });
  }

  // Clear the module's settings (enabled flag + any per-module config keys)...
  await SettingService.deleteByPrefix(tenantId, `module.${moduleId}.`, actorId ? { actorId } : undefined);
  // ...then re-assert "off" explicitly. The prefix delete also removed
  // `module.<id>.enabled`, and an ABSENT key falls back to defaultEnabled(),
  // which is TRUE for the default-on modules (blog/seo/dynamic_page) — so an
  // uninstall used to purge every row and then leave the module switched on.
  // Written directly rather than via setModuleEnabled: this is mid-teardown and
  // purge already ran its own dependency check above.
  await SettingService.updateMany(
    tenantId,
    { [moduleEnabledKey(moduleId)]: 'false' },
    actorId ? { actorId } : undefined,
  );
  await SettingService.clearCache(tenantId);

  // Remove the ledger row.
  await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.delete({ tenantId, artifactType: 'module', artifactId: moduleId }));

  await AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    action: 'marketplace.delete',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { tablesPurged, rowsDeleted, skippedTables, cascadeDependents: cascade ? deps : [], referencesSwept: swept.removed, referencesNotSwept: swept.failed },
  });

  return { tablesPurged, rowsDeleted, skippedTables };
}

export interface DeletePreview {
  moduleId: string;
  tenantTables: string[];
  skippedTables: string[];
  dependents: string[];
  /** What other modules hold that points at this one (EXT-6: shown, never blocking). */
  references: ReferenceImpact;
  /** Days the data is kept, restorable, after an uninstall (0 = purged at once). */
  restoreWindowDays: number;
}

/** What an uninstall would purge, and which active modules block it. */
export async function previewDelete(tenantId: string, moduleId: string): Promise<DeletePreview> {
  return {
    moduleId,
    tenantTables: tenantTablesFor(moduleId).map((t) => t.tableName),
    skippedTables: nonTenantTablesFor(moduleId),
    dependents: await activeDependents(tenantId, moduleId),
    references: await referencesTo(tenantId, moduleId),
    restoreWindowDays: await restoreWindowDays(),
  };
}

/**
 * Close what a tenant is no longer entitled to — the downgrade path (§3.2: close
 * and KEEP the data, never purge). Called by the billing rail after it takes an
 * entitlement away. Walks the tenant's installed, active modules — plus any module
 * switched on with no ledger row at all — and deactivates those the entitlement
 * contributors now refuse, dependents before the modules they depend on (the
 * dependency guard refuses the other order), and skips any module a
 * still-entitled, still-active module needs.
 *
 * Re-activating later is the ordinary `setActive`, which re-checks entitlement.
 * Returns the module ids it closed. One module failing to close does not stop the
 * rest; failures are returned so the caller can log them.
 */
export async function reconcileEntitlements(
  tenantId: string,
  actorId?: string,
): Promise<{ closed: string[]; failed: { moduleId: string; error: string }[] }> {
  const rows = await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.find({ where: { tenantId, artifactType: 'module', active: true } }));
  const candidates = new Set(rows.map((r) => r.artifactId));
  // The runtime gate serves the `module.<id>.enabled` projection, not the ledger, so a module
  // that is on WITHOUT a ledger row (a flag written before the ledger existed, or by a seed or
  // script) used to outlive every downgrade. Walk those too. A default-on module the tenant
  // never touched stays out: it is the out-of-the-box set, not something the plan bought.
  const ledgered = await installedIds(tenantId);
  for (const id of await getEnabledModuleIds(tenantId)) {
    if (!ledgered.has(id) && !defaultEnabled(id)) candidates.add(id);
  }
  const refused: string[] = [];
  for (const moduleId of candidates) {
    if (!isInstallableModule(moduleId)) continue;
    if (!(await checkEntitlement(tenantId, moduleId)).entitled) refused.push(moduleId);
  }
  return closeModules(tenantId, refused, 'entitlement', actorId);
}

export interface CloseResult {
  closed: string[];
  failed: { moduleId: string; error: string }[];
}

/**
 * Deactivate `moduleIds` for a tenant on the PLATFORM's behalf (data kept), recording
 * why on each ledger row: dependents before the modules they depend on, because the
 * dependency guard refuses the other order. A comparator cannot express that (two
 * unrelated modules have no order, which makes a sort inconsistent), so peel:
 * repeatedly take every module no OTHER listed module needs. One module failing to
 * close does not stop the rest; failures are returned.
 */
export async function closeModules(
  tenantId: string,
  moduleIds: string[],
  closedReason: ClosedReason,
  actorId?: string,
): Promise<CloseResult> {
  const ordered: string[] = [];
  const remaining = new Set(moduleIds);
  while (remaining.size > 0) {
    const layer = [...remaining].filter((m) => ![...remaining].some((o) => o !== m && resolveRequiresClosure(o).includes(m)));
    if (layer.length === 0) { ordered.push(...remaining); break; } // a cycle: let the guard report it
    ordered.push(...layer);
    for (const m of layer) remaining.delete(m);
  }

  const closed: string[] = [];
  const failed: { moduleId: string; error: string }[] = [];
  for (const moduleId of ordered) {
    try {
      // The ordinary deactivate path: dependency guard, hook, ledger, audit.
      await setActive(tenantId, moduleId, false, actorId, { closedReason });
      closed.push(moduleId);
    } catch (err) {
      failed.push({ moduleId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { closed, failed };
}

// ── Operator governance (docs/phases/25-marketplace/03-module-governance) ──────

const assertGovernable = (tenantId: string | null, moduleId: string): void => {
  if (tenantId && isReservedTenant(tenantId)) {
    throw new AppError('The platform tenants are the operator: no module policy applies to them.', 400, ErrorCode.VALIDATION_ERROR);
  }
  if (!isInstallableModule(moduleId) || isPlatformOnlyModule(moduleId)) {
    throw new AppError(`Module '${moduleId}' is not a tenant-installable module.`, 400, ErrorCode.VALIDATION_ERROR);
  }
};

/**
 * Block a module for one tenant (04): the tenant can no longer install or reactivate
 * it, and if it is on now it is closed together with the modules that depend on it
 * (dependents first, data kept, `closedReason: 'policy'`). Lifting the block later
 * reactivates nothing.
 */
export async function blockModule(tenantId: string, moduleId: string, reason: string | null, actorId?: string): Promise<CloseResult> {
  assertGovernable(tenantId, moduleId);
  await writeBlock(tenantId, moduleId, reason, actorId);
  let result: CloseResult = { closed: [], failed: [] };
  if ((await getEnabledModuleIds(tenantId)).has(moduleId)) {
    result = await closeModules(tenantId, [moduleId, ...(await activeDependents(tenantId, moduleId))], 'policy', actorId);
  }
  await AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    action: 'module.policy.block',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { reason, closed: result.closed, failed: result.failed.map((f) => f.moduleId) },
  });
  return result;
}

/** Lift a block (04). Returns whether there was one. */
export async function unblockModule(tenantId: string, moduleId: string, actorId?: string): Promise<boolean> {
  assertGovernable(tenantId, moduleId);
  const removed = await deleteBlock(tenantId, moduleId);
  if (removed) {
    await AuditLogService.log({ tenantId, actorId: actorId ?? null, action: 'module.policy.unblock', resourceType: 'module', resourceId: moduleId });
  }
  return removed;
}

/**
 * Change a module's platform-wide availability (03). Retiring it closes it on every
 * active customer tenant that has it on, with the modules that depend on it
 * (`closedReason: 'retired'`, data kept); what could not be closed is returned per
 * tenant. Moving back to `available` reactivates nothing — each tenant switches it
 * back on itself.
 */
export async function setModuleAvailability(
  moduleId: string,
  state: AvailabilityState,
  reason: string | null,
  actorId?: string,
): Promise<{ entry: AvailabilityEntry; retired: ({ tenantId: string } & CloseResult)[] }> {
  assertGovernable(null, moduleId);
  const entry = await writeAvailability(moduleId, state, reason, actorId);
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID,
    actorId: actorId ?? null,
    action: 'module.availability.changed',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { state, reason },
  });
  const retired: ({ tenantId: string } & CloseResult)[] = [];
  if (state === 'retired') {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep');
    for (const t of await listActiveTenants()) {
      if (isReservedTenant(t.tenantId)) continue;
      try {
        if (!(await getEnabledModuleIds(t.tenantId)).has(moduleId)) continue;
        const dependents = await activeDependents(t.tenantId, moduleId);
        retired.push({ tenantId: t.tenantId, ...(await closeModules(t.tenantId, [moduleId, ...dependents], 'retired', actorId)) });
      } catch (err) {
        retired.push({ tenantId: t.tenantId, closed: [], failed: [{ moduleId, error: err instanceof Error ? err.message : String(err) }] });
      }
    }
  }
  return { entry, retired };
}

/** Per-tenant marker: a provisioning run left something uninstalled (see `provisionEntitlements`). */
export const PROVISIONING_PENDING_KEY = 'moduleLifecycleProvisioningPending';

export async function isProvisioningPending(tenantId: string): Promise<boolean> {
  return (await SettingService.getValue(tenantId, PROVISIONING_PENDING_KEY)) === 'true';
}

export interface ProvisionResult {
  installed: string[];
  reactivated: string[];
  failed: { moduleId: string; error: string }[];
}

/**
 * Plans install their modules (06): for every UNLISTED module the tenant's plan now
 * covers (`source: 'plan'` — free mode and the operator are not a plan), install it
 * (`origin: 'plan'`) or, if a lapse closed it (`closedReason: 'entitlement'`),
 * reactivate it. Listed modules stay the tenant's choice (MG-6); a copy the tenant
 * switched off itself, or one the operator blocked, is left alone. Called by the
 * billing rail after it grants an entitlement, mirroring `reconcileEntitlements`.
 *
 * One failure does not stop the rest. Any failure sets the tenant's pending marker,
 * which the hourly job retries; a clean run clears it.
 */
export async function provisionEntitlements(tenantId: string, actorId?: string): Promise<ProvisionResult> {
  const result: ProvisionResult = { installed: [], reactivated: [], failed: [] };
  if (isReservedTenant(tenantId)) return result;
  const unlisted = [...(await listAvailability()).values()]
    .filter((e) => e.state === 'unlisted' && isInstallableModule(e.moduleId) && !isPlatformOnlyModule(e.moduleId))
    .map((e) => e.moduleId);
  if (unlisted.length) {
    const rows = new Map((await withTenantRepositoryFor(tenantId, Install, (repo) =>
      repo.find({ where: { tenantId, artifactType: 'module' } }))).map((r) => [r.artifactId, r]));
    for (const moduleId of unlisted) {
      try {
        const verdict = await checkEntitlement(tenantId, moduleId);
        if (!verdict.entitled || verdict.source !== 'plan') continue;
        if ((await getPolicy(tenantId, moduleId))?.policy === 'block') continue;
        const row = rows.get(moduleId);
        if (!row) {
          await install(tenantId, moduleId, actorId, { origin: 'plan' });
          result.installed.push(moduleId);
        } else if (!row.active && row.closedReason === 'entitlement') {
          await setActive(tenantId, moduleId, true, actorId, { origin: 'plan' });
          result.reactivated.push(moduleId);
        }
      } catch (err) {
        result.failed.push({ moduleId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  try {
    if (result.failed.length) await SettingService.updateMany(tenantId, { [PROVISIONING_PENDING_KEY]: 'true' });
    else if (await isProvisioningPending(tenantId)) await SettingService.delete(tenantId, PROVISIONING_PENDING_KEY);
  } catch { /* the marker is a retry hint; the next grant runs provisioning anyway */ }
  return result;
}

/**
 * Install the platform's default modules (01) — or `moduleIds` when given — for a
 * tenant, with `origin: 'default'`: the plan check, ledger, hooks and audit of an
 * ordinary install. A module already on is skipped; one the plan (or the gate)
 * refuses is reported, never forced. Called when a tenant is created
 * (`tenant:default_modules`) and by the operator for an existing tenant.
 */
export async function applyDefaultModules(
  tenantId: string,
  actorId?: string,
  moduleIds?: string[],
): Promise<{ installed: string[]; skipped: { moduleId: string; error: string }[] }> {
  const out = { installed: [] as string[], skipped: [] as { moduleId: string; error: string }[] };
  if (isReservedTenant(tenantId)) return out;
  const ids = moduleIds ?? (await getPlatformDefaultModules());
  if (!ids.length) return out;
  const enabled = await getEnabledModuleIds(tenantId);
  for (const moduleId of ids) {
    if (enabled.has(moduleId)) continue;
    try {
      await install(tenantId, moduleId, actorId, { origin: 'default' });
      out.installed.push(moduleId);
    } catch (err) {
      out.skipped.push({ moduleId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
