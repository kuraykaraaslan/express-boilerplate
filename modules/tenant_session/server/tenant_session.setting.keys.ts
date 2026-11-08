import { z } from 'zod';

// ============================================================================
// Tenant Session Setting Keys
// ============================================================================

/**
 * The per-tenant keys tenant_session reads (tenant_session.policy.ts), owned by this module in tenant_setting.key-owners.ts
 * (`tenant_session.settings.read` / `.update`), edited on Settings → Sign-in Policy:
 *  - `twoFactorRequired`: every member's request must come on a session that proved a second factor (assert2faSatisfied).
 *    OWNER-only; switched on only from a session that proved one (tenant_setting.two-factor.ts).
 *  - `ipWhitelist`, `ipBlacklist`: the tenant's own allow / deny lists (assertIpAllowed; never inherited). OWNER-only; a
 *    list that would shut out its writer is refused (tenant_setting.ip-lists.ts).
 *  - `maxConcurrentSessions`: the per-member session cap, enforced when a session is issued (user_session `enforceSessionCap`, MS-36); since D28
 *    the cap is always on: unset or 0 = the platform default of 10; a tenant may only lower it, never raise it. OWNER-only.
 *  - `sessionTimeout` (minutes): caps how long a resolved membership is cached (resolveSessionTtl); no field.
 *
 * MS-39 (2026-10-27): no longer declared, read by nothing here: `maxLoginAttempts` (the enforced lockout is auth's
 * `lockoutMaxAttempts`), `passwordMinLength` / `passwordRequireUppercase` (auth's own keys), `passwordRequireNumbers` /
 * `passwordRequireSymbols` (auth reads `passwordRequireDigit` / `passwordRequireSpecial`), `ssoEnabled` / `ssoProvider` /
 * `ssoConfig` (sign-in gating is auth's `disableSocialLogin` / `ssoAllowedProviders`, auth_sso's and auth_saml's).
 */
export const TenantSecuritySettingKeySchema = z.enum([
  'twoFactorRequired',
  'sessionTimeout',
  'maxConcurrentSessions',
  'ipWhitelist',
  'ipBlacklist',
]);
export type TenantSecuritySettingKey = z.infer<typeof TenantSecuritySettingKeySchema>;
export const TENANT_SECURITY_KEYS = TenantSecuritySettingKeySchema.options;
