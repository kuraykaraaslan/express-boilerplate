# Api Key Module

Manages tenant-scoped API keys for programmatic authentication. Generates, hashes, and verifies keys with scopes and expiration tracking; creation is gated behind the `feature_api_keys` plan feature and isolated per tenant.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `ApiKey` | `api_keys` | One API key per row: `name`, `description`, SHA-256 `keyHash` (unique index), `scopes`, `permissions` (module permission ids, phase 48), `scopeReview` (marked for review, phase 48), `keyEnv` (`live`/`test`), `ipAllowlist` (subnets), `isActive`, `lastUsedAt`, `lastUsedIp`, `usageCount`, `successorKeyId` (rotation), `expiresAt`, `createdByUserId`, `isServiceKey`. Indexed by `tenantId`. |

Lives in the **shared database**, never in a tenant's own database (docs/phases/02-fleet F8, P9-7). `verify()` finds a key by its hash before any tenant is known (the row it finds is what names the tenant), so the lookup can only read one database; a key written into a tenant's dedicated database (`tenant_databases`) would never verify, and its revocation would never reach the row verify reads. The table holds only hashes, so nothing tenant-confidential is left behind on the shared database.

- Both entities (`ApiKey`, `ApiKeyScopeDefinition`) carry `@SharedDatabaseOnly()` (`db/server/db.shared-database.ts`); every service uses `withSharedTenantRepositoryFor` / `withSharedTenantTransactionFor`: the shared DataSource, with the tenant still set per transaction (RLS), the write fence and the async tenant context. Rows stay isolated by `tenantId`.
- The guard: `withTenantRepository` / `withTenantRepositoryFor` refuse these entities (`SharedDatabaseRoutingError`, `SHARED_DATABASE_ONLY`) whatever database the tenant lives in, and a tenant's own DataSource is built without them, so a query on it (also inside `withTenantTransactionFor`) fails and its dev schema sync never creates the tables. Tests: `api_key.shared-database.security.test.ts`, `db.shared-database.security.test.ts`, `db.shared-database.integration.test.ts` (real PostgreSQL).
- Cross-tenant reads (`verify`, the last-used write) keep `withSystemRLS`, which is the shared database too. The migration fan-out still creates the empty tables in dedicated databases (the module SQL is not per-entity); nothing reads or writes them there.

---

## Files

| File | Purpose |
|---|---|
| `api_key.service.ts` | Core logic: create, getById, list, update, delete, verify, key generation/hashing |
| `api_key.types.ts` | `ApiKey` / `SafeApiKey` zod schemas + types (`SafeApiKey` omits `keyHash`) |
| `api_key.dto.ts` | `CreateApiKeyDTO`, `UpdateApiKeyDTO`, `ListApiKeysDTO` |
| `api_key.enums.ts` | `ApiKeyScopeEnum` / `API_KEY_SCOPES` |
| `api_key.messages.ts` | Error/success message strings |
| `api_key.settings.fields.ts` | UI metadata for the settings page |
| `api_key.setting.keys.ts` | Setting-key Zod enum + named accessors |
| `api_key.seed.ts` | Demo-data seed (read/write, admin, SCIM, revoked keys) |
| `entities/api_key.entity.ts` | TypeORM entity |

---

## Key Concepts

