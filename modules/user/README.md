# User Module

Core system user management: CRUD operations, password hashing with bcrypt, role/status, and Redis caching on the login hot path. Users are platform-wide (no `tenantId`) and managed only by root-tenant admins. Foundation for every auth and tenancy flow.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `User` | `users` | Platform-wide user account (email, hashed password, phone, role, status, email-verification + soft-delete timestamps); on a Fleet ID node also a shadow user (`identitySub`, `emailReleased`, no password) |

System-scoped — the `User` entity has **no `tenantId` column**, so it lives in the **system DB** and is never partitioned per tenant. Soft deletes use TypeORM's `@DeleteDateColumn` (`deletedAt`). `email` is unique and indexed; `phone` is indexed.

---

## Files

| File | Purpose |
|---|---|
| `user.service.ts` | Core: `create`, `getAll`, `getById`, `getByEmail`, `update`, `delete`, `invalidate` |
| `user.types.ts` | `User`, `SafeUser`, `UpdateUser` types + Zod schemas (`UserSchema`, `SafeUserSchema`, `UpdateUserSchema`) |
| `user.dto.ts` | Request/query Zod DTOs (create, update, list, get, delete) |
| `user.enums.ts` | `UserRoleEnum`, `UserStatusEnum` (+ `UserRole`, `UserStatus` types) |
| `user.messages.ts` | Error/success message string enum |
| `user.seed.ts` | Demo seed — 3 system-scoped users covering every role + status |
| `entities/user.entity.ts` | TypeORM entity (`users` table) |
| `user.shadow.rules.ts` | Fleet ID shadow-user rules: subject shape, the `fid+<hash>@fleet.invalid` placeholder, when a released e-mail may sit on the row (F10) |
| `user.shadow.service.ts` | `upsertShadowUser`: the just-in-time shadow user of a verified Fleet ID login (one row per subject, never linked by e-mail) |
| `migrations/001_users_identity_shadow.sql` | `identitySub` (unique, partial), `emailReleased`, `password` nullable, `ck_users_credential_or_identity` |
| `module.json` | Module manifest (deps: `db`, `env`, `logger`, `common`) |

---

## Roles

| Role | Meaning |
|---|---|
| `USER` | Standard user (default) |
| `ADMIN` | Elevated user. A root-tenant `ADMIN` is effectively a super-admin |

`userRole` defaults to `USER` on create.

## Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Normal access (default) |
| `INACTIVE` | Disabled |
| `SUSPENDED` | Suspended — transitioning into this status fires a `user.suspended` webhook |

`userStatus` defaults to `ACTIVE` on create.

---

## Fleet ID shadow users (FID-07)

On a fleet node whose people log in through Fleet ID (docs/phases/02-fleet/12-fleet-identity.md section 4.2), a person is a **shadow user**: the row
carries the pairwise subject the hub issued for this node (`identitySub`, decision F14) and **no password** (`password` is NULL; the CHECK
`ck_users_credential_or_identity` requires one of the two, so a local account never loses its password by accident). `email` is the person's real
address only when the hub released it (decision F10: an accepted workspace membership on this node plus the person's agreement, `email_verified`
true, and the tenant being logged into did not opt out); otherwise it is the undeliverable placeholder `fid+<32 hex of sha256(sub)>@fleet.invalid`.

`upsertShadowUser({ sub, email, emailVerified, tenantAllowsRelease })` is the only writer of `identitySub`: one row per subject (concurrent first
logins insert once), role `USER`, nothing from the identity provider but the subject and the released address. It never links by e-mail: a
released address that another row holds leaves the shadow on its placeholder and answers `emailConflict`. A shadow that is not ACTIVE or is
soft-deleted is refused (`SHADOW_INACTIVE`). A password check against a shadow fails like a wrong password, and `erase` clears the subject.

---

## SafeUser vs User

`User` includes the hashed `password` (NULL for a shadow user) and the soft-delete date (`deletedAt`) — never return this from API responses. `SafeUser` omits both and optionally carries an attached `userProfile`; it is safe to serialize. `getByEmail` returns the full `User` (hashed password included) because it backs the login/auth hot path; every other read returns `SafeUser`.

