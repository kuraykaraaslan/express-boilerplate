# Notification Sms Module

A pluggable, queue-backed outbound SMS sender (Twilio / Nexmo / Clickatell / NetGSM / Verimor) with per-tenant provider credentials, region-based provider routing, phone-number validation (libphonenumber), Redis rate limiting, country allowlists, and per-tenant subscription gating + usage tracking.

---

## Files

| File | Purpose |
|---|---|
| `notification_sms.service.ts` | Core: queue/send, tenant-aware provider selection, rate limiting, region routing, feature gating, usage/audit logging |
| `notification_sms.provider.service.ts` | Resolves a provider for a tenant via the `sms:provider` extension point — see *Providers* below |
| `notification_sms.setting.keys.ts` | Tenant-scoped setting key constants (`SMS_KEYS`) |
| `providers/base.provider.ts` | `BaseSMSProvider` abstract contract (`sendShortMessage`, `isConfigured`) + `SMSOptions` / `SMSResult` types |
| `providers/isolated.provider.ts` | `IsolatedSmsProvider` — runs a sandboxed community plugin's `sendShortMessage` op behind `BaseSMSProvider` |

This module has **no entities** of its own — all persisted state lives in other modules: per-tenant credentials in the `setting` table, delivery records via `notification_log`, and usage counters via `tenant_usage`.

---

## Services / Responsibilities

`SMSService` (default export, static class) is the single entry point.

| Method | Responsibility |
|---|---|
| `sendShortMessage(tenantId, { to, body, provider? })` | Public send path. Validates input, asserts feature access, applies the per-recipient Redis rate limit, then enqueues a `sendShortMessage` job on the `smsQueue` BullMQ queue. Failures are caught and logged, never thrown to the caller. |
| `sendShortMessageDirect(tenantId, { to, body, provider? })` | Synchronous send (urgent messages) — asserts feature access then calls `_sendShortMessage` inline, bypassing the queue. |
| `assertSmsFeatureAccess(tenantId)` | Defense-in-depth billing gate: asserts the tenant's plan grants `feature_sms_send` (boolean) and is below `feature_sms_monthly_quota` (LIMIT vs `TenantUsage.smsSends`). Root tenant is short-circuited. |
| `monthlyQuota(tenantId)` | Read-only form of the quota half: `{ allowed, key: 'feature_sms_monthly_quota', reason? }`, no audit row, nothing counted; `reason` is `no_access` for an undeclared key, no live plan or a limit of 0, else `spent`. The SMS channel exposes it as `quota` for the dispatcher's `spentQuotas` (G-137). |
| `completedSend(tenantId, idempotencyKey?)` | The recorded result of a send whose key already completed (the `RedisIdempotencyService` record of the worker and `sendShortMessageDirect`), or undefined. `sendShortMessage` and `sendShortMessageDirect` ask it **before** the feature gate, the suppression check and the rate limit: a redelivered send returns (the direct path returns the recorded result) and is never refused for a quota spent since. The SMS channel exposes it as `completed` for `spentQuotas`. |
| `getProvider(tenantId, providerName?)` | Resolves a provider instance by name; if it is not `isConfigured` for the tenant, walks the `PROVIDER_MAP` fallback chain and returns the first provider that tenant has credentials for. |
| `getProviderForRegion(tenantId, regionCode)` | Looks up the region→provider map, then delegates to `getProvider` so the actual provider is tenant-config-aware. |
| `listProviders(tenantId)` | Returns each provider name + its `configured` state for the tenant (used by the GET route). |
| `getRegionProviderMap()` | Returns the current region→provider map as a plain record. |
| `parsePhoneNumber(phoneNumber)` | Parses to E.164 and extracts the region code via libphonenumber; returns `null` on failure. |
| `isValidPhoneNumber(phoneNumber)` | Boolean validity check via libphonenumber. |
| `isAllowedCountry(regionCode)` | Checks the region against `ALLOWED_COUNTRIES` (`env.SMS_ALLOWED_COUNTRIES`); allows all when unset. |
| `_sendShortMessage(...)` (private) | BullMQ worker target. Re-asserts feature access, validates/parses the number, enforces the country allowlist, resolves the provider (explicit > region default > tenant fallback), sends, then records usage + audit (see below). |

### Queue / Worker

- Queue name: `smsQueue` (`SMSService.QUEUE`), backed by the shared BullMQ Redis connection.
- A module-level `WORKER` consumes jobs and invokes `_sendShortMessage`; `completed` / `failed` events are logged.
- Job payload: `{ tenantId, to, body, provider? }`.

