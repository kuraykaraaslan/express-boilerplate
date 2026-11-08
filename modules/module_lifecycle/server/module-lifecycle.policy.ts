// A sysadmin's per-tenant policy for one module
// (docs/phases/25-marketplace/03-module-governance/04). Storage only: what a
// block means at install time is the gate's, and closing the blocked module is
// the service's (`blockModule`).

import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ModulePolicy } from './entities/module_policy.entity';

export async function listPolicies(tenantId: string): Promise<ModulePolicy[]> {
  return withTenantRepositoryFor(tenantId, ModulePolicy, (repo) => repo.find({ where: { tenantId } }));
}

export async function getPolicy(tenantId: string, moduleId: string): Promise<ModulePolicy | null> {
  return withTenantRepositoryFor(tenantId, ModulePolicy, (repo) => repo.findOne({ where: { tenantId, moduleId } }));
}

/** Set (or replace the reason of) a block. */
export async function writeBlock(tenantId: string, moduleId: string, reason: string | null, actorId?: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, ModulePolicy, (repo) =>
    repo.save(repo.create({ tenantId, moduleId, policy: 'block', reason: reason?.trim() || null, createdBy: actorId ?? null })));
}

/** Remove a block; returns whether there was one. */
export async function deleteBlock(tenantId: string, moduleId: string): Promise<boolean> {
  const res = await withTenantRepositoryFor(tenantId, ModulePolicy, (repo) => repo.delete({ tenantId, moduleId }));
  return (res.affected ?? 0) > 0;
}