- The raw key is shown **once** at creation — only its SHA-256 hash is stored (`keyHash`).
- Raw key format: `sk_{env}_{first 8 chars of tenantId}_{24 random bytes hex}` where `{env}` is `live` or `test`, derived from `NODE_ENV` (production/vercel → `live`, else `test`) or an explicit `environment` on create. Prevents test keys being mistaken for production ones.
- `SafeApiKey` omits `keyHash` and is the only shape returned to clients.
- Scopes control what the key can access; `verify` can optionally enforce a `requiredScope`.
- **Network pinning:** a key may declare an `ipAllowlist` of subnets (CIDR; a single host is a `/32`). Validation + matching is owned by [`@/modules/network`](../network/README.md) (`SubnetListSchema`, `ipMatchesAllowlist`). A tenant-wide default allowlist applies to keys that declare none. The caller's address for both is read like the tenant IP lists read it (`ipFromHeaders`: X-Forwarded-For through `TRUSTED_PROXY_HOPS` trusted proxies, the entry that many places from the right; X-Real-IP is not read), so a client-written entry cannot name an allowlisted address. The tenant's session `ipWhitelist` / `ipBlacklist` do not apply to API keys.
- **Lifecycle:** keys can be rotated (successor key + grace window), bulk-revoked for incident response, and swept on expiry. Per-tenant policy caps active-key count and max TTL, and can require an expiry.
- **Observability:** every call a key is let through bumps `usageCount` and records `lastUsedIp` (a caller that refuses some verified keys itself verifies with `deferUsage` and stamps through `recordUse` once it let the call through, so a refused call is not a use); a dormant key used from a new IP raises an anomaly audit event, once per key and address per hour; failed verifications are audit-logged; per-key rate limiting is enforced from the tenant default.

## Module permissions (phase 48)

A key may hold **module permissions**: permission ids of the manifests (`iot_device.devices.read`), picked on the create
screen a module at a time, one at a time, or as a module's "Read only" preset (docs/phases/48-api-key-scopes, lead decisions
D11–D14).

- **Where they work**: every module route guarded by `authorizeRequest` on the TENANT path. A request whose `Authorization`
  is `Bearer sk_live_…` / `sk_test_…` is judged only as that key (`auth_abac.guard.api-key.next.ts`, a cookie on the same
  request is ignored); ROOT, GLOBAL, ACCOUNT and GUEST routes never accept a key.
- **Who the key acts as**: its holder, the creator (or, for a service key whose creator left, the OWNER who marked it).
  The route sees the holder as `user` / `tenantMember`, `auth.apiKey` names the key, and `userSession` is a stand-in for
  the one request (`userSessionId` = the key id).
- **Ceiling (D12)**: on every call the key must hold the permission, the permission must still be key-grantable and its
  module enabled for the tenant, and the holder must hold it now: role floor (or a group / `config/access.ts` lift of an
  ADMIN floor), a route's own `requiredTenantRole`, then the PDP with the route's resource (tenant policies and
  `config/access.ts` removals apply, even in shadow mode). A key has no session methods, so a policy demanding `acr`/`amr`
  refuses it. `grantedPermissions` on a key's request answers within the key's own list.
- **Which permissions a key may hold** (`api_key.permissions.ts`): `USER` or `ADMIN` floor, tenant scope; never `OWNER`
  or `GUEST` floors, account-scope ones, or the identity and access modules (`api_key`, `auth`, `auth_*`, `account`,
  `notification_push`, `scim`, `tenant`, `tenant_member`, `tenant_session`, `user`, `user_session`).
- **Create and edit**: create takes only permissions the creator holds now (`api_key.grant.next.ts` asks
  `grantedPermissions`), of enabled modules; edit removes freely and adds only what the editor holds; scopes only narrow.
  `GET /api/api-keys/permission-catalog` lists what the caller may give, by module.
- **Existing keys (D14)**: migration 002 gives every older key an explicit empty permission list (no module route took a
  key before), keeps its scopes and sets `scopeReview`; the list page shows a banner, the key page a "Mark reviewed" action.
  Any permission or scope edit also clears the mark.
