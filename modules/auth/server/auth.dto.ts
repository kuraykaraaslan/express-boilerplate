import { z } from 'zod';
import { OTPMethodEnum, OTPActionEnum } from '@kuraykaraaslan-labs/user_security/server/user_security.enums';

// ============================================================================
// Authentication DTOs
// ============================================================================

// auth.16: size caps on the unauthenticated credential inputs. An address over 254 characters (RFC 5321) never reaches
// the user lookup, the audit log or the captcha key, and a password is capped at 256 characters (bcrypt reads 72 bytes;
// a 1 MB password used to reach the hash and the lockout counter).
const Email = z.string().max(254).email();
const Password = z.string().max(256);
const Token = z.string().max(512);

export const LoginDTO = z.object({
  email: Email,
  password: Password.min(1),
  /** KD-19: required once the brute-force threshold is reached. */
  captchaToken: z.string().optional(),
  /** F10 §1: opt-in long-lived session (widened sliding window + absolute cap). */
  rememberMe: z.boolean().optional().default(false),
});

/**
 * Self-reported hardware for a device-bearer session (phone, tablet, watch,
 * TV, …) — a native app's `Authorization: Bearer` login has no browser
 * User-Agent string worth parsing, so it sends this instead. Stored into
 * `UserSession.metadata.device` (see user_session.types.ts SessionMetaSchema)
 * and shown in the account "Active sessions" panel.
 */
export const DeviceInfoDTO = z.object({
  type: z.enum(['phone', 'tablet', 'watch', 'tv', 'desktop', 'other']).optional(),
  brand: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  name: z.string().max(120).optional(),
  os: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
});

export const DeviceLoginDTO = LoginDTO.extend({
  device: DeviceInfoDTO.optional(),
});

export const RegisterDTO = z.object({
  email: Email,
  password: Password.min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  // GDPR Art. 7 / KVKK / LGPD: version string of the ToS/Privacy Policy the user agreed to.
  consentVersion: z.string().optional(),
  captchaToken: z.string().optional(),
});

export const LogoutDTO = z.object({
  accessToken: Token.max(8192)
});

export const VerifyEmailDTO = z.object({
  token: Token
});

// ============================================================================
// Password DTOs
// ============================================================================

export const ForgotPasswordDTO = z.object({
  email: Email
});

/** Passwordless login (backlog F10 §1). */
export const MagicLinkRequestDTO = z.object({
  email: Email
});

export const MagicLinkConsumeDTO = z.object({
  token: z.string().min(16).max(512)
});

export const ResetPasswordDTO = z.object({
  email: Email,
  resetToken: Token,
  newPassword: Password.min(8, "Password must be at least 8 characters")
});

export const ValidateResetTokenDTO = z.object({
  email: Email,
  resetToken: Token
});

export const InvalidateResetTokenDTO = z.object({
  email: Email
});

export const ChangePasswordDTO = z.object({
  currentPassword: Password,
  newPassword: Password.min(8, "Password must be at least 8 characters")
});

// ============================================================================
// OTP DTOs
// ============================================================================

export const RequestOTPDTO = z.object({
  method: OTPMethodEnum,
  action: OTPActionEnum
});

export const VerifyOTPDTO = z.object({
  method: OTPMethodEnum,
  action: OTPActionEnum,
  otpToken: z.string().min(4).max(64),
  /** 38-security 3.4: after a successful sign-in code, remember this browser for 30 days (skips the risk step-up only). */
  trustDevice: z.boolean().optional(),
});

// ============================================================================
// TOTP DTOs
// ============================================================================

export const TOTPSetupDTO = z.object({
  // No additional fields needed - user/session from context
});

export const TOTPEnableDTO = z.object({
  otpToken: z.string().min(6).max(6)
});

export const TOTPVerifyDTO = z.object({
  otpToken: z.string().min(6).max(8) // 6 for TOTP, 8 for backup codes
});

export const TOTPDisableDTO = z.object({
  otpToken: z.string().min(6).max(6)
});

export const TOTPBackupCodesDTO = z.object({
  count: z.number().int().min(1).max(20).nullable().default(4)
});

export const TOTPConsumeBackupCodeDTO = z.object({
  code: z.string()
});

// ============================================================================
// Session DTOs
// ============================================================================

export const RefreshTokenDTO = z.object({
  refreshToken: z.string()
});

// ============================================================================
// Type Exports
// ============================================================================

export type LoginInput = z.infer<typeof LoginDTO>;
export type RegisterInput = z.infer<typeof RegisterDTO>;
export type LogoutInput = z.infer<typeof LogoutDTO>;
export type VerifyEmailInput = z.infer<typeof VerifyEmailDTO>;

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDTO>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordDTO>;
export type ValidateResetTokenInput = z.infer<typeof ValidateResetTokenDTO>;
export type InvalidateResetTokenInput = z.infer<typeof InvalidateResetTokenDTO>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordDTO>;

export type RequestOTPInput = z.infer<typeof RequestOTPDTO>;
export type VerifyOTPInput = z.infer<typeof VerifyOTPDTO>;

export type TOTPSetupInput = z.infer<typeof TOTPSetupDTO>;
export type TOTPEnableInput = z.infer<typeof TOTPEnableDTO>;
export type TOTPVerifyInput = z.infer<typeof TOTPVerifyDTO>;
export type TOTPDisableInput = z.infer<typeof TOTPDisableDTO>;
export type TOTPBackupCodesInput = z.infer<typeof TOTPBackupCodesDTO>;
export type TOTPConsumeBackupCodeInput = z.infer<typeof TOTPConsumeBackupCodeDTO>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenDTO>;
