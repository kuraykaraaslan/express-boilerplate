import Logger from '@kuraykaraaslan-labs/logger';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { featureGateDeploymentUsageLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/feature_gate.deployment_usage';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { FEATURE_GATE_MESSAGES } from './feature_gate.messages';
import { resolveCeiling } from './feature_gate.ceiling';
import type { DeploymentCapReport, DeploymentUsageProvider, EntitlementFeature } from './feature_gate.types';
import { capAsLimit, evaluateDeploymentLimit, type DeploymentLimitCheck } from './feature_gate.deployment-limit.rules';

/**
 * Deployment-wide limits (fleet step 3b.11, owner rule S11 rules 3, 4, 7 and 8).
 *
 * `checkFeatureAccess` answers for ONE tenant: its plan, capped by the deployment ceiling. A few counts are not any
 * tenant's: how many customer tenants this deployment holds, how many nodes and regions a control plane manages. A
 * tenant plan says nothing about them, so the answer is the ceiling alone. This file is the only reader of the ceiling
 * for those counts; the counting itself stays with the module that owns the rows (`tenant` counts tenants under its
 * own lock, `fleet` nodes and regions), so no module reads the license directly (rule 8).
 *
 * Semantics: a key no contributor caps is allowed (no license, or a license without that cap, changes nothing). A
 * BOOLEAN `false` (or a LIMIT `0`) refuses every new one; a LIMIT `n` allows while the count is below `n`; `-1` is
 * unlimited. No grace percentage: a license cap is a hard number. Only NEW creations ask (rule 4): nothing here ever
 * removes or disables what already exists.
 */

/** The audit action every refusal by a deployment cap writes (rule 7: never a silent failure). */
export const LIMIT_BLOCKED_ACTION = 'fleet.license.limit_blocked';

export { capAsLimit, evaluateDeploymentLimit, type DeploymentLimitCheck } from './feature_gate.deployment-limit.rules';

/** The deployment's cap for one key, or undefined when nothing caps it. Throws only when the ceiling has never answered in this process (fail closed). */
export async function deploymentCap(featureKey: string): Promise<EntitlementFeature | undefined> {
  return (await resolveCeiling())?.get(featureKey);
}

/** Every cap the deployment ceiling holds right now, sorted by key (for the console). Empty when nothing caps anything. */
export async function deploymentCaps(): Promise<EntitlementFeature[]> {
  const ceiling = await resolveCeiling();
  return ceiling ? [...ceiling.values()].sort((a, b) => a.key.localeCompare(b.key)) : [];
}

/** Extension point id — declared in feature_gate/module.json `extensionPoints`. */
export const FEATURE_GATE_USAGE_POINT = 'feature_gate:deployment_usage';

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * The console's deployment limits (S11 rule 7): every cap the ceiling holds, with how many exist now where a module
 * counts that key (`feature_gate:deployment_usage`). Display only. A counter that fails leaves its keys `null`; two
 * counters for one key are summed (each counts its own rows).
 */
export async function deploymentCapsReport(): Promise<DeploymentCapReport[]> {
  const caps = await deploymentCaps();
  if (caps.length === 0) return [];
  const usage = new Map<string, number>();
  try {
    const { results } = await ext.aggregate<DeploymentUsageProvider, Readonly<Record<string, number>>>(
      FEATURE_GATE_USAGE_POINT, systemCtx('feature_gate deployment usage'), featureGateDeploymentUsageLoaders,
      async (count) => count(),
    );
    for (const { value } of results) {
      if (!value || typeof value !== 'object') continue;
      for (const [key, n] of Object.entries(value)) if (isCount(n)) usage.set(key, (usage.get(key) ?? 0) + n);
    }
  } catch (err) {
    Logger.error(`[feature_gate] deployment usage: ${err instanceof Error ? err.message : String(err)}`);
  }
  // A cap row's type is a string column; anything but BOOLEAN reads as a LIMIT (capAsLimit already treats it so).
  return caps.map((c): DeploymentCapReport => ({ key: c.key, type: c.type === 'BOOLEAN' ? 'BOOLEAN' : 'LIMIT', value: c.value, limit: capAsLimit(c), current: usage.get(c.key) ?? null }));
}

/** {@link evaluateDeploymentLimit} against the live ceiling. */
export async function checkDeploymentLimit(featureKey: string, current: number): Promise<DeploymentLimitCheck> {
  return evaluateDeploymentLimit(featureKey, await deploymentCap(featureKey), current);
}

export interface LimitBlockedContext {
  /** The module that refused (`tenant`, `module_lifecycle`, `fleet`). */
  enforcedBy: string;
  actorId?: string | null;
  /** The tenant the creation was for, when there is one (a module activation); never a secret. */
  tenantId?: string | null;
  /** Extra non-secret detail for the audit row (a module id, a region code). */
  details?: Record<string, unknown>;
}

/**
 * The audit row of a refusal (rule 7). Written under the root tenant like every other deployment license event, and
 * best-effort: an audit outage must not turn a clear 403 into a 500. `audit_log` is reached by a dynamic import for
 * the reason `feature_gate.cache.ts` gives.
 */
export function recordLimitBlocked(check: DeploymentLimitCheck, ctx: LimitBlockedContext): void {
  import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    .then(({ default: AuditLogService }) => AuditLogService.log({
      tenantId: ROOT_TENANT_ID,
      actorType: ctx.actorId ? 'USER' : 'SYSTEM',
      actorId: ctx.actorId ?? null,
      action: LIMIT_BLOCKED_ACTION,
      resourceType: 'DeploymentLimit',
      resourceId: check.featureKey,
      metadata: {
        featureKey: check.featureKey,
        limit: check.limit,
        current: check.current,
        enforcedBy: ctx.enforcedBy,
        forTenantId: ctx.tenantId ?? null,
        ...(ctx.details ?? {}),
      },
    }))
    .catch((err) => Logger.error(`[feature_gate] ${LIMIT_BLOCKED_ACTION} audit failed: ${err instanceof Error ? err.message : String(err)}`));
}

/** The refusal a caller throws: 403 FEATURE_NOT_AVAILABLE, the shape `assertFeatureAccess` already answers, with the numbers. */
export function deploymentLimitError(check: DeploymentLimitCheck, message?: string): AppError {
  return new AppError(
    message ?? (check.limit === 0 ? FEATURE_GATE_MESSAGES.DEPLOYMENT_FEATURE_OFF : FEATURE_GATE_MESSAGES.DEPLOYMENT_LIMIT_REACHED),
    403,
    ErrorCode.FEATURE_NOT_AVAILABLE,
    { details: { featureKey: check.featureKey, limit: check.limit, current: check.current, reason: 'DEPLOYMENT_LIMIT' } },
  );
}

/**
 * Check, and on a refusal audit and throw. For callers whose count is already final (no concurrent creation can slip
 * in between); a caller that must serialise creations (tenant) checks inside its own lock with
 * {@link evaluateDeploymentLimit} and calls {@link recordLimitBlocked} and {@link deploymentLimitError} itself.
 */
export async function assertDeploymentLimit(featureKey: string, current: number, ctx: LimitBlockedContext, message?: string): Promise<DeploymentLimitCheck> {
  const check = await checkDeploymentLimit(featureKey, current);
  if (!check.allowed) {
    recordLimitBlocked(check, ctx);
    throw deploymentLimitError(check, message);
  }
  return check;
}
