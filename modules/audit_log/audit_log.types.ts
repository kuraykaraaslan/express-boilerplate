import { z } from 'zod';

export const AuditLogSchema = z.object({
  auditLogId: z.string().uuid(),
  tenantId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  action: z.string(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: z.date().nullable(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

export type CreateAuditLogInput = {
  action: string;
  tenantId?: string | null;
  userId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};
