import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';

/**
 * auth_abac.01: creating, editing, deactivating or deleting an ABAC policy changes who may do what, so it leaves an audit row
 * naming the acting user. Awaited (the row exists when the answer goes out) but never fatal: an audit outage does not undo
 * or fail the change.
 */
export async function auditPolicyChange(
  tenantId: string,
  actorId: string | null | undefined,
  action: 'abac.policy.created' | 'abac.policy.updated' | 'abac.policy.deleted',
  policyId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await AuditLogService.log({
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'USER' : 'SYSTEM',
      action,
      resourceType: 'AbacPolicy',
      resourceId: policyId,
      metadata,
    });
  } catch { /* best effort */ }
}
