import 'reflect-metadata';
import Logger from '@kuraykaraaslan-labs/logger';
import { create, emitAuditLog } from './tenant_setting.write.service';
import { decryptValue } from './tenant_setting.crypto';
import { isLedgerProjectionKey, isPluginConfigKey } from './tenant_setting.write.maker-checker';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { IP_LIST_KEYS, validateSettingValue } from './tenant_setting.validation';
import { assertIpListWriteKeepsWriter } from './tenant_setting.ip-lists';
import { ABAC_SHADOW_MODE_KEY, assertAbacShadowWriteAllowed } from './tenant_setting.abac-shadow';
import { env } from '@kuraykaraaslan-labs/env';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { isDeclaredSettingKey, PLATFORM_ONLY_SETTING_KEYS } from './tenant_setting.key-policy';
import { getValue } from './tenant_setting.read.service';
import { assertPaymentDefaultWriteAllowed, isPaymentDefaultSettingKey } from './tenant_setting.payment-default';

/**
 * (08 review C) The default-gateway guard of a parked change, against the settings as they are NOW. The maker's write
 * was checked when it was parked, against the state of that moment; two parked changes (switch STRIPE off while PAYPAL is
 * the default; make STRIPE the default) each passed alone and together left the default switched off. So the guard runs
 * again when the change is approved and when it is applied, each time against what is stored then.
 */
async function assertParkedPaymentDefaultChange(tenantId: string, key: string, storedValue: string): Promise<void> {
  if (!isPaymentDefaultSettingKey(key)) return;
  const value = await decryptValue(tenantId, key, storedValue);
  await assertPaymentDefaultWriteAllowed(tenantId, { [key]: value }, (k) => getValue(tenantId, k));
}

/** The request that approves a parked setting change, and whether the tenant IP lists apply to its caller. */
export interface SettingChangeApprover {
  request: { headers: Pick<Headers, 'get'> };
  /** `TenantAuthResult.ipListsExempt` of the approver: a platform admin, a system-flow impersonation, break-glass. */
  exempt?: boolean;
}

/**
 * The approval-time check of a parked setting change, run by the reviewer BEFORE it records an APPROVE (approval
 * registers it as the `tenant_setting_change` decision guard, inside the decision's locked transaction): a throw refuses
 * the decision, so the item stays pending and nothing is written.
 *
 * ABAC shadow mode under a role that refuses it (`FLEET_ROLE=node|fleet`, docs/phases/02-fleet P9-10): a parked change that would turn it on (or a
 * case variant of its key) is refused with 403 (`assertAbacShadowWriteAllowed`), so the approver sees the refusal and the item stays pending instead of
 * reading APPROVED while the write it approved is refused afterwards. Such a change can be parked from before the role was set or before the gate
 * refused it on submit.
 *
 * The IP allow/deny lists are checked too. They apply from the moment they land, so the self-lockout guard that ran
 * for the maker on submit runs again for the APPROVER, whose request makes the list take effect: the stored entries are
 * validated (400 on an invalid IP/CIDR), then `assertIpListWriteKeepsWriter` refuses with 409 a list that would refuse
 * the approver's own trusted client IP, unless the approver is exempt from the lists. A decision with no approver request
 * (a system flow) cannot be checked, so it is refused with 409 too.
 */
export async function assertSettingChangeApprovable(
  tenantId: string,
  metadata: Record<string, unknown> | null | undefined,
  approver?: SettingChangeApprover,
): Promise<void> {
  const meta = metadata ?? {};
  const key = typeof meta.key === 'string' ? meta.key : null;
  if (!key) return;
  // (08 review C) The default payment gateway stays switched on, judged against the settings at approval (409).
  if (typeof meta.value === 'string') await assertParkedPaymentDefaultChange(tenantId, key, meta.value);
  if (key.toLowerCase() === ABAC_SHADOW_MODE_KEY.toLowerCase()) {
    if (typeof meta.value !== 'string') return; // nothing will be written
    assertAbacShadowWriteAllowed(key, await decryptValue(tenantId, key, meta.value), env.FLEET_ROLE);
    return;
  }
  if (!IP_LIST_KEYS.has(key)) return;
  if (typeof meta.value !== 'string') return; // nothing will be written
  const value = await decryptValue(tenantId, key, meta.value);
  validateSettingValue(key, value);
  if (!approver) {
    throw new AppError(
      `An IP list change must be approved by a signed-in reviewer whose address can be checked against ${key}.`,
      409,
      ErrorCode.CONFLICT,
    );
  }
  await assertIpListWriteKeepsWriter(tenantId, { [key]: value }, approver.request, { exempt: approver.exempt === true });
}

