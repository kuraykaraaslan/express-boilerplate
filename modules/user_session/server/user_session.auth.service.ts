import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { env } from '@kuraykaraaslan-labs/env';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { UserSession as UserSessionEntity } from './entities/user_session.entity';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import redis from '@kuraykaraaslan-labs/redis';
import { SafeUserSession, SafeUserSessionSchema, type SessionMeta } from './user_session.types';
import UserSessionMessages from './user_session.messages';
import UserSessionTokenService, { type TokenAudience } from './user_session.token.service';
import UserSessionCacheService from './user_session.cache.service';
import { sessionCacheKey } from './user_session.cache-keys';
import AuthPolicyService from '@kuraykaraaslan-labs/auth/server/auth.policy.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { emitSecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SESSION_EXPIRY_MS = env.SESSION_EXPIRY_MS ?? (1000 * 60 * 60 * 24 * 7);
const REMEMBER_ME_SESSION_EXPIRY_MS = env.REMEMBER_ME_SESSION_EXPIRY_MS ?? (1000 * 60 * 60 * 24 * 30);
const SESSION_CACHE_TTL = env.SESSION_CACHE_TTL;
const REFRESH_TOKEN_GRACE_SECONDS = env.REFRESH_TOKEN_GRACE_SECONDS;
const refreshGraceKey = (userSessionId: string) => `session:refreshgrace:${userSessionId}`;

/** Whether a session was created with "remember me" ticked. */
function isRemembered(session: { metadata?: unknown }): boolean {
  return (session.metadata as SessionMeta | null)?.rememberMe === true;
}

/**
 * Absolute (creation-anchored) deadline for a session, in ms epoch. A
 * "remember me" session uses the wider `rememberMeMaxHours` ceiling; every other
 * session uses `absoluteMaxHours`.
 */
function absoluteDeadlineFor(
  session: { createdAt: Date; metadata?: unknown },
  policy: { absoluteMaxHours: number; rememberMeMaxHours: number },
): number {
  const capHours = isRemembered(session) ? policy.rememberMeMaxHours : policy.absoluteMaxHours;
  // A Fleet ID session (FID-07) never outlives its own cap, whatever the tenant allows.
  const fleetId = (session.metadata as SessionMeta | null)?.fleetId;
  const fleetIdHours = fleetId?.maxHours;
  const byHours = session.createdAt.getTime() + Math.min(capHours, typeof fleetIdHours === 'number' && fleetIdHours > 0 ? fleetIdHours : Infinity) * 60 * 60 * 1000;
  // A session derived from a Fleet ID session (tenant switch) also ends with the login it came from; an unreadable deadline ends it now.
  if (!fleetId?.notAfter) return byHours;
  const notAfter = Date.parse(fleetId.notAfter);
  return Number.isNaN(notAfter) ? 0 : Math.min(byHours, notAfter);
}

/**
 * user_session.01: may this session's owner still be issued tokens? The account must be ACTIVE, and the membership the
 * session was minted for must still be ACTIVE. A session with no membership row is allowed only when it never had one by
 * construction: an account-only session (central login) or a platform admin's (its tenant access is the global-admin
 * bypass, re-checked on every request). Fail closed: a lookup error propagates and refuses the refresh.
 */
async function sessionOwnerMayRefresh(session: UserSessionEntity): Promise<boolean> {
  const ds = await getDataSource();
  const user = await ds.getRepository(UserEntity).findOne({ where: { userId: session.userId } });
  if (!user || user.userStatus !== 'ACTIVE') return false;
  if ((session.metadata as SessionMeta | null)?.accountOnly === true || !session.tenantId) return true;
  const member = await withTenantRepositoryFor(session.tenantId, TenantMemberEntity, (repo) => repo.findOne({
    where: { tenantId: session.tenantId, userId: session.userId, deletedAt: IsNull() },
  }));
  if (member) return member.memberStatus === 'ACTIVE';
  return user.userRole === 'ADMIN';
}

