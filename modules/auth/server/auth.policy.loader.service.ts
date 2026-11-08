import { env } from '@kuraykaraaslan-labs/env';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';

export const PASSWORD_POLICY_KEYS = [
  'passwordMinLength', 'passwordRequireUppercase', 'passwordRequireLowercase',
  'passwordRequireDigit', 'passwordRequireSpecial', 'passwordHistoryCount', 'passwordMaxAgeDays',
  'passwordMinAgeDays', 'passwordBreachCheck',
] as const;

export const LOCKOUT_POLICY_KEYS = ['lockoutMaxAttempts', 'lockoutDurationMinutes'] as const;
export const SESSION_POLICY_KEYS = ['sessionAbsoluteMaxHours', 'sessionIdleTimeoutMinutes', 'sessionRememberMeMaxHours'] as const;
export const DORMANT_POLICY_KEYS = ['dormantAccountDays', 'dormantAccountAutoDisable', 'dormantDeleteAfterDays'] as const;
export const ADMIN_POLICY_KEYS   = ['adminPanelIpAllowlist', 'adminRequireMfa'] as const;
export const ACCESS_POLICY_KEYS  = [
  'externalRequireMfa', 'disableSocialLogin', 'captchaTriggerAttempts', 'singleSessionOnly',
  'allowRegistration', 'emailVerificationRequired', 'ssoAllowedProviders', 'mfaAllowedMethods',
] as const;
export const OTP_POLICY_KEYS = ['otpLength', 'otpExpirySeconds', 'otpRateLimitSeconds', 'otpMaxAttempts'] as const;
export const RESET_POLICY_KEYS = ['resetTokenExpirySeconds', 'resetTokenLength'] as const;
export const EMAIL_VERIFY_POLICY_KEYS = ['emailVerifyTtlSeconds', 'emailVerifyRateLimitSeconds'] as const;
export const CREDENTIAL_POLICY_KEYS = ['bcryptCost'] as const;

export interface PasswordPolicy {
  minLength: number; requireUppercase: boolean; requireLowercase: boolean;
  requireDigit: boolean; requireSpecial: boolean; historyCount: number; maxAgeDays: number;
  minAgeDays: number;
  /**
   * Reject passwords found on a public breach list (backlog F10 §0).
   *
   * Defaults to TRUE since docs/phases/38-security 5.7 (`passwordBreachCheck`, tenant-overridable). It puts an outbound call on a
   * credential path and fails open: a timeout or an error lets the password through (auth.breach-check.ts).
   */
  breachCheck: boolean;
}

export interface LockoutPolicy { maxAttempts: number; lockDurationMinutes: number; }
export interface SessionPolicy { absoluteMaxHours: number; idleTimeoutMinutes: number; rememberMeMaxHours: number; }
export interface DormantPolicy { days: number; autoDisable: boolean; deleteAfterDays: number; }

export interface AdminPolicy {
  ipAllowlist: string[];
  requireMfa: boolean;
}

/** Supported MFA second-factor methods (matches user_security OTP methods). */
export type MfaMethod = 'TOTP_APP' | 'EMAIL' | 'SMS';
export const ALL_MFA_METHODS: MfaMethod[] = ['TOTP_APP', 'EMAIL', 'SMS'];

export interface AccessPolicy {
  externalRequireMfa: boolean;
  disableSocialLogin: boolean;
  captchaTriggerAttempts: number;
  singleSessionOnly: boolean;
  /** GTH-1: when false, self-registration is rejected (invite-only). */
  allowRegistration: boolean;
  /** GTH-1/12: when true, a verified email is required for credential login. */
  emailVerificationRequired: boolean;
  /** GTH-2: per-provider SSO allow-list. Empty array = all providers allowed. */
  ssoAllowedProviders: string[];
  /** GTH-13: tenant-allowed MFA methods. Empty = all methods allowed. */
  mfaAllowedMethods: MfaMethod[];
}

/** GTH-3: per-tenant OTP delivery knobs. */
export interface OtpPolicy { length: number; expirySeconds: number; rateLimitSeconds: number; maxAttempts: number; }
/** GTH-3: per-tenant password-reset token knobs. */
export interface ResetPolicy { tokenExpirySeconds: number; tokenLength: number; }
/** GTH-3: per-tenant email-verification token knobs. */
export interface EmailVerifyPolicy { ttlSeconds: number; rateLimitSeconds: number; }
/** GTH-6: per-tenant bcrypt cost factor. */
export interface CredentialPolicy { bcryptCost: number; }

