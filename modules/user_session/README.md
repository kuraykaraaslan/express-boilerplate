# User Session Module

JWT access/refresh token issuance, verification, rotation, and revocation backed by a Redis-cached `UserSession` row in the shared **system DB**. Supports device fingerprinting, multi-session tracking, impersonation sessions, and OTP-verification gating. Per-request session lifetime, idle timeout, and single-session enforcement are gated by `AuthPolicyService` settings (per tenant).

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `UserSession` | `user_sessions` | One row per login session: hashed access/refresh tokens, device fingerprint, user agent, IP, `sessionStatus`, `otpVerifyNeeded`, `sessionExpiry`, and a JSONB `metadata` blob (used for impersonation). |

Lives in the **system DB** — there is **no `tenantId` column**; sessions are system-scoped and seeded via `ctx.systemRepo`. `accessToken` and `refreshToken` are stored as SHA-256 hashes (never the raw token).

---

## Files

| File | Purpose |
|---|---|
| `user_session.service.ts` | Facade: binds and re-exports the token / cache / CRUD sub-services |
| `user_session.token.service.ts` | JWT generation & verification, token hashing, device-fingerprint hashing |
| `user_session.crud.service.ts` | DB CRUD + Redis cache/idle logic: create, get, refresh, update, delete sessions |
| `user_session.cache.service.ts` | Redis session-cache invalidation per user |
| `user_session.entity.ts` (`entities/`) | TypeORM entity for the `user_sessions` table |
| `user_session.types.ts` | Zod schemas + `UserSession`, `SafeUserSession`, `SessionMeta` types |
| `user_session.enums.ts` | `SessionStatusEnum` (`ACTIVE` / `EXPIRED` / `REVOKED`) |
| `user_session.messages.ts` | `UserSessionMessages` error/status string enum |
| `user_session.device-id.ts` | The `device-id` cookie: parse, mint, cookie options (D28) |
| `user_session.idle.ts` | When a session is idle, i.e. dormant (idle key gone + row untouched for the dormancy window), `lastActiveAt` (D28) |
| `user_session.prune.ts` / `user_session.prune.job.ts` | Retention pruning of ended rows, the same-device leftover cleanup, the 15-minute job (D28) |
| `user_session.seed.ts` | Demo seed: active/OTP/expired/revoked sessions for the seed users |

---

## Session Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Valid and usable |
| `EXPIRED` | Past `sessionExpiry` (or idle-timeout) |
| `REVOKED` | Manually invalidated |

---

## Services / Responsibilities

**`UserSessionTokenService`** — stateless JWT/crypto helper:
- `generateAccessToken` / `generateRefreshToken` — sign payloads with env secrets; access TTL `ACCESS_TOKEN_EXPIRES_IN` (default `1h`), refresh TTL `REFRESH_TOKEN_EXPIRES_IN` (default `7d`), refresh token has a 5s `notBefore`.
- `verifyAccessToken` / `verifyRefreshToken` — verify issuer/audience, optionally enforce device fingerprint; map JWT errors to `TOKEN_EXPIRED` / `INVALID_TOKEN`.
- `hashToken` — SHA-256 hash stored in the DB instead of the raw token.
- `generateDeviceFingerprint` — SHA-256 of `ip|userAgent|acceptLanguage`.

