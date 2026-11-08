# Setting Module

Generic **per-tenant** key/value configuration store. Every other module declares its keys in its own `*.setting.keys.ts` file and reads/writes them through `SettingService`, keyed by the request `tenantId`. Values are Redis-cached (10-min TTL) and namespaced per tenant.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `Setting` | `settings` | Per-tenant key/value row. Composite PK `(tenantId, key)`; `value` is always stored as `text`, with `group` bucketing keys for the admin UI and `type` (`string`/`number`/`boolean`/`json`/…) telling the reader how to coerce. |

Lives in the **tenant DB** — every row is isolated by `tenantId` via the per-tenant `DataSource` (`tenantDataSourceFor(tenantId)`).

---

## Service (`setting.service.ts`)

All methods take `tenantId` as the first argument and partition every read/write on `{ tenantId, key }`. The Redis cache key is namespaced per tenant (`settings:<tenantId>:<key>`, or `settings:<tenantId>:all` for the full list) so cached values never leak across tenants.

| Method | Responsibility |
|---|---|
| `getValue(tenantId, key)` | Single read path consumed by other modules; returns the tenant's value or `null` if unset. |
| `getByKey(tenantId, key)` | Full `Setting` row (cached) or `null`. |
| `getByKeys(tenantId, keys[])` | Bulk read → `Record<key, value>`; uses Redis `mget`, falls back to DB for misses, back-fills the cache. |
| `getAll(tenantId)` | All rows for the tenant (cached as the `:all` list). |
| `getAllAsRecord(tenantId)` | `getAll` flattened to `Record<key, value>`. |
| `getByGroup(tenantId, group)` | All rows in one `group` (uncached). |
| `create(tenantId, key, value, group?, type?)` | Upsert: inserts (defaults `group='general'`, `type='string'`) or updates an existing row. |
| `update(tenantId, key, value)` | Updates value of an existing row; throws `SETTING_NOT_FOUND` if missing. |
| `updateMany(tenantId, settings)` | Upserts a `Record<key, value>` batch (insert-or-update per key). Backs the admin `PUT`/`POST` route. |
| `delete(tenantId, key)` | Removes a row and its cache entry; returns the deleted row or `null`. |
| `clearCache(tenantId)` | Drops every cached per-key entry and the `:all` list for the tenant. |

