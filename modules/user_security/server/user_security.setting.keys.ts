import { z } from 'zod';

// MS-37 (2026-10-27): this file holds only user_security's own keys, so the module owns them (tenant_setting.key-owners.ts).
// The Security tab's keys that used to sit here in a second enum (CORS, HSTS, blocked IPs, reCAPTCHA, the cron secret) are
// tenant_setting's, declared in tenant_setting.security.setting.keys.ts. Dropped as read by nothing: rateLimitPerMinute /
// rateLimitPerHour / rateLimitEnabled (the installation's rate limits are limiter's, MS-33), xContentTypeOptions,
// xFrameOptions, maxmindAccountId, maxmindApiKey. Dropped with their uncalled helpers: mfaRequired, mfaRequiredRoles (the
// enforced policies are tenant_session's twoFactorRequired and auth's adminRequireMfa).

// ============================================================================
// user_security's setting keys (read via SettingService.getByKeys)
// ============================================================================

export const TenantSecuritySettingKeySchema = z.enum([
  // remember-this-device lifetime in days (1..30, default 30); an INSTALLATION key read from ROOT only
  // (user_security.settings-policy.ts, ROOT page /admin/settings/trusted-devices)
  'trustedDeviceTtlDays',
]);
export type TenantSecuritySettingKey = z.infer<typeof TenantSecuritySettingKeySchema>;
export const TENANT_SECURITY_KEYS = TenantSecuritySettingKeySchema.options;
