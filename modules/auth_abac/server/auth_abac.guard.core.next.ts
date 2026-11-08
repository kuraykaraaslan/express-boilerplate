import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import TenantSessionNextService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import type { TenantMemberRole, PermissionFloor } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import ObservabilityService from '@kuraykaraaslan-labs/observability';
import AbacSettingsService from './auth_abac.settings.service';
import { evaluatePermissionFromRequest } from './auth_abac.pdp.service.next';
import type { SubjectSource } from './auth_abac.attributes';
import type { Decision } from './auth_abac.types';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import TenantAuthMessages from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.messages';
import UserSessionMessages from '@kuraykaraaslan-labs/user_session/server/user_session.messages';
import Logger from '@kuraykaraaslan-labs/logger';

/** The plain-Error messages the authentication path throws on purpose (a refusal the caller may read). */
const KNOWN_AUTH_MESSAGES: ReadonlySet<string> = new Set<string>([
  ...Object.values(TenantAuthMessages),
  ...Object.values(UserSessionMessages as Record<string, string>),
]);
import type { AuthorizationScope, AuthorizeRequestBase } from './auth_abac.guard.types';

// Lazily-built permission-id → coarse floor map (the registry is static at
// runtime). A permission's floor mirrors the wrapped route's old
// `requiredTenantRole`; absent → 'ADMIN' (the dominant floor). Widened to
// `PermissionFloor` because public permissions carry `minRole: 'GUEST'` (rank 0),
// which `deriveScope` reads to auto-route to the anonymous-tolerant path.
let PERMISSION_MIN_ROLE: Map<string, PermissionFloor> | null = null;
export function minRoleOf(permissionId: string): PermissionFloor {
  if (!PERMISSION_MIN_ROLE) {
    PERMISSION_MIN_ROLE = new Map(
      moduleRegistry.getPermissions().map((p) => [p.id, (p.minRole as PermissionFloor) ?? 'ADMIN']),
    );
  }
  return PERMISSION_MIN_ROLE.get(permissionId) ?? 'ADMIN';
}

/**
 * The coarse TENANT floor for a permission: its `minRole`, with the public
 * sentinel `'GUEST'` coerced to `'USER'`. A GUEST-floored permission only reaches
 * the tenant path via an explicit, catalog-inconsistent `scope` — which
 * `assertScopeConsistent` flags — so the coercion is just a safe fallback.
 */
export function tenantFloorOf(permissionId: string): TenantMemberRole {
  const floor = minRoleOf(permissionId);
  return floor === 'GUEST' ? 'USER' : floor;
}

