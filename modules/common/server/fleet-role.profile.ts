/**
 * Fleet role profile table (docs/phases/02-fleet, Decision 2 and 26).
 *
 * The role is a BUILD argument (`BUILD_ROLE`, baked into the image); the runtime
 * `FLEET_ROLE` is only compared against it at boot. A runtime-only flag would fail
 * open when unset, so an unset `FLEET_ROLE` is `single` (today's standalone) and
 * every non-`single` role must be matched by an equal baked `BUILD_ROLE`.
 */
export const FLEET_ROLES = ['single', 'node', 'fleet'] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

export interface FleetRoleProfile {
  /** Business modules (CRM, commerce, ...) are present in the image's registries. */
  businessModules: boolean;
  /** Fleet control-plane domain (`modules/fleet`) is present. */
  fleetConsole: boolean;
  /** Fleet ID (OIDC provider for every node) is served. */
  fleetIdentity: boolean;
  /** The deployment is enrolled with a fleet instance and obeys its signed commands. */
  enrolled: boolean;
  /** Boot fails without the field-encryption key (`encryption.field_key_present`). */
  requiresFieldKey: boolean;
  /** Super-admin session path is removed (operators come from the fleet tenant). */
  superAdminRemoved: boolean;
}

export const FLEET_ROLE_PROFILES: Readonly<Record<FleetRole, Readonly<FleetRoleProfile>>> = Object.freeze({
  single: { businessModules: true, fleetConsole: false, fleetIdentity: false, enrolled: false, requiresFieldKey: false, superAdminRemoved: false },
  node: { businessModules: true, fleetConsole: false, fleetIdentity: false, enrolled: true, requiresFieldKey: true, superAdminRemoved: true },
  fleet: { businessModules: false, fleetConsole: true, fleetIdentity: true, enrolled: false, requiresFieldKey: true, superAdminRemoved: true },
});

export function isFleetRole(v: unknown): v is FleetRole {
  return typeof v === 'string' && (FLEET_ROLES as readonly string[]).includes(v);
}

export function getFleetRoleProfile(role: FleetRole): Readonly<FleetRoleProfile> {
  return FLEET_ROLE_PROFILES[role];
}

export type FleetRoleBakedVerdict =
  | { ok: true; role: FleetRole }
  | { ok: false; runtime: FleetRole; baked: FleetRole };

/**
 * `env.FLEET_ROLE === BUILD_ROLE` boot assertion (pure). Unset on both sides is
 * `single`. An unset `BUILD_ROLE` is `single` too, so a `node`/`fleet` runtime
 * without a matching baked role fails closed.
 */
export function checkFleetRoleBaked(env: { FLEET_ROLE?: FleetRole; BUILD_ROLE?: FleetRole }): FleetRoleBakedVerdict {
  const runtime = env.FLEET_ROLE ?? 'single';
  const baked = env.BUILD_ROLE ?? 'single';
  return runtime === baked ? { ok: true, role: runtime } : { ok: false, runtime, baked };
}

export function assertFleetRoleBaked(env: { FLEET_ROLE?: FleetRole; BUILD_ROLE?: FleetRole }): FleetRole {
  const v = checkFleetRoleBaked(env);
  if (!v.ok) throw new Error(`FLEET_ROLE (${v.runtime}) does not match the role baked at build (BUILD_ROLE=${v.baked}); refusing to start`);
  return v.role;
}
