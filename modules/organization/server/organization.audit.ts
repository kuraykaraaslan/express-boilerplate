import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service'

/** The three organization rows this module can be audited about. */
export type OrganizationResourceType = 'LegalEntity' | 'Site' | 'CostCenter' | 'Team'

/**
 * Best-effort `organization` audit trail. Mirrors the shared audit_log contract
 * (see accounting.audit.ts): a logging failure must never block or fail the
 * mutation it records, so the promise is fire-and-forget with a swallowed
 * rejection. With no `actorId` the event is attributed to the SYSTEM actor
 * (seeds, jobs).
 */
export function auditOrganization(
  tenantId: string,
  actorId: string | null | undefined,
  action: string,
  resourceType: OrganizationResourceType,
  resourceId: string,
  metadata: Record<string, unknown> = {},
): void {
  AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType,
    resourceId,
    metadata,
  }).catch(() => {})
}
