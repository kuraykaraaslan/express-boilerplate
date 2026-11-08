// Platform-wide availability of a module for customer tenants
// (docs/phases/25-marketplace/03-module-governance/03): available | unlisted |
// hidden | retired. One small table in the ROOT datasource, read on every
// install, activation and catalog listing, so the whole map is cached in one
// Redis entry and dropped on every write. A Redis failure is a miss.
//
// This file only stores the state. What each state means at install time is the
// gate's (module-lifecycle.gate); closing every copy of a retired module is the
// service's (`setModuleAvailability`), which can call `setActive`.

import redis from '@kuraykaraaslan-labs/redis';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isPlatformOnlyModule } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { ModuleAvailability } from './entities/module_availability.entity';
import { isInstallableModule } from './module-lifecycle.helpers';
import { AVAILABILITY_STATES, type AvailabilityState } from './module-lifecycle.types';

const CACHE_KEY = 'module_lifecycle:availability';
const CACHE_TTL_SECONDS = 60;

export interface AvailabilityEntry {
  moduleId: string;
  state: AvailabilityState;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const AVAILABLE = (moduleId: string): AvailabilityEntry => ({
  moduleId, state: 'available', reason: null, updatedBy: null, updatedAt: null,
});

function toEntry(row: ModuleAvailability): AvailabilityEntry {
  return {
    moduleId: row.moduleId,
    state: row.state,
    reason: row.reason ?? null,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/** Every module with an explicit state (an absent module is `available`). */
export async function listAvailability(): Promise<Map<string, AvailabilityEntry>> {
  try {
    const raw = await redis.get(CACHE_KEY);
    if (raw) {
      const list = JSON.parse(raw) as AvailabilityEntry[];
      if (Array.isArray(list)) return new Map(list.map((e) => [e.moduleId, e]));
    }
  } catch { /* a miss */ }
  const rows = await withTenantRepositoryFor(ROOT_TENANT_ID, ModuleAvailability, (repo) => repo.find());
  const entries = rows.map(toEntry);
  try { await redis.set(CACHE_KEY, JSON.stringify(entries), 'EX', CACHE_TTL_SECONDS); } catch { /* best effort */ }
  return new Map(entries.map((e) => [e.moduleId, e]));
}

export async function getAvailability(moduleId: string): Promise<AvailabilityEntry> {
  return (await listAvailability()).get(moduleId) ?? AVAILABLE(moduleId);
}

/**
 * Store a module's state. Only a tenant-installable module has one: core
 * (protected) modules are always on and operator-only modules never reach a
 * tenant, so a state for either would mean nothing. `available` deletes the row.
 */
export async function writeAvailability(
  moduleId: string,
  state: AvailabilityState,
  reason: string | null,
  actorId?: string,
): Promise<AvailabilityEntry> {
  if (!(AVAILABILITY_STATES as readonly string[]).includes(state)) {
    throw new AppError(`Unknown availability state '${state}'.`, 400, ErrorCode.VALIDATION_ERROR);
  }
  if (!isInstallableModule(moduleId) || isPlatformOnlyModule(moduleId)) {
    throw new AppError(`Module '${moduleId}' is not a tenant-installable module.`, 400, ErrorCode.VALIDATION_ERROR);
  }
  const entry = await withTenantRepositoryFor(ROOT_TENANT_ID, ModuleAvailability, async (repo) => {
    if (state === 'available') {
      await repo.delete({ moduleId });
      return AVAILABLE(moduleId);
    }
    await repo.save(repo.create({ moduleId, state, reason: reason?.trim() || null, updatedBy: actorId ?? null }));
    const saved = await repo.findOne({ where: { moduleId } });
    return saved ? toEntry(saved) : AVAILABLE(moduleId);
  });
  try { await redis.del(CACHE_KEY); } catch { /* the TTL bounds staleness */ }
  return entry;
}
