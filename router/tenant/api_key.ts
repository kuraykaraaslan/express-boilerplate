import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import ApiKeyService from '@/modules/api_key/api_key.service';
import { CreateApiKeyDTO, ListApiKeysDTO } from '@/modules/api_key/api_key.dto';

const apiKeyRouter = Router({ mergeParams: true });

apiKeyRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const userId = (req.user as { userId?: string } | undefined)?.userId ?? '';

      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = CreateApiKeyDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await ApiKeyService.create(tenantId, userId, parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

apiKeyRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = ListApiKeysDTO.safeParse({
        tenantId,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await ApiKeyService.list(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

apiKeyRouter.delete(
  '/:apiKeyId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId as string;
      const { apiKeyId } = req.params;

      if (!tenantId || !apiKeyId) {
        throw new AppError('tenantId and apiKeyId are required', 400, ErrorCode.VALIDATION_ERROR);
      }

      await ApiKeyService.delete(tenantId, apiKeyId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default apiKeyRouter;
