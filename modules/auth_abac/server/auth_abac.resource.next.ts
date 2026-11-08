import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import AbacSettingsService from './auth_abac.settings.service';
import { evaluatePermissionFromRequest } from './auth_abac.pdp.service.next';
import { decisionBlocks } from './auth_abac.guard.core.next';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import type { AttributeBag } from './auth_abac.types';

/**
 * The second half of an attribute-based decision: judge the RECORD.
 *
 * ## Why this file exists
 *
 * `authorizeRequest` has always accepted a `resource` bag, and `PolicyRule`
 * has always been able to read `resource.*`. But a route cannot fill that bag
 * on its first call: the guard runs before anything is loaded, which is the
 * correct order — an unauthenticated caller must not be able to make us read a
 * row. So in practice nothing ever passed one. A 2026-08-19 sweep found **zero**
 * production call sites supplying `resource`, which means the two shipped
 * `EXAMPLE_POLICIES` keyed on `resource.status` have never once matched a real
 * request. A policy an operator can see, enable, and watch do nothing is worse
 * than an absent feature: it reads as enforcement.
 *
 * This is the missing second pass. A route authorizes coarsely, loads the row,
 * and then asks again with the row's attributes in hand.
 *
 * ## Why it is cheap
 *
 * The caller hands back the session it already resolved, so the PDP adapter
 * skips re-authentication — one extra policy evaluation, no extra session
 * lookup. And it only ever runs for a caller who already cleared the coarse
 * gate and is allowed to see the record.
 *
 * ## Why the failure direction is 'permit'
 *
 * ABAC is additive here as everywhere else: with no policy targeting the
 * permission the request stands, because the role matrix already authorized it.
 * This helper narrows; it never grants. That asymmetry is the reason it is safe
 * to add to a route that ships today without changing that route's behaviour
 * until an operator writes a policy.
 */
export interface AuthorizeResourceArgs {
  request: NextRequest;
  tenantId: string;
  requiredPermission: string;
  /**
   * The record, as attributes.
   *
   * `type` defaults to the permission's `module.resource` prefix — the same
   * derivation the PDP adapter uses — so a policy's `resourceTypes` targets the
   * value an operator sees in the policy editor rather than one invented here.
   */
  resource: AttributeBag & { type?: string };
  /** The session the route's own guard already resolved. */
  session: { user: Pick<SafeUser, 'userId' | 'email'> | null; tenantMember: Pick<SafeTenantMember, 'memberRole'> | null };
}

function resourceTypeOf(permission: string): string {
  const parts = permission.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : permission;
}

/**
 * Throws `AppError(403)` on an explicit policy deny; returns silently otherwise.
 *
 * Shadow mode is honoured through the same settings the PEP guard reads: while
 * `abacShadowMode` is on the PDP still logs the verdict but a deny does not
 * block, so an operator can watch a new record-level rule before trusting it.
 */
export async function authorizeResource(args: AuthorizeResourceArgs): Promise<void> {
  const settings = await AbacSettingsService.getRuntimeSettings(args.tenantId);
  const { type, ...attributes } = args.resource;
  const decision = await evaluatePermissionFromRequest({
    request: args.request,
    tenantId: args.tenantId,
    requiredPermission: args.requiredPermission,
    resource: { type: type ?? resourceTypeOf(args.requiredPermission), ...attributes },
    session: args.session,
    settings,
  });

  // The PEP guard's own condition (`decisionBlocks`), shared so the two stay identical: a copy that diverged on shadow
  // mode (or on the installation's config, which shadow mode never loosens) would make a record-level rule enforce
  // while the request-level one only logged.
  if (decisionBlocks(decision, settings)) {
    throw new AppError(MSG.FORBIDDEN, 403, ErrorCode.FORBIDDEN);
  }
}
