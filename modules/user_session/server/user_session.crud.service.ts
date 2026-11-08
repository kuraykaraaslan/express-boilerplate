import { revokeSessions } from './user_session.revocation-tx';
import 'reflect-metadata';
import { env } from '@kuraykaraaslan-labs/env';
import { Not } from 'typeorm';
import type { Repository } from 'typeorm';
import { getDataSource, withSystemRLS } from '@kuraykaraaslan-labs/db';
import { UserSession as UserSessionEntity } from './entities/user_session.entity';
import redis from '@kuraykaraaslan-labs/redis';
import { v4 as uuidv4 } from 'uuid';
import { SafeUserSession, SafeUserSessionSchema, type ListedUserSession, type SessionMeta } from './user_session.types';
import { findIdleSessions, idleWindows, lastActiveAt, readIdleRemaining } from './user_session.idle';
import { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { SafeUserSecurity } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import UserSessionMessages from './user_session.messages';
import UserSecurityMessages from '@kuraykaraaslan-labs/user_security/server/user_security.messages';
import UserSessionTokenService, { type TokenPayload } from './user_session.token.service';
import UserSessionCacheService from './user_session.cache.service';
import type { SessionStatus } from './user_session.enums';
import AuthPolicyService from '@kuraykaraaslan-labs/auth/server/auth.policy.service';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import UserAgentService from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.service';
import type { DeviceType as UaDeviceType } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.enums';
import UserSessionAuthService from './user_session.auth.service';
import { normalizeAmr } from './user_session.amr';
import { assessLogin, geoForSession, loginAnomalySeverity, type LoginRisk } from './user_session.login-risk.service';
import { assertNotSecurityLocked, isSecurityLocked } from '@kuraykaraaslan-labs/user_security/server/user_security.lock.service';
import Logger from '@kuraykaraaslan-labs/logger';

export { UserSessionAuthService };

/** `DeviceTypeEnum` (browser UA parser) → our broader `SessionMeta.device.type` (also covers watch/tv, which no browser UA reports). */
function mapUaDeviceType(info: { deviceType: UaDeviceType; deviceName: string | null; osName: string; osVersion: string | null }): import('./user_session.types').SessionMeta['device'] {
  const type = info.deviceType === 'Mobile' ? 'phone' : info.deviceType === 'Tablet' ? 'tablet' : 'desktop';
  return {
    type,
    os: info.osName !== 'Unknown' ? info.osName : undefined,
    osVersion: info.osVersion ?? undefined,
    name: info.deviceName ?? undefined,
  };
}

/** D28: the cap a tenant gets when it sets none, and the most it may set (the cap is always on; "no limit" is not an option). */
export const DEFAULT_SESSION_CAP = 10;

const IMPERSONATION_SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_EXPIRY_MS = env.SESSION_EXPIRY_MS ?? (1000 * 60 * 60 * 24 * 7);
const REMEMBER_ME_SESSION_EXPIRY_MS = env.REMEMBER_ME_SESSION_EXPIRY_MS ?? (1000 * 60 * 60 * 24 * 30);

export default class UserSessionCrudService {

  static async createSession({ user, userSecurity, deviceFingerprint, userAgent, ipAddress, otpIgnore = false, tenantId, rememberMe = false, audience = "web", device, accountOnly = false, amr, fleetId, passwordChangeRequired = false, trustedDevice = false, deviceId }: {
    user: SafeUser;
    userSecurity: SafeUserSecurity;
    deviceFingerprint?: string;
    userAgent?: string;
    ipAddress?: string;
    otpIgnore?: boolean;
    // Every session is tenant-scoped — this is the ONE tenant the resulting
    // token pair will be valid for. A user logging into a second tenant gets a
    // second, independent UserSession row, not a widened one.
    tenantId: string;
    /** "Remember me" was ticked at login — widen the session window + cap. */
    rememberMe?: boolean;
    audience?: import('./user_session.token.service').TokenAudience;
    /** Self-reported hardware for a device-bearer login (phone/tablet/watch/…). */
    device?: import('./user_session.types').SessionMeta['device'];
    /** Central login: a root-tenant session without a root membership (SessionMeta.accountOnly). */
    accountOnly?: boolean;
    /** The methods this login proved (RFC 8176, see user_session.amr.ts); values outside the vocabulary are dropped. */
    amr?: readonly string[];
    /**
     * A Fleet ID login (FID-07): the ID token's `sid` and the hours the session may live from now at most (`SessionMeta.fleetId`); `notAfter`
     * (ISO) for a session derived from one (`derivedFleetIdSession`), the original login's deadline it never outlives.
     */
    fleetId?: { sid: string | null; maxHours: number; notAfter?: string };
    /** auth.05: the login found the password expired; `userSecurity.mustChangePassword` sets it too. */
    passwordChangeRequired?: boolean;
    /** 38-security 3.4: the request carried a valid trusted-device token for this user; it suppresses the risk step-up (never the ordinary second factor). */
    trustedDevice?: boolean;
    /** D28: the browser's device-id cookie (user_session.device-id.ts); this device's earlier session of the user in this tenant ends with this sign-in. */
    deviceId?: string;
  }): Promise<{ userSession: SafeUserSession; rawAccessToken: string; rawRefreshToken: string }> {
    const fleetIdNotAfterMs = fleetId?.notAfter ? Date.parse(fleetId.notAfter) : Infinity;
    if (Number.isNaN(fleetIdNotAfterMs) || fleetIdNotAfterMs <= Date.now()) {
      throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    }
    // Phase 55 00.1 (P-1): the SECURITY lock (an admin or the firewall) refuses every sign-in method here, because every one of them
    // (password, passkey, SSO / social / OIDC, SAML, magic link, national ID, e-signature, Fleet ID, device login, handoff) ends in this
    // call. First, before a token exists or another session is ended. The guessing lock (`lockedUntil`) is NOT checked here: it is the
    // password sign-in's own (auth.credential.login.service), so a stranger guessing a password cannot lock a passkey or SSO user out.
    await assertNotSecurityLocked(user.userId, { tenantId, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null, method: normalizeAmr(amr)[0] ?? null });
    const userSessionId = uuidv4();
    const rawAccessToken = UserSessionTokenService.generateAccessToken({ userId: user.userId, userSessionId, tenantId, deviceFingerprint }, audience);
    const rawRefreshToken = UserSessionTokenService.generateRefreshToken({ userId: user.userId, userSessionId, tenantId, deviceFingerprint }, audience);
    // 38-security 3.2 / 3.3: geo of this login against the user's last session. Impossible travel or a Tor exit on the web lane forces
    // the second factor (step-up, A-6) even when the caller said otpIgnore; users without one are alerted (magic-link confirmation is 3.3b).
    // Phase 55 00.4: the ONE login-anomaly assessment (geo, velocity, Tor / proxy / VPN, and the new address / device check that used to
    // run, and webhook, a second time in user_security's recordLoginAttempt).
    const risk: LoginRisk = ipAddress ? await assessLogin({ userId: user.userId, ipAddress, tenantId, audience, userAgent }) : { geo: null, reasons: [], stepUp: false };
    // The tenant's opt-in hard deny (A-6: off by default): a risky web sign-in is refused, reported (one row, one webhook), and no session exists.
    if (risk.deny) {
      UserSessionCrudService.reportLoginAnomaly(user.userId, null, tenantId, ipAddress, { ...risk, stepUp: false }, false, audience, trustedDevice, true);
      throw new AppError(UserSessionMessages.LOGIN_BLOCKED_RISK, 403, ErrorCode.FORBIDDEN);
    }
    const hasOtp = (userSecurity?.otpMethods?.length ?? 0) > 0;
    const stepUp = risk.stepUp && !trustedDevice;
    // No enrolled factor: the step-up is a code sent to the account's e-mail address (A-6: step up, never hard-deny), allowed for this session only.
    const stepUpByEmail = stepUp && !hasOtp;
    const otpVerifyNeeded = ((!otpIgnore || stepUp) && hasOtp) || stepUpByEmail;

    const sessionPolicy = await AuthPolicyService.getSessionPolicy(tenantId);
    const capHours = rememberMe ? sessionPolicy.rememberMeMaxHours : sessionPolicy.absoluteMaxHours;
    const absoluteCapMs = capHours * 60 * 60 * 1000;
    const baseExpiryMs = rememberMe ? REMEMBER_ME_SESSION_EXPIRY_MS : SESSION_EXPIRY_MS;
    const expiryMs = Math.min(baseExpiryMs, absoluteCapMs, fleetId ? fleetId.maxHours * 60 * 60 * 1000 : Infinity, fleetIdNotAfterMs - Date.now());

    const ds = await getDataSource();

    // D28: one live session per user, tenant and device: this device's earlier session ends first (a sign-in from the same browser
    // replaces its session instead of adding a row). Then MS-36: the one enforcement of the session cap (`singleSessionOnly` = a cap
    // of 1, `maxConcurrentSessions` = N, else the platform default of 10), before the new row exists: the user's oldest live sessions IN
    // THIS TENANT beyond cap - 1 end, so the new sign-in always gets in. Neither is caught: if the older sessions cannot be ended, no
    // new session is issued (fail closed; it used to fail open).
    // A sign-in that still waits for its second factor ends NOTHING of the person's verified sessions: a password alone (a guess, a leak)
    // must not sign the owner out. It only trims the pending rows; the replacement and the cap run when the factor is proven
    // (`updateSession`, below) and the session becomes a live one.
    if (otpVerifyNeeded) await UserSessionCrudService.trimPendingSessions(user.userId, tenantId);
    else await UserSessionCrudService.enforceSessionLimits(user.userId, tenantId, { deviceId, audience });

    const repo = ds.getRepository(UserSessionEntity);
    const sessionMeta: import('./user_session.types').SessionMeta = {};
    if (rememberMe) sessionMeta.rememberMe = true;
    if (accountOnly) sessionMeta.accountOnly = true;
    if (passwordChangeRequired || userSecurity?.mustChangePassword === true) sessionMeta.passwordChangeRequired = true;
    const sessionAmr = normalizeAmr(amr);
    if (sessionAmr.length) sessionMeta.amr = sessionAmr;
    if (fleetId) sessionMeta.fleetId = { sid: fleetId.sid, maxHours: fleetId.maxHours, ...(fleetId.notAfter ? { notAfter: new Date(fleetIdNotAfterMs).toISOString() } : {}) };
    // Device data for every session, not just a device-bearer login: a web
    // cookie session has no self-reported hardware, but the User-Agent it
    // DOES carry is enough to place it (phone/tablet/desktop, OS, browser).
    // An explicit `device` payload (native app) always wins per-field over
    // this best-effort guess — the app knows its own brand/model, a UA
    // string never does.
    const autoDevice = userAgent ? mapUaDeviceType(UserAgentService.parseUserAgent(userAgent)) : undefined;
    if (autoDevice || device) sessionMeta.device = { ...autoDevice, ...device };
    // D28: the lane of the sign-in; the cap takes its victims from the SAME lane first (see enforceSessionCap).
    if (audience === 'device') sessionMeta.audience = 'device';
    if (risk.geo) sessionMeta.geo = geoForSession(risk.geo);
    if (stepUpByEmail) sessionMeta.stepUpEmail = true;
    const session = repo.create({
      userSessionId,
      userId: user.userId,
      tenantId,
      accessToken: UserSessionTokenService.hashToken(rawAccessToken),
      refreshToken: UserSessionTokenService.hashToken(rawRefreshToken),
      deviceFingerprint,
      deviceId: deviceId ?? null,
      userAgent,
      ipAddress,
      otpVerifyNeeded,
      // notAfter is an instant: the time the work above took must not carry the session past the original login (FID-07)
      sessionExpiry: new Date(Math.min(Date.now() + expiryMs, fleetIdNotAfterMs)),
      metadata: sessionMeta as unknown,
    });
    const saved = await repo.save(session);
    // Phase 55 00.1: a lock set while this sign-in was between its gate and its save is seen here. lockAccount writes the lock BEFORE it
    // ends the sessions, so either that sweep finds this row or this re-read finds the lock: the row never outlives the lock.
    if (await isSecurityLocked(user.userId)) {
      await repo.delete({ userSessionId });
      throw new AppError(UserSecurityMessages.ACCOUNT_SECURITY_LOCKED, 403, ErrorCode.FORBIDDEN);
    }

    // Audit: a session was issued (login). Best-effort — never blocks login.
    UserSessionCrudService.auditLifecycle('user_session.login', saved.userSessionId, user.userId, tenantId, {
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      ...(risk.geo ? { geo: geoForSession(risk.geo) } : {}),
    });
    if (risk.reasons.length > 0) {
      UserSessionCrudService.reportLoginAnomaly(user.userId, saved.userSessionId, tenantId, ipAddress, { ...risk, stepUp }, hasOtp, audience, trustedDevice);
    }
    // Phase 55 00.4 review: the place of this sign-in becomes the one the next sign-in is measured against (new_ip / new_device), for
    // every method and after the assessment above read the previous one. Persistent (user_securities), so a sign-out does not erase it.
    // Best-effort: it never fails the sign-in. Awaited (one UPDATE), so a sign-in right after this one is measured against it.
    if (ipAddress || userAgent) {
      try {
        const { recordSignInPlace } = await import('@kuraykaraaslan-labs/user_security/server/user_security.login.service');
        await recordSignInPlace(user.userId, ipAddress ?? null, userAgent ?? null);
      } catch (err) {
        Logger.warn(`[user_session] last sign-in place not recorded: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Best-effort coarse geo-location derived from the login IP, folded into the
    // session `metadata` jsonb (no schema change — metadata is a passthrough bag).
    // Fire-and-forget so a slow/failed geo lookup never delays or breaks login.
    if (ipAddress && !risk.geo) {
      UserSessionCrudService.annotateSessionGeo(saved.userSessionId, ipAddress, sessionMeta, tenantId).catch(() => {});
    }

    await redis
      .setex(`session:idle:${userSessionId}`, Math.max(60, sessionPolicy.idleTimeoutMinutes * 60), '1')
      .catch(() => {});

    return { userSession: SafeUserSessionSchema.parse(saved), rawAccessToken, rawRefreshToken };
  }

  /**
   * The session cap of the tenant a sign-in is for (MS-36, always on since D28): 1 when the tenant's access policy says
   * `singleSessionOnly` (auth), else the tenant's `maxConcurrentSessions` (tenant_session's key) when it is a whole number above 0
   * (never above `DEFAULT_SESSION_CAP`: a tenant may tighten the platform's cap, not loosen it), else `DEFAULT_SESSION_CAP`. Never 0: a
   * tenant that leaves the key empty or 0 gets the platform default, because no cap at all is how a user's sessions piled up without limit. Read in THAT tenant: for a central login it is
   * the ROOT tenant, whose sessions are the account's own. An unreadable `maxConcurrentSessions` counts as unset, as every policy
   * read does (AuthPolicyService falls back to its defaults); ending the sessions is what fails closed.
   */
  static async sessionCap(tenantId: string): Promise<number> {
    const [accessPolicy, raw] = await Promise.all([
      AuthPolicyService.getAccessPolicy(tenantId),
      Promise.resolve().then(() => SettingService.getValue(tenantId, 'maxConcurrentSessions')).catch(() => null),
    ]);
    if (accessPolicy.singleSessionOnly) return 1;
    const n = raw == null ? 0 : Number(String(raw).trim());
    return Number.isInteger(n) && n > 0 ? Math.min(n, DEFAULT_SESSION_CAP) : DEFAULT_SESSION_CAP;
  }

  /**
   * Ends sessions of one user: rows deleted, cache keys cleared, live sockets told (user_session:session_revoked), one
   * `user_session.revoked` audit row each carrying the cause. The one path every sign-in time eviction goes through.
   */
  private static async endSessions(
    userId: string,
    tenantId: string,
    rows: Pick<UserSessionEntity, 'userSessionId' | 'userId' | 'tenantId' | 'accessToken'>[],
    cause: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (rows.length === 0) return;
    // D249: the delete and the sessions' session-ending orders in one transaction; cache keys, delivery and the hooks after it
    await revokeSessions(async (qr) => {
      await qr.manager.getRepository(UserSessionEntity).delete(rows.map((s) => s.userSessionId));
      return rows;
    });
    for (const s of rows) {
      UserSessionCrudService.auditLifecycle('user_session.revoked', s.userSessionId, userId, tenantId, { cause, ...extra });
    }
  }

  /**
   * D28: the sign-in time limits of a session that is (becoming) live: this device's earlier session ends, then the cap. `exceptSessionId`
   * is the session that is being activated (a second factor just proven): it is already a row and is never its own victim.
   */
  static async enforceSessionLimits(
    userId: string,
    tenantId: string,
    opts: { deviceId?: string | null; audience?: string; exceptSessionId?: string } = {},
  ): Promise<void> {
    if (opts.deviceId) await UserSessionCrudService.replaceDeviceSessions(userId, tenantId, opts.deviceId, opts.exceptSessionId);
    await UserSessionCrudService.enforceSessionCap(userId, tenantId, { audience: opts.audience, exceptSessionId: opts.exceptSessionId });
  }

  /**
   * D28: one live session per user, tenant and device. The live (not expired) sessions of this user in this tenant that carry this device
   * id end (cause `replaced_by_new_login`); sessions of other devices, of other tenants, rows without a device id and expired rows (history,
   * see user_session.prune.ts) are untouched. Returns how many ended. Runs inside `createSession` before the new row exists and, like the
   * cap, is not caught: if the earlier session cannot be ended no new one is issued.
   */
  static async replaceDeviceSessions(userId: string, tenantId: string, deviceId: string, exceptSessionId?: string): Promise<number> {
    const repo = (await getDataSource()).getRepository(UserSessionEntity);
    const now = Date.now();
    const same = (await repo.find({
      where: { userId, tenantId, deviceId },
      select: { userSessionId: true, userId: true, tenantId: true, accessToken: true, sessionExpiry: true },
    })).filter((s) => s.userSessionId !== exceptSessionId && s.sessionExpiry.getTime() > now);
    await UserSessionCrudService.endSessions(userId, tenantId, same, 'replaced_by_new_login');
    return same.length;
  }

  /**
   * MS-36: the ONE enforcement of the concurrent-session cap, run when a session becomes live (`createSession` before the new row is
   * written, `updateSession` when a second factor is proven). Behaviour: PRUNE THE OLDEST. Of the user's live sessions in this tenant
   * (not expired, second factor done, not an impersonation or break-glass session: those are the impersonator's, short and counted
   * nowhere) the newest `cap - 1` stay (the new one fills the last slot) and the rest end: rows deleted, cache keys cleared, live
   * sockets told, one `user_session.revoked` audit row each (cause `concurrent_session_limit`). Sessions in other tenants are never
   * touched (user_session.02: a tenant's policy must not sign the user out of another tenant). Returns how many sessions ended.
   *
   * The victims come from the sign-in's own lane first (`audience`: a native or device sign-in has no device cookie, so each one is a new
   * row; they must not push out the person's browser session, and the other way round); only when that lane has too few does the
   * oldest of the other lane go, so the cap still holds as a total.
   *
   * Why prune rather than refuse the new sign-in: refusing lets whoever holds the oldest sessions (a stolen cookie included)
   * lock the owner out, and the owner could not reach the session list to revoke them. Pruning means the owner's next sign-in
   * always gets in and ends the oldest session, and a thief's sign-in visibly ends the owner's.
   */
  static async enforceSessionCap(userId: string, tenantId: string, opts: { audience?: string; exceptSessionId?: string } = {}): Promise<number> {
    const cap = await UserSessionCrudService.sessionCap(tenantId);
    if (cap <= 0) return 0;

    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const now = Date.now();
    const sessions = (await repo.find({
      where: { userId, tenantId },
      order: { createdAt: 'DESC' },
      select: { userSessionId: true, userId: true, tenantId: true, accessToken: true, createdAt: true, sessionExpiry: true, otpVerifyNeeded: true, metadata: true },
    })).filter((s) => {
      const meta = s.metadata as SessionMeta | null | undefined;
      return s.userSessionId !== opts.exceptSessionId && s.sessionExpiry.getTime() > now && !s.otpVerifyNeeded && !meta?.impersonation && !meta?.breakGlass;
    });
    const excess = sessions.length - Math.max(0, cap - 1);
    if (excess <= 0) return 0;
    const lane = opts.audience === 'device' ? 'device' : 'web';
    const laneOf = (s: (typeof sessions)[number]) => ((s.metadata as SessionMeta | null | undefined)?.audience === 'device' ? 'device' : 'web');
    // Oldest first; the sign-in's own lane ahead of the other one.
    const oldestFirst = [...sessions].reverse();
    const chosen = new Set([...oldestFirst.filter((s) => laneOf(s) === lane), ...oldestFirst.filter((s) => laneOf(s) !== lane)].slice(0, excess));
    const victims = sessions.filter((s) => chosen.has(s));
    await UserSessionCrudService.endSessions(userId, tenantId, victims, 'concurrent_session_limit', { cap });
    return victims.length;
  }

  /** The most second-factor-pending sessions one user keeps in one tenant (a password alone must not pile up rows nor push out live sessions). */
  static readonly MAX_PENDING_SESSIONS = 5;

  /**
   * D28: before a sign-in that still waits for its second factor is written, the user's older pending rows of this tenant beyond
   * `MAX_PENDING_SESSIONS - 1` end (cause `otp_pending_limit`). Verified sessions are never touched here: the replacement and the cap
   * run when the factor is proven.
   */
  static async trimPendingSessions(userId: string, tenantId: string): Promise<number> {
    const repo = (await getDataSource()).getRepository(UserSessionEntity);
    const pending = await repo.find({
      where: { userId, tenantId, otpVerifyNeeded: true },
      order: { createdAt: 'DESC' },
      select: { userSessionId: true, userId: true, tenantId: true, accessToken: true, createdAt: true },
    });
    const stale = pending.slice(Math.max(0, UserSessionCrudService.MAX_PENDING_SESSIONS - 1));
    await UserSessionCrudService.endSessions(userId, tenantId, stale, 'otp_pending_limit');
    return stale.length;
  }

  static async createImpersonationSession({ targetUser, impersonationMeta, userAgent, ipAddress, ttlMs, deviceFingerprint }: {
    targetUser: SafeUser;
    impersonationMeta: NonNullable<SessionMeta['impersonation']>;
    userAgent?: string;
    ipAddress?: string;
    /**
     * auth_impersonation.06: the fingerprint of the impersonator's browser (the one that receives the cookies). A web
     * token carries it like a login's does, so the session works only in that browser.
     */
    deviceFingerprint?: string;
    // Per-tenant impersonation TTL (ms). Resolved by the impersonation module
    // (`ImpersonationService.getImpersonationTtlMs`) and threaded in here to keep
    // a single source of truth without a user_session → auth_impersonation cycle.
    // Falls back to the 1-hour default when omitted.
    ttlMs?: number;
  }): Promise<{ userSession: SafeUserSession; rawAccessToken: string; rawRefreshToken: string }> {
    const userSessionId = uuidv4();
    // The impersonation session is scoped to the tenant being impersonated
    // into (falling back to the root tenant for a tenant-less impersonation).
    const tenantId = impersonationMeta.tenantId ?? ROOT_TENANT_ID;
    const jwtPayload: TokenPayload = { userId: targetUser.userId, userSessionId, tenantId, impersonation: impersonationMeta, ...(deviceFingerprint ? { deviceFingerprint } : {}) };
    const rawAccessToken = UserSessionTokenService.generateAccessToken(jwtPayload);
    const rawRefreshToken = UserSessionTokenService.generateRefreshToken(jwtPayload);
    const metadata: SessionMeta = { impersonation: impersonationMeta };

    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const session = repo.create({
      userSessionId,
      userId: targetUser.userId,
      tenantId,
      accessToken: UserSessionTokenService.hashToken(rawAccessToken),
      refreshToken: UserSessionTokenService.hashToken(rawRefreshToken),
      deviceFingerprint,
      userAgent,
      ipAddress,
      sessionExpiry: new Date(Date.now() + (ttlMs && ttlMs > 0 ? ttlMs : IMPERSONATION_SESSION_TTL_MS)),
      metadata: metadata as unknown,
    });
    const saved = await repo.save(session);
    return { userSession: SafeUserSessionSchema.parse(saved), rawAccessToken, rawRefreshToken };
  }

  /**
   * A fleet break-glass session (see `SessionMeta.breakGlass`): for a shadow user, valid for ONE tenant, lasting exactly until the grant's window ends and
   * never refreshable. `ttlMs` is the time left on the grant (capped at the 4 h grant maximum).
   */
  static async createBreakGlassSession({ user, tenantId, breakGlass, ttlMs, deviceFingerprint, userAgent, ipAddress }: {
    user: SafeUser;
    tenantId: string;
    breakGlass: NonNullable<SessionMeta['breakGlass']>;
    ttlMs: number;
    /**
     * The fingerprint of the browser that proved possession of the grant key. A cookie (web) session is only accepted with the fingerprint of the request
     * bearing it, so a token minted without one can never authenticate.
     */
    deviceFingerprint?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ userSession: SafeUserSession; rawAccessToken: string; rawRefreshToken: string }> {
    if (!(ttlMs > 0)) throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    // Phase 55 00.1: a security-locked account gets no break-glass session either (it is a sign-in of that account, minted elsewhere).
    await assertNotSecurityLocked(user.userId, { tenantId, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null, method: 'break_glass' });
    const userSessionId = uuidv4();
    const lifeMs = Math.min(ttlMs, 4 * 60 * 60 * 1000);
    // Both tokens end with the grant window (the session cannot be refreshed, so a token shorter than the window would cut a 2-4 h grant short).
    const lifeSeconds = Math.max(1, Math.floor(lifeMs / 1000));
    const jwtPayload: TokenPayload = { userId: user.userId, userSessionId, tenantId, deviceFingerprint };
    const rawAccessToken = UserSessionTokenService.generateAccessToken(jwtPayload, 'web', lifeSeconds);
    const rawRefreshToken = UserSessionTokenService.generateRefreshToken(jwtPayload, 'web', lifeSeconds);
    const repo = (await getDataSource()).getRepository(UserSessionEntity);
    const saved = await repo.save(repo.create({
      userSessionId, userId: user.userId, tenantId,
      accessToken: UserSessionTokenService.hashToken(rawAccessToken), refreshToken: UserSessionTokenService.hashToken(rawRefreshToken),
      deviceFingerprint, userAgent, ipAddress, sessionExpiry: new Date(Date.now() + lifeMs),
      metadata: { breakGlass } as unknown,
    }));
    return { userSession: SafeUserSessionSchema.parse(saved), rawAccessToken, rawRefreshToken };
  }

  /** Drops every session minted from the given break-glass grants (revocation or expiry). Returns how many sessions were removed. */
  static async deleteBreakGlassSessions(grantIds: string[]): Promise<number> {
    if (grantIds.length === 0) return 0;
    // D249: found, deleted and their session-ending orders recorded in one transaction
    const rows = await revokeSessions(async (qr) => {
      const repo = qr.manager.getRepository(UserSessionEntity);
      const found = await repo.createQueryBuilder('s').select(['s.userSessionId', 's.userId', 's.tenantId', 's.accessToken'])
        .where(`s.metadata -> 'breakGlass' ->> 'grantId' IN (:...ids)`, { ids: grantIds }).getMany();
      if (found.length) await repo.delete(found.map((r) => r.userSessionId));
      return found;
    });
    return rows.length;
  }

  /**
   * Ends the Fleet ID sessions a back-channel logout token names (FID-07; OpenID Connect Back-Channel Logout 1.0 section 2.7): those minted with
   * that per-client `sid` (`SessionMeta.fleetId.sid`), those of that shadow user, or, with both, the sessions of that user with that `sid`. Only
   * sessions minted by a Fleet ID login (`metadata.fleetId`) are touched. A person's sessions span tenants, so it runs in the system context.
   * Returns how many sessions ended; asking with neither ends nothing.
   */
  static async deleteFleetIdSessions({ userId, sid }: { userId?: string | null; sid?: string | null }): Promise<number> {
    if (!userId && !sid) return 0;
    // D249: in the system context's transaction, with the sessions' session-ending orders
    const rows = await revokeSessions(async (qr) => {
      const repo = qr.manager.getRepository(UserSessionEntity);
      const q = repo.createQueryBuilder('s').select(['s.userSessionId', 's.userId', 's.tenantId', 's.accessToken'])
        .where(`s.metadata -> 'fleetId' IS NOT NULL`);
      if (userId) q.andWhere('s.userId = :userId', { userId });
      if (sid) q.andWhere(`s.metadata -> 'fleetId' ->> 'sid' = :sid`, { sid });
      const found = await q.getMany();
      if (found.length) await repo.delete(found.map((r) => r.userSessionId));
      return found;
    }, withSystemRLS);
    for (const r of rows) UserSessionCrudService.auditLifecycle('user_session.revoked', r.userSessionId, r.userId, r.tenantId, { cause: 'fleet_id_backchannel_logout' });
    return rows.length;
  }

  static async updateSession(
    userSessionId: string,
    updates: Partial<Pick<{ otpVerifyNeeded: boolean; sessionStatus: SessionStatus }, 'otpVerifyNeeded' | 'sessionStatus'>> & {
      /** Methods to add to the session's `amr` (a verified second factor adds `otp` and `mfa`); merged, never replacing what the login recorded. */
      amrAdd?: readonly string[];
    }
  ): Promise<SafeUserSession> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const session = await repo.findOne({ where: { userSessionId } });
    if (!session) throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);

    // D28: a session that waited for its second factor becomes a live one now: this device's earlier session ends and the cap is
    // enforced (a pending sign-in ends nothing, see createSession). Before the update, so if it cannot be done the session stays pending.
    const sessionMeta = session.metadata as SessionMeta | null | undefined;
    if (updates.otpVerifyNeeded === false && session.otpVerifyNeeded && !sessionMeta?.impersonation && !sessionMeta?.breakGlass) {
      await UserSessionCrudService.enforceSessionLimits(session.userId, session.tenantId, {
        deviceId: session.deviceId, audience: sessionMeta?.audience, exceptSessionId: session.userSessionId,
      });
    }

    const { amrAdd, ...columns } = updates;
    const patch: Record<string, unknown> = { ...columns };
    if (amrAdd?.length) {
      const meta = (session.metadata ?? {}) as SessionMeta;
      patch.metadata = { ...meta, amr: normalizeAmr([...(meta.amr ?? []), ...amrAdd]) };
    }
    await repo.update({ userSessionId }, patch as Parameters<Repository<UserSessionEntity>['update']>[1]);
    await UserSessionCacheService.clearSessionCacheKeys(session.userId, [session.accessToken]);
    const updated = await repo.findOne({ where: { userSessionId } });
    return SafeUserSessionSchema.parse(updated!);
  }

  static async deleteSession(userSessionId: string): Promise<void> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const session = await repo.findOne({ where: { userSessionId } });
    if (session) {
      // D249: the delete with the session's session-ending orders in one transaction; cache keys, delivery and the hooks after it
      await revokeSessions(async (qr) => {
        await qr.manager.getRepository(UserSessionEntity).delete({ userSessionId });
        return [session];
      });
      // Audit: a single session was revoked (also covers user logout, which routes here).
      UserSessionCrudService.auditLifecycle('user_session.revoked', userSessionId, session.userId, session.tenantId, {});
    }
  }

  /**
   * Revoke a session by the RAW access token, resolving the row via the stored
   * `hashToken(accessToken)`. This is the reliable logout path: it needs neither
   * a live Redis cache entry nor an unexpired/verifiable JWT — only possession
   * of the raw token (whose SHA-256 nobody else can produce), so an expired
   * access token or a cold cache can no longer leave the DB session (and its
   * refresh token) alive after "log out". Returns true if a row was deleted.
   */
  static async deleteSessionByAccessToken(rawAccessToken: string): Promise<boolean> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const hashed = UserSessionTokenService.hashToken(rawAccessToken);
    const session = await repo.findOne({ where: { accessToken: hashed } });
    if (!session) return false;
    // D249: the delete with the session's session-ending orders in one transaction; cache keys, delivery and the hooks after it
    await revokeSessions(async (qr) => {
      await qr.manager.getRepository(UserSessionEntity).delete({ userSessionId: session.userSessionId });
      return [session];
    });
    // Phase 55 00.4: this is the sign-out (its only caller is the logout route), so it is audited as `auth.logout`, the action that
    // was defined and never written; every other way a session ends stays `user_session.revoked*` with its cause.
    UserSessionCrudService.auditLifecycle('auth.logout', session.userSessionId, session.userId, session.tenantId, {});
    return true;
  }

  /** Ends every session of the user but the given one, in every tenant (the account page's "sign out all other sessions", a password change). Returns how many ended. */
  static async deleteOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    // D249: found, deleted and their session-ending orders recorded in one transaction
    const others = await revokeSessions(async (qr) => {
      const repo = qr.manager.getRepository(UserSessionEntity);
      const found = await repo.find({ where: { userId, userSessionId: Not(currentSessionId) }, select: { userSessionId: true, userId: true, tenantId: true, accessToken: true } });
      await repo.delete({ userId, userSessionId: Not(currentSessionId) });
      return found;
    });
    // Audit: all other sessions revoked (e.g. after a password change).
    UserSessionCrudService.auditLifecycle('user_session.revoked_others', userId, userId, undefined, { keptSessionId: currentSessionId, count: others.length });
    return others.length;
  }

  /**
   * auth.05: the password was changed, so the forced change-password step is over for this user's sessions. Drops
   * `passwordChangeRequired` from every session that carries it and purges their cache entries (the guard reads the
   * flag from the cached session).
   */
  static async clearPasswordChangeRequired(userId: string): Promise<void> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const rows = await repo.find({ where: { userId }, select: { userSessionId: true, accessToken: true, metadata: true } });
    const flagged = rows.filter((r) => (r.metadata as import('./user_session.types').SessionMeta | null)?.passwordChangeRequired === true);
    for (const row of flagged) {
      const { passwordChangeRequired: _done, ...rest } = (row.metadata ?? {}) as import('./user_session.types').SessionMeta;
      void _done;
      row.metadata = rest as unknown;
      await repo.save(row);
    }
    if (flagged.length) await UserSessionCacheService.clearSessionCacheKeys(userId, flagged.map((r) => r.accessToken));
  }

  static async deleteAllSessions(userId: string): Promise<void> {
    // D249: found, deleted and their session-ending orders recorded in one transaction
    await revokeSessions(async (qr) => {
      const repo = qr.manager.getRepository(UserSessionEntity);
      const all = await repo.find({ where: { userId }, select: { userSessionId: true, userId: true, tenantId: true, accessToken: true } });
      await repo.delete({ userId });
      return all;
    });
    // Audit: every session for the user revoked ("log out everywhere").
    UserSessionCrudService.auditLifecycle('user_session.revoked_all', userId, userId, undefined, {});
  }

  /**
   * Drops every session OF ONE TENANT (a tenant that moved to another node, docs/phases/02-fleet/05 section 6.2 CUTOVER): its members' sessions in other
   * tenants are untouched. Cross-tenant by nature, so in the system context. Not audited into the tenant's chain: the tenant no longer lives here.
   */
  static async deleteTenantSessions(tenantId: string): Promise<number> {
    // D249: in the system context's transaction, with the sessions' session-ending orders
    const rows = await revokeSessions(async (qr) => {
      const repo = qr.manager.getRepository(UserSessionEntity);
      const found = await repo.find({ where: { tenantId }, select: { userSessionId: true, userId: true, tenantId: true, accessToken: true } });
      if (found.length) await repo.delete({ tenantId });
      return found;
    }, withSystemRLS);
    return rows.length;
  }

  /**
   * The user's live sessions, newest first (the account page's list). `ACTIVE`, not expired and, since D28, not idle (see
   * user_session.idle.ts: a session `getSession` would refuse is not "active", and it is deleted by the prune job soon), each with
   * `lastActiveAt`. `keepSessionId` (the caller's own session) is always listed.
   */
  static async getUserSessions(userId: string, keepSessionId?: string | null): Promise<ListedUserSession[]> {
    const ds = await getDataSource();
    const rows = await ds.getRepository(UserSessionEntity).find({
      where: { userId, sessionStatus: 'ACTIVE' },
      order: { createdAt: 'DESC' },
    });
    const now = Date.now();
    const live = rows.filter((s) => s.sessionExpiry > new Date(now));
    const idle = await findIdleSessions(live, keepSessionId, now);
    const shown = live.filter((s) => !idle.has(s.userSessionId));
    const [windows, remaining] = await Promise.all([idleWindows(shown), readIdleRemaining(shown.map((s) => s.userSessionId))]);
    const ownDeviceId = keepSessionId ? live.find((s) => s.userSessionId === keepSessionId)?.deviceId : null;
    return shown.map((s) => ({
      ...SafeUserSessionSchema.parse(s),
      lastActiveAt: lastActiveAt(s, windows.get(s.tenantId), remaining?.get(s.userSessionId), now)?.toISOString() ?? null,
      ...(ownDeviceId && s.deviceId === ownDeviceId && s.userSessionId !== keepSessionId ? { thisDevice: true } : {}),
    }));
  }

  /**
   * 38-security 3.2: one anomalous login, reported three ways: the audit row `auth.login_anomaly`, the tenant webhook
   * `security.login_anomaly`, and a log line. Phase 55 00.4: this is the only place either is written, so a login is reported ONCE
   * whatever its reasons and whatever the sign-in method; the row carries the severity its reasons earn (`loginAnomalySeverity`:
   * impossible travel, Tor or a deny is high and rides `audit.high_risk`; a new address or device alone is low). A denied sign-in has
   * no session: its row's resource is `denied`. Fire-and-forget and guarded; reporting never blocks or breaks the login.
   */
  private static reportLoginAnomaly(userId: string, userSessionId: string | null, tenantId: string, ipAddress: string | undefined, risk: LoginRisk, hasOtp: boolean, audience: string, trustedDevice = false, denied = false): void {
    const severity = loginAnomalySeverity(risk.reasons, { denied });
    const detail = {
      reasons: risk.reasons, severity, stepUp: risk.stepUp, stepUpMethod: risk.stepUp ? (hasOtp ? 'otp' : 'email') : null, stepUpWanted: risk.stepUp,
      ...(denied ? { denied: true } : {}), trustedDevice, audience, ipAddress: ipAddress ?? null, previousIp: risk.previousIp ?? null,
      device: risk.device ?? null, country: risk.geo?.countryCode ?? null,
    };
    UserSessionCrudService.auditLifecycle('auth.login_anomaly', userSessionId ?? 'denied', userId, tenantId, detail, severity);
    import('@kuraykaraaslan-labs/webhook/server/webhook.service')
      .then(({ default: WebhookService }) => WebhookService.dispatchEvent(tenantId, 'security.login_anomaly', {
        userId, ...(userSessionId ? { userSessionId } : {}), at: new Date().toISOString(), ...detail,
      }))
      .catch(() => {});
  }

  /**
   * Coarse geo annotation (best-effort). Resolves a country/city-level location
   * for the login IP via the user_agent geo provider and folds it into the
   * session's `metadata` jsonb. No schema change — `metadata` is a passthrough
   * bag. Private/reserved IPs and lookup failures yield all-null fields, which
   * we skip so we never replace good metadata with an empty location.
   */
  private static async annotateSessionGeo(
    userSessionId: string,
    ipAddress: string,
    baseMeta: SessionMeta,
    tenantId?: string,
  ): Promise<void> {
    const geo = await UserAgentService.getGeoLocation(ipAddress, tenantId);
    if (!geo.country && !geo.city && !geo.countryCode) return;
    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);
    const row = await repo.findOne({ where: { userSessionId } });
    if (!row) return;
    row.metadata = {
      ...baseMeta,
      geo: { city: geo.city, state: geo.state, country: geo.country, countryCode: geo.countryCode },
    };
    await repo.save(row);
  }

  /**
   * Emit a session-lifecycle audit entry (login / revoke / revoke-all) to the
   * shared audit_log. Fire-and-forget and guarded — auditing must never block or
   * break the auth path. Mirrors the webhook / feature_flags audit helpers.
   */
  private static auditLifecycle(
    action: string,
    resourceId: string,
    userId: string | null,
    tenantId: string | null | undefined,
    metadata: Record<string, unknown>,
    severity?: 'low' | 'medium' | 'high' | 'critical',
  ): void {
    AuditLogService.log({
      tenantId: tenantId ?? null,
      actorId: userId ?? null,
      actorType: userId ? 'USER' : 'SYSTEM',
      action,
      ...(severity ? { severity } : {}),
      resourceType: 'user_session',
      resourceId,
      metadata: { userId, ...metadata },
    }).catch(() => {});
  }

  // Auth delegates
  static getSession           = UserSessionAuthService.getSession.bind(UserSessionAuthService);
  static refreshTokens        = UserSessionAuthService.refreshTokens.bind(UserSessionAuthService);
  static isSessionRefreshable = UserSessionAuthService.isSessionRefreshable.bind(UserSessionAuthService);
}
