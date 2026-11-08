import 'reflect-metadata';
import type { SafeApiKey } from './api_key.types';
import type { CreateApiKeyInput, UpdateApiKeyInput, RotateApiKeyInput } from './api_key.dto';
import type { ApiKeyEnv, RequiredScope } from './api_key.enums';
import { generateRawKey, hashKey } from './api_key.crypto';
import { getNegativeCacheTtl } from './api_key.cache';
import { list, countForReview, getById, getLineage, create, update, remove, type KeyGrantContext } from './api_key.crud.service';
import { rotate, revokeAll, sweepExpired, sweepExpiringSoon } from './api_key.rotation.service';
import { verify, verifyFromAuthHeader, type VerifyContext } from './api_key.verify.service';
import { ipFromHeaders, recordUsage } from './api_key.verify.helpers';

export type { VerifyContext, KeyGrantContext };

/**
 * API key service facade. The implementation is split across focused modules
 * (`api_key.crud.service`, `api_key.rotation.service`, `api_key.verify.service`,
 * plus the `api_key.crypto` / `api_key.cache` / `api_key.policy` helpers); this
 * class preserves the single `ApiKeyService.*` entry point its callers depend on.
 */
export default class ApiKeyService {
  static getNegativeCacheTtl(): Promise<number> {
    return getNegativeCacheTtl();
  }

  static generateRawKey(tenantId: string, environment?: ApiKeyEnv): string {
    return generateRawKey(tenantId, environment);
  }

  static hashKey(rawKey: string): string {
    return hashKey(rawKey);
  }

  static list(input: Parameters<typeof list>[0]): Promise<{ keys: SafeApiKey[]; total: number }> {
    return list(input);
  }

  static countForReview(tenantId: string): Promise<number> {
    return countForReview(tenantId);
  }

  static getById(tenantId: string, apiKeyId: string): Promise<SafeApiKey> {
    return getById(tenantId, apiKeyId);
  }

  static getLineage(
    tenantId: string,
    apiKeyId: string,
  ): Promise<{ key: SafeApiKey; successor: SafeApiKey | null; predecessors: SafeApiKey[] }> {
    return getLineage(tenantId, apiKeyId);
  }

  static create(tenantId: string, createdByUserId: string, input: CreateApiKeyInput, grant?: KeyGrantContext): Promise<{ key: SafeApiKey; rawKey: string }> {
    return create(tenantId, createdByUserId, input, grant);
  }

  static update(tenantId: string, apiKeyId: string, input: UpdateApiKeyInput, actorId?: string, grant?: KeyGrantContext): Promise<SafeApiKey> {
    return update(tenantId, apiKeyId, input, actorId, grant);
  }

  static delete(tenantId: string, apiKeyId: string, actorId?: string): Promise<void> {
    return remove(tenantId, apiKeyId, actorId);
  }

  static rotate(tenantId: string, apiKeyId: string, createdByUserId: string, input: RotateApiKeyInput): Promise<{ key: SafeApiKey; rawKey: string }> {
    return rotate(tenantId, apiKeyId, createdByUserId, input);
  }

  static revokeAll(tenantId: string, actorUserId?: string): Promise<number> {
    return revokeAll(tenantId, actorUserId);
  }

  static sweepExpired(tenantId: string): Promise<number> {
    return sweepExpired(tenantId);
  }

  static sweepExpiringSoon(tenantId: string, withinDays?: number): Promise<number> {
    return sweepExpiringSoon(tenantId, withinDays);
  }

  /** `requiredScope`: one scope, or `{ anyOf }` (41-ui-fixes/15 C10); a miss is audited `insufficient_scope` and records no usage. */
  static verify(rawKey: string, requiredScope?: RequiredScope, ctx?: VerifyContext): Promise<SafeApiKey> {
    return verify(rawKey, requiredScope, ctx);
  }

  static verifyFromAuthHeader(
    request: { headers: { get: (name: string) => string | null } },
    tenantId?: string,
    requiredScope?: RequiredScope,
    ctx?: VerifyContext,
  ): Promise<SafeApiKey> {
    return verifyFromAuthHeader(request, tenantId, requiredScope, ctx);
  }

  /**
   * Stamp a key's use (lastUsedAt, lastUsedIp, usageCount), fire-and-forget. For a caller that verified with `deferUsage`
   * because it refuses some verified keys itself (its own scope rule, tenant or record check): it stamps once it let the call through.
   */
  static recordUse(apiKeyId: string, ip: string | null | undefined): void {
    void recordUsage(apiKeyId, ip ?? null);
  }

  /** {@link recordUse} with the caller's IP read from the request headers, as `verifyFromAuthHeader` reads it. */
  static recordUseFromRequest(request: { headers: { get: (name: string) => string | null } }, apiKeyId: string): void {
    void recordUsage(apiKeyId, ipFromHeaders(request.headers));
  }
}
