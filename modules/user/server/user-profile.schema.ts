import { z } from 'zod';

/**
 * The profile's shape, owned by `user`: SafeUser carries an optional `userProfile`, and `user` must describe it without
 * importing `user_profile`, which requires `user` back (docs/phases/37-extensions/10, 2026-10-17 second pass). Only
 * zod, so it is safe in every bundle. `user_profile.types` and `user_profile.enums` re-export all of it, so the
 * profile module and its importers read the same schema they always did.
 */

// Overall and per-field visibility for public-facing profile exposure (GDPR
// data-minimization). TENANT = visible only to members of the same tenant.
export const ProfileVisibilityEnum = z.enum(['PUBLIC', 'TENANT', 'PRIVATE']);
export type ProfileVisibility = z.infer<typeof ProfileVisibilityEnum>;

// Identity-verification status (KYC / verified-badge gate).
export const VerificationStatusEnum = z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

// Name ordering — GIVEN_FIRST (Western) vs FAMILY_FIRST (East Asian, Hungarian).
export const NameOrderEnum = z.enum(['GIVEN_FIRST', 'FAMILY_FIRST']);
export type NameOrder = z.infer<typeof NameOrderEnum>;

export const SocialLinkPlatformEnum = z.enum([
  // Core Developer Platforms
  'GITHUB',
  'GITLAB',
  'BITBUCKET',
  'STACKOVERFLOW',
  'NPM',
  'PYPI',

  // Blogging & Writing
  'DEVTO',
  'MEDIUM',
  'HASHNODE',
  'SUBSTACK',

  // Professional & Career
  'LINKEDIN',
  'WEBSITE',
  'EMAIL',
  'CALENDLY',

  // Social Media
  'TWITTER',
  'FACEBOOK',
  'INSTAGRAM',
  'YOUTUBE',
  'TIKTOK',
  'SNAPCHAT',
  'REDDIT',
  'PINTEREST',

  // Community & Messaging
  'DISCORD',
  'SLACK',
  'TELEGRAM',
  'KEYBASE',
  'DISCOURSE',

  // Freelance / Consulting
  'UPWORK',
  'FREELANCER',
  'FIVERR',
  'TOPTAL',

  // Frontend / Playground
  'CODEPEN',
  'JSFIDDLE',

  // Competitive / Learning
  'LEETCODE',
  'HACKERRANK',
  'KAGGLE',
]);

export type SocialLinkPlatform = z.infer<typeof SocialLinkPlatformEnum>;

export const SocialLinkItemSchema = z.object({
  id: z.string().uuid(),
  platform: SocialLinkPlatformEnum,
  url: z.string().url().nullable(),
  order: z.number().int().nonnegative()
});

export const SocialLinksSchema = z.array(SocialLinkItemSchema).default([]);

export const UserProfileSchema = z.object({
  name: z.string().nullable(),
  // Structured / localized name fields (directory-service mapping, correct
  // formatting for cultures where family name precedes given name).
  firstName: z.string().nullable().default(null),
  lastName: z.string().nullable().default(null),
  displayName: z.string().nullable().default(null),
  nameOrder: NameOrderEnum.default('GIVEN_FIRST'),
  pronouns: z.string().max(40).nullable().default(null),
  biography: z.string().nullable(),
  profilePicture: z.string().nullable(),
  headerImage: z.string().nullable(),
  socialLinks: SocialLinksSchema,
  // Visibility: overall + per-field overrides (field name → visibility).
  visibility: ProfileVisibilityEnum.default('PUBLIC'),
  fieldVisibility: z.record(z.string(), ProfileVisibilityEnum).default({}),
  // Identity verification (verified badge / KYC gate).
  isVerified: z.boolean().default(false),
  verificationStatus: VerificationStatusEnum.default('UNVERIFIED'),
  // Per-tenant custom fields (JSONB extension — department, vatNumber, CPF...).
  customFields: z.record(z.string(), z.unknown()).default({}),
  // GDPR erasure marker.
  anonymizedAt: z.coerce.date().nullable().default(null),
});


export const UserProfileDefault: z.infer<typeof UserProfileSchema> = {
  name: null,
  firstName: null,
  lastName: null,
  displayName: null,
  nameOrder: 'GIVEN_FIRST',
  pronouns: null,
  biography: null,
  profilePicture: null,
  headerImage: null,
  socialLinks: [],
  visibility: 'PUBLIC',
  fieldVisibility: {},
  isVerified: false,
  verificationStatus: 'UNVERIFIED',
  customFields: {},
  anonymizedAt: null,
};

export type UserProfile = z.infer<typeof UserProfileSchema>;
export type SocialLinkItem = z.infer<typeof SocialLinkItemSchema>;
