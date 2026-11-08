# Tenant Session Module

Tenant-scoped authentication and authorization for API routes and server actions. Resolves a tenant and the requesting user's membership from the per-tenant DB, validates tenant/member status, enforces the required role against a fixed role hierarchy, and caches the resolved session in Redis (default 5 minutes) with `sessionVersion`-based staleness detection.

---

## Entities

This module owns no tables. It reads two entities from the **per-tenant DB** (and the shared catalog DB for membership enumeration):

| Entity | Table | Description |
|---|---|---|
| `Tenant` | `tenant` | Resolved from `tenantDataSourceFor(tenantId)`; status (`tenantStatus`) is validated. Owned by the `tenant` module. |
| `TenantMember` | `tenant_member` | The requesting user's membership row: `memberRole`, `memberStatus`, `sessionVersion`. Owned by the `tenant_member` module. |

`getUserTenants` additionally reads `TenantMember` rows from the **shared catalog DataSource** (`getDataSource()`) to enumerate a user's memberships before re-reading each `Tenant` from its own per-tenant datasource.

---

## Service / Responsibilities

`TenantSessionService` (`tenant_session.service.ts`) — static methods only:

| Method | Responsibility |
|---|---|
| `authenticateTenantMembership({ user, tenantId, requiredRole? })` | Main entry point. Returns `{ tenant, tenantMember }` after validating tenant status, member status, and role. Checks the Redis cache first (with a `sessionVersion` recheck); on miss/stale, fully re-fetches and re-caches. Throws on not-found / inactive / suspended / pending / insufficient role. |
| `hasRequiredRole(memberRole, requiredRole)` | Role check against `ROLE_HIERARCHY = ['OWNER', 'ADMIN', 'USER']` — lower index satisfies a higher-or-equal requirement. |
| `getTenantById(tenantId)` | Reads the `Tenant` from the per-tenant datasource; returns `SafeTenant \| null`. |
| `getTenantMembership(tenantId, userId)` | Reads the non-deleted `TenantMember` from the per-tenant datasource; returns `SafeTenantMember \| null`. |
| `validateTenantStatus(tenant)` | Throws if `tenantStatus` is `INACTIVE` or `SUSPENDED`. |
| `validateMemberStatus(tenantMember)` | Throws if `memberStatus` is `INACTIVE`, `SUSPENDED`, or `PENDING`. |
| `getUserTenants(userId)` | Lists all tenants where the user is an `ACTIVE`, non-deleted member **and** the tenant itself is `ACTIVE`. |
| `clearTenantCache(userId, tenantId)` | Deletes the single cached session key. |
| `clearUserTenantCaches(userId)` | Deletes all cached sessions for a user across tenants. |

All return shapes are Zod-parsed (`SafeTenantSchema` / `SafeTenantMemberSchema`), so internal columns never leak to callers. Error strings come from `tenant_session.messages.ts` (`TenantAuthMessages`).

### Next.js request wrapper

The request/server-action surface (`authenticateTenantByRequest`, `authenticateRootTenantAdmin`, plus pass-throughs to `getUserTenants` / `clearTenantCache` / `clearUserTenantCaches`) lives in `TenantSessionNextService` at `server/tenant_session.service.next.ts`; it resolves the user/tenant from the request and delegates the authz decision to `TenantSessionService.authenticateTenantMembership`. Consumers import `@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next`; manifest-declared API routes are dispatched by `app/tenant/[tenantId]/api/[...slug]/route.ts`.

---

## Caching

Sessions are cached in Redis per `(userId, tenantId)` pair under key `tenant:member:${userId}:${tenantId}` for `TENANT_CACHE_TTL` (the `env.TENANT_CACHE_TTL` value, default `60 * 5` = 300s). On a cache hit the service does a lightweight DB read of just `sessionVersion`; if it differs from the cached value the entry is evicted and the session is fully re-fetched, so role/status revocation propagates within the TTL (immediately on the next request if `sessionVersion` was bumped). The required-role check is re-applied even on a cache hit.

---

## Usage

```typescript
import TenantSessionService from '@/modules/tenant_session/tenant_session.service';

// Require at least USER membership in this tenant:
const { tenant, tenantMember } = await TenantSessionService.authenticateTenantMembership({
  user,        // SafeUser
  tenantId,
  requiredRole: 'USER',
});

// Require ADMIN:
await TenantSessionService.authenticateTenantMembership({ user, tenantId, requiredRole: 'ADMIN' });

// List every ACTIVE tenant the user belongs to:
const tenants = await TenantSessionService.getUserTenants(user.userId);
```

---

## Settings

