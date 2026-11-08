import 'reflect-metadata';
import { In } from 'typeorm';
import { withSharedTenantRepositoryFor, withSharedTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import { ApiKey as ApiKeyEntity } from './entities/api_key.entity';
import { SafeApiKey, SafeApiKeySchema } from './api_key.types';
import type { RotateApiKeyInput } from './api_key.dto';
import ApiKeyMessages from './api_key.messages';
import type { ApiKeyEnv } from './api_key.enums';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { DEFAULT_KEY_ENV, generateRawKey, hashKey } from './api_key.crypto';
import { clearCache, deliverKeyDrops, recordKeyDrops } from './api_key.cache';
import { DAY_MS, KEY_DEFAULT_TTL_DAYS, assertUnderKeyLimit, getTenantPolicy, keyLimitLock, maxKeyTtlDays } from './api_key.policy';
import { scopesWithinAllowlist } from './api_key.enums';

// ============================================================================
// Rotation — mint a successor and grace-expire the old key
// ============================================================================

/**
 * Zero-downtime rotation: issues a brand-new key inheriting the old key's
 * scopes / IP allowlist / environment, then sets the old key to expire after
 * `graceSeconds` (or deactivates it immediately when `graceSeconds === 0`).
 * Both keys verify successfully during the grace window so consumers can
 * cut over without an outage.
 */
export async function rotate(
  tenantId: string,
  apiKeyId: string,
  createdByUserId: string,
  input: RotateApiKeyInput,
): Promise<{ key: SafeApiKey; rawKey: string }> {
  const policy = await getTenantPolicy(tenantId);
  const graceSeconds = input.graceSeconds ?? 0;

  // On the locked key, and only once: rotating a revoked, expired or already
  // rotated key used to mint a fresh ACTIVE key with the same scopes (a way to
  // undo a revocation, around the key limit), and two concurrent rotations
  // left a second active successor nobody's lineage pointed at.
  const { old, successor, keyHash, rawKey, drops } = await withSharedTenantTransactionFor(tenantId, async (qr) => {
    // The tenant's key-limit lock first (the order create takes it in): it serialises this rotation against the active-key ceiling
    // (api_key.01) and against revokeAll (api_key.22), which now waits for a rotation in flight and then revokes its successor too.
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [keyLimitLock(tenantId)]);
    const repo = qr.manager.getRepository(ApiKeyEntity);
    const old = await repo.findOne({ where: { apiKeyId, tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!old) throw new AppError(ApiKeyMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    const expired = !!old.expiresAt && new Date(old.expiresAt).getTime() <= Date.now();
    if (!old.isActive || old.successorKeyId || expired) {
      throw new AppError(ApiKeyMessages.KEY_NOT_ROTATABLE, 409, ErrorCode.CONFLICT);
    }
    // The successor is a new credential: it may not carry scopes the plan no
    // longer allows, even though the old key was minted under a wider plan.
    if (!scopesWithinAllowlist(old.scopes as never, policy.allowedScopes)) {
      throw new AppError(ApiKeyMessages.SCOPE_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
    }

    // api_key.01 (fixed 2026-10-20): a graceful rotation leaves the old key active beside its successor for the grace window, so it
    // must fit under maxActiveKeys like a create does (422 MAX_KEYS_REACHED); an immediate rotation (grace 0) swaps one for one.
    if (graceSeconds > 0) await assertUnderKeyLimit(tenantId, repo, policy.maxActiveKeys);

    const environment = (old.keyEnv as ApiKeyEnv) || DEFAULT_KEY_ENV;
    const rawKey = generateRawKey(tenantId, environment);
    const keyHash = hashKey(rawKey);

    const successor = await repo.save(repo.create({
      tenantId,
      createdByUserId,
      name: `${old.name} (rotated)`,
      description: old.description,
      keyHash,
      scopes: old.scopes,
      // Phase 48: the grant and its review mark travel to the successor; the rotator becomes its holder (D12 ceiling at use).
      permissions: old.permissions ?? [],
      scopeReview: old.scopeReview ?? false,
      keyEnv: environment,
      ipAllowlist: old.ipAllowlist ?? [],
      isActive: true,
      usageCount: 0,
      lastUsedIp: null,
      successorKeyId: null,
      // Phase 48 (D13, D48-6): a successor is a new credential and expires; it keeps the old key's expiry, or gets the default
      // lifetime when the old key (from before the phase) had none.
      expiresAt: old.expiresAt ?? new Date(Date.now() + Math.min(KEY_DEFAULT_TTL_DAYS, maxKeyTtlDays(policy)) * DAY_MS),
      // An OWNER-marked service key stays one across rotation (api_key.03); the successor is minted by the rotator.
      isServiceKey: old.isServiceKey ?? false,
      serviceKeyMarkedByUserId: old.serviceKeyMarkedByUserId ?? null,
    }));

    const patch: Partial<ApiKeyEntity> = { successorKeyId: successor.apiKeyId };
    if (graceSeconds <= 0) {
      patch.isActive = false;
    } else {
      const graceEnd = new Date(Date.now() + graceSeconds * 1000);
      // Honour any earlier existing expiry — never extend a key during rotation.
      patch.expiresAt = old.expiresAt && old.expiresAt < graceEnd ? old.expiresAt : graceEnd;
    }
    await repo.update({ apiKeyId, tenantId }, patch);
    // D253: the old key's cache drop commits with the rotation (an immediate rotation ends it at once on every node, a graceful one
    // gives every node its new expiry)
    const drops = await recordKeyDrops(qr, tenantId, [old]);
    return { old: Object.assign(old, patch), successor, keyHash, rawKey, drops };
  });

  await deliverKeyDrops(drops);
  await redis.del(`api_key:hash:${keyHash}`).catch(() => {});

  // api_key.08 (fixed 2026-10-20): a rotation is audited with the actor.
  AuditLogService.log({
    tenantId, actorId: createdByUserId ?? null, actorType: createdByUserId ? 'USER' : 'SYSTEM',
    action: 'api_key.rotated', resourceType: 'ApiKey', resourceId: old.apiKeyId,
    metadata: { successorKeyId: successor.apiKeyId, graceSeconds },
  }).catch(() => {});

  await WebhookService.dispatchEvent(tenantId, 'api_key.rotated', {
    apiKeyId: old.apiKeyId,
    successorKeyId: successor.apiKeyId,
    graceSeconds,
  }).catch(() => {});

  return { key: SafeApiKeySchema.parse(successor), rawKey };
}

// ============================================================================
// Emergency revoke-all (incident response)
// ============================================================================

/**
 * Deactivate every active key for a tenant in one atomic operation and flush
 * their cache entries. Intended for breach response. Returns the number of
 * keys revoked.
 */
export async function revokeAll(tenantId: string, actorUserId?: string): Promise<number> {
  // Lock the active keys and revoke exactly those, so the cache flush below
  // covers every key the UPDATE touched (a key created in between used to be
  // revoked in the table but left verifying from its cached row).
  const { active, drops } = await withSharedTenantTransactionFor(tenantId, async (qr) => {
    // api_key.22 (fixed 2026-10-20): under the key-limit lock every rotation takes, so a successor a concurrent rotation is about
    // to commit is in this SELECT's view; it used to be missed (a READ COMMITTED phantom) and stay active after an emergency revoke.
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [keyLimitLock(tenantId)]);
    const repo = qr.manager.getRepository(ApiKeyEntity);
    const rows = await repo.find({ where: { tenantId, isActive: true }, lock: { mode: 'pessimistic_write' } });
    if (rows.length === 0) return { active: rows, drops: [] };
    await repo.update({ tenantId, apiKeyId: In(rows.map((k) => k.apiKeyId)) }, { isActive: false });
    // D253: every revoked key's cache drop commits with the revocation
    return { active: rows, drops: await recordKeyDrops(qr, tenantId, rows) };
  });
  if (active.length === 0) return 0;

  await deliverKeyDrops(drops);

  AuditLogService.log({
    tenantId,
    actorId: actorUserId ?? null,
    actorType: actorUserId ? 'USER' : 'SYSTEM',
    action: 'api_key.revoke_all',
    resourceType: 'ApiKey',
    metadata: { revokedCount: active.length },
  }).catch(() => {});

  await WebhookService.dispatchEvent(tenantId, 'api_key.updated', {
    revokedAll: true,
    revokedCount: active.length,
  }).catch(() => {});

  return active.length;
}

// ============================================================================
// Expiry sweep (background enforcement)
// ============================================================================

/**
 * Deactivate keys whose `expiresAt` has passed but are still flagged active,
 * emitting an `api_key.expired` webhook per key. Meant to be invoked by a
 * scheduled job per tenant; `verify` already rejects expired keys at request
 * time, so this is about state hygiene and notifying webhook consumers.
 */
export async function sweepExpired(tenantId: string): Promise<number> {
  const now = new Date();
  const expired = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo
    .createQueryBuilder('k')
    .where('k.tenantId = :tenantId', { tenantId })
    .andWhere('k.isActive = :active', { active: true })
    .andWhere('k.expiresAt IS NOT NULL')
    .andWhere('k.expiresAt <= :now', { now }) // api_key.21: the instant itself is expired, as in verify and rotate
    .getMany());

  let swept = 0;
  for (const k of expired) {
    // Conditional, column-only: a concurrent sweep emits `api_key.expired`
    // once, and a concurrent edit of the key is not overwritten.
    const res = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) =>
      repo.update({ apiKeyId: k.apiKeyId, tenantId, isActive: true }, { isActive: false }));
    if (!res.affected) continue;
    swept += 1;
    await clearCache({ apiKeyId: k.apiKeyId, tenantId, keyHash: k.keyHash });
    await WebhookService.dispatchEvent(tenantId, 'api_key.expired', {
      apiKeyId: k.apiKeyId,
      name: k.name,
      expiredAt: k.expiresAt?.toISOString() ?? null,
    }).catch(() => {});
  }

  return swept;
}