**`UserSessionCrudService`** — session lifecycle (per-tenant policy aware):
- `createSession` — issues a new session; caps `sessionExpiry` at `min(SESSION_EXPIRY_MS, absoluteMaxHours)` (or `min(REMEMBER_ME_SESSION_EXPIRY_MS, rememberMeMaxHours)` when `rememberMe` is passed — the flag is stamped into `SessionMeta.rememberMe`), seeds the Redis idle key, and enforces the session cap first (`enforceSessionCap`, MS-36, below). A Fleet ID login on a fleet node (FID-07) passes `fleetId: { sid, maxHours }`: the session then lives at most `maxHours` from its creation (8 for Fleet ID), whatever the tenant policy or remember-me allow, and `SessionMeta.fleetId.sid` keeps the ID token's per-client `sid` for back-channel logout. `deleteFleetIdSessions({ userId?, sid? })` ends the Fleet ID sessions (only rows with `metadata.fleetId`) a back-channel logout token names, across the person's tenants in the system context, with cache keys cleared, one `user_session.revoked` audit per session and `user_session:session_revoked` told.
- `createImpersonationSession` — issues a short-lived (1h) session carrying impersonation `metadata`; refresh of these is rejected.
- `getSession` — verifies the access token, serves from / repopulates the Redis cache, enforces idle timeout (Redis idle key + DB `updatedAt` grace window), and gates on `otpVerifyNeeded`.
- `refreshTokens` — rotates access+refresh tokens; detects refresh-token reuse (purges all user sessions on reuse), and enforces the absolute-lifetime ceiling (`createdAt + absoluteMaxHours`).
- `updateSession` — patch `otpVerifyNeeded` / `sessionStatus`.
- `deleteSession` / `deleteOtherSessions` / `deleteAllSessions` — revoke one / all-but-current / all sessions for a user, clearing the cache.
- `getUserSessions` — list a user's `ACTIVE`, non-expired sessions (newest first).

**`UserSessionCacheService`** — `clearUserSessionCache(userId)` deletes all `session:<userId>:*` Redis keys.

**`UserSessionService`** — facade exposing all of the above as bound static methods.

---

## Usage

```typescript
import UserSessionService from '@/modules/user_session/user_session.service';

// Create a new session after login (tenantId gates lifetime/idle/single-session policy)
const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.createSession({
  user,
  userSecurity,
  deviceFingerprint,
  userAgent: request.headers['user-agent'],
  ipAddress: '1.2.3.4',
  tenantId,
});

// Resolve / validate a session from an access token
const session = await UserSessionService.getSession({ accessToken, deviceFingerprint, tenantId });

// Rotate tokens (refresh flow)
const rotated = await UserSessionService.refreshTokens(rawRefreshToken);

// Revoke (logout) a single session, or all of a user's sessions
await UserSessionService.deleteSession(userSession.userSessionId);
await UserSessionService.deleteAllSessions(user.userId);
```

---

## API Routes (tenant-scoped, under `/tenant/[tenantId]/api/auth`)

| Method | Path | Description |
|---|---|---|
| GET | `/auth/me/sessions` | List the authenticated user's active sessions (`getUserSessions`) |
| DELETE | `/auth/me/sessions/[sessionId]` | Revoke one of the user's own sessions (`deleteSession`) |
| POST | `/auth/refresh` | Rotate access/refresh tokens (`refreshTokens`) |

The service is also consumed by sibling auth routes (`/auth/session`, `/auth/change-password`) and by impersonation flows.

---

## Concurrent-session cap (MS-36)

One behaviour, one code path: `UserSessionCrudService.enforceSessionCap(userId, tenantId)`, called by `createSession` before the new row is written.

- **The cap** (`sessionCap(tenantId)`): 1 when auth's access policy says `singleSessionOnly`, else tenant_session's `maxConcurrentSessions` (a whole number above 0, never above the platform default: a tenant may tighten the cap, not loosen it), else `DEFAULT_SESSION_CAP` = 10 (D28: the cap is always on; unset, 0, negative or not a whole number = the default, never "no limit"). Both are read in the tenant the session is for: a workspace sign-in reads that workspace; a central login (an account-only session on ROOT) reads ROOT, the account's own sessions.
- **Prune the oldest.** The user's LIVE sessions in that tenant (not expired, second factor done, not impersonation or break-glass) are kept newest first up to `cap - 1`, the rest end (the victims come from the sign-in's own lane first, a native or device sign-in against native sessions and a browser sign-in against browser ones, so a client without a device cookie cannot push out the person's browser session) (rows deleted, cache keys cleared, `user_session:session_revoked` told, one `user_session.revoked` audit row each with `cause: 'concurrent_session_limit'`), then the new session is written. Sessions in other tenants are never touched (user_session.02).
- **Fail closed.** If the older sessions cannot be read or ended, the sign-in fails and no session is issued (it used to fail open). An unreadable `maxConcurrentSessions` counts as unset, as before and as every policy read does (`singleSessionOnly` comes from AuthPolicyService, which falls back to its defaults).
- **Why prune, not refuse.** Refusing the newest session lets whoever holds the oldest sessions (a stolen cookie included) lock the owner out, and the owner could not reach the session list to revoke them. With pruning the owner's next sign-in always gets in and ends the oldest session, and a thief's sign-in visibly ends the owner's.
- tenant_session's per-request 429 check of the same key is removed, so the key has one meaning. Sessions that were already over the cap before the upgrade end at the user's next sign-in in that tenant.

