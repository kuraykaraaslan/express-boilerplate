import { NextRequest } from 'next/server';
import { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import TenantSessionService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { extractTenantId, type TenantIdSource } from './tenant_session.extract.next';
import { authenticateTenantByRequest } from './tenant_session.authenticate.next';
import type { TenantAuthResult } from './tenant_session.types';

export default class TenantSessionNextService {

  /**
   * Extract tenant ID from various sources in the request
   * @param request - The Next.js request object
   * @param source - The source to extract tenant ID from
   * @param paramKey - Optional parameter key for query/body/param extraction
   * @returns The tenant ID or null
   */
  static extractTenantId(
    request: NextRequest,
    source: TenantIdSource = 'header',
    paramKey: string = 'tenantId'
  ): string | null {
    return extractTenantId(request, source, paramKey);
  }

  /**
   * Authenticate user and verify tenant membership with required role
   * Global admins (userRole === 'ADMIN') bypass tenant membership check
   */
  static authenticateTenantByRequest(params: {
    request: NextRequest;
    requiredTenantRole?: TenantMemberRole;
    tenantIdSource?: TenantIdSource;
    tenantId?: string;
    otpVerifyBypass?: boolean;
    /** auth.05: the route is part of the forced change-password step. */
    passwordChangeBypass?: boolean;
    /** Phase 55 00.6: the route is part of the step-up forced on a session (auth_abac SESSION_STEP_UP_PERMISSIONS). */
    sessionStepUpBypass?: boolean;
    allowGlobalAdmin?: boolean;
    /** The guard's TENANT path: a non-member answers 403 with a recorded denial, not the 401 session mismatch. */
    refuseNonMember?: boolean;
  }): Promise<TenantAuthResult> {
    return authenticateTenantByRequest(params);
  }

  /**
   * Helper method to get all user's tenants (wrapper for core service)
   * @param userId - The user ID
   * @returns List of tenants the user is a member of
   */
  static async getUserTenants(userId: string): Promise<Array<{
    tenant: SafeTenant;
    tenantMember: SafeTenantMember;
  }>> {
    return TenantSessionService.getUserTenants(userId);
  }

  /**
   * Clear tenant cache for a specific user and tenant (wrapper for core service)
   * @param userId - The user ID
   * @param tenantId - The tenant ID
   */
  static async clearTenantCache(userId: string, tenantId: string): Promise<void> {
    return TenantSessionService.clearTenantCache(userId, tenantId);
  }

  /**
   * Clear all tenant caches for a user (wrapper for core service)
   * @param userId - The user ID
   */
  static async clearUserTenantCaches(userId: string): Promise<void> {
    return TenantSessionService.clearUserTenantCaches(userId);
  }

  /**
   * Check if user has required role in tenant (wrapper for core service)
   * @param memberRole - The user's role in the tenant
   * @param requiredRole - The required role
   * @returns true if user has required role or higher
   */
  static hasRequiredRole(memberRole: TenantMemberRole, requiredRole: TenantMemberRole): boolean {
    return TenantSessionService.hasRequiredRole(memberRole, requiredRole);
  }

  /**
   * Authenticate as a root-tenant member with the given role (default ADMIN).
   *
   * Super-admin = a TenantMember of the root tenant (ROOT_TENANT_ID) whose
   * memberRole satisfies `requiredRole`. Replaces the legacy
   * `userRole === 'ADMIN'` check; cross-tenant impersonation/global-admin
   * bypass is intentionally disabled here because the root tenant *is* the
   * super-admin scope.
   *
   * Use in admin API routes that previously sat under `/system/api/...`.
   */
  static async authenticateRootTenantAdmin({
    request,
    requiredRole = 'ADMIN',
    otpVerifyBypass = false,
  }: {
    request: NextRequest;
    requiredRole?: TenantMemberRole;
    otpVerifyBypass?: boolean;
  }): Promise<{
    user: SafeUser;
    userSession: SafeUserSession;
    tenant: SafeTenant;
    tenantMember: SafeTenantMember;
  }> {
    const result = await this.authenticateTenantByRequest({
      request,
      tenantId: ROOT_TENANT_ID,
      requiredTenantRole: requiredRole,
      otpVerifyBypass,
      allowGlobalAdmin: false,
    });
    return {
      user: result.user,
      userSession: result.userSession,
      tenant: result.tenant,
      tenantMember: result.tenantMember,
    };
  }
}