/** A reviewer's decision on a parked setting change: the review item's status and the metadata it was parked with. */
export interface SettingChangeDecision {
  status: string;
  metadata?: Record<string, unknown> | null;
  /**
   * The review item's own submitter, recorded by the queue (tenant_setting.08). When the reviewer passes it, the write is
   * attributed to it and `metadata.actorId` (which the submitter wrote) is ignored.
   */
  submittedByUserId?: string | null;
}

/**
 * Apply a TERMINAL review decision on a deferred setting change: the maker-checker loop's sync-back. When a tenant
 * enables `tenantSettingMakerChecker`, an admin config write is NOT applied immediately; it is parked with the reviewer
 * (`tenant_setting:change_review`, the approval queue) carrying the intended `{ key, value, actorId }` in the item
 * metadata (the value stored via `encryptValue`, so secrets never sit in the queue in plaintext). The reviewer calls
 * this on its decision (approval registers it as its `tenant_setting_change` decision handler):
 *
 *  - APPROVED → apply the parked write via the raw (ungated) upsert, so it is NOT re-queued. The original maker
 *    (`metadata.actorId`) is the write actor so history / audit attribute the change to who proposed it.
 *  - REJECTED → discard: no write, just an audit breadcrumb.
 *  - anything else → nothing.
 *
 * Best-effort and IDEMPOTENT: re-applying the same `{ key, value }` yields the same row, so a redelivered decision is
 * harmless. It never throws: the reviewer's decision write must not depend on it.
 */
export async function applySettingChangeDecision(tenantId: string, decision: SettingChangeDecision): Promise<void> {
  const { status } = decision;
  if (status !== 'APPROVED' && status !== 'REJECTED') return;

  const meta = decision.metadata ?? {};
  const key = typeof meta.key === 'string' ? meta.key : null;
  if (!key) return; // malformed / non-setting item — nothing to apply
  // A review item can be submitted with any metadata by a tenant admin; the ledger-owned
  // keys must not be reachable through it either.
  if (isLedgerProjectionKey(key) || isPluginConfigKey(key)) {
    Logger.warn(`[tenant_setting] refusing an approved write of ledger-owned key ${key} (tenant ${tenantId})`);
    return;
  }
  // tenant_setting.03: anyone holding approvals.submit can create an item with this entityType and any metadata, so the
  // apply step re-runs the key rules of the generic API: only a declared key, and never a platform-only key outside ROOT
  // (a forged `abacShadowMode` used to be written once someone approved the item).
  if (!isDeclaredSettingKey(key) || (PLATFORM_ONLY_SETTING_KEYS.has(key) && !isRootTenant(tenantId))) {
    Logger.warn(`[tenant_setting] refusing an approved write of protected or undeclared key ${key} (tenant ${tenantId})`);
    return;
  }
  // tenant_setting.08: the queue's own submitter when the reviewer passes it; `metadata.actorId` only as the fallback.
  const actorId = typeof decision.submittedByUserId === 'string' && decision.submittedByUserId
    ? decision.submittedByUserId
    : typeof meta.actorId === 'string' ? meta.actorId : undefined;

  if (status === 'REJECTED') {
    await emitAuditLog(tenantId, 'setting.approval_rejected', key, actorId);
    return;
  }

  const rawValue = typeof meta.value === 'string' ? meta.value : null;
  if (rawValue === null) return; // nothing to write
  try {
    const value = await decryptValue(tenantId, key, rawValue);
    // (08 review C) Judged again at the moment it lands: another parked change applied since the approval may have
    // made this one switch the default gateway off. A refusal is logged below and nothing is written.
    await assertParkedPaymentDefaultChange(tenantId, key, rawValue);
    // Raw, ungated upsert — bypasses the maker-checker gate so the approved
    // write lands directly instead of being re-submitted for review. `create`
    // upserts (preserving group/type on an existing row) and fires its own
    // audit + webhook, exactly like a normal write.
    await create(tenantId, key, value, undefined, undefined, { actorId });
    await emitAuditLog(tenantId, 'setting.approval_approved', key, actorId);
  } catch (err) {
    Logger.warn(
      `[tenant_setting] approved setting write failed tenant=${tenantId} key=${key}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
