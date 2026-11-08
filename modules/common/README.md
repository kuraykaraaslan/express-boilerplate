# Common Module

Cross-module primitives that every other module is allowed to depend on. Exposes the canonical error class, the well-known error-code enum, an error-response helper, and a set of internationalization / value-object primitives (locale, country, currency, timezone, Money, pagination, log context).

Anything added here must be **dependency-free** (no DB, no Redis, no env, no `next/*`, no `react`) so it can be imported safely from the deepest leaf modules without creating cycles. npm **data** libraries with no runtime side effects are allowed — `currency-codes-ts` (already a dependency, used by `payment_core`) is the single source for ISO 4217 codes.

## Worker bootstrap

`server/worker-bootstrap.ts` is the boot sequence of every process that owns background work, with no side effects
on import: `registerRuntimeHooks` (always, first: in-process hooks such as the stored-text overlay of `i18n`'s server
messages, `common:boot_task` phase `runtime`), `registerApprovalHandlers` (always), `startBackgroundJobs` (the module
schedulers, only when `ENABLE_BACKGROUND_JOBS=true`) and `bootRuntime` (all three, in that order). A runtime hook that
route handlers must see keeps its state on `globalThis`: inside the Next server, instrumentation and the route
handlers evaluate a module separately. The schedulers and approval registrars stay in
`instrumentation/*.ts` and are imported lazily; the logger is passed in so `common` keeps no dependency.

Two callers share it. In a single process `instrumentation.ts` runs `bootRuntime` inside the Next server. The Docker
`worker` target runs `scripts/worker.ts`, which starts through `process_host`'s `startProcessHost` (`/healthz` and
`/metrics` on `WORKER_HEALTH_PORT`, default `4010`, a `proc:nodes:worker` heartbeat and a SIGTERM drain), initialises
observability and then calls `bootRuntime`. In split deployments the app must use `ENABLE_BACKGROUND_JOBS=false`
while the worker uses `true`; enabling both creates duplicate schedulers.

A job file never builds its BullMQ `Worker` at module top level: it exports an idempotent `startWorker()` that its
schedule function calls, so importing a job file (an HTTP cron route, a test) never consumes the queue. The
consumer registers itself with `registerWorkerDrain` (`process-hooks`), so SIGTERM closes it and waits for the job
in flight inside `SHUTDOWN_GRACE_MS`. It also records the queue as consumed (`consumedQueues()`), in scope `every`, or `leader`
when a single-owner scheduler task started it (`startBackgroundJobs` runs those inside `withConsumerScope('leader', …)`): the
supervised `worker` reports the oldest wait of the `every` queues only, since more children cannot help a queue only the leader
consumes (docs/phases/14-docker/07 task 7). A module that runs in the worker reports its health with `registerHealthCheck(name, fn)`;
`scripts/worker.ts` passes `collectHealth()` (the worst status wins) to `startProcessHost` as its `health`. `worker-bootstrap.test.ts` fails when a `*.job.ts` / `*.sweep.ts` file
constructs a `Worker` at top level.

`server/build-info.ts` (`resolveBuildInfo`) reads the build identity (`RELEASE_VERSION`, `IMAGE_DIGEST`, `GIT_SHA`).

### Sidecar contract

Every long-running non-Next process (`ws`, `telephony-gateway`, `worker`, later
`iot-gateway` / `iot-worker`) is a thin target over the shared `sidecar` Docker
stage and must:

1. serve `GET /healthz` on its own port (200 unless the health report is `fail`
   or the process is draining),
2. drain on SIGTERM within `SHUTDOWN_GRACE_MS` (default 10 s),
3. heartbeat into the process registry (`proc:nodes:<kind>`),
4. import only pure-Node `@kuraykaraaslan-labs/*` code, never anything that pulls
   `next/server`.

