// The platform operator's read models (docs/phases/25-marketplace/03-module-governance/03, 05):
// one tenant's modules with where each state comes from, and every module's
// availability with how many tenants have it. Server-only; the ROOT routes call these.

import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { FLEET_TENANT_ID, ROOT_TENANT_ID, isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import {
  getEnabledModuleIds,
  isModulePlacedIn,
  isPlatformOnlyModule,
  isAlwaysOnModule,
  defaultEnabled,
  moduleEnabledKey,
} from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { Install } from './entities/install.entity';
import { listAvailability } from './module-lifecycle.availability';
import { listPolicies } from './module-lifecycle.policy';
import { checkEntitlement } from './module-lifecycle.entitlement';
import { isInstallableModule } from './module-lifecycle.helpers';
import type { AvailabilityState, ClosedReason, InstallOrigin } from './module-lifecycle.types';

/** The target of an operator action must be a live customer tenant: 404 if unknown, 400 for ROOT/Fleet. */
export async function assertCustomerTenant(tenantId: string): Promise<void> {
  if (isReservedTenant(tenantId)) {
    throw new AppError('The platform tenants are the operator; manage their modules from their own console.', 400, ErrorCode.VALIDATION_ERROR);
  }
  const rows = await withSystemRLS((qr) =>
    qr.query('SELECT 1 FROM "tenants" WHERE "tenantId" = $1 AND "deletedAt" IS NULL', [tenantId])) as unknown[];
  if (!rows.length) throw new AppError('Tenant not found', 404, ErrorCode.NOT_FOUND);
}

export interface TenantModuleRow {
  id: string;
  name: string;
  icon?: string;
  tier?: string;
  protected: boolean;
  defaultOn: boolean;
  /** Has an `installs` ledger row. */
  installed: boolean;
  installedVersion: string | null;
  origin: InstallOrigin | null;
  /** On for this tenant right now (the runtime gate's answer). */
  active: boolean;
  /** Where `active` comes from: the tenant's own flag, or the code default. */
  flagSource: 'own' | 'default';
  closedReason: ClosedReason | null;
  entitled: boolean | null;
  entitledBy: 'plan' | 'unrestricted' | 'ceiling' | null;
  availability: AvailabilityState;
  blocked: boolean;
  blockReason: string | null;
  /** The ledger and the flag disagree (what scripts/verify-install-ledger.mjs reports). */
  drift: boolean;
}

/** Every module that may be on for this tenant (its placement, docs/phases/46-module-placement), with its state and source (05). */
export async function describeTenantModules(tenantId: string): Promise<TenantModuleRow[]> {
  const mods = moduleRegistry.getModules().filter((m) => isModulePlacedIn(m.id, tenantId));
  const [enabled, rows, flags, availability, policies] = await Promise.all([
    getEnabledModuleIds(tenantId),
    withTenantRepositoryFor(tenantId, Install, (repo) => repo.find({ where: { tenantId, artifactType: 'module' } })),
    SettingService.getByKeys(tenantId, mods.map((m) => moduleEnabledKey(m.id))),
    listAvailability(),
    listPolicies(tenantId),
  ]);
  const byId = new Map(rows.map((r) => [r.artifactId, r]));
  const policyById = new Map(policies.map((p) => [p.moduleId, p]));

  const out = await Promise.all(mods.map(async (m): Promise<TenantModuleRow> => {
    const row = byId.get(m.id);
    const active = enabled.has(m.id);
    let entitled: boolean | null = null;
    let entitledBy: 'plan' | 'unrestricted' | 'ceiling' | null = null;
    if (isInstallableModule(m.id)) {
      try {
        const verdict = await checkEntitlement(tenantId, m.id);
        entitled = verdict.entitled;
        entitledBy = verdict.entitled ? (verdict.source ?? 'unrestricted') : null;
      } catch { /* unknown */ }
    }
    const policy = policyById.get(m.id);
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      tier: m.tier,
      protected: isAlwaysOnModule(m.id),
      defaultOn: defaultEnabled(m.id),
      installed: !!row,
      installedVersion: row?.version ?? null,
      origin: row ? (row.origin ?? 'tenant') : null,
      active,
      flagSource: flags[moduleEnabledKey(m.id)] !== undefined ? 'own' : 'default',
      closedReason: row?.closedReason ?? null,
      entitled,
      entitledBy,
      availability: availability.get(m.id)?.state ?? 'available',
      blocked: policy?.policy === 'block',
      blockReason: policy?.reason ?? null,
      drift: !!row && row.active !== active,
    };
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ModuleAvailabilityRow {
  id: string;
  name: string;
  icon?: string;
  tier?: string;
  state: AvailabilityState;
  reason: string | null;
  updatedAt: string | null;
  /** Customer tenants with a ledger row / with it active / with it blocked. */
  installed: number;
  active: number;
  blocked: number;
}

/**
 * Every tenant-installable module with its platform availability and how many
 * customer tenants have it (03): the operator's platform view. Counts come from
 * the ledger and the policy table across tenants, so they run on the system
 * connection; the reserved tenants are left out.
 */
export async function describeAvailability(): Promise<ModuleAvailabilityRow[]> {
  const availability = await listAvailability();
  const counts = await withSystemRLS(async (qr) => {
    const installs = await qr.query(
      `SELECT "artifactId" AS id, count(*)::int AS installed, (count(*) FILTER (WHERE "active"))::int AS active
         FROM "installs" WHERE "artifactType" = 'module' AND "tenantId" NOT IN ($1, $2) GROUP BY 1`,
      [ROOT_TENANT_ID, FLEET_TENANT_ID],
    ) as Array<{ id: string; installed: number; active: number }>;
    const blocks = await qr.query(
      `SELECT "moduleId" AS id, count(*)::int AS blocked FROM "module_policies" WHERE "policy" = 'block' GROUP BY 1`,
    ) as Array<{ id: string; blocked: number }>;
    return { installs: new Map(installs.map((r) => [r.id, r])), blocks: new Map(blocks.map((r) => [r.id, r.blocked])) };
  });
  return moduleRegistry.getModules()
    .filter((m) => isInstallableModule(m.id) && !isPlatformOnlyModule(m.id))
    .map((m) => {
      const a = availability.get(m.id);
      const c = counts.installs.get(m.id);
      return {
        id: m.id,
        name: m.name,
        icon: m.icon,
        tier: m.tier,
        state: a?.state ?? 'available',
        reason: a?.reason ?? null,
        updatedAt: a?.updatedAt ?? null,
        installed: c?.installed ?? 0,
        active: c?.active ?? 0,
        blocked: counts.blocks.get(m.id) ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Record an operator action on a customer tenant in the ROOT audit log too. The
 * target tenant's own log gets the lifecycle's ordinary entry (actor = the
 * sysadmin); this one lets the platform answer "what did our operators do to
 * tenant X" from one place. Best effort: the action has already happened.
 */
export async function logOperatorAction(
  actorId: string | undefined,
  action: string,
  targetTenantId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID,
    actorId: actorId ?? null,
    action: `module_lifecycle.operator.${action}`,
    resourceType: 'tenant',
    resourceId: targetTenantId,
    metadata,
  }).catch(() => {});
}
