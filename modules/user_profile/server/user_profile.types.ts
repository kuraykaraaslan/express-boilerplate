// The profile schema lives in `user` (user/server/user-profile.schema), because SafeUser carries the profile and
// `user` cannot import this module, which requires it. Re-exported here unchanged.
export {
  SocialLinkItemSchema,
  SocialLinksSchema,
  UserProfileSchema,
  UserProfileDefault,
} from '@kuraykaraaslan-labs/user/server/user-profile.schema';
export type { UserProfile, SocialLinkItem } from '@kuraykaraaslan-labs/user/server/user-profile.schema';
