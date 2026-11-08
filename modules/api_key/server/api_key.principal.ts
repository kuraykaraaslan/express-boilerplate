import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { deferUntilSettled } from '@kuraykaraaslan-labs/common/server/request-settle';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import ApiKeyMessages from './api_key.messages';
import type { SafeApiKey } from './api_key.types';
import { verifyFromAuthHeader } from './api_key.verify.service';
import { auditFailure, ipFromHeaders, recordUsage } from './api_key.verify.helpers';
import { creatorIsActiveMember } from './api_key.membership';
import { isKeyGrantable, permissionEntry } from './api_key.permissions';

/** A key that may call a module route, and the member it acts as (docs/phases/48-api-key-scopes D48-2). */
export interface KeyPrincipal {
  key: SafeApiKey;
  /** The member whose current rights are the key's ceiling: the creator, or for a service key whose creator left, the OWNER who marked it. */
  holderUserId: string;
  /** The key's permissions that a key may still hold, of modules enabled now: all a later check on this request may grant. */
  usablePermissions: string[];
}

/**
 * The api_key half of the key lane of auth_abac's tenant guard (D48-1): is this request's `Bearer sk_…` a key of this tenant
 * that holds this permission, and who does it act as?
 *
 * 1. The key verifies as on every machine route: active, unexpired, its tenant ACTIVE, its creator an ACTIVE member unless an
 *    OWNER marked it a service key, the per-key or tenant IP allowlist, the rate limit; it must be a key of the URL tenant.
 * 2. The key holds the permission, and the permission is still one a key may hold (api_key.permissions).
 * 3. The permission's module is enabled for the tenant now (placement, the platform's bans, the tenant's switch; D12).
 * The holder's own rights (role floor, groups, config/access.ts, policies) are auth_abac's half. Every refusal past the
 * key itself is audited like a failed verification (`auditKeyRefusal` for auth_abac's half) and answered 403 with one message.
 * The key's use (`lastUsedAt`, `lastUsedIp`, `usageCount`) is stamped only when auth_abac let the request through
 * (`recordKeyUse`): a refused call writes nothing to the key's row. Under the tenant API dispatcher the stamp waits for the
 * handler's answer, and a later guard call of the same request that refuses drops it (`markKeyRefused`).
 */
type KeyRequest = { headers: { get: (name: string) => string | null } };

/**
 * One verification per request (a WeakMap, so nothing outlives it): a route that runs the guard several times (one call per
 * permission it checks) charges the key's rate limit and usage count once, and a refused key is refused (and audited) once.
 */
const VERIFIED = new WeakMap<object, { tenantId: string; key: Promise<SafeApiKey> }>();
function verifyOnce(request: KeyRequest, tenantId: string): Promise<SafeApiKey> {
  const seen = VERIFIED.get(request);
  if (seen && seen.tenantId === tenantId) return seen.key;
  const key = verifyFromAuthHeader(request, tenantId, undefined, { deferUsage: true });
  VERIFIED.set(request, { tenantId, key });
  return key;
}

/** Per request: the key's use is stamped once, and never for a request a guard call refused. */
const USES = new WeakMap<object, { refused: boolean; pending: boolean }>();
/**
 * Stamp the key's use once per request, after the guard let it through (a route that runs the guard several times counts once).
 * Under the tenant API dispatcher the stamp waits until the handler answered (common/server/request-settle), so a later guard
 * call of the same request that refuses (a second permission the key lacks) still leaves the row untouched. Outside it (a file
 * route, an internal caller) the stamp is immediate.
 */
export function recordKeyUse(request: KeyRequest, key: Pick<SafeApiKey, 'apiKeyId'>): void {
  if (USES.has(request)) return;
  const entry = { refused: false, pending: true };
  USES.set(request, entry);
  const ip = ipFromHeaders(request.headers);
  const stamp = () => {
    if (entry.refused || !entry.pending) return;
    entry.pending = false;
    void recordUsage(key.apiKeyId, ip);
  };
  if (!deferUntilSettled(request, stamp)) stamp();
}

/** A guard call of this request refused the key: a deferred stamp is dropped, and no later pass of the request stamps one. */
export function markKeyRefused(request: KeyRequest): void {
  const use = USES.get(request);
  if (use) use.refused = true;
  else USES.set(request, { refused: true, pending: false });
}

/** Audit a refusal of a verified key that its holder's side decided (auth_abac's half of the key lane), like a failed verification. */
export function auditKeyRefusal(request: KeyRequest, key: Pick<SafeApiKey, 'apiKeyId' | 'tenantId'>, reason: string): void {
  auditFailure(reason, key.tenantId, ipFromHeaders(request.headers), key.apiKeyId);
}

export async function resolveKeyPrincipal(
  request: KeyRequest,
  tenantId: string,
  permissionId: string,
): Promise<KeyPrincipal> {
  const key = await verifyOnce(request, tenantId);
  const refuse = (reason: string): never => {
    auditKeyRefusal(request, key, reason);
    throw new AppError(ApiKeyMessages.INSUFFICIENT_PERMISSION, 403, ErrorCode.FORBIDDEN);
  };

  const entry = permissionEntry(permissionId);
  if (!entry || !isKeyGrantable(entry) || !(key.permissions ?? []).includes(permissionId)) refuse('insufficient_permission');
  const enabled = await getEnabledModuleIds(tenantId);
  if (!enabled.has(entry!.moduleId)) refuse('module_disabled');
  const usablePermissions = (key.permissions ?? []).filter((id) => {
    const p = permissionEntry(id);
    return !!p && isKeyGrantable(p) && enabled.has(p.moduleId);
  });

  // verify already refused a non-service key whose creator is no longer an ACTIVE member. A service key outlives its
  // creator (api_key.03); its ceiling is then the OWNER who marked it, while they are a member (auth_abac checks).
  let holderUserId = key.createdByUserId;
  if (key.isServiceKey && !(await creatorIsActiveMember(tenantId, key.createdByUserId))) {
    if (!key.serviceKeyMarkedByUserId) refuse('no_holder');
    holderUserId = key.serviceKeyMarkedByUserId!;
  }
  return { key, holderUserId, usablePermissions };
}