## One session per device, idle expiry and pruning (D28)

The session list used to grow without end: every sign-in added a row, and only a sign-out, a revoke or the (then optional) cap ever removed one (36 rows for one admin on the demo). `docs/audits/2026-10-28-lead-decisions.md` D28:

- **Device id.** The first sign-in of a browser gets a random UUID in an httpOnly `device-id` cookie (path `/`, one year, sliding: `user_session.device-id.ts`, set by `UserSessionNextService.createSession` through the route handler's `cookies()` store, so no sign-in route changed). It is stored on the row (`user_sessions."deviceId"`, migration 002) and is NOT the token binding (`deviceFingerprint` is, and it still changes with the IP). `createSession` first ends this user's sessions of the SAME tenant with the SAME device id (`replaceDeviceSessions`, cause `replaced_by_new_login`, audited, sockets told), then enforces the cap, then writes the row. A sign-in that still waits for its second factor ends NOTHING (a password alone must not sign the owner out): it only trims the older pending rows beyond 4 (`otp_pending_limit`); the replacement and the cap run when `updateSession` activates it (second factor proven), before the update. Other tenants' sessions and other devices are untouched. An id is useless to anyone else: it can only replace sessions of the same user in the same tenant, and it is unguessable. A browser that drops the cookie is simply a new device (the cap and the idle expiry bound it). Impersonation and break-glass sessions carry no device id and never replace or get replaced by one.
- **Cap always on.** See above: 10 unless the tenant sets a lower number (a higher one reads as 10).
- **Idle** (`user_session.idle.ts`): a session is idle when it is DORMANT: its idle key (`session:idle:<id>`, refreshed on every request) is gone AND its row (written by a sign-in or a token refresh) has not been touched for 30 days, or the tenant's absolute session limit when that is shorter, never less than the tenant's idle timeout. It is deliberately NOT the 30-minute access idle window: `refreshTokens` has no idle check, so a remember-me browser or a native app left alone for a day is revived by its refresh token. A Redis that lost its keys alone never makes a recently seen session idle.
- **The list** (`getUserSessions(userId, keepSessionId)`) shows live, non-idle sessions newest first with `lastActiveAt` (from the idle key's remaining TTL, else the row's clock) and `thisDevice` (another session of the caller's own browser; the device id itself is never sent); the caller's own session is always listed. `DELETE /api/auth/me/sessions` ("Sign out all other sessions", `account.sessions.manage`) ends every other session of the account in every organization (`deleteOtherSessions`, audited `user_session.revoked_others`); an impersonation or break-glass session is refused (403).
- **Pruning** (`user_session.prune.ts`, BullMQ job `user-session-prune` every 15 minutes, `common:boot_task` order 2126): the rows are also the person's sign-in history (login-risk reads the latest row, new-device recognition reads past devices, the impersonation-sessions route lists past impersonations), so an ended row is kept for `HISTORY_RETENTION_DAYS` (90) and a user's newest `KEEP_NEWEST_PER_USER` (25) rows are kept whatever their age. Past that, expired rows and dormant rows are deleted (not announced: expiry is not a revocation; one log line with the counts). The same pass collapses the same-device leftovers of before the device id: of the rows without a device id that share a user, tenant and device fingerprint only the newest stays, and a row touched in the last 24 hours stays too (impersonation and break-glass rows are neither candidates nor counted); it finds nothing once those rows are gone.

## Settings

**Geo-IP lookup (ROOT page `/admin/settings/geo-ip`, 2026-10-27).** `geoIpProvider` (ipinfo / ip-api / ipgeolocation, default ipinfo) and `geoIpApiKey` (secret) are installation settings: the geo lookup (`common/server/user_agent/user_agent.geo.service.ts`) reads them from the ROOT tenant only, so one provider serves every tenant and the shared `geoip:<ip>` cache. Both fields are `rootOnly`; the route is placed `root` and guarded by `user_session.settings.read` + `tenant_setting.config.read` (update: `user_session.settings.update`). MS-34: the default is ipinfo, whose keyless https endpoint answers. ip-api's free tier is http only (its https endpoint answers 403 without a key), so ip-api is used only with a key, through its paid https endpoint (pro.ip-api.com); a stored `ip-api` without a key reads as keyless ipinfo, with one warning per process. ipgeolocation needs a key (without one it resolves nothing). The lookup never uses plain http. An installation that stored `ip-api` without a key now gets real geo answers from ipinfo with no action; to use ip-api, set its key. The keys are declared in `user_session.setting.keys.ts` with `loginAnomalyResponse` / `loginAnomalyVelocityKmh`, which are read per tenant and kept off every page. MS-35: they can only keep or tighten the login-risk check: `loginAnomalyResponse` is `step_up` (default) or `deny`, and a stored `alert_only` (removed) or any other value reads as `step_up`; `loginAnomalyVelocityKmh` is capped at 900 km/h (the default), so a stored larger value reads as 900 (values below 100 or not a number read as the default).

**The one login-anomaly detector (phase 55 00.4).** `user_session.login-risk.service.ts` `assessLogin` judges every sign-in against the user's previous session: impossible travel, a Tor exit, a proxy or VPN, a new country, a new address (`new_ip`) and a new browser / OS (`new_device`; the version never counts). `createSession` reports it ONCE (`reportLoginAnomaly`): one `auth.login_anomaly` row at the severity its reasons earn (`loginAnomalySeverity`: high for impossible travel, Tor or a deny, medium for a new country / proxy / VPN, low for a new address or device alone) and one `security.login_anomaly` webhook, denied sign-ins included. user_security's `recordLoginAttempt` no longer judges the sign-in (it used to send the webhook a second time). The per-request country change (tenant_session `tenant.session.geo_anomaly`) stays its own signal. A sign-out (`deleteSessionByAccessToken`) is audited `auth.logout`.

Its session lifetimes are not its own settings: its per-tenant behavior is driven by `AuthPolicyService` (`modules/auth/auth.policy.service.ts`), read via `getSessionPolicy(tenantId)` / `getAccessPolicy(tenantId)`. The relevant keys are documented under *Tenant Variability* below. JWT secrets and token TTLs come from env (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`); session record / cache TTLs come from `SESSION_EXPIRY_MS` (default 7 days) and `SESSION_CACHE_TTL` (default 1800s).

---

## Security

- Tokens are stored **hashed** (SHA-256) — the raw access/refresh tokens never touch the DB, and `SafeUserSession` omits `accessToken`, `refreshToken`, and `deviceFingerprint`.
- **Refresh-token reuse detection**: if a presented refresh token no longer matches the stored hash, all of the user's sessions are purged and `REFRESH_TOKEN_REUSED` is thrown.
- **Device-fingerprint binding**: when a fingerprint is supplied, both `verifyAccessToken` and `getSession` reject a mismatch (`DEVICE_FINGERPRINT_MISMATCH`).
- **OTP gating**: a session with `otpVerifyNeeded` cannot be resolved (or refreshed) until verification, unless explicitly bypassed.
- **Idle timeout**: enforced via a Redis `session:idle:<id>` key (TTL = `idleTimeoutMinutes`) plus a DB-level grace window against `updatedAt`.
- **Absolute lifetime ceiling**: a session record can never outlive `createdAt + absoluteMaxHours` (or `createdAt + rememberMeMaxHours` for a "remember me" session), even across refreshes. A Fleet ID session's deadline is additionally `createdAt + SessionMeta.fleetId.maxHours`.
- **Admin actuators (phase 55 00.6)** (`user_session.admin.service.ts`): what an administrator or the firewall does to ANOTHER person's sessions, each audited with the acting administrator (or none and `source: 'firewall'`): `revokeUserSessionsByAdmin` (all, or one workspace's), `revokeUserSessionByAdmin`, `forceSessionStepUp` / `clearSessionStepUp`, `flagPasswordChangeRequired`; and `sessionIdsOfUser` (ids of every session row of the person, whatever its status, expiry or idleness: the firewall's privacy erasure, phase 55 D55-18). Callers own the authorization and the ranks (routes: `user` for the platform, `auth` for `DELETE /api/members/[memberId]/sessions` in a workspace).
- **Refresh-token reuse signal (phase 55 02 §2.3, D55-34)**: when `refreshTokens` meets a rotated refresh token outside the grace window it ends every session of the person (as before) and hands the AI firewall one `user_session.refresh_reused` signal through `emitSecuritySignal` (synchronous, never throws, never waits): actor the person, subject the session, the number of sessions ended; ids only, never a token. Registered in `user_session.firewall-signals.ts`; the session-hijack detector's strongest evidence.
- **Forced step-up** (`SessionMeta.stepUpRequired`, `user_session.step-up-flag.ts`): `authenticateUserByRequest` refuses such a session 401 `SESSION_STEP_UP_REQUIRED` with `details.stepUp = { purpose: 'auth.session.step_up', windowSeconds }` on every route but the step-up, the session read and the one-time-code step (`SESSION_STEP_UP_PERMISSIONS` in auth_abac); checked after the OTP step and before the password-change step. The session is not ended. A step-up that succeeds on the session clears it (`finishStepUp`); the browser client fires `SESSION_STEP_UP_EVENT` and auth's shell banner opens the dialog. Impersonation, break-glass and pending sessions are never flagged (409). A 404 here is `TARGET_SESSION_NOT_FOUND`, never `SESSION_NOT_FOUND` (which makes the browser refresh its own token).

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Issues, stores, verifies, refreshes and revokes JWT-backed user login sessions in the shared system DB; sessions have no tenantId column, but session lifetime/idle/single-session behavior is gated per request tenant via AuthPolicyService settings.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `sessionAbsoluteMaxHours` | number | `8` | tenant | Absolute ceiling on a session's total lifetime (hours); createSession caps sessionExpiry at min(SESSION_EXPIRY_MS, absoluteMaxHours) and refreshTokens kills the session past createdAt+absoluteMaxHours. | `user_session.crud.service.ts` |
| `sessionRememberMeMaxHours` | number | `720` | tenant | Absolute ceiling for a session created with **"remember me"** ticked at login (`SessionMeta.rememberMe`). createSession then caps at `min(REMEMBER_ME_SESSION_EXPIRY_MS, rememberMeMaxHours)` and the refresh path anchors its deadline on this instead of `absoluteMaxHours`. Env default `AUTH_SESSION_REMEMBER_ME_MAX_HOURS`. | `user_session.crud.service.ts` / `user_session.auth.service.ts` |
| `sessionIdleTimeoutMinutes` | number | `30` | tenant | Idle-timeout window; sets the Redis session:idle:<id> TTL so a session expires after this many minutes of inactivity (enforced in getSession and seeded in createSession). | `user_session.crud.service.ts` |
| `singleSessionOnly` | boolean | `false` | tenant | When true, the session cap is 1: createSession ends every prior session of the user in this tenant before issuing the new one (MS-36). | `user_session.crud.service.ts` |
| `maxConcurrentSessions` | integer | unset (the platform default, 10) | tenant (tenant_session's key) | The session cap N (a tenant may only lower the platform default: a higher number, unset, 0 or not a whole number reads as 10, D28): createSession ends the user's oldest sessions in this tenant beyond N - 1 before issuing the new one (MS-36). | `user_session.crud.service.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Per-tenant behavior

- `user_session.crud.service.ts:createSession` — Calls AuthPolicyService.getSessionPolicy(tenantId) and getAccessPolicy(tenantId): per-tenant absoluteMaxHours caps the new session's expiry, idleTimeoutMinutes sets the initial Redis idle-key TTL, and `enforceSessionCap` applies the session cap (below).
- `user_session.crud.service.ts:getSession` — Calls getSessionPolicy(tenantId); per-tenant idleTimeoutMinutes determines the Redis idle-key TTL and the DB-level idle grace window, so the same access token can expire from inactivity sooner/later depending on the tenant.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| refreshTokens computes the absolute-lifetime deadline from AuthPolicyService.getSessionPolicy() called WITHOUT a tenantId, so token refresh always uses the platform/default sessionAbsoluteMaxHours instead of the session owner's tenant policy. | `user_session.crud.service.ts:refreshTokens` | Inconsistent with createSession/getSession which pass tenantId; a tenant that tightens sessionAbsoluteMaxHours has its ceiling silently bypassed on refresh. The tenant context (or session's tenant) should be threaded through so the same per-tenant policy already in settings is honored on refresh. | — |
| Session record TTL is the global SESSION_EXPIRY_MS (env, default 7 days) and the cache TTL is global env SESSION_CACHE_TTL; only the absolute-max cap is per tenant. | `user_session.crud.service.ts:SESSION_EXPIRY_MS` | A tenant cannot set its own baseline session duration (only an upper cap via sessionAbsoluteMaxHours); the underlying refresh-window duration is shared across all tenants. Plausibly should be a per-tenant override for tenants wanting shorter default sessions without lowering the absolute cap. | `sessionDurationMs` |

### Platform/root-only settings (not per-tenant)

Configured once at the root tenant; identical for all tenants:

- `jwtAccessTokenSecret` — Platform JWT signing config; tokens are signed/verified with global env secrets (ACCESS_TOKEN_SECRET) in user_session.token.service.ts, not per tenant.
- `jwtAccessTokenExpiresIn` — Global access-token TTL (env ACCESS_TOKEN_EXPIRES_IN, default 1h) used for all tenants when signing access tokens.
- `jwtRefreshTokenExpiresIn` — Global refresh-token TTL (env REFRESH_TOKEN_EXPIRES_IN, default 7d) used for all tenants when signing refresh tokens.

---

## Revocations and their session-ending orders (D249)

Every way a session ends on purpose (logout, sign out other devices, log out everywhere and the password change behind it, the cap,
device replacement, the pending-sign-in trim, the admin and firewall actions, break-glass, Fleet ID back-channel logout, a moved
tenant's sessions) goes through `revokeSessions` (`user_session.revocation-tx.ts`): the rows are found and deleted in ONE transaction
in which `session_end` records the sessions' session-ending orders (`recordSessionEndInTx`, point `session_end:order_source`: the
websocket drops of `websocket_session`, a module this one cannot depend on). Then the cache keys are cleared, the orders delivered
(the relay has them after a crash), and `user_session:session_revoked` told, each session carrying `sessionEndOrderedBy` (the modules
whose orders are recorded; their hooks skip it). A broken order source never blocks a revocation: it is left out, and its hook records
after the commit, with the revocation outbox behind it. docs/audits/2026-11-03-redis-outage.md §3.2.

## Dependencies

Requires: `db`, `redis`, `env`, `session_end` (the in-transaction orders), `user`, `user_agent`. Reads per-tenant policy from `auth` (`AuthPolicyService`); consumes `user` / `user_security` types and `tenant_member` role enum (impersonation metadata).