Points 1-3 are met by calling `startProcessHost(...)` from
`@kuraykaraaslan-labs/process_host` (OD-12: the entry depends on `process_host`, never
on `observability`). The same contract is written at the top of the sidecar
stage in the `Dockerfile`; `.github/workflows/ci.yml` smoke-runs every target
and asserts `/healthz` answers and a `proc:nodes:<kind>` heartbeat appears.

---

## Entities

None. This module owns no tables and touches no database — it is a pure infrastructure leaf.

---

## Public API

Import from the barrel `@/modules/common`, or from a specific file. The deep path `@/modules/common/app-error` is preserved unchanged.

```ts
import { AppError, ErrorCode, money, formatMoney, parseLocale } from '@/modules/common';
import { AppError } from '@/modules/common/app-error'; // still valid
```

---

## `storefront-guest-identity.next.ts` — anonymous storefront shoppers

`resolveGuestIdentity(request, cookieName, userId, create)` and `applyGuestCookie(response, cookieName, maxAge, identity)`.

- A signed-in shopper is their userId; an anonymous one is an opaque httpOnly cookie token.
- A signed-in request still carrying the cookie gets `mergeGuestToken` and then `clearGuestToken`, so the caller folds the guest's data into the user's rather than orphaning it.
- Consumers: `commerce_cart` (`sf_cart`) and `commerce_wishlist` (`sf_wish`). Each uses its own cookie, because clearing one surface must not clear the other.

## `signed-webhook.ts` — inbound webhook signatures

`signWebhook(secret, timestamp, rawBody)` and `verifyWebhook({ rawBody, signature, timestamp, secret, previousSecret, nowMs })` implement HMAC-SHA256 over `${timestamp}.${rawBody}`. The rules: a 300 s replay window in both directions, a `sha256=` prefix optional, a constant-time compare, and the previous secret honoured during rotation. When no secret is configured, the request is refused. There is one scheme for every provider callback, and each consumer names its own headers and setting keys. Consumers today: `mail_inbound` (provider webhook) and `commerce_fulfillment` (carrier tracking webhook).

## `server/install-config/` — the installation's config/ (docs/phases/45-install-config)

`defineBrand`, `defineMenu`, `defineAccess` (exported as `@kuraykaraaslan-labs/common/config`; types only, no runtime
imports) give `config/brand.ts` and `config/access.ts` their shape (`defineMenu` stays only so `npm run menu:import` can read an old `config/menu.ts`; the menu is set in Platform → Menu, docs/phases/54-menu-editor). `install-config.dto.ts` holds the
strict zod schemas and `install-config.service.ts` the pure parsers, which throw one `InstallConfigError` naming the file
and the path of every problem (`parseInstallAccess` also checks ids against the permission catalog and grants against
OWNER floors). The runtime accessors `installBrand()`, `installMenu()` and `installAccess()` read each file through its
generated shim (`server/generated/install-config.*.ts`, written by `scripts/config/install-config.mjs`) and cache only a
file that parses. `installRoleLabels` names the viewer's install roles (`sysadmin` for an owner or admin of the root
tenant or a global admin), `installAccessVerdict` what config/access.ts removes and grants them. `app-name.ts` reads
`config/brand.ts` raw for the root layout (name, favicon, default theme, colours) and stays a leaf. Guide:
`docs/guides/install-config.md`.

## `request-observer.ts` — every request, for the AI firewall's feature store

