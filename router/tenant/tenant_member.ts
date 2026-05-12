import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import { SafeUser } from '@/modules/user/user.types';
import AuthMiddleware from '@/modules_express/auth/auth.middleware';
import TenantMemberMiddleware from '@/modules_express/tenant_member/tenant_member.middleware';
import TenantMemberService from '@/modules/tenant_member/tenant_member.service';
import { CreateTenantMemberDTO, GetTenantMembersDTO } from '@/modules/tenant_member/tenant_member.dto';
import { TenantMemberRoleEnum } from '@/modules/tenant_member/tenant_member.enums';

const tenantMemberRouter = Router({ mergeParams: true });

tenantMemberRouter.use(AuthMiddleware('USER'));

tenantMemberRouter.get(
  '/',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetTenantMembersDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.query,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await TenantMemberService.getByTenantId(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

tenantMemberRouter.post(
  '/',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateTenantMemberDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.body,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const member = await TenantMemberService.create(parsed.data);
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  },
);

tenantMemberRouter.get(
  '/me',
  TenantMemberMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(req.tenantMember);
    } catch (err) {
      next(err);
    }
  },
);

tenantMemberRouter.put(
  '/:userId/role',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roleResult = TenantMemberRoleEnum.safeParse(req.body.memberRole);
      if (!roleResult.success) {
        throw new AppError('Invalid memberRole', 400, ErrorCode.VALIDATION_ERROR);
      }

      const existingMember = await TenantMemberService.getByTenantAndUser({
        tenantMemberId: null,
        tenantId: req.params.tenantId,
        userId: req.params.userId,
      });

      if (!existingMember) {
        throw new AppError('Member not found', 404, ErrorCode.NOT_FOUND);
      }

      const member = await TenantMemberService.update(
        existingMember.tenantMemberId,
        { memberRole: roleResult.data, memberStatus: null },
      );

      res.json(member);
    } catch (err) {
      next(err);
    }
  },
);

tenantMemberRouter.delete(
  '/:userId',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existingMember = await TenantMemberService.getByTenantAndUser({
        tenantMemberId: null,
        tenantId: req.params.tenantId,
        userId: req.params.userId,
      });

      if (!existingMember) {
        throw new AppError('Member not found', 404, ErrorCode.NOT_FOUND);
      }

      await TenantMemberService.delete(existingMember.tenantMemberId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantMemberRouter;
