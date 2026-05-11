import { z } from 'zod';

export const SetSettingDTO = z.object({
  tenantId: z.string().uuid(),
  key: z.string().min(1),
  value: z.string(),
  isPublic: z.boolean().optional(),
});

export const GetSettingDTO = z.object({
  tenantId: z.string().uuid(),
  key: z.string().min(1),
});

export const GetAllSettingsDTO = z.object({
  tenantId: z.string().uuid(),
  publicOnly: z.boolean().optional(),
});

export type SetSettingInput = z.infer<typeof SetSettingDTO>;
export type GetSettingInput = z.infer<typeof GetSettingDTO>;
export type GetAllSettingsInput = z.infer<typeof GetAllSettingsDTO>;