---

## Providers

Every SMS gateway ships as a **sandboxed community plugin** (`sms:provider` extension
point) — there is no in-tree built-in provider, mirroring how `payment` moved its
gateways out. A tenant installs the ones it wants from the marketplace; the reference
implementations live in-repo as examples:

| Provider | Plugin | Required settings (secret in *italics*) |
|---|---|---|
| Twilio | `modules/marketplace/examples/@sms/twilio` | `twilioAccountSid`, *`twilioAuthToken`*, `twilioPhoneNumber` |
| Nexmo / Vonage | `modules/marketplace/examples/@sms/nexmo` | `nexmoApiKey`, *`nexmoApiSecret`*, `nexmoPhoneNumber` |
| Clickatell | `modules/marketplace/examples/@sms/clickatell` | *`clickatellApiKey`* |
| NetGSM (Turkey) | `modules/marketplace/examples/@sms/netgsm` | `netgsmUserCode`, `netgsmPhoneNumber` (message header), *`netgsmPassword`* |
| Verimor (Turkey) | `modules/marketplace/examples/@sms/verimor` | `verimorUsername`, `verimorSourceAddr`, *`verimorPassword`* |

`NotificationSmsProviderService.getProvider(tenantId, name?)` resolves the tenant's
installed+configured plugins (`IsolatedSmsProvider` wraps the sandboxed `invoke`),
honouring an explicit `provider`, then the `smsProvider` setting, then the first
configured installed plugin. No plugin installed ⇒ send throws.

**Provider selection** for the region map is driven by `env`: the default provider
comes from `env.SMS_DEFAULT_PROVIDER` (fallback `twilio`), and region routing from
`env.SMS_PROVIDER_MAP` (e.g. `"TR:netgsm,US:twilio,GB:twilio"`; built-in defaults map
TR→NetGSM, US/GB/DE/FR→Twilio when unset) or a per-tenant override
(`notification_sms.delivery.service.ts`). An explicit `provider` on the call overrides
both — but still only resolves to a plugin the tenant has installed and configured.

---

## API Routes (tenant-scoped, ADMIN+)

| Method | Path | Description |
|---|---|---|
| POST | `/tenant/[tenantId]/api/notifications/sms/send` | Send an SMS. Body: `{ to, body, provider?, direct? }`. `direct:true` sends synchronously, otherwise queued. |
| GET | `/tenant/[tenantId]/api/notifications/sms/send` | Returns `{ providers, regionProviderMap }` for the tenant (configured state per provider). |

Both routes apply the rate limiter and require tenant-admin auth (`authenticateAdminRequest`).

---

## Sending an SMS

```typescript
import SMSService from '@/modules/notification_sms/notification_sms.service';

// Queue for async delivery (validates, rate-limits, and feature-gates per tenant)
await SMSService.sendShortMessage(tenantId, {
  to: '+905551234567',
  body: 'Your verification code is 123456',
});

// Send immediately, bypassing the queue (urgent messages)
await SMSService.sendShortMessageDirect(tenantId, {
  to: '+905551234567',
  body: 'Your one-time password is 987654',
  provider: 'netgsm', // optional: force a specific provider
});
```

---

## Phone Number Validation

Uses Google's `libphonenumber` — numbers are parsed to E.164 (`+{countryCode}{number}`) and the region code is derived from the number. Unparseable numbers are logged and dropped before sending.

---

## Rate Limiting

Per-recipient throttling via Redis: a key `sms:rate-limit:${to}` is set with TTL `RATE_LIMIT_SECONDS` (`env.SMS_RATE_LIMIT_SECONDS`, default `60`). While the key exists, further messages to that number are dropped (not queued). The key is currently scoped by phone number only, not by tenant.

---

## Opt-out (STOP) list

Decision D254 (docs/audits/2026-11-03-redis-outage.md §6.7 item 2): the opt-out list is **durable**. Before D254 it was a Redis set only, and a Redis that lost its data forgot every opt-out.

