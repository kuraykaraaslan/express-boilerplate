import type { TelemetryReadContext } from './telemetry.kinds';

/**
 * A kind's `canRead` for data that a module permission guards (docs/phases/42-telemetry/00 §0.4; 05 `fx.history.read`, 06
 * `metering.usage.read` and `tenant_usage.metrics.read`): does the reader hold at least the ROLE FLOOR of that permission in the tenant?
 *
 * The generic read routes and the dashboard source hand the kind the reader's `memberRole` with the context; without it the member is
 * looked up (`tenant_member`). This is the coarse floor the API applies before the policy engine, not the engine's own decision: a
 * custom group lift or an ABAC policy on the module's permission is not consulted here. A context without a user (a server-side caller
 * acting for its module) never passes: such a caller reads the service directly, not through the gate.
 */
export async function readerMeetsPermission(ctx: TelemetryReadContext, permissionId: string): Promise<boolean> {
  if (!ctx.userId) return false;
  const { tenantFloorOf, FLOOR_RANK } = await import('@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.core.next');
  const floor = tenantFloorOf(permissionId);
  const role = typeof ctx.memberRole === 'string' ? ctx.memberRole : undefined;
  if (role) return (FLOOR_RANK[role as keyof typeof FLOOR_RANK] ?? -1) >= FLOOR_RANK[floor];
  try {
    const { checkPermission } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.helpers');
    return await checkPermission(ctx.tenantId, ctx.userId, floor);
  } catch {
    return false;
  }
}

/** `canRead` for a kind whose every entity is readable by whoever holds the permission (RLS already scopes the rows to the tenant). */
export function canReadWithPermission(permissionId: string): (ctx: TelemetryReadContext, entityIds: readonly string[]) => Promise<Set<string>> {
  return async (ctx, entityIds) => ((await readerMeetsPermission(ctx, permissionId)) ? new Set(entityIds.map((e) => e.toLowerCase())) : new Set());
}
