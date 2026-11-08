import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuthMessages from './auth.messages';

/**
 * Request-bound step-up (P9-19, docs/phases/02-fleet/04-security-model.md §1.3).
 *
 * A route that must not run on a session alone (a release publish, a key registration, a trust bundle publish) calls
 * `requireStepUp` after its own authorization. The caller proves a second factor shortly before the request:
 *
 *   1. `beginStepUp` (POST /api/auth/step-up/options) — a single-use challenge bound to this user, this session, this tenant and
 *      the purpose (the route's permission, optionally one target such as a release id). WebAuthn is offered first when a passkey
 *      method is contributed and the user has a passkey (`auth:step_up_method`, key `webauthn`), TOTP as the fallback when the user
 *      enrolled an authenticator app. A user with neither cannot step up: refused, never waved through.
 *   2. `completeStepUp` (POST /api/auth/step-up/verify) — one attempt per challenge (the challenge is taken before it is checked),
 *      a user-verified WebAuthn assertion or a TOTP code that was not used before, on any flow. Challenges are free, so the guess
 *      limit is not the challenge: `TOTPService.checkCode` keeps the spent-code ledger shared by every TOTP flow (login, step-up,
 *      impersonation, disable) and a per-user failure counter in Redis that refuses every code (429) after five wrong ones in
 *      15 minutes, whatever the number of IPs or challenges. It answers an opaque grant token.
 *   3. `requireStepUp` — the protected request carries the token in `x-step-up-token`. The grant is taken (single use), so it
 *      authorises exactly one request, of the same user, session, tenant and purpose, within the window.
 *
 * The window is five minutes (`STEP_UP_WINDOW_SECONDS`) for the challenge and again from the moment of verification for the
 * grant. Backup codes are not a step-up factor (they are for losing the device, not for confirming an action), and an
 * impersonation session never steps up: the person at the keyboard is not the account owner. Redis that cannot answer is a 503,
 * never a pass. The pattern is lifted from `auth_impersonation`'s `enforceStepUp`, which takes a credential inline.
 */

export const STEP_UP_WINDOW_SECONDS = 300;
export const STEP_UP_HEADER = 'x-step-up-token';

/** Extension point id — declared in auth/module.json `extensionPoints`. */
export const AUTH_STEP_UP_METHOD_POINT = 'auth:step_up_method';

export type StepUpMethodId = 'webauthn' | 'totp';

/**
 * Default export of an `auth:step_up_method` contribution (auth_passkey contributes `webauthn`). `begin` answers the options the
 * client hands its authenticator and an opaque `state` (the challenge) that auth stores with its own single-use challenge;
 * `verify` answers true only for an assertion by a credential of `userId`, made with user verification, over that state.
 */
export interface StepUpMethod {
  available(input: { userId: string }): Promise<boolean>;
  begin(input: { userId: string }): Promise<{ options: Record<string, unknown>; state: string }>;
  verify(input: { userId: string; state: string; response: unknown }): Promise<boolean>;
}

/** The authenticated caller, as `authorizeRequest` answers it. */
export interface StepUpSubject {
  user: { userId: string };
  /** `metadata.impersonation` marks a session minted by `auth_impersonation`: such a session never steps up. */
  userSession: { userSessionId: string; metadata?: { impersonation?: unknown } | null };
  isImpersonating?: boolean;
}

/** What a grant is good for: the tenant of the route, its purpose (the permission) and, when the route names one, its target. */
export interface StepUpBinding {
  tenantId: string;
  purpose: string;
  target?: string;
}

/** A key-value store with an atomic take: Redis in production, a map in tests. */
export interface StepUpStore {
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Reads and deletes in one step; null when absent. */
  take(key: string): Promise<string | null>;
}

export interface StepUpDeps {
  store: StepUpStore;
  /** The contributed WebAuthn method active for this tenant, or null (not installed, switched off or failing). */
  webauthn(tenantId: string): Promise<StepUpMethod | null>;
  totp: {
    available(userId: string): Promise<boolean>;
    /**
     * Throws on a wrong code and on a code already used on any flow (401), on a locked factor (429, an `AppError`) and when the
     * ledger cannot answer (5xx, an `AppError`). Production: `TOTPService.verifyAuthenticate`, which owns the ledger and the counter.
     */
    verify(userId: string, code: string): Promise<void>;
    /** The configured code length (`OTP_LENGTH`, default 6): the dialog sizes its input by it. */
    digits: number;
  };
  now?: () => number;
}

export const StepUpPurposeSchema = z.string().regex(/^[a-z0-9_.:-]{1,128}$/);
export const StepUpTargetSchema = z.string().min(1).max(200);

export const BeginStepUpSchema = z.object({
  purpose: StepUpPurposeSchema,
  target: StepUpTargetSchema.optional(),
}).strict();

