import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { noteRequestPrincipal } from '@kuraykaraaslan-labs/common/server/request-observer';
import { principalOfAuthResult } from './auth_abac.request-principal';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import AbacSettingsService from './auth_abac.settings.service';
import { evaluatePermissionFromRequest } from './auth_abac.pdp.service.next';
import type { Decision } from './auth_abac.types';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import {
  deriveScope,
  authorizeTenant,
  authorizeGuest,
  authorizeRoot,
  authorizeGlobal,
  authorizeAccount,
} from './auth_abac.guard.scopes.next';
import { decisionBlocks } from './auth_abac.guard.core.next';
// Re-exported from the guard so callers have one import for authorization,
// whether they are guarding a route or filtering a list.
export { grantedPermissions } from './auth_abac.guard.scopes.next';
import type {
  AuthorizeArgs,
  AuthorizeTenantArgs,
  AuthorizeGuestArgs,
  AuthorizeRootArgs,
  AuthorizeGlobalArgs,
  AuthorizeAccountArgs,
  AuthorizeDerivedArgs,
  PublicAuthResult,
  AccountAuthResult,
} from './auth_abac.guard.types';

// Re-export the guard's public surface so existing importers of these types keep
// resolving against this file after the code-organization split.
export type {
  AuthorizeArgs,
  AuthorizationScope,
  AuthorizeRequestBase,
  AuthorizeTenantArgs,
  AuthorizeGuestArgs,
  AuthorizeRootArgs,
  AuthorizeGlobalArgs,
  AuthorizeAccountArgs,
  AuthorizeDerivedArgs,
  PublicAuthResult,
  AccountAuthResult,
} from './auth_abac.guard.types';

/**
 * The PEP guard — the permission twin of `authenticateTenantByRequest`. Call it
 * AFTER the route's coarse `authenticateTenantByRequest({ requiredTenantRole })`:
 * it resolves the subject from the session itself, evaluates ABAC policies keyed
 * on `requiredPermission`, and throws `AppError(FORBIDDEN, 403)` on an explicit
 * policy deny. Silent return means permit.
 *
 * ABAC is additive: with no policy targeting the permission the request is
 * permitted (the coarse role gate already authorized it) — so wrapping a route
 * changes nothing until an admin writes a policy. Under shadow mode
 * (`abacShadowMode`) the PDP logs the decision with `enforced:false` but a deny
 * never blocks — the safe-rollout escape hatch.
 */
export async function authorize(args: AuthorizeArgs): Promise<void> {
  const settings = await AbacSettingsService.getRuntimeSettings(args.tenantId);
  const decision = await evaluatePermissionFromRequest({ ...args, settings });
  if (decisionBlocks(decision, settings)) {
    throw new AppError(MSG.FORBIDDEN, 403, ErrorCode.FORBIDDEN);
  }
}

/**
 * Non-throwing variant for conditional branches / UI gating — returns the raw
 * decision so the caller can read effect + reason instead of catching. Shadow
 * mode does not change the returned decision (it only affects whether
 * `authorize()` blocks).
 */
export async function can(args: AuthorizeArgs): Promise<Decision> {
  return evaluatePermissionFromRequest(args);
}

// ── Unified guard: `authorizeRequest` ───────────────────────────────────────

/**
 * The one-call authorization guard: a drop-in for `authenticateTenantByRequest` that
 * also enforces `requiredPermission`, unifying the tenant / public / root scopes.
 *
 * - `scope: 'TENANT'` (or omitted for a non-GUEST permission) → authenticates at the
 *   permission's coarse floor and returns the full `TenantAuthResult` (non-null identity).
 * - `scope: 'GUEST'` (or omitted for a `minRole:'GUEST'` permission) → anonymous-tolerant,
 *   never throws on missing auth, returns a nullable `PublicAuthResult`.
 * - `scope: 'ROOT'` → root-tenant super-admin; returns `TenantAuthResult`.
 * - `scope: 'GLOBAL'` → root-tenant super-admin behind the KD-13 IP/MFA gate; `TenantAuthResult`.
 * - `scope: 'ACCOUNT'` → a logged-in user with no tenant membership (self-service);
 *   returns `AccountAuthResult` (user present, tenant/tenantMember null).
 *
 * Behaviour is unchanged until an admin removes the permission from a role (→ 403) or
 * writes a policy. Under `abacShadowMode` a permission deny is logged but does not block.
 * The guard throws status-carrying `AppError`s, so call it under the route's single
 * outer try/catch — no dedicated try/catch is needed.
 */
export function authorizeRequest(args: AuthorizeTenantArgs): Promise<TenantAuthResult>;
export function authorizeRequest(args: AuthorizeRootArgs): Promise<TenantAuthResult>;
export function authorizeRequest(args: AuthorizeGlobalArgs): Promise<TenantAuthResult>;
export function authorizeRequest(args: AuthorizeAccountArgs): Promise<AccountAuthResult>;
export function authorizeRequest(args: AuthorizeGuestArgs): Promise<PublicAuthResult>;
export function authorizeRequest(args: AuthorizeDerivedArgs): Promise<PublicAuthResult>;
export async function authorizeRequest(
  args:
    | AuthorizeTenantArgs
    | AuthorizeGuestArgs
    | AuthorizeRootArgs
    | AuthorizeGlobalArgs
    | AuthorizeAccountArgs
    | AuthorizeDerivedArgs,
): Promise<TenantAuthResult | PublicAuthResult | AccountAuthResult> {
  const result = await authorizeByScope(args);
  notePrincipal(args.request, result);
  return result;
}

function authorizeByScope(
  args:
    | AuthorizeTenantArgs
    | AuthorizeGuestArgs
    | AuthorizeRootArgs
    | AuthorizeGlobalArgs
    | AuthorizeAccountArgs
    | AuthorizeDerivedArgs,
): Promise<TenantAuthResult | PublicAuthResult | AccountAuthResult> {
  const scope = deriveScope(args);
  switch (scope) {
    case 'GUEST':
      return authorizeGuest(args);
    case 'ACCOUNT':
      return authorizeAccount(args);
    case 'ROOT':
      return authorizeRoot(args as AuthorizeRootArgs);
    // Split off ROOT: a federated caller is authenticated in THEIR agency but judged
    // against the CLIENT's policy set, which authorizeRoot cannot express.
    case 'GLOBAL':
      return authorizeGlobal(args);
    case 'TENANT':
    default:
      return authorizeTenant(args);
  }
}

/**
 * Phase 55 02 §2.1: the caller this guard authenticated, noted beside the request (ids and the member's role, never a token) for the
 * AI firewall's feature store, which the dispatcher's observation reads (common/server/request-observer.ts). A guest without a user
 * notes nothing; an impersonation notes the operator (`principalOfAuthResult`, D55-47). Never throws: bookkeeping never changes an
 * authorization.
 */
function notePrincipal(request: unknown, result: TenantAuthResult | PublicAuthResult | AccountAuthResult): void {
  try {
    const principal = principalOfAuthResult(result);
    if (principal) noteRequestPrincipal(request, principal);
  } catch {
    // never changes the answer
  }
}
