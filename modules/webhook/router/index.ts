import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import WebhookService from '../webhook.service';
import { CreateWebhookDTO, UpdateWebhookDTO, WebhookIdDTO } from '../webhook.dto';

const webhookRouter = Router();

/**
 * POST /
 * Create a new webhook. Requires ADMIN.
 */
webhookRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateWebhookDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const webhook = await WebhookService.create(parsed.data);
      res.status(201).json(webhook);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /
 * List tenant webhooks. Requires ADMIN.
 */
webhookRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const webhooks = await WebhookService.findByTenant(tenantId);
      res.json({ webhooks });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /:webhookId
 * Update a webhook. Requires ADMIN.
 */
webhookRouter.put(
  '/:webhookId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParsed = WebhookIdDTO.safeParse(req.params);
      if (!idParsed.success) {
        throw new AppError(idParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const bodyParsed = UpdateWebhookDTO.safeParse(req.body);
      if (!bodyParsed.success) {
        throw new AppError(bodyParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const webhook = await WebhookService.update(idParsed.data.webhookId, bodyParsed.data);
      res.json(webhook);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:webhookId
 * Delete a webhook. Requires ADMIN.
 */
webhookRouter.delete(
  '/:webhookId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = WebhookIdDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await WebhookService.delete(parsed.data.webhookId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /:webhookId/deliveries
 * Get delivery history for a webhook. Requires ADMIN.
 */
webhookRouter.get(
  '/:webhookId/deliveries',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = WebhookIdDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const deliveries = await WebhookService.getDeliveries(parsed.data.webhookId);
      res.json({ deliveries });
    } catch (err) {
      next(err);
    }
  },
);

export default webhookRouter;
