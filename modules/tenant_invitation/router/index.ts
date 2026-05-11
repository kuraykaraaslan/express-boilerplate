import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import AuthMiddleware from '@/modules/auth/middleware';
import TenantMemberMiddleware from '@/modules/tenant_member/middleware';
import TenantInvitationService from '../tenant_invitation.service';
import {
  CreateInvitationDTO,
  AcceptInvitationDTO,
  DeclineInvitationDTO,
  GetInvitationsDTO,
} from '../tenant_invitation.dto';
import { SafeUser } from '@/modules/user/user.types';

/**
 * Tenant Invitation Router.
 *
 * Mount under a route that already injects `:tenantId` as a param, e.g.:
 *   app.use('/tenants/:tenantId/invitations', tenantInvitationRouter)
 *
 * Public routes (accept/decline) do not require authentication.
 */
const tenantInvitationRouter = Router({ mergeParams: true });

/**
 * POST /
 * Send a new invitation. Requires ADMIN tenant role.
 */
tenantInvitationRouter.post(
  '/',
  AuthMiddleware('USER'),
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as SafeUser;

      const parsed = CreateInvitationDTO.safeParse({
        tenantId: req.params.tenantId,
        ...req.body,
      });

      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const { invitation, rawToken } = await TenantInvitationService.create(
        parsed.data,
        user.userId,
      );

      res.status(201).json({ invitation, token: rawToken });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /
 * List invitations for the tenant. Requires ADMIN tenant role.
 */
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

      const result = await TenantInvitationService.findByTenant(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /accept
 * Accept an invitation by token. Public — no auth required.
 */
tenantInvitationRouter.post(
  '/accept',
  AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as SafeUser;

      const parsed = AcceptInvitationDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantInvitationService.accept(parsed.data.token, user.userId);
      res.json({ message: 'INVITATION_ACCEPTED' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /decline
 * Decline an invitation by token. Public — no auth required.
 */
tenantInvitationRouter.post(
  '/decline',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = DeclineInvitationDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantInvitationService.decline(parsed.data.token);
      res.json({ message: 'INVITATION_DECLINED' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:invitationId
 * Revoke (cancel) an invitation. Requires ADMIN tenant role.
 */
tenantInvitationRouter.delete(
  '/:invitationId',
  AuthMiddleware('USER'),
  TenantMemberMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await TenantInvitationService.revokeInvitation(req.params.invitationId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantInvitationRouter;