export default class UserSessionAuthService {

  static async getSession({ accessToken, deviceFingerprint, otpVerifyBypass = false, tenantId, audience = 'web' }: {
    accessToken: string;
    deviceFingerprint?: string;
    otpVerifyBypass?: boolean;
    tenantId?: string;
    /** user_session.05: the audience the caller verified with ('device' for a Bearer caller); verified again with the SAME one. */
    audience?: TokenAudience;
  }): Promise<SafeUserSession> {
    const decoded = UserSessionTokenService.verifyAccessToken(accessToken, deviceFingerprint, audience);
    const hashedToken = UserSessionTokenService.hashToken(accessToken);
    const cacheKey = sessionCacheKey(decoded.userId, hashedToken);
    const idleKey = `session:idle:${decoded.userSessionId}`;

    // Resolve the idle-timeout policy against the SESSION's own tenant. The
    // caller may omit `tenantId` (e.g. token-only auth paths); falling back to
    // the system default would silently ignore a tenant's configured idle
    // timeout, so we prefer the explicit arg, then the tenantId stored in the
    // session metadata, then the system default.
    const resolveIdleTtl = async (sessionTenantId?: string): Promise<number> => {
      const policy = await AuthPolicyService.getSessionPolicy(tenantId ?? sessionTenantId);
      return Math.max(60, policy.idleTimeoutMinutes * 60);
    };

    // auth.21: a purge that failed while Redis was refusing (a refresh, a logout, a revoke) is owed first, so a rotated token's
    // stale entry is gone before any cached entry is trusted.
    await UserSessionCacheService.flushPendingPurges();
    const cached = await redis.get(cacheKey);

    if (cached) {
      try {
        const session = SafeUserSessionSchema.parse(JSON.parse(cached));
        const alive = await redis.get(idleKey);
        if (!alive) throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
        if (!otpVerifyBypass && session.otpVerifyNeeded) throw new AppError(UserSessionMessages.OTP_REQUIRED, 401, ErrorCode.OTP_REQUIRED);
        const idleTtl = await resolveIdleTtl(session.tenantId);
        await redis.expire(idleKey, idleTtl).catch(() => {});
        return session;
      } catch (err: unknown) {
        if (err instanceof AppError && err.code === ErrorCode.SESSION_EXPIRED) throw err;
        await redis.del(cacheKey);
      }
    }

    const ds = await getDataSource();
    const session = await ds.getRepository(UserSessionEntity).findOne({
      where: { accessToken: hashedToken, userId: decoded.userId },
    });

    if (!session) throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
    if (session.sessionExpiry < new Date()) throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    if (session.sessionStatus === 'REVOKED') throw new AppError(UserSessionMessages.SESSION_REVOKED, 401, ErrorCode.UNAUTHORIZED);
    if (deviceFingerprint && session.deviceFingerprint !== deviceFingerprint) {
      throw new AppError(UserSessionMessages.DEVICE_FINGERPRINT_MISMATCH, 401, ErrorCode.UNAUTHORIZED);
    }
    if (!otpVerifyBypass && session.otpVerifyNeeded) throw new AppError(UserSessionMessages.OTP_REQUIRED, 401, ErrorCode.OTP_REQUIRED);

    const sessionTenantId = session.tenantId;
    const idleTtl = await resolveIdleTtl(sessionTenantId);
    const lastActivityMs = (session.updatedAt ?? session.createdAt).getTime();
    if (Date.now() - lastActivityMs > idleTtl * 1000) {
      throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    }

    const safeSession = SafeUserSessionSchema.parse(session);
    await redis.setex(cacheKey, SESSION_CACHE_TTL, JSON.stringify(safeSession));
    await redis.setex(idleKey, idleTtl, '1').catch(() => {});
    return safeSession;
  }

