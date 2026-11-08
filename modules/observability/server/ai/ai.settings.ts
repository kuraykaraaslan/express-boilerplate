/** Reading and writing the tenant's AI settings (phase 20). The schemas, defaults and parsing are pure and live in `ai.settings.schema.ts`. */
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { OBSERVABILITY_AI_SETTING_KEYS } from './ai.setting.keys';
import { AI_SETTINGS_DEFAULT, AiSettingsPatchSchema, mergeAiSettings, parseAiSettings, type AiSettings } from './ai.settings.schema';

export * from './ai.settings.schema';

export async function getAiSettings(tenantId: string): Promise<AiSettings> {
  try {
    return parseAiSettings(await SettingService.getValue(tenantId, OBSERVABILITY_AI_SETTING_KEYS.SETTINGS));
  } catch {
    return AI_SETTINGS_DEFAULT;
  }
}

export async function updateAiSettings(tenantId: string, patch: unknown, actorId?: string): Promise<AiSettings> {
  const p = AiSettingsPatchSchema.parse(patch);
  const next = mergeAiSettings(await getAiSettings(tenantId), p);
  await SettingService.create(tenantId, OBSERVABILITY_AI_SETTING_KEYS.SETTINGS, JSON.stringify(next), 'observability', 'json', actorId ? { actorId } : undefined);
  return next;
}
