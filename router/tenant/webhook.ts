import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import WebhookService from '@/modules/webhook/webhook.service';
import { CreateWebhookDTO, UpdateWebhookDTO, ListWebhooksDTO, ListDeliveriesDTO } from '@/modules/webhook/webhook.dto';

const webhookRouter = Router({ mergeParams: true });

webhookRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const userId = (req.user as { userId?: string } | undefined)?.userId ?? '';

      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = CreateWebhookDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const webhook = await WebhookService.create(tenantId, userId, parsed.data);
      res.status(201).json(webhook);
    } catch (err) {
      next(err);
    }
  },
);

webhookRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = ListWebhooksDTO.safeParse({
        tenantId,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await WebhookService.list(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

webhookRouter.put(
  '/:webhookId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const { webhookId } = req.params;

      if (!tenantId || !webhookId) {
        throw new AppError('tenantId and webhookId are required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const bodyParsed = UpdateWebhookDTO.safeParse(req.body);
      if (!bodyParsed.success) {
        throw new AppError(bodyParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const webhook = await WebhookService.update(tenantId, webhookId, bodyParsed.data);
      res.json(webhook);
    } catch (err) {
      next(err);
    }
  },
);

webhookRouter.delete(
  '/:webhookId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const { webhookId } = req.params;

      if (!tenantId || !webhookId) {
        throw new AppError('tenantId and webhookId are required', 400, ErrorCode.VALIDATION_ERROR);
      }

      await WebhookService.delete(tenantId, webhookId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

webhookRouter.get(
  '/:webhookId/deliveries',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const { webhookId } = req.params;

      if (!tenantId || !webhookId) {
        throw new AppError('tenantId and webhookId are required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = ListDeliveriesDTO.safeParse({
        tenantId,
        webhookId,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await WebhookService.listDeliveries(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default webhookRouter;
