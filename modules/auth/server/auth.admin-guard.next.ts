import { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import AuthPolicyService from '@kuraykaraaslan-labs/auth/server/auth.policy.service';
import AuthMessages from '@kuraykaraaslan-labs/auth/server/auth.messages';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import TenantSessionNextService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import type { SafeUserSecurity } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import type { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import type { SessionMeta } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { amrHasSecondFactor } from '@kuraykaraaslan-labs/user_session/server/user_session.amr';
import { trustedClientIp } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.client-ip';

/**
 * The client address the allowlist judges (E-06 / S12): X-Forwarded-For through the trusted proxy hops, like the tenant IP
 * lists. The first hop, X-Real-IP and CF-Connecting-IP are client-chosen and were what this used to read.
 */
function clientIp(request: NextRequest): string | undefined {
  return trustedClientIp(request) ?? undefined;
}

/**
 * KD-13: gate admin surfaces behind an IP allowlist and (optionally) MFA: an
 * enrolled second factor that this session has also proven (F.auth.05). Call this at the top of any system/admin route handler
 * that has already resolved the requesting user's role to SUPER_ADMIN/ADMIN.
 *
 * Returns a 403 NextResponse if the request should be rejected, or null
 * when the caller may proceed. Designed to be cheap — policy reads are cached
 * via SettingService's Redis cache.
 */
export async function enforceAdminAccess(
  request: NextRequest,
  userSecurity: SafeUserSecurity | null,
  userSession?: Pick<SafeUserSession, 'metadata'> | null,
): Promise<NextResponse | null> {
  // auth.24: an unreadable admin policy refuses (503). The loader's tolerant read answered `{}` on an outage, and an empty
  // allowlist means "no restriction", so an outage opened the admin surface to every address.
  let policy;
  try {
    policy = await AuthPolicyService.getAdminPolicy(undefined, { strict: true });
  } catch {
    return NextResponse.json({ error: AuthMessages.ADMIN_POLICY_UNAVAILABLE }, { status: 503 });
  }
  const ip = clientIp(request);

  if (!AuthPolicyService.isAdminIpAllowed(ip, policy)) {
    return NextResponse.json(
      { error: AuthMessages.ADMIN_IP_NOT_ALLOWED },
      { status: 403 },
    );
  }

  if (policy.requireMfa) {
    const enrolled = (userSecurity?.otpMethods?.length ?? 0) > 0
      || userSecurity?.passkeyEnabled === true;
    if (!enrolled) {
      return NextResponse.json(
        { error: AuthMessages.MFA_ENROLLMENT_REQUIRED },
        { status: 403 },
      );
    }
    // F.auth.05: enrolment is not enough; THIS session must have proven a second factor (an OTP / TOTP verified on it, or a
    // passkey sign-in). A passkey-enrolled admin who signed in with the password only used to pass. No session: refused.
    if (!amrHasSecondFactor((userSession?.metadata as SessionMeta | null | undefined)?.amr)) {
      return NextResponse.json(
        { error: AuthMessages.ADMIN_SECOND_FACTOR_REQUIRED },
        { status: 403 },
      );
    }
  }

  return null;
}

export type AdminAuthResult =
  | {
      ok: true;
      user: SafeUser;
      userSession: SafeUserSession;
      userSecurity: SafeUserSecurity;
      tenant: SafeTenant;
      tenantMember: SafeTenantMember;
    }
  /**
   * `error`: set only for a refusal the client can answer (phase 55 00.6: a step-up forced on the session, 401 with `details.stepUp`).
   * `authorizeRequest` (GLOBAL) rethrows it as it is, so its details survive.
   */
  | { ok: false; response: NextResponse; error?: AppError };

/**
 * Single-call helper for admin API routes: resolves the session against the
 * root tenant, enforces root-tenant membership at the requested role, and
 * applies the KD-13 IP/MFA guard in one go.
 *
 * Super-admin = a TenantMember of the root tenant with memberRole satisfying
 * `requiredRole` (default 'ADMIN'). The legacy `userRole === 'ADMIN'` gate
 * is gone; identity now flows through the unified tenant-membership model.
 *
 * Usage:
 *   const auth = await authenticateAdminRequest(request);
 *   if (!auth.ok) return auth.response;
 *   const { user, userSession, tenant, tenantMember } = auth;
 */
export async function authenticateAdminRequest(
  request: NextRequest,
  options: { requiredRole?: TenantMemberRole } = {},
): Promise<AdminAuthResult> {
  let result;
  try {
    result = await TenantSessionNextService.authenticateRootTenantAdmin({
      request,
      requiredRole: options.requiredRole ?? 'ADMIN',
    });
  } catch (err: unknown) {
    if (err instanceof AppError && err.statusCode === 401 && (err.details as { stepUp?: unknown } | undefined)?.stepUp) {
      return {
        ok: false,
        error: err,
        response: NextResponse.json({ message: err.message, code: err.code, details: err.details }, { status: 401 }),
      };
    }
    const msg = err instanceof Error ? err.message : AuthMessages.USER_NOT_AUTHENTICATED;
    // auth.17: a status-carrying error decides (the session layer throws AppError 403 for "not a member" / "insufficient
    // role"); the message test is the fallback for plain errors, case-insensitive (the real messages are "Insufficient
    // permissions …" / "User is not a member …", which the old case-sensitive test never matched: every forbidden caller got 401).
    const carried = (err as { statusCode?: unknown } | null)?.statusCode;
    const status = carried === 401 || carried === 403
      ? carried
      : msg === AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE || /insufficient|not_member|not a member/i.test(msg)
        ? 403
        : 401;
    return { ok: false, response: NextResponse.json({ error: msg }, { status }) };
  }

  const userSecurity = await UserSecurityService.getSafeByUserId(result.user.userId).catch(() => null);
  const denied = await enforceAdminAccess(request, userSecurity, result.userSession);
  if (denied) return { ok: false, response: denied };

  return {
    ok: true,
    user: result.user,
    userSession: result.userSession,
    userSecurity: userSecurity!,
    tenant: result.tenant,
    tenantMember: result.tenantMember,
  };
}
