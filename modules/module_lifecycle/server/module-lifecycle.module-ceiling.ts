// The deployment license's `module:<id>` cap at module activation (fleet step 3b.11, owner rule S11 rules 4 and 8).
//
// The license may switch a module off for the whole deployment (`feature_gate:entitlement_ceiling`, key
// `module:<id>`, contributed by fleet_license from the platform license). `feature_gate` refuses that module's gated
// features at use; activation does not go through `checkFeatureAccess`, so it asks here, through feature_gate's
// deployment-limit API (no module reads the license directly). The 3b.8 edition check is a separate contributor
// to `module_lifecycle:entitlement`; this is the per-module cap the license document itself carries.
//
// NEW activations only (rule 4): a module already on for the tenant is never refused, so `reconcileEntitlements`
// (which asks the same question of every active module) never closes one because the license changed or lapsed.
// A `bundle:<key>` cap has no module map here and is enforced at use only.
//
// FAILS CLOSED: a ceiling that cannot answer refuses the activation with a 503, like a contributor that cannot answer.

import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import Logger from '@kuraykaraaslan-labs/logger';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import {
  deploymentCap, evaluateDeploymentLimit, type DeploymentLimitCheck,
} from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.deployment-limit';
import { moduleFeatureKey } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';

export interface ModuleCeilingRefusal {
  message: string;
  check: DeploymentLimitCheck;
}

/** Null when the license does not stop this activation; otherwise the refusal (not yet audited: only an actual activation attempt is). */
export async function moduleCeilingRefusal(tenantId: string, moduleId: string): Promise<ModuleCeilingRefusal | null> {
  let check: DeploymentLimitCheck;
  try {
    check = evaluateDeploymentLimit(moduleFeatureKey(moduleId), await deploymentCap(moduleFeatureKey(moduleId)), 0);
  } catch (err) {
    Logger.error(`[module_lifecycle.entitlement][tenant:${tenantId}] deployment ceiling: ${err instanceof Error ? err.message : String(err)}`);
    throw new AppError("Cannot verify entitlement: the deployment license ceiling did not answer", 503, ErrorCode.INTERNAL_ERROR);
  }
  if (check.allowed) return null;
  // S11 rule 4: a module already on stays on; only a new activation is refused.
  if ((await getEnabledModuleIds(tenantId)).has(moduleId)) return null;
  return {
    check,
    message: `Module '${moduleId}' is not included in this deployment's license. Modules already active stay on.`,
  };
}
