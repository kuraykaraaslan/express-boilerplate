import { z } from 'zod'
import { StorageProviderTypeSchema } from './storage.enums'

// Origin of an upload, captured for fraud investigation / GDPR audit responses
// ("who uploaded this from where?"). The country is inferred server-side from
// the IP; callers only supply ip + userAgent.
export const UploadOriginSchema = z.object({
  ip: z.string().optional(),
  userAgent: z.string().optional(),
})
export type UploadOrigin = z.infer<typeof UploadOriginSchema>

export const UploadFileDTOSchema = z.object({
  file: z.instanceof(File),
  folder: z.string().optional(),
  filename: z.string().optional(),
  provider: StorageProviderTypeSchema.optional(),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  origin: UploadOriginSchema.optional(),
})
export type UploadFileDTO = z.infer<typeof UploadFileDTOSchema>

export const UploadFromUrlDTOSchema = z.object({
  url: z.string(),
  folder: z.string().optional(),
  filename: z.string().optional(),
  provider: StorageProviderTypeSchema.optional(),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  origin: UploadOriginSchema.optional(),
})
export type UploadFromUrlDTO = z.infer<typeof UploadFromUrlDTOSchema>

export const DeleteFileDTOSchema = z.object({
  key: z.string(),
  provider: StorageProviderTypeSchema.optional(),
  tenantId: z.string().optional(),
})
export type DeleteFileDTO = z.infer<typeof DeleteFileDTOSchema>

export const GetFileUrlDTOSchema = z.object({
  key: z.string(),
  provider: StorageProviderTypeSchema.optional(),
  tenantId: z.string().optional(),
})
export type GetFileUrlDTO = z.infer<typeof GetFileUrlDTOSchema>

// Browser-direct upload, step 1: the declaration the server checks and signs a
// PUT for. `type` is informational only: the stored MIME is derived from the
// name's extension, never taken from the client.
export const PresignUploadDTOSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(255).optional(),
  folder: z.string().max(100).optional(),
  provider: StorageProviderTypeSchema.optional(),
})
export type PresignUploadDTO = z.infer<typeof PresignUploadDTOSchema>

// Step 3: the opaque upload id the presign step handed out. It is the only
// thing the client sends; the key, size, type and folder come from the session.
export const CompleteUploadDTOSchema = z.object({
  uploadId: z.string().min(20).max(200),
})
export type CompleteUploadDTO = z.infer<typeof CompleteUploadDTOSchema>
