// The entitlement seam of module lifecycle: "may this tenant have this module?"
//
// `module_lifecycle` must ask the billing rail, and the billing rail must close
// modules when a tenant stops being entitled — two arrows between the same pair
// of modules, which as hard imports is a cycle. So the question is inverted the
// way `payment:plan_usage` does it: this module declares `module_lifecycle:entitlement`,
// a rail contributes a check, and the rail (which may import this module) calls
// `reconcileEntitlements` the other way. Nothing here knows a plan, a product
// or a price — and with NO contributor installed every module is allowed, the
// standalone-installability contract (feature_gate's entitlement_source works
// the same way).
//
// FAILS CLOSED: a contributor that throws is "cannot answer", not "entitled".
// Server-only; React-free.

import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { moduleLifecycleEntitlementLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/module_lifecycle.entitlement';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import Logger from '@kuraykaraaslan-labs/logger';
import { deploymentLimitError, recordLimitBlocked, type DeploymentLimitCheck } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.deployment-limit';
import { moduleCeilingRefusal } from './module-lifecycle.module-ceiling';

/** Extension point id — declared in module_lifecycle/module.json `extensionPoints`. */
export const MODULE_LIFECYCLE_ENTITLEMENT_POINT = 'module_lifecycle:entitlement';

export interface EntitlementVerdict {
  entitled: boolean;
  /** Shown to the user when `entitled` is false (e.g. upgrade guidance). */
  message?: string;
  /**
   * Why an `entitled: true` holds: 'plan' = something the tenant holds covers the
   * module; 'unrestricted' = the contributor gates nothing right now (monetization
   * off, the platform operator). Plan provisioning, the store's "included in your
   * plan" and the plan-delivered uninstall guard act only on 'plan'
   * (docs/phases/25-marketplace/03-module-governance/06). Unset = 'unrestricted'.
   * 'ceiling' = the contributor is a cap, never a grant (the deployment's platform license edition,
   * fleet step 3b.8): it has no objection and delivers nothing, so it is left out when deciding
   * whether every contributor answers 'plan'.
   */
  source?: 'plan' | 'unrestricted' | 'ceiling';
  /**
   * Set on a refusal by the deployment license's `module:<id>` cap (fleet 3b.11, `module-lifecycle.module-ceiling.ts`),
   * never by a contributor: {@link assertEntitled} audits it as `fleet.license.limit_blocked` and answers its 403.
   */
  deploymentLimit?: DeploymentLimitCheck;
}

/**
 * A contribution to `module_lifecycle:entitlement`. Return `{ entitled: true }`
 * for a module the contributor has no objection to — including every module
 * when its own gate (a monetization switch) is off. Keep it cheap: it runs on
 * every install and activation.
 */
export type EntitlementCheck = (tenantId: string, moduleId: string) => Promise<EntitlementVerdict>;

/**
 * Ask every contributor. Deliberately NOT filtered by the tenant's enabled
 * modules: a tenant that switched the billing rail off must not thereby bypass
 * it — hence the point's `platform` gate (docs/phases/37-extensions): its
 * contributors run whatever the tenant switched on, and only a platform ban
 * stops them; the context stays the tenant's so a failing rail pauses for that
 * tenant only. The first objection in order wins; a contributor that
 * cannot answer (throws, fails to load, does not answer in time, answers
 * garbage) denies.
 */
export async function checkEntitlement(tenantId: string, moduleId: string): Promise<EntitlementVerdict> {
  const { results, unverifiable, blocked } = await ext.guard<EntitlementCheck, EntitlementVerdict>(
    MODULE_LIFECYCLE_ENTITLEMENT_POINT, tenantCtx(tenantId), moduleLifecycleEntitlementLoaders,
    (check) => check(tenantId, moduleId),
    { sequential: true, validate: (verdict) => typeof verdict?.entitled === 'boolean' },
  );
  const objection = results.find((r) => !r.value.entitled);
  if (objection) return objection.value;
  // 'plan' only when every contributor that grants answers 'plan'; a ceiling (a cap, never a grant) is left out,
  // so a license edition gate never hides a plan. With no granting contributor nothing is sold, so 'unrestricted'.
  const granting = results.filter((r) => r.value.source !== 'ceiling');
  const allPlan = granting.length > 0 && granting.every((r) => r.value.source === 'plan');
  if (blocked) {
    for (const f of unverifiable) Logger.error(`[module_lifecycle.entitlement][tenant:${tenantId}][${f.contributionId}] ${f.reason}: ${f.message}`);
    throw new AppError(
      `Cannot verify entitlement: the '${unverifiable[0]!.moduleId}' entitlement check did not answer`,
      503,
      ErrorCode.INTERNAL_ERROR,
    );
  }
  // Every contributor agrees; the deployment license may still switch this module off for a NEW activation (3b.11).
  const capped = await moduleCeilingRefusal(tenantId, moduleId);
  if (capped) return { entitled: false, message: capped.message, deploymentLimit: capped.check };
  return { entitled: true, source: allPlan ? 'plan' : 'unrestricted' };
}

/** Throws 403 (with the contributor's upgrade message) when the tenant is not entitled. */
export async function assertEntitled(tenantId: string, moduleId: string): Promise<void> {
  const verdict = await checkEntitlement(tenantId, moduleId);
  if (!verdict.entitled && verdict.deploymentLimit) {
    recordLimitBlocked(verdict.deploymentLimit, { enforcedBy: 'module_lifecycle', tenantId, details: { moduleId } });
    throw deploymentLimitError(verdict.deploymentLimit, verdict.message);
  }
  if (!verdict.entitled) {
    throw new AppError(
      verdict.message ?? `Module '${moduleId}' is not included in your plan.`,
      403,
      ErrorCode.FORBIDDEN,
    );
  }
}
