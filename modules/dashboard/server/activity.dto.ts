import { z } from 'zod';
import { AuditSeverityEnum } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';

/**
 * The home's "Recent activity" query (`GET …/dashboard/activity`, e2e run 1 E21): the DataTable's server-mode parameters. `search`
 * searches the action name (as the audit list does), `filterTenantId` narrows the root's feed to one tenant.
 */
export const ActivityQueryDTO = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  severity: AuditSeverityEnum.optional(),
  search: z.string().trim().max(128).optional(),
  filterTenantId: z.string().uuid().optional(),
  sort: z.enum(['createdAt:desc', 'createdAt:asc']).optional(),
}).strict();

export type ActivityQuery = z.infer<typeof ActivityQueryDTO>;
