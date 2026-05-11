import { z } from 'zod';

export const CreateAuditLogDTO = z.object({
  action: z.string().min(1),
  tenantId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
});

export const GetAuditLogsDTO = z.object({
  tenantId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateAuditLogInputDTO = z.infer<typeof CreateAuditLogDTO>;
export type GetAuditLogsInput = z.infer<typeof GetAuditLogsDTO>;
