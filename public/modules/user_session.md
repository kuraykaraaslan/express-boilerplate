# user_session

- **id:** `user_session`
- **tier:** identity
- **dir:** `modules/user_session/`
- **hasExpressLayer:** true

Session management with access/refresh token lifecycle. Supports device fingerprinting, multi-session tracking, impersonation metadata, and OTP verification flags.

## Services

- `user_session.cache.service.ts`
- `user_session.crud.service.ts`
- `user_session.service.ts`
- `user_session.token.service.ts`

## Entities

- `user_session.entity.ts`

## Enums

- `user_session.enums.ts`

## Message keys

- `user_session.messages.ts`

## Owned routes

- `system` DELETE `/system/user-session`
- `system` GET `/system/user-session`
- `system` DELETE `/system/user-session/all`
- `system` POST `/system/user-session/refresh`

## TypeORM entities

- `UserSession` (system) — `modules/user_session/entities/user_session.entity.ts`

## Express layer (modules_express/) surface

- `user_session/user_session.service.express` _(service.express)_

## README

# user_session module

Session management with access/refresh token lifecycle. Supports device fingerprinting, multi-session tracking, impersonation metadata, and OTP verification flags.

---

## Files

| File | Purpose |
|---|---|
| `user_session.service.ts` | Facade: delegates to sub-services |
| `user_session.token.service.ts` | JWT generation, rotation, verification |
| `user_session.cache.service.ts` | Redis session caching |
| `user_session.crud.service.ts` | Database CRUD for persistent sessions |
| `user_session.service.next.ts` | Next.js server action wrappers |
| `user_session.types.ts` | `UserSession`, `SafeUserSession` |
| `user_session.enums.ts` | `SessionStatus` enum |
| `user_session.messages.ts` | Error/success message strings |
| `entities/user_session.entity.ts` | TypeORM entity |

---

## Session Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Valid and usable |
| `EXPIRED` | Past expiry time |
| `REVOKED` | Manually invalidated |
| `REFRESHED` | Superseded by a new session after token rotation |

---

## Usage

```typescript
import UserSessionService from '@/modules/user_session/user_session.service';

// Create a new session after login
const session = await UserSessionService.create(userId, {
  ip: '1.2.3.4',
  userAgent: request.headers['user-agent'],
  fingerprint: deviceFingerprint,
});
// session.accessToken, session.refreshToken

// Verify an access token
const { userId, sessionId } = await UserSessionService.verifyAccessToken(token);

// Rotate tokens (refresh flow)
const newSession = await UserSessionService.refresh(refreshToken);

// Revoke (logout)
await UserSessionService.revoke(sessionId);

// Revoke all sessions for a user (force logout everywhere)
await UserSessionService.revokeAll(userId);
```

---

## Next.js Wrappers

```typescript
import { getSession, requireSession } from '@/modules/user_session/user_session.service.next';

// Returns session or null
const session = await getSession();

// Throws redirect to login if unauthenticated
const session = await requireSession();
```

---

## API Routes

```
GET    /api/user/sessions       — list active sessions
DELETE /api/user/sessions/[id]  — revoke a session
DELETE /api/user/sessions       — revoke all sessions
POST   /api/auth/refresh        — rotate tokens
```
