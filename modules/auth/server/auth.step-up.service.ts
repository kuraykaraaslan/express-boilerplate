import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { authStepUpMethodLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/auth.step_up_method';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { sessionNeedsStepUp } from '@kuraykaraaslan-labs/user_session/server/user_session.step-up-flag';
import TOTPService from './auth.totp.service';
import type { SecondFactorAttempt } from './auth.second-factor-guard';
import AuthMessages from './auth.messages';
import {
  AUTH_STEP_UP_METHOD_POINT,
  beginStepUp,
  completeStepUp,
  guardFactorEnrolment,
  requireStepUp as requireStepUpWith,
  type CompleteStepUpInput,
  type StepUpBinding,
  type StepUpDeps,
  type StepUpMethod,
  type StepUpStore,
  type StepUpSubject,
} from './auth.step-up';

/** The step-up store on the shared Redis: every process of the deployment sees the same challenges and grants. */
export const redisStepUpStore: StepUpStore = {
  put: async (key, value, ttlSeconds) => {
    await redis.set(key, value, 'EX', ttlSeconds);
  },
  take: async (key) => redis.getdel(key),
};

/** The WebAuthn method contributed to `auth:step_up_method` (auth_passkey), when it is active for the tenant and loads. */
async function webauthnFor(tenantId: string): Promise<StepUpMethod | null> {
  try {
    const picked = await ext.select<StepUpMethod>(AUTH_STEP_UP_METHOD_POINT, tenantCtx(tenantId), authStepUpMethodLoaders, { key: 'webauthn' });
    return picked?.impl ?? null;
  } catch (error) {
    Logger.warn(`[auth.stepUp] webauthn method unavailable: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** The production wiring. `attempt` (phase 55 00.5): what the route knows of the request, handed to the TOTP check's second-factor guard. */
export function defaultStepUpDeps(attempt?: SecondFactorAttempt): StepUpDeps {
  return {
    store: redisStepUpStore,
    webauthn: webauthnFor,
    totp: {
      available: async (userId) => {
        const sec = await UserSecurityService.getByUserId(userId);
        return Boolean(sec?.otpSecret && (sec.otpMethods ?? []).includes('TOTP_APP' as never));
      },
      // The spent-code ledger and the failure counter live in TOTPService, shared with every other flow that takes a code.
      verify: async (userId, code) => {
        await TOTPService.verifyAuthenticate({ user: { userId } as SafeUser, otpToken: code, attempt: { flow: 'step_up', ...attempt } });
      },
      digits: TOTPService.TOTP_DIGITS,
    },
  };
}

/** `beginStepUp` on the production wiring. */
export const startStepUp = (subject: StepUpSubject, binding: StepUpBinding) => beginStepUp(defaultStepUpDeps(), subject, binding);

/**
 * `completeStepUp` on the production wiring. Phase 55 00.6: a step-up that succeeds on a session that was asked for one
 * (`SessionMeta.stepUpRequired`, set by an administrator or the firewall) lifts that request, whatever the grant's purpose: the
 * person proved a factor on this very session within the window. A lift that cannot be written fails the answer (5xx, retryable),
 * so the client never holds a grant while the session still refuses every request.
 */
export async function finishStepUp(subject: StepUpSubject, tenantId: string, input: CompleteStepUpInput, attempt?: SecondFactorAttempt) {
  // The code is typed in this session: its failures count on it, never on the account (auth.second-factor-guard.ts).
  const sessionAttempt: SecondFactorAttempt = { ...(attempt ?? { tenantId, flow: 'step_up' }), userSessionId: subject.userSession.userSessionId };
  const grant = await completeStepUp(defaultStepUpDeps(sessionAttempt), subject, tenantId, input);
  if (sessionNeedsStepUp(subject.userSession)) {
    try {
      const { clearSessionStepUp } = await import('@kuraykaraaslan-labs/user_session/server/user_session.admin.service');
      await clearSessionStepUp(subject.userSession.userSessionId, { actorId: subject.user.userId, cause: 'step_up' });
    } catch (error) {
      Logger.warn(`[auth.stepUp] the forced step-up could not be lifted: ${error instanceof Error ? error.message : error}`);
      throw new AppError(AuthMessages.STEP_UP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
    }
  }
  return grant;
}

/**
 * Phase 55 00.6: can this person step up at all (an authenticator app, or a passkey when the passkey method is active for the
 * tenant)? A session of a person who cannot is not asked for a forced step-up (it could only sign out); it is ended instead.
 */
export async function stepUpAvailableFor(userId: string, tenantId: string): Promise<boolean> {
  // D55-3: a lookup that fails is a refusal (503, retryable), never "no factor": a workspace write would otherwise skip the step-up of
  // a passkey-only administrator whenever the passkey method errors. Only "the method is not active for the tenant" (the select
  // answers nothing) and "this person has no passkey" (available() answers false) are false.
  try {
    if (await defaultStepUpDeps().totp.available(userId)) return true;
    const picked = await ext.select<StepUpMethod>(AUTH_STEP_UP_METHOD_POINT, tenantCtx(tenantId), authStepUpMethodLoaders, { key: 'webauthn' });
    const webauthn = picked?.impl ?? null;
    return Boolean(webauthn && (await webauthn.available({ userId })));
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.warn(`[auth.stepUp] factor lookup failed: ${error instanceof Error ? error.message : error}`);
    throw new AppError(AuthMessages.STEP_UP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
}

/**
 * The guard routes call: takes the request's step-up grant for this purpose (and target) or throws 401/403/503. See `auth.step-up`.
 */
export const requireStepUp = (request: { headers: Headers }, subject: StepUpSubject, binding: StepUpBinding) =>
  requireStepUpWith({ store: redisStepUpStore }, request, subject, binding);

/** `guardFactorEnrolment` on the production wiring: the guard of a route that adds a sign-in factor. See `auth.step-up`. */
export const requireFactorEnrolmentStepUp = (request: { headers: Headers }, subject: StepUpSubject, binding: StepUpBinding) =>
  guardFactorEnrolment(defaultStepUpDeps(), request, subject, binding);

