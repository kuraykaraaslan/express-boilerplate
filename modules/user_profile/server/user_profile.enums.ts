// The profile enums live with the profile schema in `user` (user/server/user-profile.schema), because SafeUser
// carries the profile and `user` cannot import this module, which requires it. Re-exported here unchanged.
export {
  ProfileVisibilityEnum,
  VerificationStatusEnum,
  NameOrderEnum,
  SocialLinkPlatformEnum,
} from '@kuraykaraaslan-labs/user/server/user-profile.schema';
export type {
  ProfileVisibility,
  VerificationStatus,
  NameOrder,
  SocialLinkPlatform,
} from '@kuraykaraaslan-labs/user/server/user-profile.schema';
