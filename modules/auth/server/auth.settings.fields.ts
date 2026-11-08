import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';
import { AUTH_SETTING_KEYS } from './auth.setting.keys';

// UI metadata for the Auth settings page. Covers the GOODTOHAVE per-tenant
// knobs. Policy keys already surfaced elsewhere (password / lockout / session)
// are intentionally not duplicated here.
export const AUTH_SETTINGS_FIELDS: SettingFieldDef[] = [
  // ── Registration & verification ──────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.ALLOW_SELF_REGISTRATION,
    label: 'Open Sign-up',
    description: 'Show "Sign up" on the sign-in page and let visitors create an account here. On the platform this opens the platform sign-up, after which a person opens their own organization. Each organization decides for itself (never inherited from the platform).',
    group: 'Registration & Verification',
    type: 'boolean',
    defaultValue: 'false',
  },
  // 05-tenant-member 3.1: no defaultMemberRole here. Self-registration always creates a USER; the setting (owner-only) lives
  // on the Members settings page and applies to invitations and admin-created members.
  {
    key: AUTH_SETTING_KEYS.SELF_SERVICE_TENANT_LIMIT,
    label: 'Organizations a Person May Open',
    description: 'How many organizations one person may open themselves after the platform sign-up (0 = nobody). Organizations the platform creates are not counted.',
    group: 'Registration & Verification',
    type: 'number',
    defaultValue: '3',
    rootOnly: true,
  },
  {
    key: AUTH_SETTING_KEYS.ALLOW_REGISTRATION,
    label: 'Registration Allowed',
    description: 'Master switch: when off, nobody can create an account here, whatever "Open Sign-up" says (invitations still work). The platform\'s value applies to every organization.',
    group: 'Registration & Verification',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: AUTH_SETTING_KEYS.EMAIL_VERIFICATION_REQUIRED,
    label: 'Require Verified Email',
    description: 'When enabled, users must verify their email address before they can sign in.',
    group: 'Registration & Verification',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: AUTH_SETTING_KEYS.MAGIC_LINK_ENABLED,
    label: 'Passwordless Sign-in Link',
    description: 'Let members request a one-time email link to sign in without a password. The link is short-lived, single-use, and does not skip MFA.',
    group: 'Registration & Verification',
    type: 'boolean',
    defaultValue: 'true',
  },
  // ── SSO / MFA ──────────────────────────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.SSO_ALLOWED_PROVIDERS,
    label: 'Allowed SSO Providers',
    description: 'Comma-separated provider allow-list (e.g. google, microsoft, github). Leave blank to allow all enabled providers.',
    group: 'SSO & MFA',
    type: 'textarea',
    placeholder: 'google, microsoft',
  },
  {
    key: AUTH_SETTING_KEYS.MFA_ALLOWED_METHODS,
    label: 'Allowed MFA Methods',
    description: 'Comma-separated list of permitted second factors: TOTP_APP, EMAIL, SMS. Leave blank to allow all. (e.g. ban SMS to mitigate SIM-swap.)',
    group: 'SSO & MFA',
    type: 'textarea',
    placeholder: 'TOTP_APP, EMAIL',
  },
  // ── TOTP branding ────────────────────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.TOTP_ISSUER,
    label: 'TOTP Issuer Label',
    description: 'The brand name shown inside authenticator apps (Google Authenticator, Authy). Falls back to the platform name.',
    group: 'SSO & MFA',
    type: 'text',
    placeholder: 'Acme Inc.',
  },
  // ── OTP delivery ───────────────────────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.OTP_LENGTH,
    label: 'OTP Length (digits)',
    description: 'Number of digits in email/SMS one-time codes.',
    group: 'OTP Delivery',
    type: 'number',
    placeholder: '6',
  },
  {
    key: AUTH_SETTING_KEYS.OTP_EXPIRY_SECONDS,
    label: 'OTP Expiry (seconds)',
    description: 'How long an OTP code remains valid.',
    group: 'OTP Delivery',
    type: 'number',
    placeholder: '600',
  },
  {
    key: AUTH_SETTING_KEYS.OTP_RATE_LIMIT_SECONDS,
    label: 'OTP Rate-Limit Window (seconds)',
    description: 'Sliding window over which OTP request attempts are counted.',
    group: 'OTP Delivery',
    type: 'number',
    placeholder: '60',
  },
  {
    key: AUTH_SETTING_KEYS.OTP_MAX_ATTEMPTS,
    label: 'OTP Max Attempts',
    description: 'Maximum OTP requests/verifications before rate-limiting kicks in.',
    group: 'OTP Delivery',
    type: 'number',
    placeholder: '5',
  },
  // ── Password reset ──────────────────────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.RESET_TOKEN_EXPIRY_SECONDS,
    label: 'Reset Token Expiry (seconds)',
    description: 'Lifetime of a password-reset token.',
    group: 'Password Reset & Verification',
    type: 'number',
    placeholder: '3600',
  },
  {
    key: AUTH_SETTING_KEYS.RESET_TOKEN_LENGTH,
    label: 'Reset Token Length (digits)',
    description: 'Number of digits in the password-reset token (minimum 4).',
    group: 'Password Reset & Verification',
    type: 'number',
    placeholder: '6',
  },
  {
    key: AUTH_SETTING_KEYS.EMAIL_VERIFY_TTL_SECONDS,
    label: 'Email-Verification TTL (seconds)',
    description: 'Lifetime of an email-verification token.',
    group: 'Password Reset & Verification',
    type: 'number',
    placeholder: '86400',
  },
  {
    key: AUTH_SETTING_KEYS.EMAIL_VERIFY_RATE_LIMIT_SECONDS,
    label: 'Email-Verification Rate-Limit (seconds)',
    description: 'Minimum interval between verification-email resends.',
    group: 'Password Reset & Verification',
    type: 'number',
    placeholder: '300',
  },
  // ── Hardening / compliance ──────────────────────────────────────────────────
  {
    key: AUTH_SETTING_KEYS.BCRYPT_COST,
    label: 'Bcrypt Cost Factor',
    description: 'Password hashing cost (4–15). Higher is more secure but slower. Falls back to 10.',
    group: 'Hardening & Compliance',
    type: 'number',
    placeholder: '10',
  },
  {
    key: AUTH_SETTING_KEYS.PASSWORD_MIN_AGE_DAYS,
    label: 'Password Minimum Age (days)',
    description: 'Minimum time before a password can be changed again (prevents history-cycling). 0 = disabled.',
    group: 'Hardening & Compliance',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
  {
    key: AUTH_SETTING_KEYS.PASSWORD_BREACH_CHECK,
    label: 'Reject Breached Passwords',
    description: 'Check new passwords against the public Have I Been Pwned list and refuse ones that appear on it. Only the first five characters of the password\u2019s hash are sent (k-anonymity) \u2014 never the password. Off by default because it makes an outbound call while somebody is registering; if the list is unreachable the password is simply not checked.',
    group: 'Hardening & Compliance',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: AUTH_SETTING_KEYS.DORMANT_DELETE_AFTER_DAYS,
    label: 'Dormant Erasure Window (days)',
    description: 'Right-to-erasure: anonymise dormant accounts inactive for this many days. 0 = disable-only (never erase).',
    group: 'Hardening & Compliance',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
];
