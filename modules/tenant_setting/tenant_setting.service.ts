import 'reflect-metadata';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { TenantSetting as TenantSettingEntity } from './entities/TenantSetting';
import { TenantSettingMessages } from './tenant_setting.messages';
import { TenantSettingSchema } from './tenant_setting.types';
import type { TenantSetting } from './tenant_setting.types';
import type { SetSettingInput } from './tenant_setting.dto';

export default class TenantSettingService {
  private static get repo() {
    return AppDataSource.getRepository(TenantSettingEntity);
  }

  static async get(tenantId: string, key: string): Promise<TenantSetting | null> {
    const setting = await TenantSettingService.repo.findOne({
      where: { tenantId, key },
    });
    if (!setting) return null;
    return TenantSettingSchema.parse(setting);
  }

  static async set(data: SetSettingInput): Promise<TenantSetting> {
    const repo = TenantSettingService.repo;

    const existing = await repo.findOne({ where: { tenantId: data.tenantId, key: data.key } });

    let saved: TenantSettingEntity;
    if (existing) {
      await repo.update(
        { tenantId: data.tenantId, key: data.key },
        {
          value: data.value,
          ...(data.isPublic !== undefined ? { isPublic: data.isPublic } : {}),
        },
      );
      saved = (await repo.findOne({ where: { tenantId: data.tenantId, key: data.key } }))!;
    } else {
      const entity = repo.create({
        tenantId: data.tenantId,
        key: data.key,
        value: data.value,
        isPublic: data.isPublic ?? false,
      });
      saved = await repo.save(entity);
    }

    return TenantSettingSchema.parse(saved);
  }

  static async getAll(tenantId: string, publicOnly?: boolean): Promise<TenantSetting[]> {
    const where: Record<string, unknown> = { tenantId };
    if (publicOnly === true) where.isPublic = true;

    const settings = await TenantSettingService.repo.find({ where: where as any });
    return settings.map((s) => TenantSettingSchema.parse(s));
  }

  static async delete(tenantId: string, key: string): Promise<void> {
    const repo = TenantSettingService.repo;

    const existing = await repo.findOne({ where: { tenantId, key } });
    if (!existing) {
      throw new AppError(TenantSettingMessages.SETTING_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.delete({ tenantId, key });
  }

  static toKeyValueMap(settings: TenantSetting[]): Record<string, string> {
    return Object.fromEntries(
      settings
        .filter((s) => s.value !== null)
        .map((s) => [s.key, s.value as string]),
    );
  }
}
