import { z } from 'zod';
import { SocialLinkPlatformEnum } from './user_profile.enums';

// ============================================================================
// Social Link Item DTO
// ============================================================================

export const SocialLinkItemDTO = z.object({
  platform: SocialLinkPlatformEnum,
  url: z.string().url(),
});

export type SocialLinkItemInput = z.infer<typeof SocialLinkItemDTO>;

// ============================================================================
// Update User Profile DTO
// ============================================================================

export const UpdateUserProfileDTO = z.object({
  name: z.string().optional(),
  lastName: z.string().optional(),
  biography: z.string().optional(),
  profilePicture: z.string().url().optional(),
  headerImage: z.string().url().optional(),
  socialLinks: z.array(SocialLinkItemDTO).optional(),
});

export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileDTO>;
