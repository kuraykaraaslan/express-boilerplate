import { z } from 'zod';
import { SocialLinkPlatformEnum } from './user_profile.enums';

export const UpdateSocialLinkItemSchema = z.object({
  id: z.string().uuid(),
  platform: SocialLinkPlatformEnum,
  url: z.string().url().nullable(),
  order: z.number().int().nonnegative()
});

/**
 * A profile save carries only what it changes (06-user 1.2): an absent key keeps the stored value (the service drops undefined keys).
 * `null` clears a field; `socialLinks: null` clears the links.
 */
export const UpdateProfileRequestSchema = z.object({
  name: z.string().nullish(),
  biography: z.string().nullish(),
  profilePicture: z.string().nullish(),
  headerImage: z.string().nullish(),
  socialLinks: z.array(UpdateSocialLinkItemSchema).nullish().transform((val) => (val === null ? [] : val)),
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
