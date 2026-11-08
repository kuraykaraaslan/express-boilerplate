import 'reflect-metadata';
import { withSharedTenantRepositoryFor, withSharedTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { ApiKey as ApiKeyEntity } from './entities/api_key.entity';
import { SafeApiKey, SafeApiKeySchema } from './api_key.types';
import { API_KEY_SORTABLE, type CreateApiKeyInput, type UpdateApiKeyInput, type ListApiKeysInput } from './api_key.dto';
import { compactWhere, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';
import ApiKeyMessages from './api_key.messages';
import type { ApiKeyEnv } from './api_key.enums';
import { scopesWithinAllowlist } from './api_key.enums';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { DEFAULT_KEY_ENV, generateRawKey, hashKey } from './api_key.crypto';
import { API_KEY_CACHE_TTL, deliverKeyDrops, recordKeyDrops, reviveCachedKey } from './api_key.cache';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';

/** api_key.08 (fixed 2026-10-20): every management action on a key is audited with the actor (best-effort, like revoke-all). */
function auditKey(tenantId: string, actorId: string | undefined, action: string, apiKeyId: string, metadata: Record<string, unknown> = {}): void {
  AuditLogService.log({
    tenantId, actorId: actorId ?? null, actorType: actorId ? 'USER' : 'SYSTEM',
    action, resourceType: 'ApiKey', resourceId: apiKeyId, metadata,
  }).catch(() => {});
}
import { assertUnderKeyLimit, defaultKeyExpiry, getTenantPolicy, keyLimitLock, resolveExpiry } from './api_key.policy';
import { assertOwnerMayMarkServiceKey } from './api_key.membership';
import { assertHeld, assertKeyGrantable, normalisePermissions } from './api_key.permissions';

/**
 * The caller's own rights for the phase 48 ceiling (D12): the permissions, among those asked, that the creator or editor holds
 * now. Resolved by the route (auth_abac `grantedPermissions` needs the request and session); a caller that passes none
 * cannot give a key a module permission (fail closed).
 */
export interface KeyGrantContext {
  heldPermissions?: ReadonlySet<string>;
}

export async function list(
  { tenantId, page, pageSize, sort, search, isActive, environment, scopeReview }:
    Pick<ListApiKeysInput, 'tenantId' | 'page' | 'pageSize'> & Partial<Pick<ListApiKeysInput, 'sort' | 'search' | 'isActive' | 'environment' | 'scopeReview'>>,
): Promise<{ keys: SafeApiKey[]; total: number }> {
  const safePage = Math.max(1, page);
  const where = compactWhere({ tenantId, isActive, keyEnv: inList(environment), scopeReview });
  const [rows, total] = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo.findAndCount({
    where: searchWhere(where, search, ['name', 'description']),
    // Columns only from API_KEY_SORTABLE; the id breaks ties so pages never overlap.
    order: toOrder(sort ?? [{ field: 'createdAt', dir: 'desc' }], API_KEY_SORTABLE, { apiKeyId: 'ASC' }, ApiKeyEntity),
    skip: (safePage - 1) * pageSize,
    take: pageSize,
  }));

  return { keys: rows.map((r) => SafeApiKeySchema.parse(r)), total };
}

/** Phase 48 (D14): how many of the tenant's active keys are marked for review (the list page's banner). */
export async function countForReview(tenantId: string): Promise<number> {
  return withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo.count({ where: { tenantId, isActive: true, scopeReview: true } }));
}

