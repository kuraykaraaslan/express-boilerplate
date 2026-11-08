import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { authSessionExtensionLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/auth.session_extension';
import Logger from '@kuraykaraaslan-labs/logger';

/** Extension point id — declared in auth/module.json `extensionPoints`. */
export const AUTH_SESSION_EXTENSION_POINT = 'auth:session_extension';

/**
 * `auth:session_extension` — extra, named sections a satellite module adds to the
 * "who am I" answer (`GET /auth/session`, the device login body).
 *
 * `compliance.pendingAgreements` is the first: a client has to know that terms
 * changed before it can ask the person to accept them, and `auth` cannot read
 * `terms_consent` (auth is always installed, the agreements module is optional).
 * Default export of a contribution: `(ctx) => Promise<Record<string, unknown> | null>`
 * — each key of the returned object becomes a top-level field of the response.
 */
export type SessionExtension = (ctx: { tenantId: string; userId: string }) => Promise<Record<string, unknown> | null>;

/** Fields a contribution must never overwrite: they are the session's own answer. */
const RESERVED = new Set(['success', 'message', 'user', 'tenant', 'tenantMember', 'userSecurity', 'accessToken', 'refreshToken', 'otpRequired']);

/**
 * Collect every contribution of a module active for this tenant, for this user.
 * Best-effort by contract: a contribution that throws, does not answer within the
 * point's `timeoutMs` (2 s), or tries to overwrite a reserved field, is skipped —
 * a satellite's trouble must never fail a sign-in or a session check.
 */
export async function collectSessionExtensions(tenantId: string, userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const { results } = await ext.aggregate<SessionExtension, Record<string, unknown> | null>(
      AUTH_SESSION_EXTENSION_POINT, tenantCtx(tenantId), authSessionExtensionLoaders,
      (contribute) => contribute({ tenantId, userId }),
      { validate: (part) => part == null || (typeof part === 'object' && !Array.isArray(part)) },
    );
    for (const { value: part } of results) {
      if (!part) continue;
      for (const [key, value] of Object.entries(part)) {
        if (!RESERVED.has(key)) out[key] = value;
      }
    }
  } catch (error) {
    Logger.warn(`[auth.sessionExtension] ${error instanceof Error ? error.message : error}`);
  }
  return out;
}
