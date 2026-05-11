import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import { SafeUser } from '@/modules/user/user.types';
import AuthMiddleware from '@/modules/auth/middleware';
import TenantMemberMiddleware from '../middleware';
import TenantMemberService from '../tenant_member.service';
import { AddMemberDTO, UpdateMemberRoleDTO, GetMembersDTO } from '../tenant_member.dto';
import { TenantMemberRoleEnum } from '../tenant_member.enums';

/**
 * Tenant Member Router.
 *
 * Mount under a route that already injects `:tenantId` as a param, e.g.:
 *   app.use('/tenants/:tenantId/members', tenantMemberRouter)
 *
 * All routes require authentication (AuthMiddleware('USER')).
 */
const tenantMemberRouter = Router({ mergeParams: true });

tenantMemberRouter.use(AuthMiddleware('USER'));

/**
 * GET /
 * List all members of the tenant. Requires ADMIN role.
 */
tenantMemberRouter.get(
  '/',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetMembersDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.query,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await TenantMemberService.findByTenant(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /
 * Add a new member to the tenant. Requires ADMIN role.
 */
tenantMemberRouter.post(
  '/',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = AddMemberDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.body,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const member = await TenantMemberService.addMember(parsed.data);
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /me
 * Get the authenticated user's own membership info.
 */
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

/**
 * PUT /:userId/role
 * Update the role of a member. Requires ADMIN role.
 */
tenantMemberRouter.put(
  '/:userId/role',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roleResult = TenantMemberRoleEnum.safeParse(req.body.memberRole);
      if (!roleResult.success) {
        throw new AppError('Invalid memberRole', 400, ErrorCode.VALIDATION_ERROR);
      }

      const member = await TenantMemberService.updateRole(
        req.params.tenantId,
        req.params.userId,
        roleResult.data,
      );

      res.json(member);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:userId
 * Remove a member from the tenant. Requires ADMIN role.
 */
tenantMemberRouter.delete(
  '/:userId',
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await TenantMemberService.removeMember(req.params.tenantId, req.params.userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantMemberRouter;
