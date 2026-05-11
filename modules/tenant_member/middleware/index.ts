import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import { SafeUser } from '@/modules/user/user.types';
import TenantMemberService from '../tenant_member.service';
import { TenantMemberMessages } from '../tenant_member.messages';
import type { TenantMemberRole } from '../tenant_member.enums';

/**
 * TenantMemberMiddleware factory.
 *
 * Resolves tenantId from `req.params.tenantId` or `req.body.tenantId`,
 * checks that the authenticated user is a member with at least `requiredRole`,
 * and attaches the member record to `req.tenantMember`.
 *
 * Usage: TenantMemberMiddleware('ADMIN')
 */
export default function TenantMemberMiddleware(requiredRole: TenantMemberRole) {
  return async function tenantMemberMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = req.user as SafeUser | undefined;

      if (!user) {
        throw new AppError(
          TenantMemberMessages.TENANT_ACCESS_DENIED,
          401,
          ErrorCode.UNAUTHORIZED,
        );
      }

      const tenantId: string | undefined =
        (req.params.tenantId as string | undefined) ??
        (req.body?.tenantId as string | undefined);

      if (!tenantId) {
        throw new AppError(
          TenantMemberMessages.TENANT_ACCESS_DENIED,
          400,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const hasPermission = await TenantMemberService.checkPermission(
        tenantId,
        user.userId,
        requiredRole,
      );

      if (!hasPermission) {
        throw new AppError(
          TenantMemberMessages.INSUFFICIENT_PERMISSIONS,
          403,
          ErrorCode.FORBIDDEN,
        );
      }

      const member = await TenantMemberService.findByTenantAndUser(tenantId, user.userId);

      if (!member) {
        throw new AppError(
          TenantMemberMessages.MEMBER_NOT_FOUND,
          404,
          ErrorCode.NOT_FOUND,
        );
      }

      req.tenantMember = TenantMemberService.omitSensitiveFields(member);

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
