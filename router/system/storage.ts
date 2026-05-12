import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import StorageService from '@/modules/storage/storage.service';
import { GetFileUrlDTOSchema, DeleteFileDTOSchema } from '@/modules/storage/storage.dto';

const storageRouter = Router();

storageRouter.post(
  '/upload-url',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetFileUrlDTOSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: getPresignedUploadUrl is not available; returning file URL instead
      const result = await StorageService.getFileUrl(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

storageRouter.post(
  '/download-url',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetFileUrlDTOSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await StorageService.getFileUrl(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

storageRouter.delete(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = DeleteFileDTOSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await StorageService.deleteFile(parsed.data);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default storageRouter;
