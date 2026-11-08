// path: app/tenant/[tenantId]/api/auth/me/security/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import AccountMessages from './account.messages';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/me/security
 * Tenant-scoped /api/auth/me endpoint.
 * Returns the current user's security overview (email-verified, role, last-login).
 * Tenant membership is enforced — any active member can read their own record.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.security.read',
      scope: 'ACCOUNT',
    });

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    return NextResponse.json({
      message: AccountMessages.SECURITY_SETTINGS_RETRIEVED,
      userSecurity,
    });
  } catch (e) {
    return normalizeError(e);
  }
}