  /**
   * Read-only counterpart to refreshTokens: would a refresh succeed *right now*?
   *
   * Page/middleware auth gates need to distinguish an expired access token that
   * still backs a live, refreshable session (allow — the client will refresh)
   * from a genuinely dead one (redirect to login). This performs the same
   * acceptance checks as refreshTokens but rotates nothing and triggers no
   * destructive refresh-token-reuse handling — purely a yes/no.
   */
  static async isSessionRefreshable(refreshToken: string, audience: TokenAudience = 'web'): Promise<boolean> {
    let decoded;
    try {
      decoded = UserSessionTokenService.verifyRefreshToken(refreshToken, audience);
    } catch {
      return false; // invalid / expired / not-yet-valid (notBefore) JWT
    }

    const ds = await getDataSource();
    const session = await ds.getRepository(UserSessionEntity).findOne({
      where: { userSessionId: decoded.userSessionId, userId: decoded.userId },
    });

    if (!session) return false;
    if (session.sessionExpiry < new Date()) return false;
    if (session.sessionStatus === 'REVOKED') return false;
    if (session.otpVerifyNeeded) return false;
    if ((session.metadata as SessionMeta | null)?.impersonation || (session.metadata as SessionMeta | null)?.breakGlass) return false;
    // Stale/rotated refresh cookie — refreshTokens would treat this as reuse.
    if (session.refreshToken !== UserSessionTokenService.hashToken(refreshToken)) return false;

    const sessionTenantId = session.tenantId;
    const sessionPolicy = await AuthPolicyService.getSessionPolicy(sessionTenantId);
    const absoluteDeadline = absoluteDeadlineFor(session, sessionPolicy);
    if (Date.now() >= absoluteDeadline) return false;

    // The same owner rule as refreshTokens (user_session.01); an unreadable owner is "no".
    return sessionOwnerMayRefresh(session).catch(() => false);
  }

  static async refreshTokens(refreshToken: string, audience: TokenAudience = 'web'): Promise<{
    userSession: SafeUserSession;
    rawAccessToken: string;
    rawRefreshToken: string;
  }> {
    const decoded = UserSessionTokenService.verifyRefreshToken(refreshToken, audience);
    const hashedRefreshToken = UserSessionTokenService.hashToken(refreshToken);

    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);

    const session = await repo.findOne({ where: { userSessionId: decoded.userSessionId, userId: decoded.userId } });

