import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogMessages from './audit_log.messages';

/**
 * The `audit_logs` plan entitlement.
 *
 * ## The gate is on READING, never on writing
 *
 * The recorder is untouched and must stay that way. A tenant on any plan keeps
 * accumulating history, for two reasons that both outrank the billing one:
 *
 *  1. An audit trail is a SECURITY CONTROL. The moment a lapsed subscription
 *     stops it, the period around a downgrade — exactly when an account is most
 *     likely to be in dispute, or being emptied by someone on their way out —
 *     becomes the one period with no record.
 *  2. A gap cannot be repaired. Refusing a read is reversible the instant the
 *     tenant upgrades; refusing a write destroys evidence permanently, and the
 *     tenant would have no way to know what it lost.
 *
 * So a downgrade hides the history. It never deletes it, and it never stops it.
 *
 * ## What else stays open, deliberately
 *
 * - **purge / anonymize** — these are ERASURE duties (GDPR Art. 17 and the
 *   retention job). Gating them would trap a tenant holding data it is legally
 *   required to delete, which turns our billing state into their legal
 *   exposure.
 * - **verify** — the hash-chain check returns an integrity verdict, not
 *   history. A tenant should always be able to establish that the record we
 *   hold on its behalf is intact, whatever it pays.
 * - **cross-tenant** — a platform-operator surface behind its own permission,
 *   not something a tenant plan sells.
 *
 * That leaves the list and the export: the surface the feature actually sells.
 *
 * UNDECLARED is allowed and gate errors fail open, as everywhere in this sweep.
 */
export async function isAuditLogEntitled(tenantId: string): Promise<boolean> {
  if (isRootTenant(tenantId)) return true;
  try {
    const [{ default: FeatureGateService }, { FEATURE_KEYS }] = await Promise.all([
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.service'),
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'),
    ]);
    const result = await FeatureGateService.checkFeatureAccess(tenantId, FEATURE_KEYS.AUDIT_LOGS);
    return !(result.type === 'BOOLEAN' && result.declared && !result.allowed);
  } catch {
    return true;
  }
}

/** {@link isAuditLogEntitled}, but a refusal is a 403. */
export async function assertAuditLogEntitled(tenantId: string): Promise<void> {
  if (!await isAuditLogEntitled(tenantId)) {
    throw new AppError(AuditLogMessages.NOT_IN_PLAN, 403, ErrorCode.FEATURE_NOT_AVAILABLE);
  }
}