export const CompleteStepUpSchema = z.discriminatedUnion('method', [
  z.object({ challengeId: z.uuid(), method: z.literal('webauthn'), response: z.object({ id: z.string().min(1).max(1024) }).passthrough() }).strict(),
  // The length is a deployment setting (OTP_LENGTH); otplib refuses a code of the wrong length, so the schema only bounds the input.
  z.object({ challengeId: z.uuid(), method: z.literal('totp'), code: z.string().regex(/^\d{4,10}$/) }).strict(),
]);
export type CompleteStepUpInput = z.infer<typeof CompleteStepUpSchema>;

const ChallengeRecordSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  tenantId: z.string(),
  purpose: z.string(),
  target: z.string().nullable(),
  methods: z.array(z.enum(['webauthn', 'totp'])),
  webauthnState: z.string().nullable(),
});

const GrantRecordSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  tenantId: z.string(),
  purpose: z.string(),
  target: z.string().nullable(),
  method: z.enum(['webauthn', 'totp']),
  verifiedAt: z.number(),
});

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const challengeKey = (id: string) => `auth:step-up:challenge:${id}`;
const grantKey = (token: string) => `auth:step-up:grant:${createHash('sha256').update(token).digest('hex')}`;

function refuse(message: AuthMessages, status: number, code: ErrorCode, binding?: { purpose: string; target?: string | null }): AppError {
  return new AppError(message, status, code, binding ? { details: { stepUp: { purpose: binding.purpose, ...(binding.target ? { target: binding.target } : {}), windowSeconds: STEP_UP_WINDOW_SECONDS } } } : undefined);
}

/** Refuses an impersonation session (403): the person at the keyboard is not the account owner. */
export function assertNotImpersonating(subject: StepUpSubject): void {
  if (subject.isImpersonating || subject.userSession?.metadata?.impersonation) throw refuse(AuthMessages.STEP_UP_NOT_FOR_IMPERSONATION, 403, ErrorCode.FORBIDDEN);
}

/** Store calls fail closed: an unanswered Redis is a 503 the client may retry, never a missing (or present) record. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new AppError(AuthMessages.STEP_UP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
}

function parseRecord<T>(schema: z.ZodType<T>, raw: string | null): T | null {
  if (!raw) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Issues the single-use challenge for one purpose. WebAuthn first, TOTP as the fallback; a user with neither is refused. */
export async function beginStepUp(deps: StepUpDeps, subject: StepUpSubject, binding: StepUpBinding) {
  assertNotImpersonating(subject);
  const now = (deps.now ?? Date.now)();
  const { userId } = subject.user;
  const webauthn = await deps.webauthn(binding.tenantId);
  let webauthnOptions: Record<string, unknown> | null = null;
  let webauthnState: string | null = null;
  if (webauthn && (await webauthn.available({ userId }))) {
    const begun = await webauthn.begin({ userId });
    webauthnOptions = begun.options;
    webauthnState = begun.state;
  }
  const totp = await deps.totp.available(userId);
  const methods: StepUpMethodId[] = [...(webauthnState ? ['webauthn' as const] : []), ...(totp ? ['totp' as const] : [])];
  if (!methods.length) throw refuse(AuthMessages.STEP_UP_METHOD_UNAVAILABLE, 403, ErrorCode.FORBIDDEN);

  const challengeId = randomUUID();
  const record: z.infer<typeof ChallengeRecordSchema> = {
    userId, sessionId: subject.userSession.userSessionId, tenantId: binding.tenantId, purpose: binding.purpose, target: binding.target ?? null, methods, webauthnState,
  };
  await guarded(() => deps.store.put(challengeKey(challengeId), JSON.stringify(record), STEP_UP_WINDOW_SECONDS));
  return {
    challengeId,
    methods,
    ...(webauthnOptions ? { webauthn: webauthnOptions } : {}),
    ...(totp ? { totpDigits: deps.totp.digits } : {}),
    purpose: binding.purpose,
    ...(binding.target ? { target: binding.target } : {}),
    expiresAt: new Date(now + STEP_UP_WINDOW_SECONDS * 1000).toISOString(),
  };
}

