# Tenant Invitation Module

Tenant membership invitations via hashed email token. Admins send/revoke invitations; invitees preview, accept, or decline them. Pending invitations are auto-accepted when a new user registers (or signs in via SAML) with a matching email. Acceptance binds the user to `tenant_member` with the invited role, and every lifecycle transition fires a tenant webhook.

---

## Entities

| Entity | Table | DB | Description |
|---|---|---|---|
| `TenantInvitation` | `tenant_invitations` | tenant DB | One invitation per email token. Columns: `email`, `invitedByUserId`, `memberRole` (default `USER`), `token` (sha256 of the raw token, unique), `status` (default `PENDING`), `expiresAt`. Indexed on `tenantId`, `email`, `token`. |

Write and list paths resolve the per-tenant DataSource via `tenantDataSourceFor(tenantId)`, so rows are isolated by tenant. The two cache-backed point reads (`getById`, `getByToken`) query the system DataSource (`getDataSource()`).

---

## Invitation Status (`TenantInvitationStatusEnum`)

| Status | Meaning |
|---|---|
| `PENDING` | Sent, awaiting response |
| `ACCEPTED` | Invitee accepted and is now a member |
| `DECLINED` | Invitee declined |
| `REVOKED` | Admin cancelled the invitation (or it was superseded by a newer invite to the same email) |
| `EXPIRED` | Past `expiresAt` (default TTL: 7 days) |

`assertUsable` rejects any non-`PENDING`/expired invitation before accept/decline/preview.

---

## Service (`tenant_invitation.service.ts`)

| Method | Responsibility |
|---|---|
| `send(tenantId, invitedByUserId, { email, memberRole })` | Normalizes the email, rejects if the user is already a member, revokes any stale `PENDING` invites to the same email, mints a raw token + sha256 hash, persists a `PENDING` row with `expiresAt`, clears any negative cache for the new token, and dispatches `invitation.sent`. Returns the safe invitation **and** the one-time `rawToken` (the route emails it). |
| `preview(tenantId, rawToken)` | Public, unauthenticated lookup by token within the tenant. Asserts the invitation is usable and returns it plus `{ tenantId, name }` of the tenant. |
| `accept(tenantId, userId, userEmail, rawToken)` | Validates token, requires `userEmail` to match the invited email (one exception, FID-09: a Fleet ID shadow user whose address the hub has not released to this node holds only a placeholder address, F10, so for it the token alone is the proof; a shadow with a released address is held to the match), creates an `ACTIVE` `tenant_member` with `memberRole`, marks `ACCEPTED`, clears cache, dispatches `invitation.accepted`. |
| `decline(tenantId, userEmail, rawToken)` | Validates token + email match, marks `DECLINED`, clears cache, dispatches `invitation.declined`. |
| `revoke(invitationId, tenantId)` | Admin cancel; only `PENDING` invitations are revocable, marks `REVOKED`, clears cache, dispatches `invitation.revoked`. |
| `autoAcceptForEmail(userId, email)` | Best-effort: finds all non-expired `PENDING` invites for the email (system DB), creates membership where missing, marks each `ACCEPTED`, clears cache. Errors per-invitation are swallowed. |
| `getByTenantId({ tenantId, page, pageSize, status })` | Paginated, optionally status-filtered list of safe invitations for a tenant + total count. |
| `getById(invitationId)` / `getByToken(rawToken)` | Cached point reads (see *Caching*). |
| `hashToken` / `generateRawToken` | sha256 hashing and 32-byte random token helpers. |

`SafeTenantInvitation` omits the `token` column, so the token hash is never returned through the service or API.

