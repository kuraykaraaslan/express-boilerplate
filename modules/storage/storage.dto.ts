import { z } from 'zod';

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const GetUploadUrlDTO = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  tenantId: z.string().uuid().optional(),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES),
});

export const GetDownloadUrlDTO = z.object({
  key: z.string().min(1),
});

export const DeleteFileDTO = z.object({
  key: z.string().min(1),
});

export type GetUploadUrlInput = z.infer<typeof GetUploadUrlDTO>;
export type GetDownloadUrlInput = z.infer<typeof GetDownloadUrlDTO>;
export type DeleteFileInput = z.infer<typeof DeleteFileDTO>;