Cache constants are module-wide and intentionally global: `REDIS_KEY_PREFIX = 'settings:'`, `REDIS_TTL = 600` (10 min). Cache reads/writes are best-effort (Redis errors are swallowed so a Redis outage degrades to direct DB access rather than failing). A cold-cache refill is fenced against writes: every write bumps the tenant's `settings:<tenantId>:ver` counter before it drops the map, and a read whose database query overlapped a write drops the map it just filled, so a write is never undone for the TTL (`tenant_setting.cache.ts`). **D270:** every write also records a cache drop through `session_end` in its own transaction (`tenant_setting.cache-drop.ts`): the map (and the resolved module set when a module switch was written) deleted and the tenant's settings generation `settings:<tenantId>:gen` bumped, delivered after the commit, else by the session_end relay; a write whose drop cannot be recorded fails. A guarded cache built from settings seals its entries with the generation (`tenant_setting.generation.ts`; auth_abac's runtime settings) and refills with `getByKeys(tenantId, keys, { fromDatabase: true })`, which reads the rows from the database and neither reads nor fills the map.

---

## API Routes

`app/tenant/[tenantId]/api/admin-settings/route.ts` — tenant-scoped, **ADMIN+**.

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/admin-settings` | All settings for the tenant as a `Record<key, value>`. |
| PUT / POST | `/tenant/[tenantId]/api/admin-settings` | Upsert a `{ settings: Record<key, value> }` batch via `updateMany`. |

Each tenant owns its own row in the shared `settings` table — what used to be platform-wide super-admin config is now per-tenant. Guarded by `TenantSessionNextService.authenticateTenantByRequest({ requiredTenantRole: 'ADMIN' })` and rate-limited (`Limiter.checkRateLimit(request, 'api')`). `ROOT_TENANT_ID` is just another `tenantId` passed in by callers that want platform/system config — the store does not special-case it.

---

## Setting Keys

The setting module **declares no domain keys of its own**. Each module defines its own keys file (e.g. `auth.setting.keys.ts`, `ai.setting.keys.ts`) and `setting.types.ts` re-exports them all into one place; it also defines a few groups inline. Always import keys from the module that owns them — never hard-code key strings.

| Group | Source | Enum / `*_KEYS` |
|---|---|---|
| General, Auth | `@/modules/auth/auth.setting.keys` | `GeneralSettingKey` / `GENERAL_KEYS`, `AuthSettingKey` / `AUTH_KEYS` |
| Email, Notification | `@/modules/notification_mail/notification_mail.setting.keys` | `EmailSettingKey` / `EMAIL_KEYS`, `NotificationSettingKey` / `NOTIFICATION_KEYS` |
| SMS | `@/modules/notification_sms/notification_sms.setting.keys` | `SmsSettingKey` / `SMS_KEYS` |
| Storage | `@/modules/storage/storage.setting.keys` | `StorageSettingKey` / `STORAGE_KEYS` |
| AI | `@/modules/ai/ai.setting.keys` | `AiSettingKey` / `AI_KEYS` |
| Security | `tenant_setting.security.setting.keys.ts` | `SecuritySettingKey` / `SECURITY_KEYS` (moved from user_security, MS-37) |
| Payment | `@/modules/payment/payment.setting.keys` | `PaymentSettingKey` / `PAYMENT_KEYS` |
| Subscription | `@/modules/tenant_subscription/tenant_subscription.setting.keys` | `SubscriptionSettingKey` / `SUBSCRIPTION_KEYS` |
| Integrations | inline in `setting.types.ts` | `INTEGRATIONS_KEYS` — `discordWebhookUrl`, `discordDoormanWebhookUrl`, `githubTreeUrl`, `githubToken`, `githubUser` |
| Analytics | inline in `setting.types.ts` | `ANALYTICS_KEYS` — `googleTagId` |
| SEO | `@/modules/seo/seo.setting.keys` | `SeoSettingKey` / `SEO_KEYS` (seo's; MS-16 removed tenant_setting's dead copy) |
| Social | inline in `setting.types.ts` | `SOCIAL_KEYS` — `facebookUrl`, `twitterUrl`, `instagramUrl`, `linkedinUrl`, `youtubeUrl`, `githubProfileUrl`, `tiktokUrl`, `pinterestUrl` |
| Localization | inline in `setting.types.ts` | `LOCALIZATION_KEYS` — `defaultTimezone`, `defaultLanguage`, `dateFormat`, `timeFormat`, `datetimeFormat`, `weekStartsOn`, `currencySymbol`, `currencyPosition`, `thousandSeparator`, `decimalSeparator` |

---

## Files

| File | Purpose |
|---|---|
| `setting.service.ts` | `SettingService` — tenant-scoped, Redis-cached CRUD (see above). |
| `setting.types.ts` | `Setting` zod schema/type + group enums, re-exports every module's setting keys. |
| `setting.dto.ts` | Request/response DTOs (`UpdateSettingsDTO`, `Get`/`Update` response DTOs, etc.). |
| `setting.messages.ts` | Error/success message strings. |
| `setting.seed.ts` | Demo-data seed: varied key/value rows across groups for a tenant (idempotent on `(tenantId, key)`). |
| `entities/setting.entity.ts` | TypeORM entity for the `settings` table. |
| `server/setting-fields.types.ts` | `SettingFieldDef` — the field metadata `ui/module-settings-page.component.tsx` (`ModuleSettingsPage`) renders: `text`, `textarea`, `number`, `boolean`, `select`, `secret`, `url`, `email`, `date` (a date input, stored as `YYYY-MM-DD`; a stored value in another shape is named under the field until a date replaces it), `flag-select`, `flag-multiselect`. |

---

## Usage

```typescript
import SettingService from '@/modules/tenant_setting/setting.service';

// Read a single value for a tenant (null if unset)
const fromEmail = await SettingService.getValue(tenantId, 'fromEmail');

// Bulk read several keys at once (Redis mget + DB fallback)
const cfg = await SettingService.getByKeys(tenantId, ['mailProvider', 'fromEmail']);

// Upsert one key
await SettingService.create(tenantId, 'fromEmail', 'noreply@example.com', 'Email', 'string');

// Upsert a batch (backs the admin PUT/POST route)
await SettingService.updateMany(tenantId, {
  mailProvider: 'sendgrid',
  fromEmail: 'noreply@example.com',
});

// All settings in one group
const emailSettings = await SettingService.getByGroup(tenantId, 'Email');
```

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The setting module is the generic per-tenant key/value configuration store (composite PK tenantId+key, Redis-cached) that every other module reads/writes through SettingService keyed by the request tenantId; it is deeply tenant-variable as infrastructure but declares no domain keys of its own.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `Setting` | `settings` | key, value, group, type |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `setting.service.ts` — Every read/write is partitioned by tenant: getValue/getByKey/getByKeys/getAll/create/update/updateMany/delete all open tenantDataSourceFor(tenantId) and filter on { tenantId, key }, so each tenant has an isolated set of (key,value) rows. The Redis cache key is also namespaced per tenant (settings:<tenantId>:<key>), so cached values never leak across tenants.
- `setting.service.ts:getValue` — Returns each tenant's own override for a given key (or null if unset); this is the single read path consumed by other modules to drive per-tenant provider selection (mail/payment/storage providers, AI keys, auth/security policy, branding, webhooks, etc.) using the caller's request tenantId. ROOT_TENANT_ID is just another tenantId passed in by callers that want platform/system config.
- **Platform defaults (ROOT inheritance).** `getByKey` / `getByKeys` / `getValue` fall back to the ROOT tenant's row when the tenant has none, so a ROOT setting is every tenant's default. **Ledger projections are the exception** (`isLedgerProjectionKey`: `module.<id>.enabled`, `plugin.community.<id>.{version,active,channel,pinned,grant}`, `plugin.archive.<id>`): they record what *this* tenant installed and are read from its own rows only. Until 2026-10-16 they inherited too, so a module the operator enabled on ROOT was on for every tenant without a row of its own (no entitlement check, no ledger row, no hooks). Deployments that ran before that can list the affected tenants, and keep their state, with `npx tsx modules/tenant_setting/scripts/root-module-inheritance.mts [--apply]` (run it before deploying the fix). **The tenant's identity is the other exception** (`TENANT_IDENTITY_KEYS`, phase 53.0, 2026-10-31): invoice's issuer block (`company*`, `euVatNumber`) and seal (`invoiceSigningKeyPem` / `CertPem`), the İYS account and on-call's Slack are never ROOT's, because a tenant without its own issued invoices under the operator's name, tax number, IBAN and seal, sent consents under its İYS brand and posted incidents into its Slack ([audit](../../docs/audits/2026-10-31-root-credential-fallback.md)). `npx tsx modules/tenant_setting/scripts/root-identity-inheritance.mts` lists, before the deploy, the tenants that were reading ROOT's (report only, never the values). **Setting levels** (phase 53, [plan](../../docs/phases/53-setting-levels/README.md)) decide the rest for the keys a module lists in its module.json `level` entry (generated into `SETTING_LEVELS_BY_MODULE`). ROOT chooses each module's level, with an installation row `settingLevel.<moduleId>` and a per-tenant row `settingLevel.<moduleId>:<tenantId>`; otherwise the module's default applies.
  - `platform`: ROOT's rows only.
  - `tenant`: the tenant's only.
  - `tenant_first`: the tenant's whole group if it set any key of it, else ROOT's.

  A group is read from one side, never key by key, so a tenant's URL is never answered with ROOT's credential. A cap (`aiDailyLimit`…) at `platform` is the lower of the two values. `getSettingLevel(tenantId, moduleId)` answers a tenant's level and where it comes from. The resolver is `tenant_setting.levels.ts`. ROOT's `settingLevel.*` rows are never inherited as values.

  **Writing levels:**
  - The operator writes the level rows only through `GET` / `PUT /tenant/[ROOT]/api/setting-levels` (`tenant_setting.levels.read` ADMIN, `tenant_setting.levels.update` OWNER). The generic API refuses them.
  - At `platform` a tenant cannot change its module's provider keys (403 "provided by the platform"); an unchanged, empty or masked value is dropped, and caps stay writable.

  **Upgrading an existing installation (53.7, D167):** the new default is `platform` for every selectable module, so run `npx tsx modules/tenant_setting/scripts/setting-levels-upgrade.mts [--apply]` before the deploy. It lists the tenants whose own keys or own configured providers would stop being used (`--apply` pins them to `tenant_first`), the tenants the root tenant's providers newly serve (a cost the operator takes on), and the tenants that lose a module at a `tenant` level.

  **Screens (53.6):**
  - ROOT's settings page of a selectable module has a "Setting level" header button and drawer (`ui/setting-level-drawer.component.tsx`) for the installation default. Pass `moduleId` to `SettingsPanelHost` / `ModuleSettingsPage`; a custom page calls `useSettingLevelAction` itself.
  - A tenant's page under Tenants has a "Setting levels" drawer (`ui/tenant-setting-levels.drawer.tsx`, contributed to tenant's `tenant.detail.drawers` slot) for that tenant's own levels.
  - A tenant's own settings page shows `SettingLevelNotice` for its module and hides the fields the platform provides (`isPlatformProvided` / `usePlatformProvides` in `ui/setting-levels.context.tsx`). `GET /api/admin-settings` answers the tenant's `levels` (ROOT: `levelModules`) and never offers ROOT's values of keys that follow a level as `inherited` (D169).

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Redis cache TTL and key prefix are hardcoded module-wide (REDIS_TTL = 600s, REDIS_KEY_PREFIX = 'settings:') | `setting.service.ts (SettingService.REDIS_TTL / REDIS_KEY_PREFIX)` | Intentionally global shared-infra constants -- a uniform settings cache TTL/prefix across all tenants is appropriate and a per-tenant TTL would add complexity with little benefit. Listed only for completeness; not recommended to make tenant-scoped. | — |

---

## Tasarım notları (eski Final Faz 12 backlog'undan, 2026-09-11)

- **"Declared-but-unwired" ayarlar tek geçişte ele alınır.** `tenant`'ın 14 genel anahtarı
  (`tenant.setting.keys.ts`) ile bu modülün coerce / tip doğrulama / kayıtlı-anahtar registry
  kalemleri aynı ayar yüzeyine bakar; ayrı ayrı bağlanırsa her biri diğerinin ikizini kalıcılaştırır.
- **Registry'nin asıl kazancı ikizleri görünür kılmak.** 2026-09-11 taraması: `tenant`'ın 14 anahtarının
  9'u başka sahibin kanonik anahtarının ikinci adı (`logoUrl`/`faviconUrl`/`primaryColor`/`secondaryColor`
  → `tenant_branding` `brand*`; `timezone`/`language` → `defaultTimezone`/`defaultLanguage`;
  `tenantName`/`tenantDescription` → `tenants.name`/`description` kolonları). `tenant_session`'ın
  `maxLoginAttempts` (→ `auth` `lockoutMaxAttempts`), `passwordRequireNumbers`/`Symbols`
  (→ `auth` `passwordRequireDigit`/`Special`) ve `ssoEnabled`/`ssoProvider`/`ssoConfig` (→ `auth`
  ACCESS_POLICY + `auth_sso`/`auth_saml`) anahtarları da aynı sınıf. Doğru yön onları okur hâle
  getirmek değil emekliye ayırmaktır (AGENTS.md §10.0/3 — aynı kavram ikinci adla yazılmaz); registry
  bir anahtarın tek sahibini bilirse bu çiftler yazım anında yakalanır.
- Canlı sonuç: General sekmesi (`ui/tenant-settings-panels.component.tsx`) "Organization Name"'i
  `tenantName` KV'sine yazıyor ve onu hiçbir şey okumuyor — gerçek ad `tenants.name`.

---

## Settings overview entries (`tenant_setting:settings_link`)

The settings overview (`/admin/settings`) renders the client slot `tenant_setting.settings.links` inside its Access & Security grid. A
contribution receives `{ tenantId }`, renders its own link card and decides itself whether it applies; tenant_setting imports none of them.
`fleet_agent` contributes the fleet node's "Residency facts" entry, which renders only when `GET /api/settings/residency` answers (so
never in the `single` role).

---

## Maker-checker (`tenantSettingMakerChecker`)

With the toggle on, `updateManyGated` hands each gateable key to the reviewer of the `tenant_setting:change_review`
point (pattern `select`, fallback `none`) instead of writing it: the approval module contributes it and parks the change
as a `tenant_setting_change` queue item (secrets encrypted). Approval's own approval-phase boot task registers the
decision handler, which calls `applySettingChangeDecision` (`server/tenant_setting.change-decision.ts`). tenant_setting
never imports approval, which requires it.

It fails closed: with the toggle on and no active reviewer (approval missing, or switched off for the workspace) the
whole batch is refused with 409 before anything is saved. The toggle key and `approval*` keys are never gated.
Only maker-checker creates `tenant_setting_change` items (`POST /approvals` refuses the type).

The IP lists (`ipWhitelist`, `ipBlacklist`) are gated like any other key, so the tenant's network policy gets a second
reviewer. Their self-lockout guard (`assertIpListWriteKeepsWriter`, `server/tenant_setting.ip-lists.ts`) runs twice: for
the maker when the change is submitted, and for the APPROVER when it is approved. Approval registers
`assertSettingChangeApprovable` (`server/tenant_setting.change-decision.ts`) as the `tenant_setting_change` APPROVE guard,
handing it the approver's request and `ipListsExempt`: the stored entries are validated (400 on an invalid IP/CIDR), then
a list that would refuse the approver's own trusted client IP (read as the enforcement reads it) is refused 409 unless the
approver is exempt (platform admin, system-flow impersonation, break-glass). The guard runs before the decision is
recorded, so a refusal leaves the item pending and nothing is written. A decision with no approver request (a system flow)
cannot be checked and is refused 409.

## The default payment gateway stays on

`updateManyGated` refuses (409, `details.key` naming the field) a write after which the tenant's effective default payment
gateway (`paymentDefaultProvider`, own row else ROOT's, else the platform's `PAYMENT_DEFAULT_PROVIDER`) has its
`<provider>Enabled` flag at `'false'`: payment's checkout would then refuse every payment that names no gateway
(`server/tenant_setting.payment-default.ts`, 08-payment review). payment requires tenant_setting, so the rule reads
payment's keys from the setting-key catalog; a payment test keeps it in step with the checkout registry.

## Dependencies

`db` (per-tenant `DataSource`), `redis` (cache), `env`. The `tenant` module supplies `ROOT_TENANT_ID`.
