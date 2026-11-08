import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from './tenant_setting.service';

/**
 * MS-39 (2026-10-27): the guarded switch of tenant_session's `twoFactorRequired`. From the moment it is 'true', every
 * member's request must come on a session that proved a second factor (tenant_session.policy.ts assert2faSatisfied), so a
 * writer who turns it on from a session without one would lock themselves (and, with nobody enrolled, the workspace) out.
 * A write that turns it on is refused (409 CONFLICT, `details.key`) unless the writer's own session proved a second factor.
 *
 * "Proved" is read exactly as the enforcement reads it: the session's `amr` (RFC 8176, `user_sessions.metadata.amr`)
 * carries `mfa` (an OTP / TOTP verified on the session) or `hwk` (a passkey sign-in). Enrolment alone never counts. The
 * check is inlined (user_session's `amrHasSecondFactor`) because user_session requires tenant_setting.
 *
 * Every writer is checked, a platform admin too: fail closed. Switching it off, or saving it back unchanged, is not
 * refused here (the key is OWNER-only, tenant_setting.key-policy.ts). Refuses before anything is written or queued.
 */
export const TWO_FACTOR_REQUIRED_KEY = 'twoFactorRequired';

const SECOND_FACTOR_AMR = new Set(['mfa', 'hwk']);

/** The authenticated writer's session as the route's authorizeRequest answered it (only its `amr` is read). */
export type TwoFactorWriter = { userSession?: { metadata?: { amr?: readonly unknown[] | null } | null } | null };

/** Did this session prove a second factor? (`amr` holds `mfa` or `hwk`.) */
export function sessionProvedSecondFactor(writer: TwoFactorWriter | null | undefined): boolean {
  const amr = writer?.userSession?.metadata?.amr;
  return Array.isArray(amr) && amr.some((v) => typeof v === 'string' && SECOND_FACTOR_AMR.has(v));
}

export async function assertTwoFactorWriteKeepsWriter(
  tenantId: string,
  settings: Record<string, unknown>,
  writer: TwoFactorWriter | null | undefined,
): Promise<void> {
  if (!(TWO_FACTOR_REQUIRED_KEY in settings) || settings[TWO_FACTOR_REQUIRED_KEY] !== 'true') return;
  let current: string | null = null;
  try {
    current = await SettingService.getValue(tenantId, TWO_FACTOR_REQUIRED_KEY);
  } catch {
    current = null; // unreadable: treated as off, so the writer must prove a second factor (fail closed)
  }
  if (current === 'true') return; // already on: nothing is switched
  if (sessionProvedSecondFactor(writer)) return;
  throw new AppError(
    'Two-step verification can only be required from a session that completed it: set up a second factor (an authenticator app or a passkey), sign in with it, then switch this on.',
    409,
    ErrorCode.CONFLICT,
    { details: { key: TWO_FACTOR_REQUIRED_KEY, reason: 'TWO_FACTOR_NOT_PROVED' } },
  );
}
