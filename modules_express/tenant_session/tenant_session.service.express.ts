import { Request } from 'express';
import { SafeUser } from '@/modules/user/user.types';
import { SafeTenant } from '@/modules/tenant/tenant.types';
import { SafeTenantMember } from '@/modules/tenant_member/tenant_member.types';
import { SafeUserSession } from '@/modules/user_session/user_session.types';
import UserSessionExpressService from '@/modules_express/user_session/user_session.service.express';
import TenantSessionService from '@/modules/tenant_session/tenant_session.service';
import TenantAuthMessages from '@/modules/tenant_session/tenant_session.messages';
import type { TenantMemberRole } from '@/modules/tenant_member/tenant_member.enums';

type TenantIdSource = 'header' | 'subdomain' | 'query' | 'body' | 'param';

export default class TenantSessionExpressService {

  static extractTenantId(
    request: Request,
    source: TenantIdSource = 'header',
    paramKey: string = 'tenantId',
  ): string | null {
    switch (source) {
      case 'header':
        return (request.headers['x-tenant-id'] as string) ?? null;

      case 'subdomain': {
        const host = request.headers['host'];
        if (!host) return null;
        const subdomain = host.split('.')[0];
        if (['localhost', 'www', 'api', '127'].includes(subdomain)) return null;
        return subdomain;
      }

      case 'query':
        return (request.query[paramKey] as string) ?? null;

      case 'param':
        return (request.params[paramKey] as string) ?? null;

      case 'body':
        return null;

      default:
        throw new Error(TenantAuthMessages.INVALID_TENANT_ID_SOURCE);
    }
  }

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
    const { user, userSession } = await UserSessionExpressService.authenticateUserByRequest({
      request,
    });

    const tenantId = directTenantId || TenantSessionExpressService.extractTenantId(request, tenantIdSource);

    if (!tenantId) {
      throw new Error(TenantAuthMessages.TENANT_ID_REQUIRED);
    }

    const isGlobalAdmin = allowGlobalAdmin && user.userRole === 'ADMIN';

    if (isGlobalAdmin) {
      const tenant = await TenantSessionService.getTenantById(tenantId);

      if (!tenant) {
        throw new Error(TenantAuthMessages.TENANT_NOT_FOUND);
      }

      const virtualTenantMember: SafeTenantMember = {
        tenantMemberId: `global-admin-${user.userId}`,
        tenantId: tenant.tenantId,
        userId: user.userId,
        memberRole: 'OWNER',
        memberStatus: 'ACTIVE',
        sessionVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return { user, userSession, tenant, tenantMember: virtualTenantMember, isGlobalAdmin: true };
    }

    const { tenant, tenantMember } = await TenantSessionService.authenticateTenantMembership({
      user,
      tenantId,
      requiredRole: requiredTenantRole,
    });

    return { user, userSession, tenant, tenantMember, isGlobalAdmin: false };
  }

  static async getUserTenants(userId: string): Promise<Array<{
    tenant: SafeTenant;
    tenantMember: SafeTenantMember;
  }>> {
    return TenantSessionService.getUserTenants(userId);
  }

  static async clearTenantCache(userId: string, tenantId: string): Promise<void> {
    return TenantSessionService.clearTenantCache(userId, tenantId);
  }

  static async clearUserTenantCaches(userId: string): Promise<void> {
    return TenantSessionService.clearUserTenantCaches(userId);
  }

  static hasRequiredRole(memberRole: TenantMemberRole, requiredRole: TenantMemberRole): boolean {
    return TenantSessionService.hasRequiredRole(memberRole, requiredRole);
  }
}
