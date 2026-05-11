import 'reflect-metadata';
import TenantSettingService from '@/modules/tenant_setting/tenant_setting.service';
import { TENANT_BRANDING_KEYS } from './tenant_branding.setting.keys';
import { TenantBrandingSchema } from './tenant_branding.types';
import type { TenantBranding } from './tenant_branding.types';

export default class TenantBrandingService {

  static async get(tenantId: string): Promise<TenantBranding> {
    const allSettings = await TenantSettingService.getAll(tenantId);
    const keyValueMap = TenantSettingService.toKeyValueMap(allSettings);
    const filtered: Record<string, string> = {};
    for (const key of TENANT_BRANDING_KEYS) {
      if (keyValueMap[key] !== undefined) {
        filtered[key] = keyValueMap[key];
      }
    }
    return TenantBrandingSchema.parse(filtered);
  }

  static async update(tenantId: string, data: Partial<TenantBranding>): Promise<TenantBranding> {
    for (const key of TENANT_BRANDING_KEYS) {
      const value = data[key];
      if (value !== undefined) {
        await TenantSettingService.set({ tenantId, key, value });
      }
    }

    return this.get(tenantId);
  }

  static async reset(tenantId: string): Promise<void> {
    for (const key of TENANT_BRANDING_KEYS) {
      await TenantSettingService.delete(tenantId, key).catch(() => {});
    }
  }
}
