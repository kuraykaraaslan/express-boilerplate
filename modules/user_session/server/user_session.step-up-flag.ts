import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import UserSessionMessages from './user_session.messages';
import type { SessionMeta } from './user_session.types';

/**
 * Phase 55 00.6 (P-6): a step-up forced on a live session (`SessionMeta.stepUpRequired`, set by an administrator or the firewall
 * through `user_session.admin.service`). Kept in a file of its own, with no service imports, because the request guard
 * (`authenticateUserByRequest`) reads it on every request.
 *
 * The refusal has the shape of `requireStepUp`'s (auth/server/auth.step-up.ts): 401 with `details.stepUp = { purpose,
 * windowSeconds }`, so the client's step-up dialog (auth/ui/step-up.client.ts `stepUpRequested`) asks for a factor with the
 * purpose below. A step-up that succeeds on the session clears the flag, whatever its purpose (auth.step-up.service
 * `finishStepUp`): it proved the factor on this session within the window.
 */

/** The purpose a client asks a challenge for; it is also the permission of the step-up routes (`auth.session.step_up`). */
export const SESSION_STEP_UP_PURPOSE = 'auth.session.step_up';

/** Same as auth's STEP_UP_WINDOW_SECONDS (a test pins the two together); repeated so this file imports nothing of auth. */
export const SESSION_STEP_UP_WINDOW_SECONDS = 300;

export function sessionStepUpRequired(): AppError {
  return new AppError(UserSessionMessages.SESSION_STEP_UP_REQUIRED, 401, ErrorCode.UNAUTHORIZED, {
    details: { stepUp: { purpose: SESSION_STEP_UP_PURPOSE, windowSeconds: SESSION_STEP_UP_WINDOW_SECONDS } },
  });
}

/** True when the session carries a forced step-up. */
export function sessionNeedsStepUp(session: { metadata?: unknown } | null | undefined): boolean {
  return Boolean((session?.metadata as SessionMeta | null | undefined)?.stepUpRequired);
}