Setting keys are declared in `tenant_session.setting.keys.ts` as `TENANT_SECURITY_KEYS` (`TenantSecuritySettingKeySchema`): `twoFactorRequired`, `sessionTimeout`, `maxConcurrentSessions`, `ipWhitelist`, `ipBlacklist`, the five `tenant_session.policy.ts` reads. They are owned by this module in tenant_setting.key-owners.ts (`tenant_session.settings.read` / `.update`, ADMIN floor); all but `sessionTimeout` are OWNER-only. MS-39 (2026-10-27) dropped the eight it declared and nothing read here (`maxLoginAttempts`, the `password*` keys, `ssoEnabled` / `ssoProvider` / `ssoConfig`).

**Settings → Sign-in Policy** (`/admin/settings/sign-in-policy`, guarded by `tenant_session.settings.read` + `tenant_setting.config.read`): require two-step verification for every member (the page asks with a ConfirmDialog and refuses unless the saver has a second factor; the server refuses it unless the saving session proved one, tenant_setting.two-factor.ts) and the IP allow / deny lists (the server refuses a list that would shut out the saver's own address, tenant_setting.ip-lists.ts). Migration 001 gives every stored role that held `tenant_setting.config.read` / `.update` the new ids.

**This module reads `ipWhitelist` and `ipBlacklist` itself (see *Tenant IP allow/deny lists* below); it declares the others but does not read them.** They are the security-policy surface consumed by the `auth` module's `auth.policy.service.ts` (password/session/lockout/access policies, resolved as a ROOT system value with optional per-tenant override). This module's own cache lifetime is the global `env.TENANT_CACHE_TTL` instead of the `sessionTimeout` setting — see *Tenant Variability*.

### Tenant IP allow/deny lists (enforced since 2026-10-18)

`ipWhitelist` and `ipBlacklist` take IPv4 and IPv6 addresses and CIDR blocks, separated by commas, spaces or newlines.
`assertIpAllowed` (`tenant_session.policy.ts`) refuses an address inside the blacklist, then, when a whitelist is set,
any address outside it, with **403 `TENANT_IP_NOT_ALLOWED`** and the same message either way (a caller cannot tell
which list refused it). A request with no usable client address passes a
blacklist and is refused by a whitelist (fail closed). If the settings cannot be read at all, the check passes (fail
open, as before). The lists come from SettingService's cached per-tenant map (one Redis GET, no database read when
warm). **Unlike other settings they never fall back to ROOT's value:** ROOT's lists guard the ROOT console only, and a
tenant without its own lists has none.

- **Where:** `authenticateTenantByRequest` checks every member and tenant-flow impersonation request once the
  membership / role decision has passed, so a non-member or under-role caller keeps its audited denial
  (`recordNotMemberDenial`, `PERMISSION_DENIED`) and learns nothing about the lists; the dashboard display principal (`resolveDisplayContext`) checks every screen request after the tenant ACTIVE check.
  `authenticateTenantMembership` still checks it when a caller passes a `context` (no caller does).
- **Client IP:** `trustedClientIp` (`tenant_session.client-ip.ts`) reads X-Forwarded-For only, through
  `TRUSTED_PROXY_HOPS` trusted proxies (env, default 1): the entry that many places from the right, so a value a client
  wrote further left is never used; `0` ignores the header. X-Real-IP, CF-Connecting-IP and the like are not read (the
  node edge drops them). Deployments behind more than one appending proxy must set the hop count.
- **Needs a proxy in front.** The lists are only as safe as the proxy that writes X-Forwarded-For. An app reachable
  directly (the shipped `docker-compose.yml` publishes `app` on :3000 with no proxy) has no safe setting: Next fills the
  header from the socket only when the request has none, so a client sends `X-Forwarded-For: <an allowed address>` and
  is let in (or past the blacklist); `TRUSTED_PROXY_HOPS=0` ignores the header, so every whitelist then refuses
  everyone. Put a proxy that overwrites or appends to the header (the node Caddyfile does) in front before setting a list.
- **Exempt:** a platform admin (`userRole === 'ADMIN'`) wherever the global-admin bypass exists (not on a fleet node),
  including on the ROOT console where routes turn the bypass itself off; an impersonation started by such an admin
  (the system flow); and an open break-glass session minted for this tenant. So a wrong list cannot lock the platform
  out of the tenant it has to repair. One function decides it (`exemptFromIpLists`, `tenant_session.ip-exempt.ts`), and
  every `TenantAuthResult` reports the answer as `ipListsExempt`. **Not exempt:** members, display
  links, an impersonation a tenant ADMIN / OWNER started inside the tenant (the tenant flow of `auth_impersonation`:
  that member's own access under another role), a break-glass session minted for another tenant, and, on a fleet node,
  platform admins (a ROOT list there is recovered through break-glass).
- **Writing the lists** (`tenant_setting`): every entry must be an IPv4 / IPv6 address or CIDR block, or the write is
  refused 400 (`validateSettingValue`). The settings routes (`/api/settings`, `/api/admin-settings`) also refuse 409 a
  change that would put the writer's own address (read the same way) outside the lists
  (`tenant_setting.ip-lists.ts`); a caller the lists do not apply to (`ipListsExempt`: the exemptions above, so also a
  break-glass operator) may set lists that exclude it. Not guarded: a tenant
  ADMIN can still set lists that exclude the OWNER. Under maker-checker a list change is parked, and the guard runs
  again at approval against the APPROVER's request and exemption (`assertSettingChangeApprovable`, the approval's
  APPROVE guard): a list that would refuse the approver is refused 409 and stays pending.
