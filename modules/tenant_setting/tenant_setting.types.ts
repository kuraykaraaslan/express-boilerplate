import { z } from 'zod';

export const TenantSettingSchema = z.object({
  settingId: z.string().uuid(),
  tenantId: z.string().uuid(),
  key: z.string(),
  value: z.string().nullable(),
  isPublic: z.boolean().default(false),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export type TenantSetting = z.infer<typeof TenantSettingSchema>;
