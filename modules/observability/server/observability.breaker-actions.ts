import redis from '@kuraykaraaslan-labs/redis';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { PLUGIN_VERSION_SCOPE } from '@kuraykaraaslan-labs/common/server/extensions/breaker';
import { closePluginVersionBreaker, holdPluginVersionBreaker } from '@kuraykaraaslan-labs/common/server/extensions/plugin-version-breaker';
import {
  BREAKER_COMMANDS_CHANNEL, OPEN_BREAKERS_KEY, announceExtensionState, applyBreakerCommand, fieldOf,
  type BreakerCommand, type OpenBreakerRecord,
} from './observability.extension-health';

/**
 * A hand on the extension breaker (docs/phases/37-extensions/04): "close now" lets a paused contribution run again at
 * once; "keep open" keeps it paused, with no probe, until a time. A contribution's breaker lives in every process, so
 * the command is applied here and broadcast to the others; a plugin version's lives in Redis and is changed there.
 * Either way the operator view's record and the open admin pages follow, and the action is audited: in the workspace
 * it concerns, and in ROOT too when an operator acted on anything but its own workspace (the module_lifecycle
 * operator pattern).
 */

export type BreakerTarget =
  | { kind: 'contribution'; scope: string; contributionId: string }
  | { kind: 'plugin-version'; pluginVersionId: string };

export interface BreakerActor {
  actorId: string | null;
  /** The tenant the request was made in (a workspace's own, or ROOT for an operator). */
  actingTenantId: string;
  reason: string;
}

const scopeOf = (t: BreakerTarget) => (t.kind === 'plugin-version' ? PLUGIN_VERSION_SCOPE : t.scope);
const idOf = (t: BreakerTarget) => (t.kind === 'plugin-version' ? t.pluginVersionId : t.contributionId);
const fieldFor = (t: BreakerTarget) => fieldOf({ scope: scopeOf(t), contributionId: idOf(t) });

async function recordOf(t: BreakerTarget): Promise<OpenBreakerRecord | null> {
  const raw = await redis.hget(OPEN_BREAKERS_KEY, fieldFor(t));
  if (!raw) return null;
  try { return JSON.parse(raw) as OpenBreakerRecord; } catch { return null; }
}

/** This process at once (its subscriber may not be up), every other one through the command channel. */
async function broadcast(cmd: BreakerCommand): Promise<void> {
  applyBreakerCommand(cmd);
  await redis.publish(BREAKER_COMMANDS_CHANNEL, JSON.stringify(cmd));
}

async function audit(
  what: 'closed' | 'held', target: BreakerTarget, actor: BreakerActor, record: OpenBreakerRecord | null, extra: Record<string, unknown> = {},
): Promise<void> {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  const metadata = {
    reason: actor.reason, scope: scopeOf(target), contributionId: idOf(target),
    ...(record ? { point: record.point, moduleId: record.moduleId, pausedFor: record.reason } : {}), ...extra,
  };
  const workspace = target.kind === 'contribution' && target.scope !== 'system' ? target.scope : null;
  // Best effort, like logOperatorAction: the action has already happened.
  if (workspace) {
    await AuditLogService.log({
      tenantId: workspace, actorId: actor.actorId, actorType: 'USER', action: `observability.extensions.breaker_${what}`,
      resourceType: 'extension_contribution', resourceId: idOf(target), metadata,
    }).catch(() => {});
  }
  if (workspace !== actor.actingTenantId) {
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorId: actor.actorId, actorType: 'USER', action: `observability.operator.breaker_${what}`,
      resourceType: workspace ? 'tenant' : target.kind === 'plugin-version' ? 'plugin_version' : 'extension_contribution',
      resourceId: workspace ?? idOf(target), metadata,
    }).catch(() => {});
  }
}

/** Close now. Closing one that is no longer open is not an error (it may have recovered meanwhile). */
export async function closeBreakerNow(target: BreakerTarget, actor: BreakerActor): Promise<{ wasOpen: boolean }> {
  const record = await recordOf(target);
  if (target.kind === 'plugin-version') await closePluginVersionBreaker(target.pluginVersionId);
  else await broadcast({ action: 'close', scope: target.scope, contributionId: target.contributionId });
  await redis.hdel(OPEN_BREAKERS_KEY, fieldFor(target));
  await announceExtensionState(scopeOf(target));
  await audit('closed', target, actor, record);
  return { wasOpen: record !== null };
}

/** Keep open until `until`: only a breaker the operator view lists (it names the point and module to hold). */
export async function keepBreakerOpen(target: BreakerTarget, until: number, actor: BreakerActor): Promise<OpenBreakerRecord> {
  const record = await recordOf(target);
  if (!record) throw new AppError('Nothing is paused under that name; only a paused contribution can be kept paused', 404, ErrorCode.NOT_FOUND);
  if (target.kind === 'plugin-version') {
    await holdPluginVersionBreaker(target.pluginVersionId, until, actor.reason);
  } else {
    await broadcast({
      action: 'hold', scope: target.scope, contributionId: target.contributionId, until,
      point: record.point, moduleId: record.moduleId, reason: actor.reason,
    });
  }
  const next: OpenBreakerRecord = { ...record, until, held: true, heldReason: actor.reason };
  await redis.hset(OPEN_BREAKERS_KEY, fieldFor(target), JSON.stringify(next));
  await announceExtensionState(scopeOf(target));
  await audit('held', target, actor, record, { until: new Date(until).toISOString() });
  return next;
}