    if (!session) throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
    if (session.sessionExpiry < new Date()) throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    if (session.otpVerifyNeeded) throw new AppError(UserSessionMessages.OTP_REQUIRED, 401, ErrorCode.OTP_REQUIRED);
    if ((session.metadata as SessionMeta | null)?.impersonation || (session.metadata as SessionMeta | null)?.breakGlass) throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);

    if (session.refreshToken !== hashedRefreshToken) {
      // A concurrent refresh from another tab can present the just-rotated
      // (previous) token after a sibling request already advanced the stored
      // hash. Honour a short grace window for that previous token so the benign
      // race isn't mistaken for token theft and doesn't nuke the user's
      // sessions. A token older than one generation (or past the window) still
      // trips reuse-detection.
      const graced = await redis.get(refreshGraceKey(session.userSessionId)).catch(() => null);
      if (graced !== hashedRefreshToken) {
        // The cache keys are made of the stored access-token hashes, so read them before the rows go.
        const all = await repo.find({ where: { userId: session.userId }, select: { accessToken: true } });
        await repo.delete({ userId: session.userId });
        await UserSessionCacheService.clearSessionCacheKeys(session.userId, all.map((s) => s.accessToken));
        // Phase 55 02 §2.3 (session hijack): a token used again after its rotation is the session-theft signal. Synchronous, never
        // throws, never waits (FWA-7); ids only, no token.
        emitSecuritySignal({
          tenantId: session.tenantId,
          lane: audience === 'device' ? 'human-native' : 'human-web',
          kind: 'user_session.refresh_reused',
          actor: { kind: 'user', id: session.userId },
          subject: { type: 'user_session', id: session.userSessionId },
          outcome: 'deny',
          severity: 'high',
          attrs: { revoked: all.length },
          source: 'user_session',
        });
        throw new AppError(UserSessionMessages.REFRESH_TOKEN_REUSED, 401, ErrorCode.UNAUTHORIZED);
      }
      // else: benign in-flight duplicate — fall through and re-mint.
    }

    // user_session.01: a suspended / disabled / deleted account, or a member removed from the session's tenant, kept minting
    // fresh tokens until the absolute deadline. Refused, and the session row goes with its cached copy.
    if (!(await sessionOwnerMayRefresh(session))) {
      await repo.delete({ userSessionId: session.userSessionId });
      await UserSessionCacheService.clearSessionCacheKeys(session.userId, [session.accessToken]);
      throw new AppError(UserSessionMessages.SESSION_REVOKED, 401, ErrorCode.UNAUTHORIZED);
    }

    const newAccessToken = UserSessionTokenService.generateAccessToken({
      userId: session.userId,
      userSessionId: session.userSessionId,
      tenantId: session.tenantId,
      deviceFingerprint: session.deviceFingerprint ?? undefined,
    }, audience);
    const newRefreshToken = UserSessionTokenService.generateRefreshToken({
      userId: session.userId,
      userSessionId: session.userSessionId,
      tenantId: session.tenantId,
      deviceFingerprint: session.deviceFingerprint ?? undefined,
    }, audience);

    const sessionTenantId = session.tenantId;
    const sessionPolicy = await AuthPolicyService.getSessionPolicy(sessionTenantId);
    const absoluteDeadline = absoluteDeadlineFor(session, sessionPolicy);
    if (Date.now() >= absoluteDeadline) {
      await repo.delete({ userSessionId: session.userSessionId });
      await UserSessionCacheService.clearSessionCacheKeys(session.userId, [session.accessToken]);
      throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    }
    const renewBaseMs = isRemembered(session) ? REMEMBER_ME_SESSION_EXPIRY_MS : SESSION_EXPIRY_MS;
    const renewedExpiryMs = Math.min(Date.now() + renewBaseMs, absoluteDeadline);

    // auth.07: compare-and-set on the refresh hash read above. Two tabs refreshing with the same token used to both write,
    // the last one won, and the other tab's fresh token then looked like a REUSED one: every session of the user was revoked.
    // The loser now gets a retryable 409 and keeps its (previous, graced) token, so its retry re-mints from the winner's row.
    const swapped = await repo.update({ userSessionId: session.userSessionId, refreshToken: session.refreshToken }, {
      accessToken: UserSessionTokenService.hashToken(newAccessToken),
      refreshToken: UserSessionTokenService.hashToken(newRefreshToken),
      sessionExpiry: new Date(renewedExpiryMs),
    });
    if (swapped && typeof swapped.affected === 'number' && swapped.affected < 1) {
      throw new AppError(UserSessionMessages.REFRESH_IN_PROGRESS, 409, ErrorCode.CONFLICT, { retryable: true });
    }
    // Remember the token we just rotated away from for a short grace window, so a
    // concurrent refresh still holding it is treated as benign (see the
    // reuse-detection check above) rather than as token theft.
    await redis
      .setex(refreshGraceKey(session.userSessionId), REFRESH_TOKEN_GRACE_SECONDS, session.refreshToken)
      .catch(() => {});
    // `session` is the row as read before the update, so this is the cache key of the access token just replaced.
    await UserSessionCacheService.clearSessionCacheKeys(session.userId, [session.accessToken]);
    const updated = await repo.findOne({ where: { userSessionId: session.userSessionId } });

    return { userSession: SafeUserSessionSchema.parse(updated!), rawAccessToken: newAccessToken, rawRefreshToken: newRefreshToken };
  }
}
