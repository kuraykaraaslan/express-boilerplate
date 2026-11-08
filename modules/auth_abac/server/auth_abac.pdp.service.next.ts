import type { NextRequest } from 'next/server';
import TenantSessionNextService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next';
import { runWithRequestMemo } from '@kuraykaraaslan-labs/common/server/request-memo';
import AbacPdpService from './auth_abac.pdp.service';
import type { AbacRuntimeSettings } from './auth_abac.settings.service';
import {
  resolveSubjectAttributes,
  resolveEnvironmentAttributes,
  type SubjectSource,
} from './auth_abac.attributes';
import type { AttributeBag, AuthzRequest, Decision } from './auth_abac.types';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { installVerdictOf } from './auth_abac.install-verdict';

export interface AuthorizePermissionArgs {
  request: NextRequest;
  tenantId: string;
  /** A permission id from a module's catalog, e.g. `dynamic_page.pages.update`. */
  requiredPermission: string;
  /** Optional resource for attribute-based policies (owner/status checks). */
  resource?: { type: string } & AttributeBag;
  /**
   * Enable the (env-keyed) decision cache. Off by default — permission verdicts
   * are matrix-based and the decision key includes `now`, so it never hits;
   * caching is only useful for deterministic attribute policies that opt in.
   */
  cache?: boolean;
  /** Pre-resolved runtime settings, threaded from the PEP guard to skip a re-read. */
  settings?: AbacRuntimeSettings;
  /**
   * Pre-resolved subject session (from the caller's own `authenticateTenantByRequest`).
   * When present, the adapter skips its internal re-authentication — the combined
   * `authorizeRequest` guard passes it so a request authenticates exactly once.
   */
  session?: SubjectSource;
}

/**
 * Derive the environment bag from incoming request headers: ip (the trusted-proxy client address), method, userAgent, host, and now.
 */
export function environmentFromRequest(request: NextRequest): AttributeBag {
  return resolveEnvironmentAttributes({
    ip:
      clientIpOf(request.headers),
    method: request.method,
    now: new Date().toISOString(),
    userAgent: request.headers.get('user-agent') ?? undefined,
    host: request.headers.get('host') ?? undefined,
  });
}

/** `module.resource.verb` → resource type `module.resource` (for policy targeting). */
function resourceTypeOf(permission: string): string {
  const parts = permission.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : permission;
}

/**
 * Thin Next adapter + PEP core: resolve the subject from the tenant session
 * (identity only — the route's own `authenticateTenantByRequest` remains the
 * coarse gate), build an `AuthzRequest` whose `action` IS the required
 * permission, and evaluate. When no ABAC policy applies, `onNotApplicable:
 * 'permission'` enforces the tenant's role→permission matrix: a permission the
 * subject's role has been explicitly denied blocks; a granted or unknown/unseeded
 * permission permits (migration-safe). An explicit policy `deny` always blocks.
 */
export function evaluatePermissionFromRequest(
  args: AuthorizePermissionArgs,
): Promise<Decision> {
  // One scope per decision (or the caller's, e.g. grantedPermissions'): the custom-role union and the matrix
  // fallback below share one read of the role set, and the policy set is read once.
  return runWithRequestMemo(() => evaluate(args));
}

async function evaluate(args: AuthorizePermissionArgs): Promise<Decision> {
  const session = await withAuthenticationMethods(args.request, args.tenantId, args.session ?? (await resolveSessionFromRequest(args.request, args.tenantId)));
  const req: AuthzRequest = {
    subject: await enrichWithCustomRoles(args.tenantId, resolveSubjectAttributes(session), session),
    action: args.requiredPermission,
    resource: args.resource ?? { type: resourceTypeOf(args.requiredPermission) },
    environment: environmentFromRequest(args.request),
  };
  return AbacPdpService.evaluate(args.tenantId, req, {
    // Default off: the env-keyed decision cache never hits for permission checks.
    cache: args.cache ?? false,
    settings: args.settings,
    onNotApplicable: 'permission',
    install: installVerdictOf(args.tenantId, session),
  });
}


/**
 * {@link evaluatePermissionFromRequest} for many permissions over one subject.
 *
 * The subject (custom groups included), the environment and the PDP's policy
 * and role reads are resolved once and every permission is decided in memory
 * through `AbacPdpService.evaluateMany`, instead of paying all of them again per
 * permission. Same `onNotApplicable: 'permission'` semantics, no decision cache
 * (its key holds the request's `now`, so it could not hit anyway). Returns one
 * decision per distinct id.
 */
