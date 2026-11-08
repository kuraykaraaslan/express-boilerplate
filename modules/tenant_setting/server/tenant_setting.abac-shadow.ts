import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * ABAC shadow mode on fleet roles (docs/phases/02-fleet P9-10, S1). Pure: no environment, so the node's compliance judge can use it too.
 *
 * `abacShadowMode` turns every ABAC deny into a logged permit. On a fleet node or the fleet instance nobody may turn it on: the fleet config lane never
 * carries it (the fleet_protocol hard denylist) and no class-3 path exists for it, so the local write is refused as well
 * (`assertAbacShadowWriteAllowed`, called by every write of tenant_setting.write.service and by the approval check of a parked change, with the process
 * role). Only an explicit off ('false', '0' or empty) is accepted there; the ABAC runtime
 * ignores a stored "on" on those roles (`effectiveShadowMode`) and the node's compliance check `abac.shadow_off` reports one.
 */
export const ABAC_SHADOW_MODE_KEY = 'abacShadowMode';
const SHADOW_OFF_VALUES: ReadonlySet<string> = new Set(['', 'false', '0']);

/** Whether this role refuses an ABAC shadow mode: `node` and `fleet` do, `single` (and an unset role) does not. */
export function isShadowModeRefusedRole(role: string | undefined): boolean {
  return role === 'node' || role === 'fleet';
}

/** Whether a stored or submitted `abacShadowMode` value is anything but an explicit off (fail closed: an unknown value counts as on). */
export function isShadowModeOnValue(value: string): boolean {
  return !SHADOW_OFF_VALUES.has(value.trim().toLowerCase());
}

/**
 * Throws a 403 when a write of `key` would turn ABAC shadow mode on under a role that refuses it. The key is matched case-insensitively: on a fleet
 * role a case variant is refused whatever its value (it is not the key the runtime reads, so it has no business there).
 */
export function assertAbacShadowWriteAllowed(key: string, value: string, role: string | undefined): void {
  if (key.toLowerCase() !== ABAC_SHADOW_MODE_KEY.toLowerCase() || !isShadowModeRefusedRole(role)) return;
  if (key !== ABAC_SHADOW_MODE_KEY || isShadowModeOnValue(value)) {
    throw new AppError(
      'ABAC shadow mode cannot be turned on on a fleet node or the fleet instance: policies are always enforced there.',
      403,
      ErrorCode.FORBIDDEN,
    );
  }
}
