import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import AuthMiddleware from '@/modules_express/auth/auth.middleware';
import TenantMemberMiddleware from '@/modules_express/tenant_member/tenant_member.middleware';
import TenantInvitationService from '@/modules/tenant_invitation/tenant_invitation.service';
import {
  SendInvitationDTO,
  AcceptInvitationDTO,
  DeclineInvitationDTO,
  GetInvitationsDTO,
} from '@/modules/tenant_invitation/tenant_invitation.dto';
import { SafeUser } from '@/modules/user/user.types';

const tenantInvitationRouter = Router({ mergeParams: true });

tenantInvitationRouter.post(
  '/',
  AuthMiddleware('USER'),
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as SafeUser;
      const tenantId = req.params.tenantId;

      const parsed = SendInvitationDTO.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const { invitation, rawToken } = await TenantInvitationService.send(
        tenantId,
        user.userId,
        parsed.data,
      );

      res.status(201).json({ invitation, token: rawToken });
    } catch (err) {
      next(err);
    }
  },
);

tenantInvitationRouter.get(
  '/',
  AuthMiddleware('USER'),
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetInvitationsDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.query,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await TenantInvitationService.getByTenantId(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

tenantInvitationRouter.post(
  '/accept',
  AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as SafeUser;
      const tenantId = req.params.tenantId;

      const parsed = AcceptInvitationDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantInvitationService.accept(tenantId, user.userId, user.email, parsed.data.token);
      res.json({ message: 'INVITATION_ACCEPTED' });
    } catch (err) {
      next(err);
    }
  },
);

tenantInvitationRouter.post(
  '/decline',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId;
      const user = req.user as SafeUser | undefined;

      const parsed = DeclineInvitationDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantInvitationService.decline(tenantId, user?.email ?? '', parsed.data.token);
      res.json({ message: 'INVITATION_DECLINED' });
    } catch (err) {
      next(err);
    }
  },
);

tenantInvitationRouter.delete(
  '/:invitationId',
  AuthMiddleware('USER'),
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId;
      await TenantInvitationService.revoke(req.params.invitationId, tenantId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantInvitationRouter;