| Piece | What it does |
|---|---|
| `entities/notification_sms_optout.entity.ts`, `migrations/002_notification_sms_optouts.sql` | `notification_sms_optouts`: one row per (tenant, recipient in E.164), primary key on the two; `optedOut` true after a STOP, false after the START that took it back (the row is kept as the subject's record), `keyword`, `changedAt`, `createdAt`. Tenant RLS, FORCE from birth. |
| `notification_sms.optout.ts` | `isOptedOut(tenantId, to)` and `recordOptOutState(tenantId, from, optedOut, keyword)`. The table is the source of truth; Redis `sms:optout:<tenantId>:<e164>` caches it (`'1'` for an hour, `'0'` for 60 s). A miss, a Redis error or a Redis call that takes longer than 250 ms reads the table. When neither can answer it throws `SmsOptOutUnknownError`: never "not opted out" because nothing could answer. |
| `handleInboundKeyword(tenantId, from, text)` | STOP / UNSUBSCRIBE / IPTAL / DUR and START / UNSTOP / BASLA (the whole message, trimmed, any case). Writes the table first, then the cache. A table write that fails THROWS (a STOP still sets the cache to `'1'` first), so the inbound handler can answer an error and the carrier redelivers the reply. Nothing calls it yet: the carrier inbound route is still to be built. |
| Send path | `sendShortMessage` checks at enqueue; an unreadable state there is queued anyway (logged), because the worker checks again: at delivery an unreadable state throws, nothing is sent and the job fails. |
| Purge, export, erasure | `notification_sms.tenant-purge.ts` (`tenant:purge_step`) deletes the purged tenant's rows; `notification_sms.export-collection.ts` (`tenant_export:collection`, `notificationSmsOptOuts`) exports them (the column is `phone`, so a redacted export redacts it). A subject's erasure keeps them: `RETAIN`, `LEGAL_OBLIGATION` (the record of an objection is what keeps it honoured). |

Numbers are normalised with `common.phone` `toE164`, so `+90 555 111 22 33` and `+905551112233` are one subscriber (this closed the register's `notification_sms.05`). They are stored in clear, not sealed under the tenant key with a blind index like `notification_logs.recipient`: the lookup must answer on every node and across key generations, because a missed lookup is a message to someone who said STOP. The short life of a cached `'0'` bounds every stale-cache case against a STOP (a cache write that failed after the table write, a reader that cached `'0'` just before the STOP committed): a STOP is honoured within 60 s whatever Redis did.

Tests: `notification_sms.optout.test.ts` (30: flush, Redis error and hang, START, isolation, E.164, unknown state, failed writes), `notification_sms.optout.lifecycle.test.ts` (migration, purge, export, manifest), `notification_sms.send.security.test.ts` (the "D254" cases through the real queue over the harness datasource and Redis), `notification_sms.optout.integration.test.ts` (real Postgres, `RLS_TEST=1`: one row per subscriber, RLS, FORCE, purge).

---

## Country Allowlist

`isAllowedCountry(regionCode)` enforces `env.SMS_ALLOWED_COUNTRIES` (comma-separated region codes). When the env var is unset/empty, all destinations are allowed.

---

## Usage tracking & audit

`_sendShortMessage` (the BullMQ worker target) records every delivery attempt:

- On `result.success === true`:
  - `TenantUsageService.incrementSmsSends(tenantId, 1)` → updates the monthly `smsSends` quota counter.
  - `NotificationLogService.log(tenantId, 'sms', toE164, 'sent', { provider, providerMessageId })`.
- On provider error / `result.success === false`:
  - `NotificationLogService.log(tenantId, 'sms', toE164, 'failed', { provider, error })`.

Feature access is re-asserted at the worker boundary so a long-queued job cannot bypass gating after the tenant's plan was downgraded / cancelled.

---

## Settings

All keys in `SMS_KEYS` (`notification_sms.setting.keys.ts`) are **tenant-scoped** and read per tenant via `SettingService.getValue(tenantId, ...)`, with `env.*` as the out-of-the-box fallback. They are surfaced in the per-tenant SMS settings page at `/tenant/[tenantId]/admin/settings/sms` (`PlatformSmsTab`).

| Key | Used by | Notes |
|---|---|---|
| `twilioAccountSid` / `twilioAuthToken` / `twilioPhoneNumber` | `@twilio/sms` plugin | Twilio creds. |
| `nexmoApiKey` / `nexmoApiSecret` / `nexmoPhoneNumber` | `@vonage/sms` plugin | Vonage/Nexmo creds. |
| `clickatellApiKey` | `@clickatell/sms` plugin | Clickatell bearer token. |
| `netgsmUserCode` / `netgsmPassword` / `netgsmPhoneNumber` | `@netgsm/sms` plugin | NetGSM creds (`netgsmPhoneNumber` is the message header/sender name). |
| `verimorUsername` / `verimorPassword` / `verimorSourceAddr` | `@verimor/sms` plugin | Verimor creds (`verimorSourceAddr` is the approved sender header). |
| `smsProvider` / `smsEnabled` | — | Declared in `SMS_KEYS` and shown in the UI, but **not read by the backend today** (see *Tenant Variability* candidates). |

---

## Security

- Both API routes require tenant-admin authentication and pass through the rate limiter.
- Outbound sends are gated by the tenant subscription (`feature_sms_send` + `feature_sms_monthly_quota`); the gate is asserted on enqueue **and** re-asserted at the worker boundary.
- Provider credentials are stored per tenant in the `setting` table (secret values: `twilioAuthToken`, `nexmoApiSecret`, `netgsmPassword`) and never returned by the send routes.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

A pluggable, queue-backed outbound SMS sender (Twilio/Nexmo/Clickatell/NetGSM) that is strongly per-tenant: each provider resolves its credentials from the requesting tenant's settings (env only as fallback), and sends are gated by per-tenant subscription features and monthly usage quota.

### Setting level (phase 53)

**Selectable, default `platform`.** The root tenant chooses where this module's provider settings come from, for the installation (the "Setting level" button on the module's settings page) and per tenant ("Setting levels" on the tenant's page): `platform` (the root tenant's only), `tenant` (the tenant's only) or `tenant_first` (the tenant's whole group if it set any key of it, else the root tenant's). The group is read from one side, never key by key.

- Keys: 15 keys (the module's `settings.level.keys`: `smsProvider`, `smsRegionProviderMap`, `twilioAccountSid`, `twilioAuthToken`, `twilioPhoneNumber`, `nexmoApiKey`, …).
- Plugin providers at: `sms:provider`.

At `platform` SMS goes out through the root tenant's provider and counts against the plan's SMS quota and counter; SMS sent through the tenant's own account does not. The on/off switch (`smsEnabled`) is always the tenant's.

Declared in `module.json` (`settings.level`); see [phase 53](../../docs/phases/53-setting-levels/README.md). The tables below predate the levels: where they say a key is read per tenant, the level decides whose row is read.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `twilioAccountSid` | string | — | tenant | Twilio Account SID used to authenticate the Twilio REST client for this tenant; falls back to env.TWILIO_ACCOUNT_SID when unset. | `twilio.provider.ts` |
| `twilioAuthToken` | string | — | tenant | Twilio Auth Token (secret) for this tenant's Twilio account; falls back to env.TWILIO_AUTH_TOKEN. | `twilio.provider.ts` |
| `twilioPhoneNumber` | string | — | tenant | Twilio sender/From phone number for this tenant; falls back to env.TWILIO_PHONE_NUMBER. | `twilio.provider.ts` |
| `nexmoApiKey` | string | — | tenant | Nexmo/Vonage API key for this tenant; falls back to env.NEXMO_API_KEY. | `nexmo.provider.ts` |
| `nexmoApiSecret` | string | — | tenant | Nexmo/Vonage API secret (secret) for this tenant; falls back to env.NEXMO_API_SECRET. | `nexmo.provider.ts` |
| `nexmoPhoneNumber` | string | — | tenant | Nexmo/Vonage sender/From phone number for this tenant; falls back to env.NEXMO_PHONE_NUMBER. | `nexmo.provider.ts` |
| `clickatellApiKey` | string | — | tenant | Clickatell API key (bearer token) for this tenant; falls back to env.CLICKATELL_API_KEY. | `clickatell.provider.ts` |
| `netgsmUserCode` | string | — | tenant | NetGSM user code for this tenant; falls back to env.NETGSM_USER_CODE. | `netgsm.provider.ts` |
| `netgsmPassword` | string | — | tenant | NetGSM password (secret) for this tenant; falls back to env.NETGSM_PASSWORD. | `netgsm.provider.ts` |
| `netgsmPhoneNumber` | string | — | tenant | NetGSM message header / sender name (msgheader) for this tenant; falls back to env.NETGSM_PHONE_NUMBER. | `netgsm.provider.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Per-tenant behavior

- `twilio.provider.ts:resolveCreds/isConfigured/sendShortMessage` — Twilio credentials are resolved per tenant via SettingService.getValue(tenantId, ...); each tenant authenticates to its own Twilio account, and isConfigured(tenantId) determines whether Twilio is usable for that tenant (else env fallback). Same pattern in nexmo/clickatell/netgsm providers.
- `notification_sms.service.ts:getProvider` — Provider selection is tenant-aware: if the requested/default provider is not configured for the tenant (isConfigured(tenantId) false), it walks the PROVIDER_MAP fallback chain and picks the first provider that tenant has credentials for.
- `notification_sms.service.ts:getProviderForRegion` — Per-region default provider is resolved against the per-tenant configured state (delegates to getProvider(tenantId,...)), so the actual provider used for a given country can differ per tenant based on which providers that tenant has configured.
- `notification_sms.service.ts:assertSmsFeatureAccess` — Outbound SMS is gated per tenant by the subscription feature feature_sms_send (boolean) and feature_sms_monthly_quota (limit) compared against that tenant's TenantUsage.smsSends; root tenant is short-circuited (ungated).
- `notification_sms.service.ts:_sendShortMessage` — On success increments per-tenant usage (TenantUsageService.incrementSmsSends(tenantId,1)) and writes a per-tenant NotificationLog entry (sent/failed) tagged with provider and provider message id; gating is re-asserted at the worker boundary with the job's tenantId.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Tenant-selected SMS provider and the SMS-enabled toggle are never read by the backend. 'smsProvider' and 'smsEnabled' are declared in the keys file and exposed in the per-tenant SMS settings UI (app/.../settings/sms/page.tsx -> PlatformSmsTab), but no service/provider ever calls SettingService.getValue(tenantId,'smsProvider') or 'smsEnabled'. | `notification_sms.service.ts (getProvider / getProviderForRegion / DEFAULT_PROVIDER_NAME)` | A tenant admin who picks a provider or disables SMS in the UI has no effect: the worker still chooses providers via the global env-driven DEFAULT_PROVIDER_NAME and REGION_PROVIDER_MAP and never checks a tenant enable flag. The tenant's stored choice should drive getProvider() and an early opt-out gate. | `smsProvider` |
| Default provider is global, sourced only from env.SMS_DEFAULT_PROVIDER (fallback 'twilio') as a static readonly field. | `notification_sms.service.ts:DEFAULT_PROVIDER_NAME` | Each tenant configures different providers (per-tenant creds already exist), yet the default provider when none is specified is a single platform-wide value rather than the tenant's chosen 'smsProvider'. Should fall back to the per-tenant smsProvider setting before the env default. | `smsProvider` |
| Region-to-provider routing map is global and built once at class load from env.SMS_PROVIDER_MAP (REGION_PROVIDER_MAP), not resolved per tenant. | `notification_sms.service.ts:buildRegionProviderMap / REGION_PROVIDER_MAP` | Routing which provider serves which country is a plausible per-tenant policy (a tenant may want NetGSM for TR but its own Twilio elsewhere), but it is a single static map shared by all tenants. Could be a per-tenant JSON setting overriding the env default. | `smsRegionProviderMap` |
| Per-recipient send rate limit is a single global env value (RATE_LIMIT_SECONDS from env.SMS_RATE_LIMIT_SECONDS, default 60) and the rate-limit Redis key is keyed only by phone number, not by tenant. | `notification_sms.service.ts:RATE_LIMIT_SECONDS / sendShortMessage (rateLimitKey = `sms:rate-limit:${to}`)` | The throttle window is identical for every tenant and, because the key omits tenantId, two tenants messaging the same number share one limit (cross-tenant interference). A per-tenant rate window and tenant-scoped key would make throttling configurable and isolated. | `smsRateLimitSeconds` |
| Allowed-country allowlist is global, derived from env.SMS_ALLOWED_COUNTRIES and applied uniformly in isAllowedCountry(). | `notification_sms.service.ts:ALLOWED_COUNTRIES / isAllowedCountry` | Which destination countries a tenant may send to is a plausible per-tenant compliance/cost policy, but it is a single platform-wide allowlist applied to all tenants. Could be a per-tenant override setting. | `smsAllowedCountries` |

---

## Dependencies

- `redis`, `env`, `setting` (declared in `module.json`)
- `tenant_subscription` (feature gating), `tenant_usage` (quota counter), `notification_log` (audit), `tenant` (root-tenant check)
- `bullmq` + the shared BullMQ Redis connection (`@/modules/redis/redis.bullmq`)
- `google-libphonenumber` (phone parsing/validation), `axios` / `qs` / `form-data` (provider HTTP)