export async function evaluatePermissionsFromRequest(args: {
  request: NextRequest;
  tenantId: string;
  permissionIds: string[];
  settings?: AbacRuntimeSettings;
  session?: SubjectSource;
}): Promise<Map<string, Decision>> {
  const ids = [...new Set(args.permissionIds)];
  const out = new Map<string, Decision>();
  if (ids.length === 0) return out;
  const session = await withAuthenticationMethods(args.request, args.tenantId, args.session ?? (await resolveSessionFromRequest(args.request, args.tenantId)));
  const subject = await enrichWithCustomRoles(args.tenantId, resolveSubjectAttributes(session), session);
  const environment = environmentFromRequest(args.request);
  const reqs: AuthzRequest[] = ids.map((permission) => ({
    subject,
    action: permission,
    resource: { type: resourceTypeOf(permission) },
    environment,
  }));
  const decisions = await AbacPdpService.evaluateMany(args.tenantId, reqs, {
    settings: args.settings,
    onNotApplicable: 'permission',
    install: installVerdictOf(args.tenantId, session),
  });
  ids.forEach((id, i) => out.set(id, decisions[i]!));
  return out;
}

/**
 * Add `subject.permissions` — the union of the custom groups the member holds
 * (phase 6.3).
 *
 * Kept OUT of `resolveSubjectAttributes` because it is a database read and that
 * function is synchronous and pure by design. Kept out of the PDP core because
 * the core must not know where a permission set comes from.
 *
 * A member with no custom group pays nothing: the common case short-circuits
 * before any lookup. A lookup failure leaves the bag WITHOUT `permissions`
 * rather than empty — an absent attribute is not-applicable to a policy, while
 * an empty array would read as "this person has no permissions at all" and
 * could flip a `subject.permissions contains …` rule from silent to denying.
 */
async function enrichWithCustomRoles(
  tenantId: string,
  bag: AttributeBag,
  session: SubjectSource,
): Promise<AttributeBag> {
  const roleKeys = session.tenantMember?.roleKeys ?? [];
  if (!roleKeys.length) return bag;
  try {
    const { default: TenantRoleService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_role.service');
    const permissions = await TenantRoleService.permissionsFor(tenantId, roleKeys);
    return permissions.length ? { ...bag, permissions } : bag;
  } catch {
    return bag;
  }
}

/** Resolve the subject session from the request (fallback when no session is passed). */
async function resolveSessionFromRequest(
  request: NextRequest,
  tenantId: string,
): Promise<SubjectSource> {
  const auth = await TenantSessionNextService.authenticateTenantByRequest({ request, tenantId });
  return { user: auth.user, tenantMember: auth.tenantMember, userSession: auth.userSession, isGlobalAdmin: auth.isGlobalAdmin };
}

const AUTHENTICATION_ATTRIBUTE_RE = /^subject\.(?:amr|acr)(?:\.|$)/;

/**
 * `subject.amr` / `subject.acr` for a caller whose route passed its session without the user session (the record-level passes, the bulk
 * gating helpers: `{ user, tenantMember }` only). Lazy, as the attribute providers are: only when a policy of the tenant names one of them
 * (the policy set is memoised for the decision, so the common case pays nothing), the request's own user session is read, and used only when
 * it belongs to the same user. Any failure leaves both attributes absent, read as the empty string: a requirement written as a deny
 * (`deny when acr nin [HIGH]`) then refuses, which is why requirements must be denies. A permit is no requirement: one that does not match
 * leaves the decision to the role matrix, and `neq` / `nin` on an absent value hold, so a permit on them would even grant.
 */
async function withAuthenticationMethods(request: NextRequest, tenantId: string, session: SubjectSource): Promise<SubjectSource> {
  if (!session.user || session.userSession !== undefined) return session;
  try {
    // Loaded lazily, like the session service below: this adapter stays importable without the database.
    const { default: AbacPolicyService } = await import('./auth_abac.policy.service');
    const policies = await AbacPolicyService.loadSet(tenantId);
    if (!policies.some((p) => p.rules.some((r) => AUTHENTICATION_ATTRIBUTE_RE.test(r.attribute)))) return session;
    const { default: UserSessionNextService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service.next');
    const auth = await UserSessionNextService.authenticateUserByRequest({ request });
    return auth.user.userId === session.user.userId ? { ...session, userSession: auth.userSession } : { ...session, userSession: null };
  } catch {
    return { ...session, userSession: null };
  }
}
