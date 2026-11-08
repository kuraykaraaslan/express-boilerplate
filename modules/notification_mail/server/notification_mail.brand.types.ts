import type { BrandIdentity } from '@kuraykaraaslan-labs/common/server/brand-identity.types';

/** Extension point id — declared in notification_mail/module.json `extensionPoints`. */
export const MAIL_BRAND_SOURCE_POINT = 'notification_mail:brand_source';

/**
 * What a brand source may contribute. This is the SAME four-field allowlist the
 * status page reads (`common/brand-identity.types`, aliased by `observability/status.branding.ts` — name, logo light/dark,
 * primary colour), plus the one thing mail needs that the status page does not:
 * the tenant's origin for links. There is deliberately no field for HTML, CSS,
 * a footer or a sender name: a tenant string is rendered as ESCAPED TEXT or as a
 * validated URL/colour, never as markup, in a mail that may carry a reset link.
 *
 * Every field is optional and `null`/absent means "use the platform default" —
 * a missing module is not an error, it is the plain mail.
 */
export interface MailBrandPatch extends Partial<BrandIdentity> {
  /** The tenant's own origin (`https://acme.example.com`), only when it is verified/active. */
  baseUrl?: string | null;
}

/** The default export of a module contributing to `notification_mail:brand_source`. */
export interface MailBrandSource {
  load(tenantId: string): Promise<MailBrandPatch | null> | MailBrandPatch | null;
}

/** A validated patch: every value is either a safe string or null. */
export interface SanitizedBrand {
  name: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  baseUrl: string | null;
}

/** The platform's env-level values, i.e. what mail looked like before branding. */
export interface PlatformMailDefaults {
  appName: string;
  frontendUrl: string;
  loginPath: string;
  resetPasswordPath: string;
  forgotPasswordPath: string;
  termsPath: string;
  privacyPath: string;
  supportEmail: string;
}

/**
 * Templates that carry an account-control credential or warning. When the
 * tenant is branded but has no verified domain, these get a fixed sentence
 * naming the PLATFORM operator's support address (see `securityNotice`).
 */
export const SECURITY_TEMPLATES: ReadonlySet<string> = new Set([
  'password_reset.ejs',
  'new_login.ejs',
  'new_device_alert.ejs',
  'verify_email.ejs',
  'magic_link.ejs',
  'forgot_password.ejs',
  'password_changed.ejs',
  'email_change.ejs',
  'suspicious_activity.ejs',
  'otp.ejs',
  'otp_enabled.ejs',
  'otp_disabled.ejs',
]);