---

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tenant/[tenantId]/api/invitations` | tenant ADMIN+ | List invitations (`?page=&pageSize=&status=`). |
| POST | `/tenant/[tenantId]/api/invitations` | tenant ADMIN+ | Send an invitation; asserts the `MAX_MEMBERS` feature, then emails the raw token via `sendInvitationEmail` (renders in `notification_mail`, sends through the notification dispatcher). |
| GET | `/tenant/[tenantId]/api/invitations/[invitationId]` | tenant ADMIN+ | Get a single invitation (404 if it belongs to another tenant). |
| DELETE | `/tenant/[tenantId]/api/invitations/[invitationId]` | tenant ADMIN+ | Revoke an invitation. |
| GET | `/tenant/[tenantId]/api/invitations/accept?token=` | public | Preview invitation + tenant info (no auth). |
| POST | `/tenant/[tenantId]/api/invitations/accept` | logged-in user | Accept via `{ token }`. |
| POST | `/tenant/[tenantId]/api/invitations/decline` | logged-in user | Decline via `{ token }`. |
| POST | `/tenant/[tenantId]/api/invitations/[invitationId]/accept` | logged-in user (ACCOUNT scope) | Accept **by id**, no emailed token — for a native app that listed the user's pending invitations (`GET /auth/me/tenants` → `invitations[]`, which carries no token). `tenantId` is the *inviting* tenant. Requires the caller's email to equal the invitation's **and** `emailVerifiedAt` (403 `INVITATION_EMAIL_NOT_VERIFIED` otherwise — holding the emailed token is the proof of the address, an id is not). Someone else's invitation answers 404, not a mismatch. Returns `{ message, tenantId, memberRole }`. |
| POST | `/tenant/[tenantId]/api/invitations/[invitationId]/decline` | logged-in user (ACCOUNT scope) | Decline by id; same rules. |

**ACCOUNT scope does not compare the token's tenant with the URL tenant** (the same is true of every `/auth/me/*` route), so a device token bound to tenant A can accept an invitation to tenant B. It still needs this module enabled for B. The new membership is *not* usable with the A token — sign in to B separately (`POST /auth/device/login` on B): a device holds one token per tenant.

The emailed link is `https://<tenant host>/auth/invitation/accept?token=<raw>` (and `…/decline?token=`), built by common's `absoluteTenantUrl`: the tenant's ACTIVE domain when tenant_domain contributes one (`common:tenant_origin`), else the platform host's `/tenant/{id}/…` form, so tenant_invitation does not require tenant_domain. To open it in the app, serve the association files (see `common/server/mobile-app-links` — `MOBILE_ANDROID_*`, `MOBILE_IOS_APP_IDS`); the app then passes `token` to `POST /invitations/accept`.

All routes pass through the shared `Limiter.checkRateLimit`. The invitation cap is enforced via the `tenant_subscription` feature `FEATURE_KEYS.MAX_MEMBERS` (current active-member count is asserted before sending).

---

## Usage

```typescript
import TenantInvitationService from '@/modules/tenant_invitation/tenant_invitation.service';

// Send an invitation (returns the one-time rawToken to email)
const { invitation, rawToken } = await TenantInvitationService.send(tenantId, adminUserId, {
  email: 'alice@example.com',
  memberRole: 'USER',
});

// Accept via token (from email link) — userEmail must match the invited email
await TenantInvitationService.accept(tenantId, userId, userEmail, rawToken);

// Revoke (only PENDING invitations)
await TenantInvitationService.revoke(invitationId, tenantId);

// List
const { invitations, total } = await TenantInvitationService.getByTenantId({
  tenantId, page: 1, pageSize: 20, status: 'PENDING',
});
```

---

## Auto-Accept on Registration

On registration, `AuthService` calls `TenantInvitationService.autoAcceptForEmail(userId, email)`, and the SAML JIT flow makes the same best-effort call after provisioning the user. It accepts every open, non-expired invitation for the email **only when the account has proven it owns the address** (`emailVerifiedAt` set, and the account's email matches). Auto-accept skips the emailed token, and neither a fresh signup nor an IdP assertion proves the address. Without this check, anyone who registered `victim@corp.com` first — or any tenant's IdP asserting it — joined every tenant that had invited it, with the invited role. An unverified invitee still joins through the emailed link: `accept` requires the token, and holding it is the proof.

**Follow-up (auth):** the register and SAML callers run before verification, so today auto-accept does nothing on those paths. Calling it from the email-verification success path would restore the convenience safely.

## Concurrency

Every decision is a conditional `PENDING →` claim. Of two concurrent decisions (accept vs revoke, two accepts, a sweep), exactly one wins; a live decision also requires the invitation to be unexpired.
- `accept` claims **before** creating the membership, which also releases the seat the invitation held. If the membership fails, the claim is released back to `PENDING`.
- `resend`/`remind` rotate the token with a conditional, column-only update. A whole-row save of a stale read used to write `PENDING` back over an accepted or revoked invitation, reviving it with a fresh, usable token.
- `send` is serialised per (tenant, email), so a new send supersedes the pending one and exactly one invitation stays usable.
- Token lookups (`getByToken`, auto-accept) are deliberate `withSystemRLS` reads; everything else goes through the tenant chokepoint.

---

## Caching

Invitations are cached in Redis (TTL = `INVITATION_CACHE_TTL`, from `env.TENANT_CACHE_TTL`, default 5 min):

| Key | Used by |
|---|---|
| `tenant_invitation:id:{invitationId}` | `getById` |
| `tenant_invitation:token:{sha256(rawToken)}` | `getByToken` |

`send` (when revoking stale PENDING invites for the same email), `accept`, `decline`, `revoke`, and `autoAcceptForEmail` all invalidate both keys for the affected invitation. Stale cache of an already-revoked or expired token would defeat the security guarantees, so any status transition clears the cache. `send` additionally clears any negative cache entry for the freshly-minted token.

### Stampede + negative cache

- **TTL jitter** (`jitter(...)`) on every cache write.
- **In-process single-flight** (`singleFlight`) dedupes concurrent loaders.
- **Negative cache** on `getByToken`: unknown tokens are cached as `__not_found__` for `NEGATIVE_CACHE_TTL` (= `min(60, INVITATION_CACHE_TTL)` seconds) — protects against token-guessing attacks on the public invite endpoint.

---

## Plan limits

`POST /invitations` clears three ceilings, all in `tenant_invitation.quota`:

- **`max_members`** — the seat ceiling, delegated to `tenant_member.seats`. This
  module contributes its pending invitations into
  `tenant_member:seat_reservation`, so an unclaimed invitation holds a seat and
  cannot be double-sold.
- **the paid seat allowance** — `assertSeatAllowance` from `tenant_member.seats`,
  the ceiling the direct add-member POST enforces, counted with the invitations
  already out (it used to be skipped here, so invitations got past a full
  allowance).
- **`max_invitations`** — how many invitations may be **outstanding** at once.
  Not invitations ever sent: that reading would bill a tenant forever for staff
  turnover, and an old company could not replace a leaver. Outstanding
  invitations are a recurring cost (a mail, and a live credential) and the
  ceiling frees itself as they are accepted, declined or expire.

Expired rows are excluded from the count even while they still read `PENDING` —
expiry is swept lazily, and letting an invitation nobody ever answered hold a
paid seat would turn a cron schedule into a billing limit.

`max_members` and `max_invitations` refuse only what a live plan **declares**, and both fail open; the paid seat allowance refuses (503) when its seller cannot answer.

## Security

- Tokens are random 32-byte hex (`generateRawToken`); only the sha256 hash is stored (`token` column) and looked up. The raw token is returned exactly once from `send` and never persisted or echoed back (`SafeTenantInvitation` omits `token`).
- `accept`/`decline` require the authenticated user's email to match the invited email (`INVITATION_EMAIL_MISMATCH`), so a forwarded link cannot be claimed by a different account.
- `send` rejects re-inviting an existing member and supersedes any prior `PENDING` invite to the same email (revoking it), preventing duplicate live tokens.
- All point reads use the negative cache to blunt token-guessing on the public preview/accept endpoint.

---

## Settings

None. The module had one tenant field, `invitationNegativeCacheTtlSeconds`, which was never read, and it was **removed on 2026-09-25** together with its settings page (`/admin/invitations/settings`), the gear button and the card on the settings hub. It cannot be per-tenant. The negative cache holds the answer for a token that does not exist, and `getByToken` runs on the system DataSource before any tenant is known (key `tenant_invitation:token:<hash>`). The TTL is a platform anti-token-guessing parameter (`NEGATIVE_CACHE_TTL` in `tenant_invitation.helpers.ts`). The `env:*` TTLs (`INVITATION_TTL_SECONDS`, `TENANT_CACHE_TTL`) are deployment config.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Manages per-tenant email-token membership invitations (send/accept/decline/revoke/list plus auto-accept on registration); invitation rows are tenant-scoped and webhooks fire per tenant, but all TTLs/limits are currently global env or hardcoded rather than per-tenant settings.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `TenantInvitation` | `tenant_invitations` | email, invitedByUserId, memberRole, token, status, expiresAt |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `tenant_invitation.service.ts:send/accept/decline/revoke` — All write/list paths resolve the per-tenant DB via tenantDataSourceFor(tenantId), so each tenant has its own isolated set of invitation rows; queries are scoped by tenantId.
- `tenant_invitation.service.ts:send/accept/decline/revoke` — Each lifecycle transition calls WebhookService.dispatchEvent(tenantId, 'invitation.*', ...), so webhook delivery (endpoints/secrets) is driven by the target tenant's webhook config.
- `tenant_invitation.service.ts:accept/autoAcceptForEmail` — On accept, TenantMemberService.create runs against the invitation's tenant with invitation.memberRole, granting membership in that specific tenant.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Invitation expiry window is a single global env value (7 days default) applied to every tenant. | `tenant_invitation.service.ts (INVITATION_TTL_SECONDS const, used in send())` | Tenants commonly want different invite link lifetimes (e.g. stricter security tenants want 24h); today it is deployment-wide env, not per tenant. | `invitationTtlSeconds` |
| Positive cache TTL for invitations is global env (TENANT_CACHE_TTL, 5 min default) shared across all tenants. | `tenant_invitation.service.ts (INVITATION_CACHE_TTL const, used in getById/getByToken)` | Intentionally global shared-infra caching tuning; listing for completeness but it is reasonable to keep deployment-wide rather than per-tenant. | — |

---

## AI firewall signals (phase 55 02.6)

The invitation path of a sign-up reaches the AI firewall (`server/tenant_invitation.firewall-emitters.ts`, registered in
`server/tenant_invitation.firewall-signals.ts`; this module writes no audit row of its own): `tenant_invitation.accepted` when an
invitation is accepted (`via` token, id or auto; the role; about the person, the invitation the subject), and
`tenant_invitation.token_refused` when the accept route (preview or accept) gets a token no invitation of the tenant has (tallied; about the
signed-in person, else the address bucket). Synchronous, never throw, never change an answer. The sign-up protections that apply to an
invited member are the account hold (auth) and the membership review (tenant_member).

## Dependencies

`db`, `tenant`, `tenant_member` (membership on accept), `notification_mail` (invite email), `user` (existing-user lookup), `env`, plus `redis` (caching) and `webhook` (lifecycle event dispatch). Invitation caps are enforced through `tenant_subscription` at the route layer.
