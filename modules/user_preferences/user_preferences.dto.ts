import { z } from 'zod';
import { ThemeEnum, LanguageEnum } from './user_preferences.enums';

// ============================================================================
// Update User Preferences DTO
// ============================================================================

export const UpdateUserPreferencesDTO = z.object({
  language: LanguageEnum.optional(),
  timezone: z.string().optional(),
  theme: ThemeEnum.optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
});

export type UpdateUserPreferencesInput = z.infer<typeof UpdateUserPreferencesDTO>;