const PASSWORD_DEFAULTS: PasswordPolicy = {
  minLength: 8, requireUppercase: true, requireLowercase: true,
  requireDigit: true, requireSpecial: true, historyCount: 3, maxAgeDays: 42, minAgeDays: 0,
  breachCheck: true,
};

const LOCKOUT_DEFAULTS: LockoutPolicy = { maxAttempts: 5, lockDurationMinutes: 15 };
const SESSION_DEFAULTS: SessionPolicy = {
  absoluteMaxHours: env.AUTH_SESSION_ABSOLUTE_MAX_HOURS,
  idleTimeoutMinutes: env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  rememberMeMaxHours: env.AUTH_SESSION_REMEMBER_ME_MAX_HOURS,
};
const DORMANT_DEFAULTS: DormantPolicy = { days: 90, autoDisable: true, deleteAfterDays: 0 };
const ADMIN_DEFAULTS: AdminPolicy = { ipAllowlist: [], requireMfa: true };
const ACCESS_DEFAULTS: AccessPolicy = {
  externalRequireMfa: false, disableSocialLogin: false,
  captchaTriggerAttempts: 3, singleSessionOnly: false,
  allowRegistration: true, emailVerificationRequired: true,
  ssoAllowedProviders: [], mfaAllowedMethods: [],
};

// Env-derived defaults so per-tenant settings fall back to the historical global
// env vars before the code default (GTH-3 / GTH-6).
const OTP_DEFAULTS: OtpPolicy = {
  length: env.OTP_LENGTH ?? 6,
  expirySeconds: env.OTP_EXPIRY_SECONDS ?? 600,
  rateLimitSeconds: env.OTP_RATE_LIMIT_SECONDS ?? 60,
  maxAttempts: env.OTP_MAX_ATTEMPTS ?? 5,
};
// F.auth.01: a reset token unlocks a GLOBAL account, so the URL tenant's policy may only make it stronger than these bounds,
// never weaker: at least 6 digits (and at most 12), alive at least a minute and at most 24 hours.
export const RESET_TOKEN_MIN_LENGTH = 6;
export const RESET_TOKEN_MAX_LENGTH = 12;
export const RESET_TOKEN_MIN_EXPIRY_SECONDS = 60;
export const RESET_TOKEN_MAX_EXPIRY_SECONDS = 24 * 3600;
const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const RESET_DEFAULTS: ResetPolicy = {
  tokenExpirySeconds: clampInt(env.RESET_TOKEN_EXPIRY_SECONDS ?? 3600, RESET_TOKEN_MIN_EXPIRY_SECONDS, RESET_TOKEN_MAX_EXPIRY_SECONDS),
  tokenLength: clampInt(env.RESET_TOKEN_LENGTH ?? 6, RESET_TOKEN_MIN_LENGTH, RESET_TOKEN_MAX_LENGTH),
};
const EMAIL_VERIFY_DEFAULTS: EmailVerifyPolicy = {
  ttlSeconds: env.EMAIL_VERIFY_TTL_SECONDS ?? 60 * 60 * 24,
  rateLimitSeconds: env.EMAIL_VERIFY_RATE_LIMIT_SECONDS ?? 300,
};
const CREDENTIAL_DEFAULTS: CredentialPolicy = { bcryptCost: 10 };

/** Parse a comma/JSON-array list of strings; tolerant of both `["a","b"]` and `a, b`. */
function parseList(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean);
    } catch { /* fall through to CSV parsing */ }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  return raw === 'true' || raw === '1';
}

