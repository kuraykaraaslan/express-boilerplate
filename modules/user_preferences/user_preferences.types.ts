import { z } from 'zod';

export const UserPreferencesSchema = z.object({
  userPreferencesId: z.string().uuid(),
  userId: z.string(),
  language: z.string().default('en'),
  timezone: z.string().default('UTC'),
  theme: z.string().default('light'),
  emailNotifications: z.boolean().default(true),
  pushNotifications: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
