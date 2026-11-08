# Tenant Module

The foundation of multi-tenancy. Owns the global tenant registry — CRUD, lifecycle (`ACTIVE`/`SUSPENDED`/`PENDING_DELETION`), soft-delete grace + hard-purge — where each row **is** a tenant's identity. On creation it bootstraps a small set of per-tenant defaults (a cloned platform plan, if configured, plus locale settings).

The **root tenant** (`ROOT_TENANT_ID = 00000000-0000-4000-8000-000000000000`, name `"Platform"`) is a real tenant row that owns platform-level configuration (global users, plans, coupons, system audit logs, super-admin settings). A super-admin is any `TenantMember` of the root tenant with `memberRole = 'ADMIN'`. There is no separate "system" scope — every request resolves to a tenant.

---

## Entities

| Entity | Table | DB | Description |
|---|---|---|---|
| `Tenant` | `tenants` | system | The global tenant registry. `tenantId` is its **own** primary key (the tenant's identity), not a tenant-scope FK. Carries `name`, `description`, `tenantStatus`, soft-delete (`deletedAt`), and the deletion-grace columns `deletionRequestedAt` / `deleteAfter`. |

`SafeTenant` (`tenant.types.ts`) is the API-facing shape — it omits `deletedAt`. It carries no domains: tenant does not import `tenant_domain` (which requires it), and the operator's tenant page shows a tenant's domains in the panel `tenant_domain` contributes (`common:entity_panel`, entity type `tenant`) from its own `GET /api/tenants/[targetTenantId]/domains`.

---

## Services / Responsibilities

| File | Responsibility |
|---|---|
| `tenant.service.ts` | Core CRUD: `getAll` (paged + search, system DataSource), `getById` (Redis-cached, guarded since D270: an entry is believed only when sealed with the Redis instance and `tenant:ver:<tenantId>` and no cache drop is pending; every status move, in `tenant.write.service`, `tenant.deletion.service` and `tenant.migration.service`, records the drop in its transaction, `tenant.cache-drop.ts`, so an API key's standing check sees a suspension at once), `create`, `update`, `delete` (soft, sets `deletedAt`), `provisionPersonal` (auto-tenant for a new user, makes the user `OWNER`), and the private `seedDefaults` bootstrap. Fires platform/tenant webhook events. |
| `tenant.deletion.service.ts` | Soft-delete lifecycle: `requestDeletion` (status → `PENDING_DELETION`, sets `deleteAfter = now + 30d`), `cancelDeletion` (back to `ACTIVE`, clears the horizon), and `purgeExpiredTenants` (hard `softRemove` of rows past `deleteAfter`). |
| `tenant.legal-hold.ts` | How a legal hold is set and lifted (fleet decision F19): tighten-only, the authorities `CONTROL_PLANE` (class-2 `tenant.hold.set`, class-3 `tenant.hold.clear`), `REGIONAL_OPERATOR` and `TENANT_DPO` (node-local, step-up); `legalHoldOrigin` (migration 130) records who stands behind a hold, `MIXED` once a second authority extended it (then only class 3 lifts it); the same end from another authority is a no-op that keeps the origin and the reason. Every change goes to `tenant:lifecycle_sink` as `LEGAL_HOLD_SET` / `LEGAL_HOLD_CLEARED` with a G payload (end in unix seconds, sha256 of the reason); the purge job clears holds that ran out first (`expireLegalHolds`). |
| `tenant.purge-files.ts`, `tenant.purge-retention.ts` | The purge's retention-aware file step: every stored file of the tenant is deleted unless a `tenant:purge_retention` contributor still retains it (issued invoices, documents under retention or legal hold); retained files are marked on their `uploaded_files` rows and deleted by `sweepRetainedFiles` once retention ends. A contributor that cannot answer defers only the file step. docs/phases/37-extensions/11. |
| `tenant.deletion.job.ts` | BullMQ queue/worker (`tenant-purge`) that runs `purgeExpiredTenants`, then `sweepRetainedFiles`. `scheduleTenantPurgeJob` registers a repeating job (default cron `0 4 * * *`, daily 04:00). |
| `tenant.migration.service.ts`, `tenant.fleet-route.ts` | A fleet node's moves of a tenant (freeze, unfreeze, import, go-live, relocate) and its routing gate. `fenceAfterDirectoryMove` is the fencing of an old home (decision F1): when the directory's `tenantStatusDelta` homes the tenant on another node at a higher assignment version, the node records that home and stamps `fencedAt` (migration 131). A stamped tenant is read-only for every writer: the `db` write fence opens each of its tenant-scoped transactions READ ONLY (cron, workers and executors included), routing answers it 409 `FENCED` (debug log only; its reads are the new home's), its sessions and sockets end through `tenant:suspension`, and it is never frozen for an export. Only a signed go-live (the failback) clears the stamp. A tenant homed elsewhere without the stamp is still the 409 `MISPLACED` error. |
| `tenant.dr.service.ts` | A node taking tenants over in disaster recovery (decision F1), run by the node app after its agent promoted the database for a verified class-3 `node.failover` / `node.failback` or a regional-operator order: `takeOverTenantsForDr` homes here, one assignment version higher and unfenced, every tenant homed on the failed primary (failover) or exactly the tenants homed on the standby and stamped with this node's id (failback), stamps `drTakenFromNodeId` (migration 132) with the node they came from, and records a `DR_FAILOVER` / `DR_FAILBACK` lifecycle event each with the authority (the command jti, or the signed regional order) and the new version. Platform tenants, deleted rows and migration or deletion states are never taken; a repeat takes nothing new and re-sends the receipts. The directory alone moves the home. |
| `tenant.seed.ts` | Registry seed (`seedTenant`) — writes the active demo tenant plus pending/suspended demo rows via `ctx.systemRepo`. |

### Lifecycle / statuses

`TenantStatusEnum` (`tenant.enums.ts`) defines every status a row can hold: the writable `ACTIVE`, `INACTIVE`, `PENDING`, `SUSPENDED`, `ARCHIVED` (`WritableTenantStatusEnum`, the only ones a PUT accepts), the legacy `DELETED` (no longer writable: a PUT of it skipped the deletion guards and no purge followed), `PENDING_DELETION` (written by the deletion flow) and the fleet migration states `MIGRATING`, `IMPORTING`, `RELOCATED`. New tenants start `ACTIVE`. `update` refuses (409) any status change out of `PENDING_DELETION` ("cancel the deletion first": the cancel clears the horizon and records `RESTORED`) and out of the migration states; other fields of such a tenant can still be edited (41-ui-fixes/09 A1.2, A1.3).

### Platform console (root tenant only)

`/admin/tenants` lists every tenant (status, health and region as labels) and creates one through `POST …/tenants/create`, which makes the operator its `OWNER`. `/admin/tenants/[targetTenantId]` shows a tenant, its members read-only (through `tenant_member`'s GLOBAL operator route on the root tenant, never the target tenant's own route), the operator's module console link, and the panels other modules add through the **`tenant:detail_panel`** slot `tenant.detail.panels` (props `{ tenantId, targetTenantId }`; `tenant_subscription` contributes the plan card). Suspend and Archive ask first; Delete **requests** a deletion with a grace period (1–365 days, 30 by default) through `deletion-request` and the page then shows its date with Cancel deletion. The immediate `DELETE` is not offered. The root and fleet tenants offer no suspend, archive or delete (41-ui-fixes/09).

---

## Enumerating tenants from a background job

A sweep (expiry jobs, reminders, retention, usage flush, billing runs) must get its tenant list from
`listActiveTenants()` in `server/tenant.sweep.ts` — never `getDataSource().getRepository(Tenant).find()`.
A sweep that must not skip a suspended or otherwise non-active tenant (the CMS page flag rebuild, D251: a reinstated tenant's
pages must not come back with their no-store flags missing) uses `listLiveTenantIds()` (every tenant not deleted, ids only).
The `tenants` table carries a row-level-security policy (migration 123) and a sweep has no tenant in
context, so on the default connection it will see **zero** tenants once the app connects as
`app_runtime` (docs/phases/10-db Faz 4). The helper reads inside `withSystemRLS`. That is the system DataSource
(today's default connection until an admin/unpooled URL is configured) **plus** the `app.bypass_rls` GUC,
and migration 122 requires both. A bare system-connection read would still have seen zero rows after the
cutover. Per-tenant work after it still goes through `withTenantRepositoryFor(tenantId, …)`.

## Chokepoint & concurrency

- The tenant's **own row** (read, update, delete, deletion request/cancel) goes through the tenant
  chokepoint. The platform tenant list, slug → tenant, tenant creation (there is no tenant context
  yet), the purge sweep, the console's cross-tenant subscription health and **maintenance windows**
  are deliberate `withSystemRLS` blocks. A SYSTEM window has `tenantId = NULL` and gates every
  tenant, so no tenant block could see it.
- `cancelDeletion` restores only a tenant that is actually `PENDING_DELETION` and not purged (409
  otherwise). It used to set `ACTIVE` unconditionally, which lifted a suspension or revived a purged tenant.
- The purge sweep **claims** each tenant with a conditional soft delete (still due) before the
  cascade runs. A deletion cancelled after the sweep's read is no longer purged.
- Maintenance edits, transitions (start/end/cancel) and scheduler ticks are conditional on the
  window's current status:
  - a late edit can no longer write `IN_PROGRESS` back over an ended window, which used to
    re-raise the 503 gate;
  - end and cancel racing each other land once;
  - two scheduler instances move and announce a window once, and send the pre-notice once.
- `verifyIsolation` accepts only a plain identifier (the name is interpolated into SQL) and runs
  inside the tenant block, so under RLS it proves exactly what a tenant block can see.
- Slug collisions lost to a concurrent create/update are 409. A personal-tenant signup falls back to
  a suffixed slug instead of failing registration.

## Auto-seed on create

`create` and `provisionPersonal` both call the private `seedDefaults(tenantId, defaults?)` after the tenant row is committed. It is best-effort and idempotent:

| Step | Source | Result |
|---|---|---|
| 1. Default plan | `TenantSubscriptionService.getDefaultPlanId` → `assignPlatformPlan` | If the operator configured a default platform plan, it is **cloned** (category/product/plan/feature chain) into the new tenant and assigned for free (the default plan's product is free by rule; there is no price override since 36-tenant-subscription/04). |
| 2. Default modules | `tenant:default_modules` → `module_lifecycle.applyDefaultModules` | The operator's ROOT list `platformDefaultModules` is installed through the plan check, ledger and hooks (`origin: 'default'`). A module the plan does not cover is reported as `modules: <id>: <reason>`, never forced (docs/phases/25-marketplace/03-module-governance/01). |
| 3. Defaults | `SettingService.updateMany` | Setting rows: `language='en'`, `dateFormat='YYYY-MM-DD'`, `timeFormat='HH:mm'`, `timezone='UTC'`. |
| 4. Seed steps | `tenant:seed_step` (platform gate, in order) | Steps other modules own: `tenant_domain` mints the `<slug>.<wildcard>` subdomain. A failure is reported as `<module>: <message>`. |

Rules:

- **Best-effort, not atomic.** Each step is wrapped in `try/catch`; a failure only emits a `Logger.warn` and never blocks tenant creation or the other step.
- **Skipped for root.** `isRootTenant(tenantId)` short-circuits the whole seed — the root tenant is seeded by dedicated seed scripts.
- **Opt-out.** `CreateTenantDTO` accepts an optional `defaults: { skipPlan?, skipSubscription?, skipSettings? }`. The plan step runs only when **neither** `skipPlan` nor `skipSubscription` is set. Internal callers may also pass `skipModules` (the HTTP DTO does not accept it).
- **No inline Free plan.** The old inline `"Free"` plan seed is disabled (`DEFAULT_FREE_PRODUCT` / `DEFAULT_FREE_PLAN_BILLING` are kept but `void`'d): plans now wrap a `StoreProduct`, so a brand-new tenant has no catalog to bind to. The seed clones the operator-configured ROOT default plan instead.

A slug rename (operator-only, `update`) is announced after the commit through `tenant:slug_changed` (fanout, platform
gate, 2026-10-17): `tenant_domain` renames the free `<slug>.<wildcard>` subdomain so the tenant keeps exactly one. A
listener that throws is logged; the rename stands.

A move into `SUSPENDED` (from any status) and out of it is announced the same way through `tenant:suspension` (fanout,
platform gate, 2026-10-18; `{ tenantId, suspended }`): the request path already refuses a suspended tenant
(`tenant_session`), and the listeners end what is already open, so the suspension takes effect at once
(docs/phases/02-fleet/05 section 7 stage 7). `websocket_session` fences the tenant's websocket handshakes and drops its live
sockets on every gateway node (and lifts the fence on resume); `tenant_session` revokes every session of the tenant.
A listener that throws is logged; the status change stands.

```typescript
import TenantService from '@/modules/tenant/tenant.service';

// Default behaviour — clones the default plan (if configured) + seeds settings
await TenantService.create({ name: 'Acme', description: null, region: 'TR' });

// Opt out of plan/subscription (e.g. importing an existing org)
await TenantService.create({
  name: 'Imported',
  description: null,
  region: 'TR',
  defaults: { skipPlan: true, skipSubscription: true },
});
```

---

## Usage

```typescript
import TenantService from '@/modules/tenant/tenant.service';

// Create a tenant (auto-seeds defaults)
const tenant = await TenantService.create({ name: 'Acme Corp', description: 'Our main workspace', region: 'TR' });

// Get by ID (Redis-cached)
const found = await TenantService.getById(tenant.tenantId);

// Paged list with optional search
const { tenants, total } = await TenantService.getAll({ page: 0, pageSize: 10, search: null, tenantId: null });

// Update
await TenantService.update(tenant.tenantId, { name: 'Acme Inc' });

// Soft-delete (sets deletedAt)
await TenantService.delete(tenant.tenantId);
```

A new user's personal tenant is provisioned via `TenantService.provisionPersonal(userId, email)`, which also creates an `OWNER` `TenantMember` for them.

---

## Webhook events

`create`/`update`/`delete` dispatch via `WebhookService`:

- `tenant.created` / `tenant.deleted` → platform-wide (root-tenant webhooks).
- `tenant.updated` → the tenant's own webhooks.
- `tenant.suspended` → platform-wide, additionally raised when an `update` transitions a tenant **into** `SUSPENDED`.

---

## API Routes (tenant-scoped)

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/tenants` | List tenants (paged, searchable) |
| POST | `/tenant/[tenantId]/api/tenants` | Create a tenant without an owner (internal/API use; the console does not call it) |
| POST | `/tenant/[tenantId]/api/tenants/create` | Create a tenant and make the caller its `OWNER` (a tenant whose owner cannot be created is discarded); `{ name, slug?, description?, region? }` → 201 `{ tenant }` |
| GET | `/tenant/[tenantId]/api/tenants/[targetTenantId]` | Get a tenant, with its deletion schedule for the operator (`deleteAfter`, `deletionRequestedAt`, `deletionRequestedBy`; null unless `PENDING_DELETION`) |
| PUT | `/tenant/[tenantId]/api/tenants/[targetTenantId]` | Update a tenant (writable statuses only; 409 for a status change out of `PENDING_DELETION` or a migration state) |
| DELETE | `/tenant/[tenantId]/api/tenants/[targetTenantId]` | Soft-delete a tenant (sets `deletedAt`; no grace and no purge cascade; not offered by the console) |
| POST | `/tenant/[tenantId]/api/tenants/[targetTenantId]/deletion-request` | Request (or cancel) soft-deletion with the 30-day grace window. The platform operator (GLOBAL) on any tenant; the tenant's own ACTIVE OWNER on its own tenant only. The requester is recorded (`deletionRequestedBy`): an owner may cancel only an owner or self-service request; a pending deletion answers 409 instead of restarting the grace period |
| GET | `/tenant/[tenantId]/api/tenants/[targetTenantId]/deletion-request` | The pending state for the settings danger zone (`tenantStatus`, `deleteAfter`, `requestedBy`); the tenant's own OWNER, own tenant only |
| GET | `/tenant/[tenantId]/api/users/[userId]/tenants` · `…/auth/me/tenants` | List a user's tenants |
| POST | `/tenant/[tenantId]/api/cron/purge-expired-tenants` | Hard-purge sweep — auth via `CRON_SECRET` bearer token (serverless trigger for `purgeExpiredTenants`, then `sweepRetainedFiles`) |
| GET/POST | `/tenant/[tenantId]/api/maintenance-windows` | List / schedule maintenance windows (`tenant.maintenance.manage`; SYSTEM scope additionally needs a platform ADMIN) |
| GET/PATCH/DELETE | `/tenant/[tenantId]/api/maintenance-windows/[windowId]` | Read / edit-extend / cancel a window |
| POST | `/tenant/[tenantId]/api/maintenance-windows/[windowId]/start` · `…/end` | Emergency force-start / force-end (immediate cache purge) |
| GET | `/tenant/[tenantId]/api/maintenance-windows/active` | The windows gating this tenant now, decided on the server (each with `canEnd`), plus `platformKillSwitch` and `canManageSystem`; the console and the shell strip read it |
| POST | `/tenant/[tenantId]/api/maintenance-windows/preview` | Render the exact downtime page for a draft window (200, JSON `{ data: { html } }`, `no-store`) |
| POST | `/tenant/[tenantId]/api/cron/maintenance-tick` | Scheduler twin — auth via `CRON_SECRET` bearer token (see `docs/guides/cron/README.md` `maintenance-tick`) |

---

## Maintenance mode (planned downtime)

> **Before you open a window, read how not to lock yourself out.** The gate's escape
> hatches are layered and ALL of them hold at once: (1) the auth surface (`…auth…`
> paths), the public `/status` page and `/api/health` are always exempt — the way
> back in stays open; (2) platform ADMINs always pass; (3) members whose role is in
> the window's `allowRoles` pass — roles are the member roles (`OWNER`, `ADMIN`, `USER`;
> case and spaces ignored), validation refuses an empty list, and an omitted list falls
> back to the `maintenanceDefaultAllowRoles` setting, then `OWNER`+`ADMIN`.
> A window that would shut its author out of the console is refused (409): creating
> one, Start now, and an edit that changes who is gated (roles, mode, routes, the
> canary share, or a start moved into the past) check that the caller's role stays in
> `allowRoles` whenever the window reaches `/admin/maintenance` or its API (41-ui-fixes/09 B1.2).
> Platform admins and internal callers are not checked. The cron routes (`/api/cron/*`)
> are exempt from the gate and from the kill-switch: they check `CRON_SECRET` themselves.

Maintenance is a **separate dimension from tenant lifecycle** (locked decision): a
tenant under maintenance stays `ACTIVE` — `TenantStatus` never gained a `MAINTENANCE`
value (pinned by a grep test). The model is `MaintenanceWindow` (`maintenance_windows`,
system DataSource; `tenantId = null` freezes every tenant):

- **Scope** — `SYSTEM` (whole platform) · `TENANT` (one workspace) · `ROUTE`
  (`routePatterns`, `*` wildcard — partial outage, e.g. only `/admin/store/*`).
- **Mode** — `FULL` (everything 503s) · `READ_ONLY` (GET/HEAD/OPTIONS pass, writes
  503 — the soft option for migrations; side-effectful GETs are a known limit).
- **Canary** — `percentage` [1..100]: only that share of subjects sees the outage,
  bucketed deterministically through the rollout hash feature flags use too
  (`common/server/common.rollout`; subject = user id, then the `ab_vid` cookie, then
  client IP), so a canary works without feature_flags. A hash failure fails OPEN.
- **HTTP semantics** — `503` + `Retry-After` (countdown to `scheduledEnd`) +
  `Cache-Control: no-store`, branded HTML for pages / JSON for `/api/*`. Never a
  200 rewrite, so search engines keep the real URLs.
- **Timing** — the proxy gate computes time-activity at RESOLVE time from a
  Redis-cached candidate list (TTL `maintenanceCacheTtlSeconds`, default 10s, purged
  on every mutation), so a `SCHEDULED` window starts gating the second its start
  passes and stops past its end **without the scheduler**. The minutely
  `maintenance-tick` job (see `docs/guides/cron/README.md`) is bookkeeping: it stamps
  `status`/`actualStart`/`actualEnd`, auto-ends force-started windows and sends the
  advance notice (`maintenancePreNotifyHours`, default 24) through the `notification`
  dispatcher.
- **Console & bridge** — `/admin/maintenance` (permission
  `tenant.maintenance.manage`, deliberately narrow) lists/schedules/force-ends
  windows and previews the exact 503 page; the admin shell shows a persistent
  "MAINTENANCE ACTIVE" strip with one-click end while any window is live, and the
  root `maintenanceMode` kill-switch while it is on. Both read
  `GET /api/maintenance-windows/active`, so what they show is what the gate does,
  with the window's real reach (full, read-only, routes, canary share); SYSTEM
  windows are read-only for anyone but a platform admin. The
  `observability` status page reads windows from here over a read seam (single
  source — it holds no window table) and suppresses auto-incidents during active
  maintenance; subscribers get start/end mail. Every action lands in `audit_log`.

The root-tenant `maintenanceMode` settings boolean remains as the coarse platform
kill-switch that runs earlier in the proxy; the window model adds detail on top.

---

## Settings

The seed writes four per-tenant locale defaults (`language`, `dateFormat`, `timeFormat`, `timezone`) via `SettingService.updateMany`.

`tenant.setting.keys.ts` declares a broader `TenantGeneralSettingKeySchema` / `TENANT_GENERAL_KEYS` (17 keys: `tenantName`, `tenantDescription`, `logoUrl`, `faviconUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `contactEmail`, `contactPhone`, `contactAddress`, `timezone`, `language`, `dateFormat`, `timeFormat`, plus the maintenance knobs `maintenanceDefaultAllowRoles`, `maintenanceCacheTtlSeconds`, `maintenancePreNotifyHours`). Only the four locale keys are wired with a write-side default today — see *Tenant Variability* below. The maintenance knobs are read with hard fallbacks to the constants in `maintenance.enums.ts`, so an unset or malformed value can never disable the gate or lock an operator out.

---

## Caching

`getById(tenantId)` is cached in Redis under `tenant:id:{tenantId}` (TTL = `TENANT_CACHE_TTL`, default 5 min, from `env.TENANT_CACHE_TTL`). `update` and `delete` clear the key. Tenant lookup runs on nearly every request, so this drops a hot DB query down to a Redis GET. The TTL is jittered (`jitter`) and reads are wrapped in in-process single-flight (`singleFlight`, `modules/redis`) so a wave of cold-cache requests for the same tenant runs only one DB query.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The tenant module is the foundation of multi-tenancy: it owns the global tenant registry (CRUD, lifecycle ACTIVE/SUSPENDED/PENDING_DELETION, soft-delete grace + purge) where each row IS a tenant's identity, and it seeds a small set of per-tenant default settings on creation.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `language` | string | `en` | tenant | Tenant's default UI/content language; seeded per real tenant in seedDefaults via SettingService.updateMany. | `tenant.service.ts` |
| `dateFormat` | string | `YYYY-MM-DD` | tenant | Tenant's default date display format; seeded per real tenant in seedDefaults. | `tenant.service.ts` |
| `timeFormat` | string | `HH:mm` | tenant | Tenant's default time display format; seeded per real tenant in seedDefaults. | `tenant.service.ts` |
| `timezone` | string | `UTC` | tenant | Tenant's default timezone; seeded per real tenant in seedDefaults. | `tenant.service.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Per-tenant behavior

- `tenant.service.ts:seedDefaults` — On creation each non-root tenant is bootstrapped per-tenant: a default platform plan (if the operator configured one via TenantSubscriptionService.getDefaultPlanId) is cloned and assigned for free, and DEFAULT_TENANT_SETTINGS are written under that tenantId. Skipped entirely for ROOT_TENANT_ID and gated by per-call defaults flags (skipPlan/skipSubscription/skipSettings).
- `tenant.service.ts:update` — Lifecycle/webhook behavior branches per tenant: tenant.updated fires to that tenant's own webhooks, and a transition into SUSPENDED additionally raises the platform-wide tenant.suspended event.
- `tenant.deletion.service.ts:requestDeletion` — Each tenant gets its own deleteAfter horizon (now + 30-day grace) stored on its row, driving an independent per-tenant hard-purge schedule swept by purgeExpiredTenants.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| TENANT_GENERAL_KEYS declares 14 tenant-branding/locale setting keys (tenantName, tenantDescription, logoUrl, faviconUrl, primaryColor, secondaryColor, accentColor, contactEmail, contactPhone, contactAddress, timezone, language, dateFormat, timeFormat) but the module has NO *.settings.fields.ts and no service ever reads them — declared-but-unwired per-tenant config. | `tenant.setting.keys.ts (TenantGeneralSettingKeySchema)` | These are explicitly tenant-scoped (per-tenant name/branding/contact/locale), yet there is no UI metadata file and no SettingService.getValue read path, so a tenant admin cannot actually override them today; only language/dateFormat/timeFormat/timezone get write-side defaults seeded. | `tenantName` |
| DELETION_GRACE_DAYS hardcoded to 30 for every tenant's soft-delete grace window. | `tenant.deletion.service.ts (DELETION_GRACE_DAYS)` | The recovery/grace period before hard-purge is a policy that could reasonably differ per tenant (e.g. enterprise plans get a longer recovery window) but is a fixed global constant. | `tenantDeletionGraceDays` |
| Tenant hard-purge cron pattern hardcoded to '0 4 * * *' (daily 04:00). | `tenant.deletion.job.ts (scheduleTenantPurgeJob default cronPattern)` | Intentionally global: a single shared platform worker sweeps all tenants, so a per-tenant schedule is not meaningful — listed only for contrast. | — |
| DEFAULT_FREE_PRODUCT / DEFAULT_FREE_PLAN_BILLING starter-plan defaults (name 'Free Plan', basePrice 0, currency 'USD', MONTHLY, trialDays 0) hardcoded. | `tenant.service.ts (DEFAULT_FREE_PRODUCT / DEFAULT_FREE_PLAN_BILLING)` | Currently dead (void'd) — inline free-plan seed was disabled in favor of cloning an operator-configured ROOT default plan; the starter currency/trial defaults are platform-global, not per-tenant. Listed for contrast. | — |
| TENANT_CACHE_TTL (default 300s) governs how long getById caches a tenant row globally. | `tenant.service.ts (TENANT_CACHE_TTL)` | Intentionally global infra tuning sourced from env.TENANT_CACHE_TTL; caching the registry per-tenant TTL has no business meaning. Listed for contrast. | — |

---

## Session-ending orders in the change's transaction (D249)

A move into SUSPENDED (`update`), a deletion request and the purge claim record the tenant's session-ending orders INSIDE their own
transaction (`recordSessionEndInTx`, point `session_end:order_source`: `websocket_session`'s `disconnect_tenant`), deliver them after
the tenant cache is cleared, and tell `tenant:lifecycle_sink` `sessionEndOrderedBy` (`tenant.session-end.ts`; ids only, never part of
a fleet receipt). The `tenant:suspension` listeners still run after the commit (`websocket_session` fences, then drops once more).
docs/audits/2026-11-03-redis-outage.md §3.2.

## Dependencies

Requires: `db`, `env`, `logger`, `common`, `session_end` (the in-transaction orders). At runtime also collaborates with `tenant_member` (personal-tenant ownership), `tenant_subscription` (default-plan cloning), `setting` (default settings), `webhook` (lifecycle events), `redis` (caching + BullMQ purge queue), and, through its extension points only, `tenant_domain` (the `tenant:seed_step` wildcard subdomain, the `tenant:slug_changed` rename of it, and the `tenant:onboarding_check` `dns_configured` item).
