import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules_express/common/app-error';
import { SafeUser } from '@/modules/user/user.types';
import TenantMemberService from '@/modules/tenant_member/tenant_member.service';
import TenantMemberMessages from '@/modules/tenant_member/tenant_member.messages';
import TenantAuthMessages from '@/modules/tenant_session/tenant_session.messages';
import UserSessionMessages from '@/modules/user_session/user_session.messages';
import type { TenantMemberRole } from '@/modules/tenant_member/tenant_member.enums';

export default function TenantMemberMiddleware(requiredRole: TenantMemberRole) {
  return async function tenantMemberMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = req.user as SafeUser | undefined;

      if (!user) {
        throw new AppError(UserSessionMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
      }

      const tenantId: string | undefined =
        (req.params.tenantId as string | undefined) ??
        (req.body?.tenantId as string | undefined);

      if (!tenantId) {
        throw new AppError(TenantAuthMessages.TENANT_ID_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
      }

      const hasPermission = await TenantMemberService.checkPermission(
        tenantId,
        user.userId,
        requiredRole,
      );

      if (!hasPermission) {
        throw new AppError(TenantAuthMessages.INSUFFICIENT_TENANT_PERMISSIONS, 403, ErrorCode.FORBIDDEN);
      }

      const member = await TenantMemberService.getByTenantAndUser({
        tenantMemberId: null,
        tenantId,
        userId: user.userId,
      });

      if (!member) {
        throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      }

      req.tenantMember = member;

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