---

## Usage

```typescript
import UserService from '@/modules/user/user.service';

// Create — password hashed automatically (bcrypt, 10 rounds)
const user = await UserService.create({
  email: 'alice@example.com',
  password: 'secret123',
  userRole: 'USER',          // optional, defaults to 'USER'
});

// Read
const safe = await UserService.getById(userId);           // SafeUser (throws if missing)
const full = await UserService.getByEmail(email);         // User | null (login hot path)
const { users, total } = await UserService.getAll({ page: 0, pageSize: 10, search });

// Update (email/phone/role/status)
await UserService.update({ userId, data: { phone: '+905551234567' } });

// Hard delete (also clears caches + fires user.deleted)
await UserService.delete(userId);
```

---

## API Routes

All routes are mounted under the root tenant and require **root-tenant admin** scope (`authenticateAdminRequest`); requests are rate-limited via `Limiter`.

```
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users
POST   /tenant/00000000-0000-4000-8000-000000000000/api/users
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]
PUT    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/tenants
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/impersonation-sessions
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/security-lock
POST   /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/security-lock
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/security-lock
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/sessions
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/sessions
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/sessions/[sessionId]
POST   /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/sessions/[sessionId]/step-up
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/sessions/[sessionId]/step-up
GET    /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/trusted-devices
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/trusted-devices
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/trusted-devices/[deviceId]
POST   /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/must-change-password
DELETE /tenant/00000000-0000-4000-8000-000000000000/api/users/[userId]/must-change-password
```

| Route | Description |
|---|---|
| `GET /users` | Paginated list (`page`, `pageSize`, `search` by email); each row carries `rootMemberRole` / `rootMemberStatus` (the root-tenant membership, any status; `null` = none, field absent = unknown, which the UI treats as privileged) |
| `POST /users` | Create user (`CreateUserRequestSchema`) |
| `GET /users/[userId]` | Fetch a single `SafeUser`, with `rootMemberRole` / `rootMemberStatus` as on the list (left out when the lookup fails) |
| `PUT /users/[userId]` | Update email/phone/role/status (`UpdateUserRequestSchema`) |
| `DELETE /users/[userId]` | Delete user |
| `GET /users/[userId]/tenants` | List the user's tenant memberships (`TenantMemberService.getUserTenants`) |
| `GET /users/[userId]/impersonation-sessions` | List the user's impersonation sessions (from `user_session`); `page`, `pageSize`, `activeOnly` |
| `GET /users/[userId]/security-lock` | The account's SECURITY lock while it holds (`{ locked, lock: { lockedAt, until, reason, lockedBy, source } }`); permission `user.users.security_lock` (phase 55 00.1) |
| `POST /users/[userId]/security-lock` | Lock (`SecurityLockRequestSchema`: exactly `{ reason, until? }`): every sign-in method refused, every live session ended, audited critical, the person mailed. Not one's own account; a root OWNER's or platform admin's only by an ACTIVE root OWNER |
| `DELETE /users/[userId]/security-lock` | Unlock (optional `{ reason }`). The guessing lock (failed passwords) is `POST /users/[userId]/unlock` and the two never lift each other |
| `GET /users/[userId]/sessions` | The person's live sessions in every workspace (`user.users.sessions_read`, phase 55 00.6) |
| `DELETE /users/[userId]/sessions` | End every session of the person (`user.users.sessions_revoke`, optional `{ reason }`); audited `user_session.revoked_by_admin` |
| `DELETE /users/[userId]/sessions/[sessionId]` | End one session of the person (404 for a session that is not theirs) |
| `POST /users/[userId]/sessions/[sessionId]/step-up` | Ask that session to prove a second factor again (`user.users.sessions_step_up`): every request of it answers 401 `SESSION_STEP_UP_REQUIRED` with `details.stepUp` until it does. 409 for an impersonation, break-glass or pending session and for a person with no factor that can step up |
| `DELETE /users/[userId]/sessions/[sessionId]/step-up` | Lift it (the undo) |
| `GET /users/[userId]/trusted-devices` | The person's trusted devices, never the token hash (`user.users.trusted_devices_read`) |
| `DELETE /users/[userId]/trusted-devices[/deviceId]` | Revoke all of them, or one (`user.users.trusted_devices_revoke`); audited `security.trusted_device_revoked_by_admin` |
| `POST /users/[userId]/must-change-password` | The person must choose a new password at the next sign-in and on every live session now (`user.users.force_password_change`); 409 `NO_LOCAL_PASSWORD` for an account without one. `DELETE` lifts it |

