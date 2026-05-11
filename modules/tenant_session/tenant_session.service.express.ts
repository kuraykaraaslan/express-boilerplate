import { Request } from 'express';
import { SafeUser } from '@/modules/user/user.types';
import { SafeTenant } from '@/modules/tenant/tenant.types';
import { SafeTenantMember } from '@/modules/tenant_member/tenant_member.types';
import { SafeUserSession } from '@/modules/user_session/user_session.types';
import { authenticateUserByRequest } from '@/modules/user_session/user_session.service.express';
import TenantSessionService from './tenant_session.service';
import TenantAuthMessages from './tenant_session.messages';
import type { TenantMemberRole } from '@/modules/tenant_member/tenant_member.enums';

type TenantIdSource = 'header' | 'subdomain' | 'query' | 'body' | 'param';

export default class TenantSessionExpressService {

  /**
   * Extract tenant ID from various sources in the request
   * @param request - The Express request object
   * @param source - The source to extract tenant ID from
   * @param paramKey - Optional parameter key for query/body/param extraction
   * @returns The tenant ID or null
   */
  static extractTenantId(
    request: Request,
    source: TenantIdSource = 'header',
    paramKey: string = 'tenantId'
  ): string | null {
    switch (source) {
      case 'header':
        return (request.headers['x-tenant-id'] as string) ?? null;

      case 'subdomain': {
        const host = request.headers['host'];
        if (!host) return null;
        const subdomain = host.split('.')[0];
        // Avoid matching localhost, www, api, etc.
        if (['localhost', 'www', 'api', '127'].includes(subdomain)) return null;
        return subdomain;
      }

      case 'query':
        return (request.query[paramKey] as string) ?? null;

      case 'param':
        // For dynamic routes like /:tenantId — use paramKey as the param name
        return (request.params[paramKey] as string) ?? null;

      case 'body':
        // Body extraction needs to be done by caller since we can't read body here
        return null;

      default:
        throw new Error(TenantAuthMessages.INVALID_TENANT_ID_SOURCE);
    }
  }

  /**
   * Authenticate user and verify tenant membership with required role
   * Global admins (userRole === 'ADMIN') bypass tenant membership check
   * @param request - The Express request object
   * @param requiredTenantRole - The required tenant role
   * @param tenantIdSource - Where to extract tenant ID from
   * @param tenantId - Optional direct tenant ID (overrides source extraction)
   * @param allowGlobalAdmin - Whether to allow global admins to bypass tenant membership (default: true)
   * @returns The authenticated user, session, tenant, and tenant member (or virtual member for global admin)
   */
  static async authenticateTenantByRequest({
    request,
    requiredTenantRole = 'USER',
    tenantIdSource = 'param',
    tenantId: directTenantId,
    allowGlobalAdmin = true,
  }: {
    request: Request;
    requiredTenantRole?: TenantMemberRole;
    tenantIdSource?: TenantIdSource;
    tenantId?: string;
    allowGlobalAdmin?: boolean;
  }): Promise<{
    user: SafeUser;
    userSession: SafeUserSession;
    tenant: SafeTenant;
    tenantMember: SafeTenantMember;
    isGlobalAdmin?: boolean;
  }> {
    // Step 1: Authenticate user
    const { user, userSession } = await authenticateUserByRequest(request);

    // Step 2: Get tenant ID
    const tenantId = directTenantId || this.extractTenantId(request, tenantIdSource);

    if (!tenantId) {
      throw new Error(TenantAuthMessages.TENANT_ID_REQUIRED);
    }

    // Step 3: Check if user is global admin
    const isGlobalAdmin = allowGlobalAdmin && user.userRole === 'ADMIN';

    if (isGlobalAdmin) {
      // Global admin bypass - just get the tenant without membership check
      const tenant = await TenantSessionService.getTenantById(tenantId);

      if (!tenant) {
        throw new Error(TenantAuthMessages.TENANT_NOT_FOUND);
      }

      // Create a virtual tenant member for global admin with OWNER privileges
      const virtualTenantMember: SafeTenantMember = {
        tenantMemberId: `global-admin-${user.userId}`,
        tenantId: tenant.tenantId,
        userId: user.userId,
        memberRole: 'OWNER',
        memberStatus: 'ACTIVE',
        // sessionVersion is not available in this version
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return { user, userSession, tenant, tenantMember: virtualTenantMember, isGlobalAdmin: true };
    }

    // Step 4: Authenticate tenant membership using core service
    const { tenant, tenantMember } = await TenantSessionService.authenticateTenantMembership({
      user,
      tenantId,
      requiredRole: requiredTenantRole,
    });

    return { user, userSession, tenant, tenantMember, isGlobalAdmin: false };
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
}
