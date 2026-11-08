import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type { ContributorStateSource, StateVerdict } from '@kuraykaraaslan-labs/common/server/extensions/contributor-state';
import { Not, IsNull } from 'typeorm';
import { Install } from './entities/install.entity';
import { listPolicies } from './module-lifecycle.policy';
import { listAvailability } from './module-lifecycle.availability';

/**
 * `common:contributor_state` from module_lifecycle (docs/phases/37-extensions/02, 07, 08): the states only it knows.
 *  - `uninstalled`: removed inside its restore window, with the date it can be restored until (08);
 *  - `blocked`: the operator blocked it for this tenant (module governance 04), with the operator's reason;
 *  - `retired`: the platform retired it for every tenant (module governance 03);
 *  - `unentitled`: the platform closed it because the tenant's plan no longer covers it (`closedReason: 'entitlement'`).
 * Such a module is also off in the activation flags (tenant_setting reports `disabled`); the resolver keeps the more
 * specific state here, so a placeholder can name it and the platform gate (EXT-13) can tell "retired" from "switched off".
 */
const moduleLifecycleState: ContributorStateSource = {
  async states(tenantId) {
    const [rows, policies, availability] = await Promise.all([
      withTenantRepositoryFor(tenantId, Install, (repo) => repo.find({
        where: [
          { tenantId, artifactType: 'module', uninstalledAt: Not(IsNull()) },
          { tenantId, artifactType: 'module', closedReason: 'entitlement' },
        ],
        select: { artifactId: true, uninstalledAt: true, restorableUntil: true, closedReason: true },
      })),
      listPolicies(tenantId),
      listAvailability(),
    ]);
    const out: StateVerdict[] = [];
    for (const r of rows) {
      if (r.uninstalledAt) {
        out.push({
          moduleId: r.artifactId,
          state: 'uninstalled',
          reason: r.restorableUntil ? `removed; restorable until ${r.restorableUntil.toISOString().slice(0, 10)}` : 'removed',
          since: r.uninstalledAt.toISOString(),
        });
      } else if (r.closedReason === 'entitlement') {
        out.push({ moduleId: r.artifactId, state: 'unentitled', reason: 'not included in the current plan' });
      }
    }
    for (const p of policies) {
      if (p.policy === 'block') out.push({ moduleId: p.moduleId, state: 'blocked', reason: p.reason ?? 'blocked by the platform for this workspace' });
    }
    for (const [moduleId, entry] of availability) {
      if (entry.state === 'retired') out.push({ moduleId, state: 'retired', reason: entry.reason ?? 'retired by the platform' });
    }
    return out;
  },
};

export default moduleLifecycleState;
