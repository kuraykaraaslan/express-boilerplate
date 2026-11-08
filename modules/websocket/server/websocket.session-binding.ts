import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * What a ticket-minting route copies from the caller's session into the ticket payload, so the
 * gateway can end the socket when the session does (docs/phases/13-websocket/04 §4.2, §4.5).
 * Pure and socket.io-free: safe to import from the Next HTTP process.
 *
 * - `userSessionId` lets a revoked session drop only its own sockets.
 * - `sessionExpiresAt` (epoch ms) lets the gateway close a socket whose session merely expires, which
 *   nothing announces (`armSessionExpiry`, `websocket.session-expiry.ts`).
 *
 * Both fields are omitted when the guard reports no session (or no usable expiry), never `undefined`
 * or `null`, so the payload stays exactly what it was before.
 */
export interface WsSessionBinding {
  userSessionId?: string;
  sessionExpiresAt?: number;
}

export function wsSessionBinding(
  session: { userSessionId?: string | null; sessionExpiry?: Date | string | number | null } | null | undefined,
): WsSessionBinding {
  if (!session) return {};
  const out: WsSessionBinding = {};
  if (session.userSessionId) out.userSessionId = session.userSessionId;
  if (session.sessionExpiry != null) {
    const at = new Date(session.sessionExpiry).getTime();
    // An expiry that is there but unreadable is not "no expiry": it would give an immortal socket (risk register
    // websocket.02). It binds as already past, so the gateway closes the socket at once and `wsTicketSubject` refuses
    // to mint for it.
    out.sessionExpiresAt = Number.isFinite(at) ? at : 0;
  }
  return out;
}

/** What every ticket payload takes from the caller: the user, plus the session binding above, never optional here. */
export interface WsTicketSubject extends WsSessionBinding {
  userId: string;
  userSessionId: string;
  /** The Origin of the minting request, when the browser sent one: the only site the ticket's socket may open from (websocket.04). */
  origin?: string;
}

/** The parts of a guard result (`authorizeRequest`) this check reads; structural so `websocket` needs no auth import. */
export interface WsTicketCaller {
  user?: { userId?: string | null } | null;
  /** The minting request's `Origin` header (`request.headers.get('origin')`); absent for a native client. */
  origin?: string | null;
  userSession?: {
    userSessionId?: string | null;
    userId?: string | null;
    sessionStatus?: string | null;
    otpVerifyNeeded?: boolean | null;
    /** auth.05: the account must change its password before it may do anything else. */
    passwordChangeRequired?: boolean | null;
    sessionExpiry?: Date | string | number | null;
    /** The API key lane's stand-in session names its key here (`{ apiKeyId }`); a person's session never does. */
    metadata?: unknown;
  } | null;
  /** Set by the guard when an API key made the request (docs/phases/48-api-key-scopes D48-4). */
  apiKey?: unknown;
}

/** Is this guard result an API key's (the key lane's answer, or its stand-in session passed on its own)? */
function isApiKeyCaller(caller: WsTicketCaller | null | undefined): boolean {
  if (caller?.apiKey) return true;
  const meta = caller?.userSession?.metadata;
  return typeof meta === 'object' && meta !== null && 'apiKeyId' in meta && (meta as { apiKeyId?: unknown }).apiKeyId != null;
}

/**
 * Only a full user session gets a socket ticket (docs/phases/13-websocket/04 §4.8). Every ticket mint route calls this on
 * its guard result and builds the payload from the answer; it throws instead of returning a partial subject:
 *
 * - no user → 401: the ticket would name nobody, and the handshake refuses such a ticket anyway (`consume`).
 * - no user session → 403: an API key, an IoT device credential or any other caller that is not a signed-in person.
 *   A native app's device-login bearer IS a user session and passes.
 * - the session belongs to another user → 401.
 * - the session still waits for its OTP → 401 `OTP_REQUIRED`: it has not finished signing in. A later pending state
 *   (a step-up) belongs here too, so every namespace refuses it at once.
 * - the session must change its password → 403 `PASSWORD_CHANGE_REQUIRED` (auth.05), as every other route answers.
 * - the session is not `ACTIVE`, or has no usable expiry or is past it → 401 `SESSION_EXPIRED`.
 *
 * The guard already refuses most of these today; this is the second check at the one door to a socket, so a guard
 * change (an OTP bypass, an API-key path) cannot open sockets by accident.
 */
export function wsTicketSubject(caller: WsTicketCaller | null | undefined, now: number = Date.now()): WsTicketSubject {
  const userId = caller?.user?.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('A socket ticket needs a signed-in user', 401, ErrorCode.UNAUTHORIZED);
  }
  const session = caller?.userSession;
  const userSessionId = session?.userSessionId;
  // Phase 48: the key lane hands routes a stand-in session for one request (its id is the key's). It is no signed-in person.
  if (!session || isApiKeyCaller(caller) || typeof userSessionId !== 'string' || userSessionId.length === 0) {
    throw new AppError('Only a signed-in user session can open a socket', 403, ErrorCode.FORBIDDEN);
  }
  if (session.userId != null && session.userId !== userId) {
    throw new AppError('A socket ticket needs a signed-in user', 401, ErrorCode.UNAUTHORIZED);
  }
  if (session.otpVerifyNeeded) {
    throw new AppError('Finish signing in before opening a socket', 401, ErrorCode.OTP_REQUIRED);
  }
  // auth.05: a session that must change its password is held at the change-password route; every other route refuses it
  // 403 PASSWORD_CHANGE_REQUIRED, and a socket is no exception.
  if (session.passwordChangeRequired) {
    throw new AppError('Change your password before opening a socket', 403, ErrorCode.PASSWORD_CHANGE_REQUIRED);
  }
  const { sessionExpiresAt } = wsSessionBinding(session);
  if ((session.sessionStatus != null && session.sessionStatus !== 'ACTIVE') || sessionExpiresAt == null || sessionExpiresAt <= now) {
    throw new AppError('The session has ended', 401, ErrorCode.SESSION_EXPIRED);
  }
  const origin = typeof caller?.origin === 'string' && caller.origin.length > 0 && caller.origin.length <= 256 ? caller.origin : undefined;
  return { userId, userSessionId, sessionExpiresAt, ...(origin ? { origin } : {}) };
}