- **Not covered:** login, OTP and SSO do not check the lists (a refused member can sign in, then every tenant request
  is refused); API-key requests (SCIM, marketplace developer keys, integrations) do not meet them either: a key has its
  own allowlists (per key, and the tenant default `apiKeyTenantIpAllowlist`), read from the same trusted
  X-Forwarded-For entry; an IP refusal on the member path writes no audit row of its own (the membership / role denials before
  it keep theirs). The other context-driven gates
  (`twoFactorRequired`, the breaker, geo) are still not switched on for this path.
- **`maxConcurrentSessions` is not enforced here (MS-36).** The per-request check (`assertConcurrentLimit`, a Redis set per
  member that answered 429 to the newest session over the cap) is removed. The key (still declared here) is enforced once,
  when a session is issued, by user_session's `enforceSessionCap` in the tenant signed into: the user's oldest sessions in
  that tenant end, the new sign-in gets in (see user_session's README). Since D28 the cap is always on: unset, 0 or not a whole
  number is the platform default of 10 (a tenant may only lower it), `singleSessionOnly` is 1.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Tenant-scoped session/authorization service that resolves a tenant and the requesting user's membership from the per-tenant DB, validates tenant/member status and role, and caches the result in Redis; tenant variability comes from per-tenant tenant/member data rather than from settings it reads itself.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `Tenant` | `tenant` | tenantStatus |
| `TenantMember` | `tenant_member` | memberRole, memberStatus, sessionVersion, externalId |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `tenant_session.service.ts:authenticateTenantMembership` — Authn/authz outcome is fully per-tenant: it resolves the Tenant and TenantMember from tenantDataSourceFor(tenantId), enforces tenant status (INACTIVE/SUSPENDED) and member status (INACTIVE/SUSPENDED/PENDING), and checks the member's role against the required role via ROLE_HIERARCHY. Each tenant has its own membership rows and statuses, so the same user can pass for one tenant and fail for another.
- `tenant_session.service.ts:authenticateTenantMembership` — Per-(tenantId,userId) Redis cache keyed `tenant:member:${userId}:${tenantId}`; staleness is detected per tenant by comparing the cached member's sessionVersion to the live per-tenant TenantMember.sessionVersion, so role/status revocation invalidates only that tenant's cached session.
- `tenant_session.service.ts:getTenantById / getTenantMembership` — Both read from the per-tenant data source (tenantDataSourceFor(tenantId)), so tenant and membership records are isolated per tenant.
- `tenant_session.service.ts:getUserTenants` — Enumerates a user's ACTIVE memberships from the shared catalog, then re-reads each Tenant from its own per-tenant datasource and includes only ACTIVE tenants — result set varies by each tenant's status.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Cache TTL for tenant membership sessions is a single global value (TENANT_CACHE_TTL from env, fallback 300s) | `tenant_session.service.ts — const TENANT_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60*5), used in redis.setex in authenticateTenantMembership` | Session/membership freshness is a security-sensitive, tenant-specific concern; a high-security tenant may want shorter session caching (faster revocation propagation) while others want longer for performance. Today it is global env-only and cannot vary per tenant. The module already declares a sessionTimeout key but does not read it here. | `tenantSessionCacheTtl` |
| Role hierarchy / privilege model is hardcoded as a fixed OWNER>ADMIN>USER array | `tenant_session.service.ts — ROLE_HIERARCHY and hasRequiredRole` | The set and ordering of tenant roles is identical for every tenant; tenants cannot define custom roles or a different privilege ordering. Likely intentionally global as a shared RBAC primitive, but flagged as a plausible per-tenant customization point if custom roles are ever needed. | — |

### Platform/root-only settings (not per-tenant)

None. Every key above is the tenant's own (`twoFactorRequired` and `sessionTimeout` fall back to ROOT's value when the
tenant has none; the IP lists never do). The keys this module used to declare for auth's policies are auth's own
(`lockoutMaxAttempts`, `passwordMinLength`, `passwordRequireUppercase`, `passwordRequireDigit`, `passwordRequireSpecial`).

---

## Dependencies

`requires`: `db`, `redis`, `user_session`, `tenant`, `env` (see `module.json`). Also reads the `tenant_member` entity/types and `TenantMemberRole` enum.
