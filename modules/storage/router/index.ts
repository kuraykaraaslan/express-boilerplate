import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import StorageService from '../storage.service';
import { GetUploadUrlDTO, GetDownloadUrlDTO, DeleteFileDTO } from '../storage.dto';

const storageRouter = Router();

/**
 * POST /upload-url
 * Get a presigned S3 upload URL. Requires authenticated USER.
 */
storageRouter.post(
  '/upload-url',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetUploadUrlDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await StorageService.getPresignedUploadUrl(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /download-url
 * Get a presigned S3 download URL. Requires authenticated USER.
 */
storageRouter.post(
  '/download-url',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetDownloadUrlDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await StorageService.getPresignedDownloadUrl(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /
 * Delete a file from S3. Requires ADMIN.
 */
storageRouter.delete(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = DeleteFileDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await StorageService.deleteFile(parsed.data.key);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default storageRouter;
