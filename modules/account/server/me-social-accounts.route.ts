// path: app/tenant/[tenantId]/api/auth/me/social-accounts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSocialAccountService from '@kuraykaraaslan-labs/user_social_account/server/user_social_account.service';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/me/social-accounts
 *
 * List federated identities linked to the current user. Social accounts live in
 * the system schema (one user can be a member of many tenants), so this returns
 * the same list as the system endpoint — the route exists per-tenant only so the
 * panel can run in tenant scope without crossing scope boundaries.
 *
 * Each account is enriched (kind/group/displayName/icon + OAuth token health) so
 * one panel can render social, enterprise SAML and government identities alike.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'account.social_accounts.read', scope: 'ACCOUNT' });

    const accounts = await UserSocialAccountService.listConnectedAccounts(user.userId);

    return NextResponse.json({ accounts }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
