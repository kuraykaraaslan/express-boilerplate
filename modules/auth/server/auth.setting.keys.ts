import { z } from 'zod';

// The tenant's general keys (siteName, contact*, maintenance*) live in auth.general.setting.keys.ts: this file declares only
// auth's own keys, which tenant_setting.key-owners.ts gives to auth (MS-44).
export { GeneralSettingKeySchema, GENERAL_KEYS, type GeneralSettingKey } from './auth.general.setting.keys';

// ============================================================================
// Auth Setting Keys (System-level auth configuration)
// ============================================================================

export const AuthSettingKeySchema = z.enum([
  'jwtAccessTokenSecret', 'jwtAccessTokenExpiresIn', 'jwtRefreshTokenSecret', 'jwtRefreshTokenExpiresIn',
  'oauthGoogle', 'oauthGitHub', 'oauthMicrosoft', 'oauthLinkedIn', 'oauthApple', 'oauthTwitter', 'oauthMeta', 'oauthAutodesk',
  'googleClientId', 'googleClientSecret',
  'githubClientId', 'githubClientSecret',
  'appleClientId', 'appleTeamId', 'appleKeyId', 'applePrivateKey',
  'metaClientId', 'metaClientSecret',
  'autodeskClientId', 'autodeskClientSecret',
  'gitlabToken', 'gitlabUser',
  // ── Password policy (KD-5 / KD-7) ─────────────────────────────────────────
  'passwordMinLength', 'passwordRequireUppercase', 'passwordRequireLowercase',
  'passwordRequireDigit', 'passwordRequireSpecial',
  'passwordHistoryCount', 'passwordMaxAgeDays',
  // ── Lockout policy (KD-9) ─────────────────────────────────────────────────
  'lockoutMaxAttempts', 'lockoutDurationMinutes',
  // ── Session policy (KD-11 / KD-12) ────────────────────────────────────────
  'sessionAbsoluteMaxHours', 'sessionIdleTimeoutMinutes', 'sessionRememberMeMaxHours',
  // ── Dormant account policy (KD-15) ────────────────────────────────────────
  'dormantAccountDays', 'dormantAccountAutoDisable',
  // ── Admin-panel hardening (KD-13) ─────────────────────────────────────────
  'adminPanelIpAllowlist', 'adminRequireMfa',
  // ── External-access MFA (KD-16) ───────────────────────────────────────────
  'externalRequireMfa',
  // ── TOTP branding (KD-22) ────────────────────────────────────────────────
  'totpIssuer',
  // ── Social login (KD-18) ──────────────────────────────────────────────────
  'disableSocialLogin',
  // ── CAPTCHA threshold (KD-19) ─────────────────────────────────────────────
  'captchaTriggerAttempts',
  // ── Single-session enforcement (KD-21) ────────────────────────────────────
  'singleSessionOnly',
  // ── Registration / verification posture (GTH-1 / GTH-12) ──────────────────
  'allowRegistration', 'allowSelfRegistration', 'selfServiceTenantLimit', 'emailVerificationRequired',
  // ── Per-provider SSO allow-list (GTH-2) ───────────────────────────────────
  'ssoAllowedProviders',
  // ── OTP / reset / email-verify per-tenant TTLs & limits (GTH-3) ───────────
  'otpLength', 'otpExpirySeconds', 'otpRateLimitSeconds', 'otpMaxAttempts',
  'resetTokenExpirySeconds', 'resetTokenLength',
  'emailVerifyTtlSeconds', 'emailVerifyRateLimitSeconds',
  // ── Per-tenant bcrypt cost (GTH-6) ────────────────────────────────────────
  'bcryptCost',
  // ── Compliance: password minimum age (GTH-9) ──────────────────────────────
  'passwordMinAgeDays',
  // ── Compliance: dormant-sweep erasure window (GTH-8) ──────────────────────
  'dormantDeleteAfterDays',
  // ── Tenant MFA method allow-list (GTH-13) ─────────────────────────────────
  'mfaAllowedMethods',
  // ── Breached-password rejection (backlog F10 §0) ───────────────────────────
  // OFF unless a tenant turns it on: it puts an outbound call on a credential
  // path, and a deployment that cannot make one — or does not want a third
  // party there at all — keeps the rest of the password policy regardless.
  'passwordBreachCheck',
  // ── Passwordless email login / magic link (backlog F10 §1) ─────────────────
  // ON by default — a boilerplate should offer it — but a tenant that only
  // wants password + MFA can switch it off. TTL is short; the link is a
  // first factor, not an MFA bypass (the session it creates still runs the
  // account's MFA).
  'magicLinkEnabled', 'magicLinkTtlSeconds', 'magicLinkRateLimitSeconds',
  // ── CAPTCHA provider the sign-in forms ask for (read by auth; declared nowhere before MS-44) ──
  'captchaProvider',
]);
export type AuthSettingKey = z.infer<typeof AuthSettingKeySchema>;
export const AUTH_KEYS = AuthSettingKeySchema.options;

// Ergonomic named accessors, kept in lockstep with the enum via `satisfies`.
// Only the GOODTOHAVE keys are surfaced here; the policy loader reads the rest
// by literal key. Centralised so runtime enforcement and the admin settings UI
// never drift apart.
export const AUTH_SETTING_KEYS = {
  ALLOW_REGISTRATION: 'allowRegistration',
  ALLOW_SELF_REGISTRATION: 'allowSelfRegistration',
  SELF_SERVICE_TENANT_LIMIT: 'selfServiceTenantLimit',
  EMAIL_VERIFICATION_REQUIRED: 'emailVerificationRequired',
  SSO_ALLOWED_PROVIDERS: 'ssoAllowedProviders',
  OTP_LENGTH: 'otpLength',
  OTP_EXPIRY_SECONDS: 'otpExpirySeconds',
  OTP_RATE_LIMIT_SECONDS: 'otpRateLimitSeconds',
  OTP_MAX_ATTEMPTS: 'otpMaxAttempts',
  RESET_TOKEN_EXPIRY_SECONDS: 'resetTokenExpirySeconds',
  RESET_TOKEN_LENGTH: 'resetTokenLength',
  EMAIL_VERIFY_TTL_SECONDS: 'emailVerifyTtlSeconds',
  EMAIL_VERIFY_RATE_LIMIT_SECONDS: 'emailVerifyRateLimitSeconds',
  BCRYPT_COST: 'bcryptCost',
  PASSWORD_MIN_AGE_DAYS: 'passwordMinAgeDays',
  PASSWORD_BREACH_CHECK: 'passwordBreachCheck',
  DORMANT_DELETE_AFTER_DAYS: 'dormantDeleteAfterDays',
  MFA_ALLOWED_METHODS: 'mfaAllowedMethods',
  TOTP_ISSUER: 'totpIssuer',
  MAGIC_LINK_ENABLED: 'magicLinkEnabled',
  MAGIC_LINK_TTL_SECONDS: 'magicLinkTtlSeconds',
  MAGIC_LINK_RATE_LIMIT_SECONDS: 'magicLinkRateLimitSeconds',
} as const satisfies Record<string, AuthSettingKey>;

/** Magic-link defaults — used when a tenant has not overridden the setting. */
export const MAGIC_LINK_DEFAULTS = {
  /** Offered unless a tenant turns it off. */
  enabled: true,
  /** How long a link is valid. Short on purpose. */
  ttlSeconds: 15 * 60,
  /** Minimum gap between two link requests for one email. */
  rateLimitSeconds: 60,
} as const;