Every write above, and since phase 55 00.6 also a platform role change (`PUT /users/[userId]` with a new `userRole`), a platform-admin creation (`POST /users` with `userRole: 'ADMIN'`), `POST /users/[userId]/reset-2fa` and both security-lock writes, is made under the acting administrator's strict step-up (`requireActionStepUp`, purpose = the route's permission, target = the person, grant of the root tenant), asked after the rank rules and before the effect. The ranks of the actuators are a suspension's (`assertMayActOnAccount`: not oneself, not an erased account, an outranking account only by an ACTIVE root OWNER). The platform user page shows the sessions and trusted devices (kui DataTable) with these actions behind ConfirmDialog (`user-account-security.component.tsx`); `trusted-devices-table.component.tsx` is shared with the account page.

---

## Webhook events

`user.service.ts` emits platform-wide webhooks via `WebhookService.dispatchPlatformEvent` (fire-and-forget) after each mutation:

| Method | Event(s) |
|---|---|
| `create` | `user.created` |
| `update` | `user.updated`, plus `user.suspended` when status transitions into `SUSPENDED` |
| `delete` | `user.deleted` |

These route to root-tenant webhooks. See `modules/webhook/README.md`.

---

## Caching

Users are cached in Redis (TTL = `SESSION_CACHE_TTL`, default 5 min):

| Key | Returns | Used by |
|---|---|---|
| `user:id:{userId}` | `SafeUser` | `getById` |
| `user:email:{email}` | `User` (with hashed password) | `getByEmail` — login hot path |

Emails are lower-cased before keying. `update`, `delete`, and `invalidate()` clear both keys. When email changes during `update`, **both** the old-email and new-email keys are invalidated.

### Cross-module invalidation

Password changes happen outside this module. Any service that mutates `user.password` (e.g. `auth.password.service.ts`) **must** call `UserService.invalidate({ userId, email })` afterward — otherwise the cached `getByEmail` row will still authenticate against the old password until TTL expires.

Already wired: `auth.password.service.resetPassword`. New writers must follow the same pattern.

### Stampede + negative cache

- **TTL jitter** (`jitter()`) on every cache write.
- **In-process single-flight** (`singleFlight`) dedupes concurrent loaders for the same key.
- **Negative cache** on `getByEmail`: unknown emails are cached as `__not_found__` for up to `min(60s, TTL)` — blunts email-enumeration / login-stuffing. `create` clears the negative key so a brand-new user can log in immediately.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

No per-tenant variability — Core system user management (CRUD, authentication, role/status) with no tenant variability; all users are platform-wide and accessible only to root-tenant admins.

---

## Dependencies

Requires `db`, `env`, `logger`, `common`. Also uses `redis` (caching/single-flight), `bcrypt` (password hashing), and `webhook` (`WebhookService.dispatchPlatformEvent`). The `[userId]/tenants` route delegates to `tenant_member`, and `[userId]/impersonation-sessions` reads from `user_session`.

---

## Tasarım notları (eski Final Faz 11 backlog'undan, 2026-09-11)

- **Son giriş zamanının tek kaynağı `user_security`'dir.** `lastLoginAt` / `lastLoginIp` / `lastLoginDevice`
  orada `recordLoginAttempt` ile yazılır ve dormant-hesap taraması (`auth.credential.lifecycle.service`)
  onu okur. Backlog "son giriş damgasını `user` tutsun" diyordu; aynı olguyu `users`'a ikinci bir kolon
  olarak eklemek iki yazılabilir kaynak üretir (DUP-07'deki `users.locale` şekli) — eklenmez. Oturum
  başına "son etkinlik" ayrı bir sorudur ve `user_session`'ındır.
