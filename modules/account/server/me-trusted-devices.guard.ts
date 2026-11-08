import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * The trusted devices are the account owner's to change: an impersonation or break-glass session (somebody else at the keyboard)
 * is refused 403, as "sign out all other sessions" refuses it (me-sessions.route.ts).
 */
export function assertOwnerAtKeyboard(userSession: { metadata?: unknown } | null | undefined): void {
  const meta = userSession?.metadata as { impersonation?: unknown; breakGlass?: unknown } | null | undefined;
  if (meta?.impersonation || meta?.breakGlass) {
    throw new AppError('An impersonation session cannot change the trusted devices of the account.', 403, ErrorCode.FORBIDDEN);
  }
}