Phase 55 02 §2.1 (D55-21, D55-25). `observeRequest` is called by the proxy (`proxy/observe.ts`: pages, assets, its own answers) and by the
tenant API dispatcher (every answer, with its route template and status); `ai_firewall` registers the one observer at boot
(`setRequestObserver`, held on `globalThis`). Synchronous, never throws, never waits: the observer folds counts in its own process and
writes them later from a timer. `noteRequestPrincipal` / `requestPrincipalOf` keep the caller auth_abac's guard let through beside the
request (ids and the member's role, a WeakMap; never a token). With no observer nothing happens.

## `zod-patch.ts` — PATCH schemas without defaults

**Write every Update/Patch schema as `patchSchema(CreateX)`, never `CreateX.partial()`.** zod 4 keeps `.default()` through `.partial()`, so an empty PATCH body parses to every defaulted field at its default, and `Object.assign(row, dto)` resets those columns. A 2026-09-25 scan (parse `{}` through every exported Update schema) found about 95 such schemas in 50 modules. Examples:

- editing an order's note moved a PAID order back to `DRAFT` and zeroed `grandTotalMinor`;
- a quantity-only line edit set the unit price to `0`;
- toggling a product flag unpublished the product;
- a title-only page PATCH wrote `slug: ''` and `sections: []`.

`patchSchema` unwraps each top-level `optional`/`default`/`prefault` and makes the field plainly optional. Nested defaults inside a value the caller did send are kept. `tests/patch-schemas.guard.test.ts` imports every module's server files and fails if any exported `Update*`/`Patch*`/`Edit*` schema parses `{}` to anything but `{}`.

## `server/axios/axios.client.ts` — the app's API client

Every page's requests go through it: a CSRF token on writes, one token refresh at a time with a queue, a grace window after a refresh, and
retries of a refresh only for a transient failure. A session that cannot go on (expired, revoked, a refused refresh, a replay still refused)
sends the person to the tenant's sign-in page with `?redirect=<the page>&reason=session_ended` (`LOGIN_REASON_SESSION_ENDED`, run 3 #99,
D544): the reason rides only with a safe same-origin redirect, never on the sign-in page itself, and the sign-in page shows its
"Session expired" banner for it (auth README, Login).

## `server/permission-labels.ts` — translated permission and role-template labels

The admin's access-control screens show permission names, descriptions and groups from every module.json, and role
templates contributed to `tenant_member:role_template`. They are translated like menu labels: keys built at run time,
with the manifest English as the fallback, in the **declaring** module's dictionary.

- `<moduleId>.permission.<idSlug>.name` and `.description` (only when the manifest has one);
  `<moduleId>.permissionGroup.<groupSlug>`; `<moduleId>.roleTemplate.<idSlug>.label` / `.description`.
- Slugs never contain a dot: an id keeps `[A-Za-z0-9_]` and turns everything else into `_` (`members.view` →
  `members_view`); a group is lower-cased with runs of other characters folded to one `_`.
- `permissionLabel(t, moduleId, perm)`, `permissionDescription(...)`, `permissionGroupLabel(...)`,
  `roleTemplateLabel(...)`, and the key builders. Pure (no React, no module imports), so `ui/` and `server/` both use it.
- `scripts/i18n/extract.mjs` writes these keys from module.json on a full run, and `--permissions [ids]` only adds the
  missing ones. `scripts/i18n/permission-labels.parity.test.ts` checks every key against en and tr.

## `ui/row-actions-menu.component.tsx` — row action menus

`label` (optional) names the trigger for its row, e.g. `t('...', 'Actions for {{email}}', { email })`; without it the
trigger reads the generic "Row actions". Pass it on every table with more than one row (41-ui-fixes 05 5.2 / 06 4.1).

## `ui/reference-select.*` — pickers and names for a relation

`useReferenceOptions(tenantId, endpoint, config)` bulk-loads one page of a list endpoint (cached per tenant and
endpoint) and returns `options`, `labelFor(id)` (pure) and `ensureLabel(id)` (reads `${endpoint}/${id}` for an id the
page did not cover). `ReferenceSelect` is that list in a searchable `CustomSelect`. Without more, the dropdown only
filters the loaded page, so a record past `pageSize` (default 100) cannot be chosen. Opt-ins, all off by default:

- `searchParam` (e.g. `'search'`, the list contract's name): typing asks the server for
  `{ [searchParam]: text, pageSize, ...params }`, debounced 250 ms; a stale answer is dropped, "Searching…" shows while
  nothing matches yet, and the selected value keeps its name. Use it for every picker over a list that can pass one page
  (employees, members).
- `labelKey` may be a dotted path (`'user.email'`) or a list taking the first non-empty one
  (`['displayName', 'user.email']`).
- `resolveById: false` when the detail route is not keyed by the value (`/api/members/{tenantMemberId}` for a `userId`).
- `maxPages`: read several pages up front (a report that lists everyone at once).
- `excludeValues` (component): values never offered, e.g. the employee being edited as their own manager.

Names found by `ensureLabel` or a search are shared by every hook on the same endpoint, so a list column, a filter chip
and a picker agree. `useReferenceLabels(tenantId, endpoint, ids, config)` calls `ensureLabel` for the ids a list shows,
once the page is loaded; `referenceFilterField({ id, label, tenantId, endpoint, searchParam, labelFor, … })` is a
`DataTable` filter (`type: 'custom'`) holding one picked id. `reload()` asks a failed page again. `CustomSelect` gained
the matching optional props: `onSearchChange`, `filterLocally` (default true), `searching` and `selectedOption`.

## `common.member-lookup.ts` — members by name or e-mail (`common:member_lookup`)

For modules that store bare user ids (a loyalty account's `userId`) and need to find a member by name or e-mail, or show
who an id is, without requiring `tenant_member` or `user`. Point `common:member_lookup` (pattern `first`, in-tree only);
`tenant_member` contributes it.

- Contract `MemberLookup`: `search(tenantId, text, { limit, match? })` and `resolve(tenantId, userIds)`, both answering
  `MemberRef = { userId, name | null, email | null }`. `match: 'name'` matches the name only, never the e-mail: for a
  caller not allowed to see e-mails, so the limit counts name matches (drive's member picker, 41-ui-fixes/10 3.3). Only the tenant's ACTIVE members, never another tenant's people;
  a search answers at most `MEMBER_SEARCH_MAX` (25), a resolve takes at most `MEMBER_RESOLVE_MAX` (200) ids.
- Consumers call `searchMembers(tenantId, text, { limit })` → `MemberRef[]` and `resolveMembers(tenantId, ids)` →
  `Map<userId, MemberRef>` (lower-case keys). Both clamp the bounds, drop non-uuid ids and answers for ids nobody asked,
  and degrade instead of throwing: no contribution active for the tenant, or a failing one (logged), is `[]` / an empty
  map, so the consumer shows the bare id and a text search finds nobody.
- A `MemberRef` carries an e-mail: show it only behind an admin-level permission, never where a member-level permission
  reaches. First consumer: loyalty's accounts list (docs/phases/17-loyalty/06-ui-fixes 3.5).

## `app-error.ts` — errors

| Export | Kind | Use |
|---|---|---|
| `AppError` | class | Throw inside services. Carries `statusCode` (HTTP), a `code` (`ErrorCode`), and `retryable` (default `false`). `toJSON()` returns `{ code, message, retryable }`. |
| `ErrorCode` | const object + type | Every well-known error code and the matching union type. |
| `toErrorResponse(error)` | function | Normalize an unknown error into `{ code, message }` for API responses. |
| `statusCodeFor(error)` | function | `error instanceof AppError ? error.statusCode : 500`. Replaces the repeated inline check in route handlers. |
| `isRetryable(error)` | function | `error instanceof AppError ? error.retryable : false`. Lets BullMQ workers / SDKs decide retry-vs-fail-fast. |

Constructor is backward compatible — existing 3-arg calls still work; pass `{ retryable: true }` as the optional 4th arg:

```ts
throw new AppError('Gateway timed out', 503, ErrorCode.INTERNAL_ERROR, { retryable: true });

// route handler
catch (err) {
  return NextResponse.json(toErrorResponse(err), { status: statusCodeFor(err) });
}
```

### Error-code groups

Authentication & Session, Authorization, Tenant, Billing, Rate limiting, Resources, **Internationalization & Jurisdiction** (`UNSUPPORTED_CURRENCY`, `UNSUPPORTED_LOCALE`, `UNSUPPORTED_TIMEZONE`, `COUNTRY_RESTRICTED`, `TAX_JURISDICTION_ERROR`, `CURRENCY_MISMATCH`), Server. Add new codes under the matching group — don't reuse `INTERNAL_ERROR` as a catch-all.

---

## `common.locale.ts` — BCP-47 locales

| Export | Kind | Use |
|---|---|---|
| `LocaleCodeEnum` | Zod enum | Registry-validated BCP-47 string (back-compat alias of `LocaleSchema`). |
| `LocaleCode` | type | `z.infer<typeof LocaleCodeEnum>`. |
| `DEFAULT_LOCALE` | const | `'en-US'`. |
| `LOCALES` | array | `{ code, label, nativeLabel }[]` for dropdowns. |
| `isLocaleCode(v)` | guard | Well-formed + IANA-registered check. |
| `LanguageCodeEnum` | Zod enum | Language subtags, single-sourced from localization: ISO 639-1 minus the withdrawn subtags (`sh`) plus the ISO 639-3 Turkic minority languages. Before DUP-05 the set was derived separately here, so the validator and the picker could disagree. |
| `parseLocale(input?)` | function | Normalises casing/underscores, resolves a bare language (`tr` → `tr-TR`), returns `null` if unknown. |

```ts
parseLocale('tr');     // 'tr-TR'
parseLocale('EN-us');  // 'en-US'
parseLocale('zz');     // null
```

---

## `common.country.ts` — ISO 3166-1 alpha-2

**Single-sourced from `modules/localization`** through build-time codegen
(`npm run gen:localization-codes` → `common.codes.generated.ts`). This file used
to derive its own list from the `countries-list` package while every admin
picker rendered localization's list — and the two disagreed exactly where it
hurt: the Turkic regions are in the picker but have no ISO alpha-2, so choosing
Northern Cyprus in the tax-rate form returned 400 (DUP-05). That flagship case is
now fixed at the source rather than at the picker — the reference data carries the
TRNC as the country `CT`, so it is in the enum. `common` cannot import
`localization` at runtime (localization/ui imports common — the edge would be a
cycle), hence codegen rather than a re-export.

| Export | Kind | Use |
|---|---|---|
| `CountryCodeEnum` | Zod enum | Sovereign ISO 3166-1 alpha-2 (252 codes). The fiscal/logistics set. |
| `CountryCodeInput` | Zod | The DTO-boundary form (upper-cases first). Use this, not the raw enum. |
| `CountryCode` | type | `z.infer<…>`. |
| `COUNTRIES` | array | `{ code, name, native }[]`. |
| `isCountryCode(v)` | guard | Membership check (uppercase). |
| `REGION_PSEUDO_CODES` | array | Non-ISO region codes (the Turkic regions and peoples) — deliberately **not** in the enum. |
| `isRegionPseudoCode(v)` | guard | Recognise a region so a caller can give a real error instead of "invalid enum". |

> **Picking a picker.** A field validated by `CountryCodeInput` must render
> `SOVEREIGN_ALPHA2_OPTIONS` from localization. `COUNTRY_ALPHA2_OPTIONS`
> (regions included) is for display/targeting fields only.

---

## `common.currency.ts` — ISO 4217

| Export | Kind | Use |
|---|---|---|
| `CurrencyCodeEnum` | Zod enum | `z.enum(codes())` from `currency-codes-ts` — same source as `payment_core`. Deliberately **not** folded into the localization codegen: both sides are plain ISO 4217 with no policy divergence, and localization's 162-entry list is a display subset that drops fund/metal/test codes (`XAU`, `XXX`, `CLF`…), so narrowing to it would reject valid data for no gain. |
| `CurrencyCode` | type | `z.infer<…>`. |
| `DEFAULT_CURRENCY` | const | `'USD'`. |
| `isCurrencyCode(v)` | guard | Membership check (uppercase). |

---

## `common.timezone.ts` — IANA timezones

| Export | Kind | Use |
|---|---|---|
| `TIMEZONES` | `string[]` | `Intl.supportedValuesOf('timeZone')`, computed once. |
| `canonicalTimezone(v)` | function | The runtime's own name for a zone or an alias of one, or `null`: `v` when it is listed, else the zone `Intl` resolves it to when that one is listed. ICU keeps `Asia/Calcutta` / `Europe/Kiev` and lists no `Etc/UTC`, while browsers may report `Asia/Kolkata` / `Europe/Kyiv`; both spellings land on one name. IANA casing is required (`europe/istanbul` is `null`). |
| `isTimezone(v)` | function | Case-sensitive membership check, aliases included (`canonicalTimezone(v) !== null`; also accepts the `UTC` default, which Intl omits in some runtimes). |
| `TimezoneSchema` | Zod schema | `z.string().refine(isTimezone, 'Invalid IANA timezone')`, then canonicalised: an alias is stored under the runtime's own name. |
| `Timezone` | type | `z.infer<…>` (string). |
| `DEFAULT_TIMEZONE` | const | `'UTC'`. |

---

## `common.money.ts` — Money value object

| Export | Kind | Use |
|---|---|---|
| `MoneySchema` | Zod schema | `{ amount: number, currency: CurrencyCodeEnum }`. |
| `Money` | type | `z.infer<…>`. |
| `money(amount, currency)` | function | Construct a `Money`. |
| `formatMoney(m, locale?)` | function | `Intl.NumberFormat` currency string; Intl handles minor units (JPY 0, KWD 3). Defaults to `DEFAULT_LOCALE`. |
| `addMoney`, `subtractMoney` | functions | Same-currency arithmetic; throw `AppError(…, 422, CURRENCY_MISMATCH)` on mismatch. |
| `multiplyMoney(m, factor)` | function | Scale by a unitless factor. |

```ts
formatMoney(money(1234.5, 'USD'), 'en-US'); // "$1,234.50"
formatMoney(money(1234, 'JPY'), 'en-US');   // "¥1,234"
addMoney(money(10, 'USD'), money(5, 'EUR')); // throws CURRENCY_MISMATCH (422)
```

---

## `common.phone.ts` — Phone value object

Backed by **`libphonenumber-js/max`**. The `max` metadata set is required, not a
preference: the default (`min`) can only check length, so `+9012` would pass —
`telephony.phone.test.ts` pins two cases that fail the moment someone shrinks
this import. **Never import this module from a client component**; the phone
FIELD (`localization/ui/phone-input.component`) uses `/min` for typing feedback
and lets the server be the authority.

| Export | Kind | Use |
|---|---|---|
| `E164Schema` / `E164` | Zod schema / type | `^\+[1-9]\d{1,14}$` — the stored form. |
| `parsePhone(input, region?)` | function | `{ e164, regionCode, national }`, or `null`. Checks validity, not just parseability. Never throws. |
| `toE164(input, region?)` | function | The canonical key alone — for indexing and lookups. |
| `formatPhone(e164, region?)` | function | National rendering for display; falls back to the input. |
| `requireE164(input, region, label?)` | function | **Strict.** Canonical form, or `AppError(…, 400, VALIDATION_ERROR)` naming the field. Empty in → `null` out. |
| `normalizeE164Lenient(input, region?)` | function | **Lenient.** Canonical when parseable, the trimmed input otherwise. |
| `normalizePhoneFields(dto, fields, region, mode?)` | function | Canonicalize a DTO's phone columns in one pass. Only touches keys actually present, so it is safe on a PATCH body. Returns a new object. |

**Strict or lenient is the caller's decision, and both are load-bearing.**
`requireE164` for a form a person filled in — they are at the keyboard and can
fix it, and a silently-stored typo is a number that never connects.
`normalizeE164Lenient` for a payload a third party sent (SCIM, payment gateways,
carrier webhooks, SIP signalling): rejecting one malformed number must not fail
a 4000-user sync or refuse a live call.

The `region` is the tenant's — `resolveTenantCountry(tenantId)` from
`tenant_setting`. It is only consulted for input written in national form; a
number already in `+…` form ignores it, so a US number in a Turkish tenant is
never re-homed.

```ts
const region = await resolveTenantCountry(tenantId);
const input = normalizePhoneFields(dto, ['phone'], region);   // throws on junk
await repo.save(repo.create({ tenantId, ...input }));
```

---

## `common.pagination.ts` — pagination envelopes

| Export | Kind | Use |
|---|---|---|
| `PaginatedResult<T>` | interface | `{ items, total, page, limit, pageCount }`. |
| `CursorPage<T>` | interface | `{ items, nextCursor, hasMore }`. |
| `PaginationDTO` | Zod DTO | `page` (≥1, default 1), `limit` (1–100, default 20), both coerced. |
| `PaginationInput` | type | `z.infer<…>`. |
| `paginate(items, total, page, limit)` | function | Wraps a page slice, computing `pageCount` via ceiling division. |

---

## `common.log-context.ts` — structured logging

| Export | Kind | Use |
|---|---|---|
| `LogContext` | interface | Optional `tenantId`, `userId`, `requestId`, `traceId`, `region` — the minimum fields every structured log entry should carry. |

---

## `common.hash-chain.ts` — tamper-evident row hashing

`chainedRowHash(prevHash, content)` = `sha256(prevHash + canonical(content))`.
Each row links to its predecessor, so an after-the-fact edit breaks the chain
from that row on and a verifier can name where.

Three modules — `audit_log`, `wallet`, `approval` — had written this
independently, and the copies had drifted in a way their own comments hid: both
`wallet` and `approval` describe themselves as mirroring `audit_log`'s
canonicalisation, and neither canonicalised anything. Harmless while they hash
only scalars; not harmless the first time either row gains a jsonb column,
because the same logical content would hash differently by key order and the
verifier would report tampering that never happened.

**Byte-compatible with all three**, because every chain in the database was
written by one of them:

| | why |
|---|---|
| top-level key order is the CALLER's | it is baked into every stored hash; sorting here would rewrite all of them |
| nested objects are key-sorted | what makes a jsonb column safe |
| `Date` → ISO string | what all three did inline |

A test hashes the three originals, copied verbatim, against the shared helper.

**The verifiers are deliberately not shared.** `wallet` walks by `seq`,
`audit_log` by `createdAt`, and `approval` follows the `prevHash` links because
its rows can tie on the millisecond — sorting there produced the repo's
best-known flaky test. Three correct answers to "what order were these
written in", one per table; unifying them would impose one table's answer on
the others.

## Settings

None. This module reads no settings and exposes no admin-settings keys.

---

## Rules

- No imports from `@/modules/*` except other items in `common/`.
- No `next/*`, no `react`, no browser APIs, no DB / Redis / env access. (Pure npm data libs like `currency-codes-ts` are allowed.)
- Domain enums use Zod (`z.enum`), never TS `enum`; types derive via `z.infer` / `type`.
- Keep this module tiny — it is loaded by everything.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-11.

No per-tenant variability in the primitives themselves — they are dependency-free constants/validators. They are the *foundation* tenants build on: a tenant may pick its own `DEFAULT_LOCALE`, `DEFAULT_CURRENCY`, or company timezone, but that selection lives in tenant settings elsewhere; this module only guarantees the canonical spelling and validation.

---

## Dependencies

None (`requires: []`). This is a leaf module; every other module may depend on it.