- **Expiry (D13)**: a new key expires 90 days out unless the caller names a date, never more than 365 days out (or the
  tenant's lower `apiKeyMaxTtlDays`), never in the past; a rotated key without expiry gets the 90 days on its successor.
- **Deactivation stamp (phase 55 D55-16)**: migration 003 adds the nullable `deactivatedAt`, set by `update` when it deactivates an
  active key and cleared when it reactivates one; never by the usage stamp (`recordUsage`), revoke-all or a rotation. Not in the
  API's key schema. The AI firewall's `api_key.revoke` reads it uncached (`activationOf`) and its undo reactivates only while the stamp is
  still the one its run wrote.

## Scopes

Scopes are the **integration scopes** of the machine routes (SCIM, observability, …), next to the module permissions.
`ApiKeyScopeEnum` / `API_KEY_SCOPES` (lowercase values):

| Scope | Access |
|---|---|
| `read` | Read-only operations |
| `write` | Create/update operations |
| `admin` | Full tenant admin access |
| `scim:read` | SCIM 2.0 (RFC 7644) read — IdP provisioning bearer tokens |
| `scim:write` | SCIM 2.0 (RFC 7644) write — IdP provisioning bearer tokens |

Service scopes (`ServiceScopeEnum`) are narrow machine credentials owned by another module; they are not coarse verbs and stay out of the admin picker, but they must be listed in `api_key.enums.ts` or a key holding one cannot pass `SafeApiKeySchema` and never verifies:

| Scope | Owner and access |
|---|---|
| `fleet_release:publish_draft` | `fleet_release`: CI may create a release draft and nothing else |
| `integrations_hub:actions` | `integrations_hub`: the key a connected app's third party calls the inbound action route with; matched exactly, and only for the connected app the key is bound to (41-ui-fixes/15 2.4) |
| `observability_config:read` | `observability` (phase 21): export, plan, list code-managed resources, read the OpenAPI document |
| `observability_config:write` | `observability`: apply and detach; implies `observability_config:read`. The coarse `read` / `write` verbs satisfy neither; `admin` and the `observability_config:*` wildcard satisfy both |

---

## Services / Responsibilities

`ApiKeyService` (default export, all static):

| Method | Responsibility |
|---|---|
| `create(tenantId, createdByUserId, input)` | Mints a key. Non-root tenants must have `feature_api_keys` in their plan (`TenantSubscriptionService.assertFeatureAccess`); root tenant bypasses. Returns `{ key: SafeApiKey, rawKey }`, clears the negative cache for the new hash, and dispatches the `api_key.created` webhook. |
| `list({ tenantId, page, pageSize })` | Paginated list of the tenant's keys (`SafeApiKey[]` + total), newest first. |
| `getById(tenantId, apiKeyId)` | Single key scoped to the tenant; Redis-cached under a tenant-scoped key. |
| `update(tenantId, apiKeyId, input)` | Updates `name`/`description`/`isActive` on a tenant-owned key; its cache drop commits with it (D253). |
| `delete(tenantId, apiKeyId)` | Removes a tenant-owned key, its cache drop commits with it (D253), dispatches the `api_key.deleted` webhook. |
| `update(...)` also dispatches `api_key.updated` and supports `ipAllowlist`. | |
| `rotate(tenantId, apiKeyId, createdByUserId, { graceSeconds })` | Mints a successor key (inherits scopes/allowlist/env), grace-expires (or immediately deactivates) the old key, dispatches `api_key.rotated`. Returns the new `{ key, rawKey }`. |
| `revokeAll(tenantId, actorUserId?)` | Emergency incident-response: deactivates every active key, flushes caches, audit-logs, dispatches `api_key.updated`. Returns the revoked count. |
| `sweepExpired(tenantId)` | Deactivates expired-but-active keys and dispatches `api_key.expired` per key (state hygiene; verify already rejects expired keys at request time). |
| `verify(rawKey, requiredScope?, { ip?, tenantId?, deferUsage? })` | Hot-path validation across all tenants by `keyHash`: rejects unknown/inactive/expired keys, a key of another tenant than `tenantId` (the generic 401, before anything of the key is spent), insufficient scope (`requiredScope` is one scope or `{ anyOf: [...] }`, any one of several judged by `scopeSatisfies`; integrations_hub's inbound actions ask for `integrations_hub:actions` or `write`, 41-ui-fixes/15 C10), IP outside the (per-key or tenant-default) subnet allowlist, and over-rate-limit calls. Audit-logs failures, raises a dormant-new-IP anomaly (once per key and address per hour), bumps `usageCount`/`lastUsedIp` unless `deferUsage` (the caller then stamps with `recordUse` / `recordUseFromRequest`). Negative-cache TTL is wired from the root setting `apiKeyNegativeCacheTtlSeconds`. |
| `verifyFromAuthHeader(request, tenantId?, requiredScope?, { ip? })` | Parses `Authorization: Bearer <key>`, derives the client IP from proxy headers when not supplied, calls `verify`, optionally pins to a tenant. Used by SCIM 2.0 and other machine-to-machine integrations. |
| `generateRawKey` / `hashKey` | Raw-key generation (env-prefixed) and SHA-256 hashing helpers. |

---

## Usage

```typescript
import ApiKeyService from '@/modules/api_key/api_key.service';

// Create a key (raw secret is returned once — show it, never store it)
const { key, rawKey } = await ApiKeyService.create(tenantId, createdByUserId, {
  name: 'CI Bot',
  scopes: ['read', 'write'],
  expiresAt: '2027-01-01T00:00:00.000Z',
});
// `rawKey` is the secret; `key` is the SafeApiKey (no hash)

// Verify an incoming raw key (optionally enforce a scope)
const verified = await ApiKeyService.verify(rawKey, 'write');
// throws if invalid, inactive, expired, or missing the scope

// Verify from an Authorization: Bearer header (SCIM / M2M)
const fromHeader = await ApiKeyService.verifyFromAuthHeader(request, tenantId, 'scim:read');

// Revoke (delete) a key
await ApiKeyService.delete(tenantId, apiKeyId);
```

---

## API Routes

Management routes are tenant-scoped and require **ADMIN+** tenant role:

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/api-keys` | List keys (paginated; `owners` emails, `reviewCount`, filter `scopeReview`) |
| GET | `/tenant/[tenantId]/api/api-keys/permission-catalog` | What the caller may give a key, by module (`api_key.keys.create`) |
| POST | `/tenant/[tenantId]/api/api-keys` | Create a key (returns raw secret once) |
| PUT | `/tenant/[tenantId]/api/api-keys/[apiKeyId]` | Update name/description/active status/IP allowlist, permissions (added ones within the editor's), scopes (narrow only), `scopeReviewed` |
| DELETE | `/tenant/[tenantId]/api/api-keys/[apiKeyId]` | Permanently revoke a key |
| POST | `/tenant/[tenantId]/api/api-keys/[apiKeyId]/rotate` | Rotate a key (successor + grace window) |
| POST | `/tenant/[tenantId]/api/api-keys/revoke-all` | Emergency: revoke all active keys |
| POST | `/tenant/[tenantId]/api/api-keys/sweep-expired` | Deactivate expired keys + emit `api_key.expired` |

Plus a public verification endpoint (the key itself is the auth — no session):

| Method | Path | Description |
|---|---|---|
| POST | `/tenant/[tenantId]/api/api-keys/verify` | Validate a key from the `x-api-key` header (optional `scope` in body); 401 if the key's `tenantId` does not match the path |

Admin UI: `/tenant/[tenantId]/admin/api-keys` (+ `.../api-keys/settings`).

---

## Concurrency & lifecycle invariants

- **Rotation** runs on the locked key and happens once: only an active, unexpired key without a
  successor can be rotated (409 otherwise), so a revoked key cannot be rotated back into a live one
  and concurrent rotations cannot fork two successors. The successor must fit the plan's current
  scope allowlist (403).
- **Edits** write only the edited columns, so they never overwrite the grace expiry or successor a
  concurrent rotation set. **Reactivation** counts against `apiKeyMaxActiveKeys`, and a rotated key
  cannot be reactivated (409).
- **Create** counts and inserts under a tenant-wide advisory lock, so the key limit holds under concurrency.
- **Revoke-all** locks the active keys and flushes the cache for exactly the rows it revoked; the
  **expiry sweep** deactivates conditionally (one `api_key.expired` per key).
- **Scope definitions**: re-creating a deleted scope restores it (the unique index includes
  soft-deleted rows); a duplicate or a rename onto a taken scope is 409.
- The lookup in `verify` is by key hash before the tenant is known, so it is a deliberate
  `withSystemRLS` read; usage is recorded in one SQL statement (`usageCount + 1`).

## Caching

API key lookups are cached in Redis (TTL = `API_KEY_CACHE_TTL`, sourced from `env.TENANT_CACHE_TTL`, default 5 min):

| Key | Used by |
|---|---|
| `api_key:hash:{sha256(rawKey)}` | `verify(rawKey)` — hot path on every authenticated API request |
| `api_key:tenant:{tenantId}:{apiKeyId}` | `getById(tenantId, apiKeyId)` |
| `api_key:id:{apiKeyId}` | invalidation key cleared on `update` / `delete` |
| `api_key:ver:{sha256(rawKey)}` | the key's cache version (D253, below) |

`create` clears the negative cache for the freshly-minted hash. `lastUsedAt` writes are intentionally fire-and-forget and do **not** invalidate — the value isn't security-critical and refreshing it would defeat the cache.

### Revocation is immediate, also through a Redis outage (D253)

The key's standing (its tenant ACTIVE, S15) reads the tenant profile through `getById`, which is guarded the same way since D270: every
status move records a drop of `tenant:id:<tenant>` in its transaction, so a suspension, a deletion request or a migration freeze refuses
the tenant's keys at once on every node (lane `api_key.tenant-status.redis-outage.test.ts`).

Every change that ends or narrows a key's access (`update` of any field, `delete`, `rotate`, `revokeAll`) records a **cache drop** in its
own transaction through `session_end`'s outbox (`recordKeyDrops` in `api_key.cache.ts`): the three entries above deleted and
`api_key:ver:<hash>` bumped. The writer delivers it after the commit (`deliverKeyDrops`); what Redis does not take then, the session_end
relay delivers from any node (a cache drop is due at once). A change whose drop cannot be recorded rolls back.

`verify` believes `api_key:hash:<hash>` only when (session_end.cache-guard.ts):

- the entry is **sealed** (`{ s, d }`) with the stamp of this read: the Redis instance id (`redis.health.ts`: the server's `run_id`,
  withheld while the client is not ready, and for 5 s after any error, close or failed command) and the key's version as read with the
  entry (both GETs go out together: one round trip). A bump retires the entry on every node at once; an entry of another Redis instance
  (a restart that replayed an old AOF, a replica promoted before it caught up), an unsealed entry, or a missing version is never believed;
- no cache drop is pending (or dead-lettered in the last hour) for the key's tenant in `session_end_orders`, as this process last read it
  (at most a second old; an outbox it cannot read believes nothing).

Otherwise the database answers (fail closed on a database error, as before), and the refill is sealed with the version read BEFORE the
database read, so a revocation that commits in between leaves it unbelieved. The negative entry (`__not_found__`) is believed as it is: it
only ever refuses. The creator's membership and the tenant's status are read on every verification, never from this cache (api_key.03, S15),
so ending a membership needs no drop. The expiry sweep drops best-effort (`clearCache`): `verify` refuses an expired key from the row's own
`expiresAt`. Lanes: `api_key.redis-outage.test.ts` (scratch `redis-server`, two nodes: healthy, Redis down and back with the old entry, a
partition where the writer cannot reach Redis), `SECURITY_TEST_LIVE=1`.

### Stampede + negative cache

- **TTL jitter (±10%)** spreads expirations so a burst of keys minted in the same second don't refill simultaneously.
- **In-process single-flight** (`modules/redis/redis.cache.ts`) dedupes concurrent loaders for the same key — if 100 requests miss on the same hash at the same time, only one DB query runs.
- **Negative cache** on `verify`: an unknown hash is cached as `__not_found__` for the TTL returned by `getNegativeCacheTtl()` — the root-tenant setting `apiKeyNegativeCacheTtlSeconds` (floored at 60s, capped at the positive TTL, memoised ~60s in-process), falling back to `Math.min(60, API_KEY_CACHE_TTL)`. Credential-stuffing attempts against random hashes hit Redis, not the DB. `create` clears the negative key for the new hash, so freshly-minted keys are immediately usable.

---

## Security

- Raw keys are never stored — only their SHA-256 hash (`keyHash`, unique index) is persisted.
- `SafeApiKey` (the only client-facing shape) omits `keyHash`; the raw key is returned exactly once, from `create`.
- Creation is billing-gated for non-root tenants via `assertFeatureAccess(tenantId, FEATURE_API_KEYS)` (defense-in-depth on top of UI gating).
- `verify` rejects inactive (`KEY_INACTIVE`), expired (`KEY_EXPIRED`), unknown (`INVALID_KEY`), under-scoped (`INSUFFICIENT_SCOPE`), IP-blocked (`IP_NOT_ALLOWED`), and over-rate-limit (`RATE_LIMITED`) keys.
- Every failed verification is audit-logged (`api_key.verify.failed`, actor type `API_KEY`); a dormant key first used from a new IP raises `api_key.anomaly.detected` (once per key and address per hour: `api_key:anomaly:<keyId>:<ip>`, Redis `SET NX`).
- Per-key subnet allowlists (and a tenant-wide default) restrict where a key may be used; per-key rate limiting caps verify throughput.
- The negative cache blunts credential-stuffing by serving repeated unknown-hash guesses from Redis instead of the DB.

---

## Settings

Surfaced at `/tenant/[tenantId]/admin/api-keys/settings` (gear button in the API Keys page header) via the shared `ModuleSettingsPage` scaffold. UI field metadata: `api_key.settings.fields.ts`. The `env:TENANT_CACHE_TTL` deployment var is **not** exposed here.

Setting keys are declared in `api_key.setting.keys.ts` (Zod enum + named accessors). UI field metadata: `api_key.settings.fields.ts`.

| Key | Type | Group | Notes |
|---|---|---|---|
| `apiKeyNegativeCacheTtlSeconds` | number | Caching | Negative-cache TTL for missing keys (min 60s). **Wired** — read from the **root tenant** (the negative cache keys on a hash before the owning tenant is known) and applied in `verify`. |
| `apiKeyMaxActiveKeys` | number | Lifecycle | Max active keys per tenant (0 = unlimited), enforced on `create`. |
| `apiKeyMaxTtlDays` | number | Lifecycle | Cap on how far out a key may expire (0 = no cap). |
| `apiKeyRequireExpiry` | boolean | Lifecycle | Require every new key to declare an expiry. |
| `apiKeyTenantIpAllowlist` | textarea | Network | Default subnets (CIDR) applied to keys without their own allowlist. |
| `apiKeyDefaultRateLimitPerMinute` | number | Network | Per-key verify rate limit (0 = unlimited). |

Read/written via the shared settings path. `env:TENANT_CACHE_TTL` (deployment var) is **not** exposed here.

---

## Webhook events

`api_key.created`, `api_key.updated`, `api_key.deleted`, `api_key.expired`, `api_key.rotated` (see `modules/webhook`).

## Dependencies

Adds **[`network`](../network/README.md)** for subnet (CIDR) validation + matching (`SubnetListSchema`, `ipMatchesAllowlist`), on top of `db`, `env`, `common`.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The api_key module issues, stores, and verifies per-tenant API keys (hashed, scoped, expirable) in each tenant's own database, gating creation on a per-tenant subscription feature, but exposes no working per-tenant settings (its one declared setting field is never read).

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `ApiKey` | `api_keys` | name, description, keyHash, scopes, isActive, expiresAt, createdByUserId, lastUsedAt |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `api_key.service.ts:create` — API key creation is feature-gated per tenant: TenantSubscriptionService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_API_KEYS) blocks tenants whose plan lacks the feature_api_keys entitlement; the root tenant (isRootTenant) is short-circuited and bypasses the gate.
- `api_key.service.ts:list/getById/create/update/delete` — All CRUD goes through tenantDataSourceFor(tenantId) and filters where:{tenantId}, so each tenant has its own isolated set of api_keys rows; cache keys are namespaced by tenantId (api_key:tenant:{tenantId}:{apiKeyId}).
- `api_key.service.ts:generateRawKey` — The raw key string embeds a per-tenant prefix derived from the tenantId (first 8 hex chars of the dashless tenantId) into the sk_live_{prefix}_{secret} format.
- `api_key.service.ts:verifyFromAuthHeader` — When a tenantId is supplied, verification rejects keys whose key.tenantId does not match, pinning a verified key to a specific tenant (used by SCIM / M2M callers). Note: the underlying verify() lookup uses the global getDataSource() and matches by keyHash across all tenants, so verification itself is not tenant-scoped at the DB level.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| apiKeyNegativeCacheTtlSeconds is declared as a UI settings field but is never read by the service; NEGATIVE_CACHE_TTL is hardcoded as Math.min(60, API_KEY_CACHE_TTL) from the global env value, so the negative-cache window is identical for every tenant and the declared setting has no effect. | `api_key.settings.fields.ts (API_KEY_SETTINGS_FIELDS apiKeyNegativeCacheTtlSeconds) / api_key.service.ts (NEGATIVE_CACHE_TTL, line 17)` | The field exists specifically to let a tenant tune how long missing-key lookups are negatively cached (credential-stuffing defense), but no SettingService.getValue call wires it in. Reading it per request tenant would make the declared setting functional and let tenants tune their own attack-surface window. | `apiKeyNegativeCacheTtlSeconds` |
| API_KEY_CACHE_TTL (positive cache TTL for valid keys) is sourced only from the global env.TENANT_CACHE_TTL (default 300s) and applied uniformly to all tenants. | `api_key.service.ts (API_KEY_CACHE_TTL, line 16)` | Positive lookup-cache freshness vs. Redis load is currently a single global deployment value. It could plausibly be per-tenant so high-traffic tenants tune it independently, but it is reasonable to keep global for operational consistency and to bound Redis memory — list as intentional-global rather than a strong candidate. | `apiKeyCacheTtlSeconds` |
| Default/allowed API key scopes are a fixed global enum (read, write, admin, scim:read, scim:write) with no per-tenant restriction; any tenant can mint admin- or scim-scoped keys regardless of plan tier. | `api_key.enums.ts (API_KEY_SCOPES / ApiKeyScopeEnum) consumed in api_key.service.ts:create` | Plan tiers or security policies might want to restrict which scopes a given tenant can grant (e.g. only paid plans may issue scim:* tokens). Today scopes are validated only against the global enum, not against any per-tenant policy, so this is a plausible per-tenant gating point. | `apiKeyAllowedScopes` |
| There is no per-tenant cap on the number of active API keys or a default key expiry/rotation policy; create() places no limit and expiresAt defaults to null (never expires). | `api_key.service.ts:create (no count check; expiresAt: input.expiresAt ? ... : null)` | Many SaaS products bound key count per plan and enforce a maximum/forced expiry for security. Both are currently unbounded and identical for all tenants, making them natural per-tenant policy settings. | `apiKeyMaxActiveKeys` |

---

## Dependencies

Requires: `db`, `env`, `common`, `session_end` (the cache drops, D253). At runtime also uses `redis` (cache/single-flight), `tenant_subscription` (feature gating), `tenant` (root-tenant check), and `webhook` (event dispatch).
