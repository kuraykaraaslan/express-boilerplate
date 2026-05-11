import 'reflect-metadata';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { ApiKey as ApiKeyEntity } from './entities/ApiKey';
import { ApiKeyMessages } from './api_key.messages';
import { SafeApiKeySchema } from './api_key.types';
import type { SafeApiKey, CreateApiKeyResult } from './api_key.types';
import type { CreateApiKeyInput } from './api_key.dto';

export default class ApiKeyService {
  private static get repo() {
    return AppDataSource.getRepository(ApiKeyEntity);
  }

  static generateRawKey(): string {
    return `ak_${uuidv4().replace(/-/g, '')}`;
  }

  static hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  static extractPrefix(rawKey: string): string {
    return rawKey.slice(0, 8);
  }

  static async create(data: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const rawKey = ApiKeyService.generateRawKey();
    const keyHash = ApiKeyService.hashKey(rawKey);
    const keyPrefix = ApiKeyService.extractPrefix(rawKey);

    const repo = ApiKeyService.repo;
    const entity = repo.create({
      tenantId: data.tenantId,
      name: data.name,
      keyHash,
      keyPrefix,
      scopes: data.scopes,
      isActive: true,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    });

    const saved = await repo.save(entity);
    return {
      apiKey: SafeApiKeySchema.parse(saved),
      rawKey,
    };
  }

  static async verify(rawKey: string): Promise<SafeApiKey> {
    const hash = ApiKeyService.hashKey(rawKey);
    const repo = ApiKeyService.repo;

    const row = await repo.findOne({ where: { keyHash: hash } });
    if (!row) {
      throw new AppError(ApiKeyMessages.API_KEY_INVALID, 401, ErrorCode.UNAUTHORIZED);
    }

    if (!row.isActive) {
      throw new AppError(ApiKeyMessages.API_KEY_INVALID, 401, ErrorCode.UNAUTHORIZED);
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new AppError(ApiKeyMessages.API_KEY_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    }

    // Fire-and-forget lastUsedAt update
    repo.update({ apiKeyId: row.apiKeyId }, { lastUsedAt: new Date() }).catch(() => {});

    return SafeApiKeySchema.parse(row);
  }

  static async revoke(apiKeyId: string): Promise<void> {
    const row = await ApiKeyService.repo.findOne({ where: { apiKeyId } });
    if (!row) {
      throw new AppError(ApiKeyMessages.API_KEY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await ApiKeyService.repo.update({ apiKeyId }, { isActive: false });
  }

  static async findByTenant(tenantId: string): Promise<SafeApiKey[]> {
    const rows = await ApiKeyService.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => SafeApiKeySchema.parse(r));
  }

  static async delete(apiKeyId: string): Promise<void> {
    const row = await ApiKeyService.repo.findOne({ where: { apiKeyId } });
    if (!row) {
      throw new AppError(ApiKeyMessages.API_KEY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    await ApiKeyService.repo.remove(row);
  }
}