export async function getById(tenantId: string, apiKeyId: string): Promise<SafeApiKey> {
  const cacheKey = `api_key:tenant:${tenantId}:${apiKeyId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    // api_key.09 (fixed 2026-10-20): the dates are revived (JSON made them strings and the schema refused every cached entry, so the
    // cache never served a hit).
    const revived = reviveCachedKey(cached);
    try { if (revived) return SafeApiKeySchema.parse(revived); } catch { /* not a key row */ }
    await redis.del(cacheKey).catch(() => {});
  }

  return singleFlight(cacheKey, async () => {
    const row = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo.findOne({ where: { apiKeyId, tenantId } }));
    if (!row) throw new AppError(ApiKeyMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const parsed = SafeApiKeySchema.parse(row);
    await redis.setex(cacheKey, jitter(API_KEY_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

/**
 * A key's activation state read from the row, never from the cache (phase 55, D55-16): whether it is active and when `update` last
 * deactivated it. For the firewall's revocation and its undo, which must not act on a cached row that a concurrent read repopulated
 * from before the write. Null for a key that is not this tenant's, or none.
 */
export async function activationOf(tenantId: string, apiKeyId: string): Promise<{ isActive: boolean; deactivatedAt: Date | null } | null> {
  const row = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo.findOne({
    where: { apiKeyId, tenantId }, select: { apiKeyId: true, isActive: true, deactivatedAt: true },
  }));
  return row ? { isActive: row.isActive, deactivatedAt: row.deactivatedAt ?? null } : null;
}

/**
 * Fetch a key together with its rotation lineage: the successor it minted (if
 * any) and every predecessor that rotated INTO it. Drives the detail page's
 * "Rotation history" panel.
 */
export async function getLineage(
  tenantId: string,
  apiKeyId: string,
): Promise<{ key: SafeApiKey; successor: SafeApiKey | null; predecessors: SafeApiKey[] }> {
  const found = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, async (repo) => {
    const row = await repo.findOne({ where: { apiKeyId, tenantId } });
    if (!row) return null;
    const successorRow = row.successorKeyId
      ? await repo.findOne({ where: { apiKeyId: row.successorKeyId, tenantId } })
      : null;
    const predecessorRows = await repo.find({ where: { successorKeyId: apiKeyId, tenantId } });
    return { row, successorRow, predecessorRows };
  });
  if (!found) throw new AppError(ApiKeyMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  const { row, successorRow, predecessorRows } = found;

  return {
    key: SafeApiKeySchema.parse(row),
    successor: successorRow ? SafeApiKeySchema.parse(successorRow) : null,
    predecessors: predecessorRows.map((p) => SafeApiKeySchema.parse(p)),
  };
}

export async function create(
  tenantId: string,
  createdByUserId: string,
  input: CreateApiKeyInput,
  grant: KeyGrantContext = {},
): Promise<{ key: SafeApiKey; rawKey: string }> {
  // Defense-in-depth billing gate — the tenant plan must include
  // `feature_api_keys`. Root tenant is short-circuited (the platform
  // owner does not buy its own plan).
  if (!isRootTenant(tenantId)) {
    await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_API_KEYS);
  }

  const policy = await getTenantPolicy(tenantId);
  const expiresAt = resolveExpiry(input.expiresAt, policy);

  const scopes = input.scopes ?? [];
  const permissions = normalisePermissions(input.permissions ?? []);
  if (scopes.length + permissions.length === 0) throw new AppError(ApiKeyMessages.GRANT_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);

  // Per-plan scope allowlist: a tenant can never mint a key with scopes
  // beyond what its plan permits (prevents privilege escalation).
  if (!scopesWithinAllowlist(scopes, policy.allowedScopes)) {
    throw new AppError(ApiKeyMessages.SCOPE_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
  }
  // Phase 48 (D12, D48-5): module permissions a key may hold, of modules the tenant has enabled, that the creator holds now.
  await assertKeyGrantable(tenantId, permissions);
  assertHeld(permissions, grant.heldPermissions);

  const environment: ApiKeyEnv = input.environment ?? DEFAULT_KEY_ENV;
  const rawKey = generateRawKey(tenantId, environment);
  const keyHash = hashKey(rawKey);

  // Count and insert under one tenant-wide lock: two concurrent creates at
  // `max - 1` would otherwise both pass the limit.
  const saved = await withSharedTenantTransactionFor(tenantId, async (qr) => {
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [keyLimitLock(tenantId)]);
    const repo = qr.manager.getRepository(ApiKeyEntity);
    await assertUnderKeyLimit(tenantId, repo, policy.maxActiveKeys);
    return repo.save(repo.create({
        tenantId,
        createdByUserId,
        name: input.name,
        description: input.description ?? null,
        keyHash,
        scopes,
        permissions,
        scopeReview: false,
        keyEnv: environment,
        ipAllowlist: input.ipAllowlist ?? [],
        isActive: true,
        usageCount: 0,
        lastUsedIp: null,
        successorKeyId: null,
        expiresAt,
      }));
  });
  await redis.del(`api_key:hash:${keyHash}`).catch(() => {});
  auditKey(tenantId, createdByUserId, 'api_key.created', saved.apiKeyId, { name: saved.name, scopes: saved.scopes, permissions, environment });
  await WebhookService.dispatchEvent(tenantId, 'api_key.created', {
    apiKeyId: saved.apiKeyId,
    name: saved.name,
    scopes: saved.scopes,
    permissions,
    environment,
    createdByUserId,
  }).catch(() => {});
  // Best-effort security notice to the tenant's admins/owner. Reached via a
  // dynamic import so the mail queue (BullMQ) is only loaded when a key is
  // actually minted, and so `notification_mail` never sits on api_key's static
  // import graph (tenant → api_key would otherwise cycle).
  await import('./api_key.notifications.service')
    .then((m) => m.default.notifyKeyCreated({
      tenantId,
      apiKeyId: saved.apiKeyId,
      name: saved.name,
      scopes: saved.scopes,
      environment,
      createdByUserId,
    }))
    .catch(() => {});
  return { key: SafeApiKeySchema.parse(saved), rawKey };
}

export async function update(
  tenantId: string,
  apiKeyId: string,
  input: UpdateApiKeyInput,
  actorId?: string,
  grant: KeyGrantContext = {},
): Promise<SafeApiKey> {
  // A review (a permission or scope edit, "Mark reviewed") or a reactivation may give a legacy key its first expiry (below).
  const reviews = input.permissions !== undefined || input.scopes !== undefined || input.scopeReviewed === true;
  const policy = input.isActive === true || reviews ? await getTenantPolicy(tenantId) : null;
  const nextPermissions = input.permissions !== undefined ? normalisePermissions(input.permissions) : undefined;

  // On the locked row, writing only the edited columns: a whole-row save of a
  // stale read would write back the `expiresAt`/`successorKeyId` a concurrent
  // rotation just set, and the rotated-away key would never expire.
  const { saved, wasActive, gaveExpiry, drops } = await withSharedTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(ApiKeyEntity);
    const row = await repo.findOne({ where: { apiKeyId, tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw new AppError(ApiKeyMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    const wasActive = row.isActive;

    const patch: Partial<ApiKeyEntity> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.ipAllowlist !== undefined) patch.ipAllowlist = input.ipAllowlist;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    // Phase 55 (D55-16): the activation marker follows only a real transition, so the usage stamp and edits never look like one
    if (input.isActive === false && wasActive) patch.deactivatedAt = new Date();
    if (input.isActive === true && !wasActive) patch.deactivatedAt = null;
    // Phase 48 (D12, D48-5): removing a permission is always allowed; an added one must be one a key may hold, of an enabled
    // module, and held by the editor now. A kept one may stay even when it stopped being grantable (it is inert at use time,
    // and narrowing must never be refused for it). Scopes only narrow. Either edit, or "Mark reviewed", is an admin's review
    // of the key's grant (D14).
    if (nextPermissions !== undefined) {
      const current = new Set(row.permissions ?? []);
      const added = nextPermissions.filter((p) => !current.has(p));
      await assertKeyGrantable(tenantId, added);
      assertHeld(added, grant.heldPermissions);
      patch.permissions = nextPermissions;
    }
    if (input.scopes !== undefined) {
      const current = new Set(row.scopes ?? []);
      if (input.scopes.some((s) => !current.has(s))) throw new AppError(ApiKeyMessages.SCOPES_ONLY_NARROWED, 403, ErrorCode.FORBIDDEN);
      patch.scopes = [...new Set(input.scopes)];
    }
    // A key keeps at least one grant: an edit that empties both lists is refused (revoke the key instead).
    if ((patch.permissions ?? row.permissions ?? []).length + (patch.scopes ?? row.scopes ?? []).length === 0) {
      throw new AppError(ApiKeyMessages.GRANT_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
    }
    if (reviews) patch.scopeReview = false;
    if (input.isServiceKey !== undefined && input.isServiceKey !== row.isServiceKey) {
      // api_key.03: the OWNER's decision alone (403 for anyone else, the route's permission notwithstanding).
      await assertOwnerMayMarkServiceKey(tenantId, actorId);
      patch.isServiceKey = input.isServiceKey;
      patch.serviceKeyMarkedByUserId = input.isServiceKey ? (actorId ?? null) : null;
    }

    if (patch.isActive === true && !wasActive) {
      // Reactivation raises the active count like a create does, and a key
      // that was rotated away must stay retired — its successor is the key now.
      if (row.successorKeyId) throw new AppError(ApiKeyMessages.ROTATED_KEY_NOT_REACTIVATABLE, 409, ErrorCode.CONFLICT);
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [keyLimitLock(tenantId)]);
      await assertUnderKeyLimit(tenantId, repo, policy?.maxActiveKeys ?? 0);
    }
    // Review fix (D13, D48-6): a key from before phase 48 with no expiry keeps working unreviewed (and stays on the banner);
    // the edit that reviews it, or brings it back, gives it the default lifetime, so no key leaves review without one.
    if (row.expiresAt == null && policy && (reviews || (patch.isActive === true && !wasActive))) {
      patch.expiresAt = defaultKeyExpiry(policy);
    }
    if (Object.keys(patch).length) await repo.update({ apiKeyId, tenantId }, patch);
    // D253: the cache drop commits with the edit (a deactivation, a narrowed grant or allowlist must hold on every node at once,
    // also when Redis is away now); delivered right after the commit, else by the session_end relay.
    const drops = await recordKeyDrops(qr, tenantId, [row]);
    return { saved: Object.assign(row, patch), wasActive, gaveExpiry: patch.expiresAt !== undefined, drops };
  });
  await deliverKeyDrops(drops);
  auditKey(tenantId, actorId, 'api_key.updated', saved.apiKeyId, {
    changed: Object.keys(input), isActive: saved.isActive,
    ...(input.permissions !== undefined ? { permissions: saved.permissions } : {}),
    ...(input.scopes !== undefined ? { scopes: saved.scopes } : {}),
    ...(gaveExpiry ? { expiresAt: saved.expiresAt } : {}),
  });

  await WebhookService.dispatchEvent(tenantId, 'api_key.updated', {
    apiKeyId: saved.apiKeyId,
    name: saved.name,
    isActive: saved.isActive,
    deactivated: wasActive && !saved.isActive,
  }).catch(() => {});

  return SafeApiKeySchema.parse(saved);
}

export async function remove(tenantId: string, apiKeyId: string, actorId?: string): Promise<void> {
  const { row, drops } = await withSharedTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(ApiKeyEntity);
    const found = await repo.findOne({ where: { apiKeyId, tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!found) return { row: null, drops: [] };
    await repo.delete({ apiKeyId, tenantId });
    return { row: found, drops: await recordKeyDrops(qr, tenantId, [found]) };
  });
  if (!row) throw new AppError(ApiKeyMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  await deliverKeyDrops(drops);
  auditKey(tenantId, actorId, 'api_key.deleted', apiKeyId, { name: row.name });
  await WebhookService.dispatchEvent(tenantId, 'api_key.deleted', {
    apiKeyId,
    name: row.name,
  }).catch(() => {});
}