/** Verifies the second factor against its challenge (one attempt) and answers a grant for exactly one request. */
export async function completeStepUp(deps: StepUpDeps, subject: StepUpSubject, tenantId: string, input: CompleteStepUpInput) {
  assertNotImpersonating(subject);
  const now = (deps.now ?? Date.now)();
  const { userId } = subject.user;
  // Taken before anything is checked: a wrong answer burns the challenge, so a code cannot be guessed against one.
  const challenge = parseRecord(ChallengeRecordSchema, await guarded(() => deps.store.take(challengeKey(input.challengeId))));
  if (!challenge) throw refuse(AuthMessages.STEP_UP_CHALLENGE_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
  if (challenge.userId !== userId || challenge.sessionId !== subject.userSession.userSessionId || challenge.tenantId !== tenantId) {
    throw refuse(AuthMessages.STEP_UP_INVALID, 401, ErrorCode.UNAUTHORIZED);
  }
  if (!challenge.methods.includes(input.method)) throw refuse(AuthMessages.STEP_UP_METHOD_UNAVAILABLE, 400, ErrorCode.VALIDATION_ERROR);

  if (input.method === 'webauthn') {
    const webauthn = await deps.webauthn(tenantId);
    // Offered at begin but gone now (switched off, failing): fail closed, the client may retry or use TOTP on a new challenge.
    if (!webauthn || !challenge.webauthnState) throw new AppError(AuthMessages.STEP_UP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
    let ok = false;
    try {
      ok = await webauthn.verify({ userId, state: challenge.webauthnState, response: input.response });
    } catch {
      ok = false;
    }
    if (!ok) throw refuse(AuthMessages.STEP_UP_FAILED, 401, ErrorCode.INVALID_CREDENTIALS);
  } else {
    try {
      // Spends the code on success (a code seen once, on any flow, never yields a second grant) and counts a failure.
      await deps.totp.verify(userId, input.code);
    } catch (e) {
      const statusCode = e instanceof AppError ? e.statusCode : 0;
      if (statusCode === 429) throw e;
      if (statusCode >= 500) throw new AppError(AuthMessages.STEP_UP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
      throw refuse(AuthMessages.STEP_UP_FAILED, 401, ErrorCode.INVALID_CREDENTIALS);
    }
  }

  const stepUpToken = randomBytes(32).toString('base64url');
  const grant: z.infer<typeof GrantRecordSchema> = {
    userId, sessionId: challenge.sessionId, tenantId, purpose: challenge.purpose, target: challenge.target, method: input.method, verifiedAt: now,
  };
  await guarded(() => deps.store.put(grantKey(stepUpToken), JSON.stringify(grant), STEP_UP_WINDOW_SECONDS));
  return {
    stepUpToken,
    method: input.method,
    purpose: challenge.purpose,
    ...(challenge.target ? { target: challenge.target } : {}),
    expiresAt: new Date(now + STEP_UP_WINDOW_SECONDS * 1000).toISOString(),
  };
}

/**
 * The guard. Call it after the route's own authorization (so a caller without the permission learns nothing and burns no grant)
 * and before the effect. It takes the grant in `x-step-up-token` — one request per grant, whatever that request's outcome — and
 * answers how and when the factor was proved, for the route's audit row. A 401 carries `details.stepUp` with the purpose (and
 * target) a client asks a new challenge for.
 */
export async function requireStepUp(
  deps: Pick<StepUpDeps, 'store' | 'now'>, request: { headers: Headers }, subject: StepUpSubject, binding: StepUpBinding,
): Promise<{ method: StepUpMethodId; verifiedAt: Date }> {
  assertNotImpersonating(subject);
  const token = request.headers.get(STEP_UP_HEADER)?.trim();
  if (!token) throw refuse(AuthMessages.STEP_UP_REQUIRED, 401, ErrorCode.UNAUTHORIZED, binding);
  if (!TOKEN_RE.test(token)) throw refuse(AuthMessages.STEP_UP_INVALID, 401, ErrorCode.UNAUTHORIZED, binding);
  const grant = parseRecord(GrantRecordSchema, await guarded(() => deps.store.take(grantKey(token))));
  const now = (deps.now ?? Date.now)();
  if (
    !grant
    || grant.userId !== subject.user.userId
    || grant.sessionId !== subject.userSession.userSessionId
    || grant.tenantId !== binding.tenantId
    || grant.purpose !== binding.purpose
    || grant.target !== (binding.target ?? null)
    // The store's TTL is the first bound; this is the second, so a grant never outlives the window even on a lenient store.
    || now - grant.verifiedAt > STEP_UP_WINDOW_SECONDS * 1000
    || grant.verifiedAt > now + 60_000
  ) {
    throw refuse(AuthMessages.STEP_UP_INVALID, 401, ErrorCode.UNAUTHORIZED, binding);
  }
  return { method: grant.method, verifiedAt: new Date(grant.verifiedAt) };
}

/**
 * The guard of a route that ADDS a sign-in factor (TOTP setup, passkey registration; auth_impersonation.02).
 *
 * An impersonation session is refused outright (403): an impersonator must never plant a factor on the account it borrows.
 * A user who already holds a factor that can step up (an enrolled authenticator app, or a passkey when the passkey method is
 * active for the tenant) must prove it first (`requireStepUp`), so a stolen or SSO-only session cannot add a key next to the
 * owner's. A user with no factor at all cannot step up; enrolling the first one stays on the session (refusing it would make
 * the first factor impossible to add).
 */
export async function guardFactorEnrolment(
  deps: StepUpDeps, request: { headers: Headers }, subject: StepUpSubject, binding: StepUpBinding,
): Promise<void> {
  assertNotImpersonating(subject);
  const { userId } = subject.user;
  const webauthn = await deps.webauthn(binding.tenantId);
  const hasFactor = (await deps.totp.available(userId))
    || Boolean(webauthn && (await webauthn.available({ userId }).catch(() => false)));
  if (hasFactor) await requireStepUp(deps, request, subject, binding);
}