/**
 * Rotation reminder: emit `api_key.expiring` for active keys whose expiry
 * falls within `withinDays`. De-duplicated per key per day via a Redis marker
 * so a daily cron does not spam consumers. Returns the number of reminders.
 */
export async function sweepExpiringSoon(tenantId: string, withinDays = 7): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * DAY_MS);
  const soon = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo
    .createQueryBuilder('k')
    .where('k.tenantId = :tenantId', { tenantId })
    .andWhere('k.isActive = :active', { active: true })
    .andWhere('k.expiresAt IS NOT NULL')
    .andWhere('k.expiresAt > :now', { now })
    .andWhere('k.expiresAt <= :horizon', { horizon })
    .getMany());

  let sent = 0;
  for (const k of soon) {
    const day = new Date().toISOString().slice(0, 10);
    const dedupeKey = `api_key:expiring:${k.apiKeyId}:${day}`;
    // Only notify once per key per day (NX marker, 2-day TTL).
    const first = await redis.set(dedupeKey, '1', 'EX', 2 * 86_400, 'NX').catch(() => 'OK');
    if (first !== 'OK') continue;
    const daysLeft = Math.max(0, Math.ceil(((k.expiresAt as Date).getTime() - now.getTime()) / DAY_MS));
    await WebhookService.dispatchEvent(tenantId, 'api_key.expiring', {
      apiKeyId: k.apiKeyId,
      name: k.name,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      daysLeft,
    }).catch(() => {});
    // Best-effort rotation reminder email to the tenant's admins/owner. Dynamic
    // import keeps the mail queue lazy and off api_key's static import graph
    // (notification_mail → notification_log → tenant → api_key would cycle).
    await import('./api_key.notifications.service')
      .then((m) => m.default.notifyKeyExpiring({
        tenantId,
        apiKeyId: k.apiKeyId,
        name: k.name,
        expiresAt: k.expiresAt as Date,
        daysLeft,
      }))
      .catch(() => {});
    sent += 1;
  }
  return sent;
}
