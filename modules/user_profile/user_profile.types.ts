import { z } from 'zod';
import { SocialLinkPlatformEnum } from './user_profile.enums';

export const SocialLinkSchema = z.object({
  platform: SocialLinkPlatformEnum,
  url: z.string().url(),
});

export const UserProfileSchema = z.object({
  userProfileId: z.string().uuid(),
  userId: z.string(),
  name: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  profilePicture: z.string().nullable().optional(),
  headerImage: z.string().nullable().optional(),
  socialLinks: z.array(SocialLinkSchema).nullish().transform((val) => val ?? []),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SafeUserProfileSchema = UserProfileSchema;

export type UserProfile = z.infer<typeof UserProfileSchema>;
export type SafeUserProfile = z.infer<typeof SafeUserProfileSchema>;
export type SocialLink = z.infer<typeof SocialLinkSchema>;