/** Normalize any auth throw to a status-carrying AppError (404 for not-found, else 403). */
export function normalizeAuthError(err: unknown): never {
  if (err instanceof AppError) throw err;
  // authenticateTenantByRequest throws plain Error on some paths (tenant-not-found /
  // insufficient role) — normalize so the route catch maps 403/404, not 500.
  const message = err instanceof Error ? err.message : String(err);
  // E-17: anything else (a driver or network failure with host, port, user, database) is not a refusal to explain: it is
  // logged and answered with a generic, retryable 503, never echoed to the caller.
  if (!KNOWN_AUTH_MESSAGES.has(message)) {
    Logger.error(`[auth_abac] authentication failed unexpectedly: ${message}`);
    throw new AppError('Authentication is temporarily unavailable.', 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
  const notFound = /not found/i.test(message);
  throw new AppError(
    message,
    notFound ? 404 : 403,
    notFound ? ErrorCode.NOT_FOUND : ErrorCode.FORBIDDEN,
  );
}

/**
 * auth.05: the permissions of the forced change-password step. A session that must change its password (SessionMeta
 * .passwordChangeRequired) reaches exactly these: reading its own session (so the client can show the change-password
 * page), the one-time-code step that may still come first, and the change itself. Every other route refuses it 403
 * PASSWORD_CHANGE_REQUIRED.
 */
export const PASSWORD_CHANGE_STEP_PERMISSIONS: ReadonlySet<string> = new Set([
  'auth.account.change_password', 'auth.session.read', 'auth.me.otp.send', 'auth.me.otp.verify',
]);

/**
 * Phase 55 00.6: the permissions of the step-up forced on a live session (SessionMeta.stepUpRequired, user_session.step-up-flag.ts).
 * Such a session reaches exactly these: the step-up itself (options and verify) and reading its own session (so the shell still
 * renders and the person can sign out). Every other route refuses it 401 SESSION_STEP_UP_REQUIRED with `details.stepUp`.
 * Not the one-time-code routes (`auth.me.otp.send` / `auth.me.otp.verify`, phase 55 00 review): no code step comes before a forced
 * step-up (it is refused for a session still waiting for its second factor, and the step-up proves an authenticator app or a passkey,
 * never an e-mail or SMS code), and through them a suspect session could still add or remove e-mail and SMS factors.
 */
export const SESSION_STEP_UP_PERMISSIONS: ReadonlySet<string> = new Set([
  'auth.session.step_up', 'auth.session.read',
]);

/** Authenticate at the coarse floor, normalizing plain-Error throws to AppError. */
export async function authenticateAtFloor(
  request: NextRequest,
  tenantId: string,
  requiredTenantRole: TenantMemberRole,
  requiredPermission?: string,
): Promise<TenantAuthResult> {
  try {
    return await TenantSessionNextService.authenticateTenantByRequest({
      request,
      tenantId,
      requiredTenantRole,
      refuseNonMember: true,
      passwordChangeBypass: requiredPermission !== undefined && PASSWORD_CHANGE_STEP_PERMISSIONS.has(requiredPermission),
      sessionStepUpBypass: requiredPermission !== undefined && SESSION_STEP_UP_PERMISSIONS.has(requiredPermission),
    });
  } catch (err) {
    normalizeAuthError(err);
  }
}

/**
 * Resolve the effective scope. An explicit scope wins (and is consistency-checked
 * against the catalog); an omitted scope derives GUEST-vs-TENANT from the
 * permission's floor. ROOT is never derived — they must be explicit.
 */
export function deriveScope(args: { scope?: AuthorizationScope; requiredPermission: string }): AuthorizationScope {
  if (args.scope) {
    assertScopeConsistent(args.scope, args.requiredPermission);
    return args.scope;
  }
  return minRoleOf(args.requiredPermission) === 'GUEST' ? 'GUEST' : 'TENANT';
}

/**
 * Guard against an explicit scope that contradicts the permission catalog: a public
 * route tagged TENANT, or a tenant route tagged GUEST. Only GUEST↔non-GUEST is
 * catalog-checkable (ROOT is cross-tenant, not encoded in `minRole`).
 * Records the anomaly, and throws in non-production so the mistake surfaces in tests/CI.
 */
function assertScopeConsistent(scope: AuthorizationScope, permissionId: string): void {
  if (scope !== 'GUEST' && scope !== 'TENANT') return;
  const floorIsGuest = minRoleOf(permissionId) === 'GUEST';
  if (floorIsGuest === (scope === 'GUEST')) return; // consistent
  const msg = `abac: scope '${scope}' conflicts with '${permissionId}' minRole (${floorIsGuest ? 'GUEST' : 'non-GUEST'})`;
  ObservabilityService.recordError(new Error(msg));
  if (process.env.NODE_ENV !== 'production') {
    throw new AppError(msg, 500, ErrorCode.INTERNAL_ERROR);
  }
}

export function requireTenantId(tenantId: string | undefined): string {
  if (!tenantId) throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
  return tenantId;
}

/**
 * The single permit/deny PEP step, shared by every scope. The caller has already
 * authenticated ONCE upstream; the resolved `session` is passed so there is no
 * second auth. Throws `AppError(403)` on an enforced policy deny (not under shadow mode).
 */
export async function enforcePermission(
  args: AuthorizeRequestBase,
  tenantId: string,
  session: SubjectSource,
): Promise<void> {
  const settings = await AbacSettingsService.getRuntimeSettings(tenantId);
  const decision = await evaluatePermissionFromRequest({
    request: args.request,
    tenantId,
    requiredPermission: args.requiredPermission,
    resource: args.resource,
    cache: args.cache,
    settings,
    session,
  });
  if (decisionBlocks(decision, settings)) {
    throw new AppError(MSG.FORBIDDEN, 403, ErrorCode.FORBIDDEN);
  }
}

/**
 * Does this decision refuse the request? A deny blocks unless the tenant runs the engine in shadow mode, except a deny
 * of the installation's config/access.ts: shadow mode is a setting in the UI, and nothing in the UI loosens the
 * installation's config (docs/phases/45-install-config D45-4).
 */
export function decisionBlocks(decision: Decision, settings: { shadowMode?: boolean }): boolean {
  return decision.effect === 'deny' && (!settings.shadowMode || decision.reason === 'install_config');
}

/** Coarse floor ranks, mirroring the PDP's own table. */
export const FLOOR_RANK: Record<PermissionFloor, number> = { OWNER: 3, ADMIN: 2, USER: 1, GUEST: 0 };