function parseInt32(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function resolve(key: string, systemMap: Record<string, string>, tenantMap: Record<string, string>): string | undefined {
  const sys = systemMap[key];
  if (sys !== undefined && sys !== '') return sys;
  const ten = tenantMap[key];
  if (ten !== undefined && ten !== '') return ten;
  return undefined;
}

/**
 * F.auth.04: a threshold where 0 (or less) means "off" (lockout attempts, captcha trigger) protects a GLOBAL account, so the URL
 * tenant — which an attacker can own — may only make it stricter than the platform's: the lower positive value wins, and "off" is
 * honoured only when both layers say off. The platform layer is its ROOT setting, else the code default.
 */
function stricterThreshold(key: string, system: Record<string, string>, tenant: Record<string, string>, fallback: number): number {
  const platform = parseInt32(system[key]) ?? fallback;
  const own = parseInt32(tenant[key]);
  if (own === undefined || own <= 0) return platform;
  return platform > 0 ? Math.min(platform, own) : own;
}

/**
 * MS-38: the one provider allowlist is `ssoAllowedProviders`. user_social_account used to read a second, undeclared one,
 * `socialEnabledProviders` (no page, no owner). A row of it that a tenant (or ROOT) still holds is folded in, read only:
 * the effective list is the STRICTER of the two, i.e. their intersection when both are set, either one when only it is
 * set. Two non-empty lists that share no provider allow nothing (`noneAllowed`, which turns `disableSocialLogin` on),
 * never "empty = all". Nothing writes the legacy key; the operator moves its value into `ssoAllowedProviders` and deletes
 * the row (a warning names the tenant, once per process).
 */
export const LEGACY_SOCIAL_ALLOWLIST_KEY = 'socialEnabledProviders';
const warnedLegacyAllowlist = new Set<string>();

export function foldLegacySocialAllowlist(
  primary: string[], legacy: string[], tenantId?: string,
): { allowed: string[]; noneAllowed: boolean } {
  if (legacy.length === 0) return { allowed: primary, noneAllowed: false };
  const who = tenantId ?? ROOT_TENANT_ID;
  if (!warnedLegacyAllowlist.has(who)) {
    warnedLegacyAllowlist.add(who);
    Logger.warn(`AuthPolicy: tenant ${who} still holds the retired setting ${LEGACY_SOCIAL_ALLOWLIST_KEY}; it is applied together with ssoAllowedProviders (the stricter wins). Move its providers into ssoAllowedProviders and delete the ${LEGACY_SOCIAL_ALLOWLIST_KEY} row.`);
  }
  const norm = (l: string[]) => [...new Set(l.map((p) => p.toLowerCase()))];
  if (primary.length === 0) return { allowed: norm(legacy), noneAllowed: false };
  const legacySet = new Set(norm(legacy));
  const both = norm(primary).filter((p) => legacySet.has(p));
  return { allowed: both, noneAllowed: both.length === 0 };
}

async function loadSettings(
  keys: readonly string[], tenantId?: string,
): Promise<{ system: Record<string, string>; tenant: Record<string, string> }> {
  const system = await SettingService.getByKeys(ROOT_TENANT_ID, [...keys]).catch((err: unknown) => {
    Logger.warn(`AuthPolicy: failed to load platform settings: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  });
  let tenant: Record<string, string> = {};
  if (tenantId) {
    tenant = await SettingService.getByKeys(tenantId, [...keys]).catch((err: unknown) => {
      Logger.warn(`AuthPolicy: failed to load tenant settings (${tenantId}): ${err instanceof Error ? err.message : String(err)}`);
      return {};
    });
  }
  return { system, tenant };
}

export default class AuthPolicyLoaderService {

  static async getPasswordPolicy(tenantId?: string): Promise<PasswordPolicy> {
    const { system, tenant } = await loadSettings(PASSWORD_POLICY_KEYS, tenantId);
    return {
      minLength: parseInt32(resolve('passwordMinLength', system, tenant)) ?? PASSWORD_DEFAULTS.minLength,
      requireUppercase: parseBool(resolve('passwordRequireUppercase', system, tenant)) ?? PASSWORD_DEFAULTS.requireUppercase,
      requireLowercase: parseBool(resolve('passwordRequireLowercase', system, tenant)) ?? PASSWORD_DEFAULTS.requireLowercase,
      requireDigit: parseBool(resolve('passwordRequireDigit', system, tenant)) ?? PASSWORD_DEFAULTS.requireDigit,
      requireSpecial: parseBool(resolve('passwordRequireSpecial', system, tenant)) ?? PASSWORD_DEFAULTS.requireSpecial,
      historyCount: parseInt32(resolve('passwordHistoryCount', system, tenant)) ?? PASSWORD_DEFAULTS.historyCount,
      maxAgeDays: parseInt32(resolve('passwordMaxAgeDays', system, tenant)) ?? PASSWORD_DEFAULTS.maxAgeDays,
      minAgeDays: parseInt32(resolve('passwordMinAgeDays', system, tenant)) ?? PASSWORD_DEFAULTS.minAgeDays,
      breachCheck: parseBool(resolve('passwordBreachCheck', system, tenant)) ?? PASSWORD_DEFAULTS.breachCheck,
    };
  }

  static async getLockoutPolicy(tenantId?: string): Promise<LockoutPolicy> {
    const { system, tenant } = await loadSettings(LOCKOUT_POLICY_KEYS, tenantId);
    // F.auth.04: the URL tenant can only tighten the lockout of a global account (fewer attempts, a longer lock).
    const platformDuration = parseInt32(system.lockoutDurationMinutes) ?? LOCKOUT_DEFAULTS.lockDurationMinutes;
    const ownDuration = parseInt32(tenant.lockoutDurationMinutes);
    return {
      maxAttempts: stricterThreshold('lockoutMaxAttempts', system, tenant, LOCKOUT_DEFAULTS.maxAttempts),
      lockDurationMinutes: ownDuration === undefined ? platformDuration : Math.max(platformDuration, ownDuration),
    };
  }

  static async getSessionPolicy(tenantId?: string): Promise<SessionPolicy> {
    const { system, tenant } = await loadSettings(SESSION_POLICY_KEYS, tenantId);
    return {
      absoluteMaxHours: parseInt32(resolve('sessionAbsoluteMaxHours', system, tenant)) ?? SESSION_DEFAULTS.absoluteMaxHours,
      idleTimeoutMinutes: parseInt32(resolve('sessionIdleTimeoutMinutes', system, tenant)) ?? SESSION_DEFAULTS.idleTimeoutMinutes,
      rememberMeMaxHours: parseInt32(resolve('sessionRememberMeMaxHours', system, tenant)) ?? SESSION_DEFAULTS.rememberMeMaxHours,
    };
  }

  static async getDormantPolicy(tenantId?: string): Promise<DormantPolicy> {
    const { system, tenant } = await loadSettings(DORMANT_POLICY_KEYS, tenantId);
    return {
      days: parseInt32(resolve('dormantAccountDays', system, tenant)) ?? DORMANT_DEFAULTS.days,
      autoDisable: parseBool(resolve('dormantAccountAutoDisable', system, tenant)) ?? DORMANT_DEFAULTS.autoDisable,
      deleteAfterDays: parseInt32(resolve('dormantDeleteAfterDays', system, tenant)) ?? DORMANT_DEFAULTS.deleteAfterDays,
    };
  }

  /**
   * `strict` (the admin gate, auth.24): a settings outage throws instead of answering the defaults, because the default
   * allowlist is empty and empty means "unrestricted"; the caller refuses.
   */
  static async getAdminPolicy(tenantId?: string, opts: { strict?: boolean } = {}): Promise<AdminPolicy> {
    const { system, tenant } = opts.strict
      ? {
          system: await SettingService.getByKeys(ROOT_TENANT_ID, [...ADMIN_POLICY_KEYS]),
          tenant: tenantId ? await SettingService.getByKeys(tenantId, [...ADMIN_POLICY_KEYS]) : {},
        }
      : await loadSettings(ADMIN_POLICY_KEYS, tenantId);
    const raw = resolve('adminPanelIpAllowlist', system, tenant) ?? '';
    const ipAllowlist = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    return { ipAllowlist, requireMfa: parseBool(resolve('adminRequireMfa', system, tenant)) ?? ADMIN_DEFAULTS.requireMfa };
  }

  static async getAccessPolicy(tenantId?: string): Promise<AccessPolicy> {
    const { system, tenant } = await loadSettings([...ACCESS_POLICY_KEYS, LEGACY_SOCIAL_ALLOWLIST_KEY], tenantId);
    const sso = foldLegacySocialAllowlist(
      parseList(resolve('ssoAllowedProviders', system, tenant)),
      parseList(resolve(LEGACY_SOCIAL_ALLOWLIST_KEY, system, tenant)),
      tenantId,
    );
    const allowedMethods = parseList(resolve('mfaAllowedMethods', system, tenant))
      .map((m) => m.toUpperCase())
      .filter((m): m is MfaMethod => (ALL_MFA_METHODS as string[]).includes(m));
    return {
      externalRequireMfa: parseBool(resolve('externalRequireMfa', system, tenant)) ?? ACCESS_DEFAULTS.externalRequireMfa,
      // MS-38: also on when the two allowlists of a tenant that set both share no provider (nothing is allowed then).
      disableSocialLogin: (parseBool(resolve('disableSocialLogin', system, tenant)) ?? ACCESS_DEFAULTS.disableSocialLogin) || sso.noneAllowed,
      // F.auth.04: the URL tenant can lower the captcha trigger, never raise it or switch it off.
      captchaTriggerAttempts: stricterThreshold('captchaTriggerAttempts', system, tenant, ACCESS_DEFAULTS.captchaTriggerAttempts),
      singleSessionOnly: parseBool(resolve('singleSessionOnly', system, tenant)) ?? ACCESS_DEFAULTS.singleSessionOnly,
      allowRegistration: parseBool(resolve('allowRegistration', system, tenant)) ?? ACCESS_DEFAULTS.allowRegistration,
      emailVerificationRequired: parseBool(resolve('emailVerificationRequired', system, tenant)) ?? ACCESS_DEFAULTS.emailVerificationRequired,
      ssoAllowedProviders: sso.allowed,
      mfaAllowedMethods: allowedMethods,
    };
  }

  static async getOtpPolicy(tenantId?: string): Promise<OtpPolicy> {
    const { system, tenant } = await loadSettings(OTP_POLICY_KEYS, tenantId);
    return {
      length: parseInt32(resolve('otpLength', system, tenant)) ?? OTP_DEFAULTS.length,
      expirySeconds: parseInt32(resolve('otpExpirySeconds', system, tenant)) ?? OTP_DEFAULTS.expirySeconds,
      rateLimitSeconds: parseInt32(resolve('otpRateLimitSeconds', system, tenant)) ?? OTP_DEFAULTS.rateLimitSeconds,
      maxAttempts: parseInt32(resolve('otpMaxAttempts', system, tenant)) ?? OTP_DEFAULTS.maxAttempts,
    };
  }

  static async getResetPolicy(tenantId?: string): Promise<ResetPolicy> {
    const { system, tenant } = await loadSettings(RESET_POLICY_KEYS, tenantId);
    return {
      tokenExpirySeconds: clampInt(parseInt32(resolve('resetTokenExpirySeconds', system, tenant)) ?? RESET_DEFAULTS.tokenExpirySeconds,
        RESET_TOKEN_MIN_EXPIRY_SECONDS, RESET_TOKEN_MAX_EXPIRY_SECONDS),
      tokenLength: clampInt(parseInt32(resolve('resetTokenLength', system, tenant)) ?? RESET_DEFAULTS.tokenLength,
        RESET_TOKEN_MIN_LENGTH, RESET_TOKEN_MAX_LENGTH),
    };
  }

  static async getEmailVerifyPolicy(tenantId?: string): Promise<EmailVerifyPolicy> {
    const { system, tenant } = await loadSettings(EMAIL_VERIFY_POLICY_KEYS, tenantId);
    return {
      ttlSeconds: parseInt32(resolve('emailVerifyTtlSeconds', system, tenant)) ?? EMAIL_VERIFY_DEFAULTS.ttlSeconds,
      rateLimitSeconds: parseInt32(resolve('emailVerifyRateLimitSeconds', system, tenant)) ?? EMAIL_VERIFY_DEFAULTS.rateLimitSeconds,
    };
  }

  static async getCredentialPolicy(tenantId?: string): Promise<CredentialPolicy> {
    const { system, tenant } = await loadSettings(CREDENTIAL_POLICY_KEYS, tenantId);
    // bcrypt cost must stay within a sane range (4..15). Out-of-range values fall
    // back to the default rather than crashing bcrypt or making login unusable.
    const raw = parseInt32(resolve('bcryptCost', system, tenant));
    const cost = raw !== undefined && raw >= 4 && raw <= 15 ? raw : CREDENTIAL_DEFAULTS.bcryptCost;
    return { bcryptCost: cost };
  }
}
