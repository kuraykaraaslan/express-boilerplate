import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import ApiKeyService from '../api_key.service';
import { CreateApiKeyDTO, ApiKeyIdDTO } from '../api_key.dto';

const apiKeyRouter = Router();

/**
 * POST /
 * Create a new API key. Requires ADMIN.
 * NOTE: rawKey is returned only once in this response.
 */
apiKeyRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateApiKeyDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await ApiKeyService.create(parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /
 * List API keys for a tenant. Requires ADMIN.
 * rawKey is never returned here.
 */
apiKeyRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const keys = await ApiKeyService.findByTenant(tenantId);
      res.json({ keys });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:apiKeyId
 * Revoke (deactivate) an API key. Requires ADMIN.
 */
apiKeyRouter.delete(
  '/:apiKeyId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ApiKeyIdDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await ApiKeyService.revoke(parsed.data.apiKeyId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default apiKeyRouter;
