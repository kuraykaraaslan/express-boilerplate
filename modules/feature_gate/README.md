# Feature Gate

Plan-based feature gating, as a leaf. Answers **"is this tenant allowed to do X"**
and nothing else: it owns no table, no screen, no setting, and knows nothing
about plans, prices or subscriptions.

## Why it exists

Fifteen modules ask that question — `ai`, `api_key`, `commerce_catalog`,
`dynamic_page`, `gift_card`, `integrations_hub`, `invoice`, `notification_mail`,
`notification_sms`, `storage`, `tenant`, `tenant_invitation`, `tenant_member`,
`tenant_usage`, `webhook`. Until 2026-08 they asked it by importing
`tenant_subscription`, the **tenant billing rail**, and therefore had to
`require` it. A mail queue could not be installed without the module that sells
plans to tenants.

It also made the dependency graph unreadable. Every one of those modules is
imported *by* something the rail imports back, so each closed a cycle: five of
the repo's unexpected mutual-import pairs (`invoice`, `notification_mail`,
`tenant_member`, `commerce_catalog`, `tenant_usage`) existed for no reason other
than this one call — and it is why `tenant_subscription` had to be exempt from
the drift report at all. Extracting the gate is what let the rail leave that
exemption (audit 2026-08, **DUP-01 step 5**).

Three modules — `invoice`, `gift_card`, `integrations_hub` — turned out to
`require` the billing rail *only* for the gate; those declarations were deleted
as phantoms in the same pass.

## What it owns

| Piece | Responsibility |
|---|---|
| `feature_gate.service.ts` | The policy. What `BOOLEAN` and `LIMIT` mean, how `gracePercent` widens a ceiling, that a lapsed arrangement refuses while one inside its grace window does not, and the fan-out over entitlement sources. |
| `feature_gate.cache.ts` | The Redis copy (`feature:sub:<tenantId>`, 5 min TTL) and the best-effort audit row per decision. |
| `feature_gate.keys.ts` | `FEATURE_KEYS` — the canonical key vocabulary, so no caller hard-codes a string. Plus `moduleFeatureKey` / `bundleFeatureKey` for module and bundle entitlements. |
| `feature_gate.types.ts` | `FeatureAccessResult`, `EntitlementState`, `EntitlementSource`. |
| `feature_gate.pieces.ts` | Sellable pieces (ADR-0015): the `feature_gate:pieces` declaration shape (zod), the derived keys `bundle:<moduleId>_<pieceId>` / `bundle_<moduleId>_<pieceId>`, `definePieces`, and who owns a piece key (`pieceOwners`, `foreignPieceKeys`). Pure: client, server and scripts read it. |
| `feature_gate.pieces.registry.ts` | The declarations of the build, read from the contributions' metadata (system context, validated, memoised per process); `declaredPieceOwners`, which tenant_subscription reads so a module never sells or comps another module's piece. |
| `feature_gate.piece-check.ts` | The one piece check every module that sells pieces calls (`pieceStates`, `isPieceOpen`, `openPieces`); the only reader of the ceiling for pieces. |
| `feature_gate.pack-build.ts`, `feature_gate.pack-ticket.ts`, `feature_gate.pack-mark.ts`, `feature_gate.protected-packs.ts` | Protected packs (dashboard phase 33, ADR-0016): paid client content served behind a ticket instead of as a public chunk. A module declares its packs through the metadata point `feature_gate:protected_packs`; `scripts/build-protected-packs.mts` bundles each one (its own files only, the declared host modules read from the page's registry, any other import fails the build) into `.protected-packs/` before `next build`. The owning module issues tickets from its own route through `issuePackTicket` (10 minutes, a fresh mark, a strict audit row `feature_gate.pack.ticket`, no row = no ticket); `GET /api/feature_gate/packs/[moduleId]/[packId]?t=` serves a pack only to a ticket for exactly that tenant, module and pack, with the ticket's mark written into its numbers. |
| `ui/protected-pack-licence.ts`, `ui/protected-pack-loader.ts` | Inside every pack, the browser check of the deployment's signed licence (Ed25519 with WebCrypto, the licence's `origins` against the page; localhost and a build without a vendor key are allowed), and the browser's loader of protected packs. |
| `server/testing/pieces.contract.ts` | `@kuraykaraaslan-labs/feature_gate/testing`: `checkPieceDeclarations` for a module's own tests. |

## Extension point

### `feature_gate:entitlement_changed` — told when a tenant's entitlements changed (2026-10-17)

```ts
const listener: EntitlementChangeListener = {
  async entitlementChanged(tenantId) { /* idempotent: re-derive what depends on the entitlement */ },
}
export default listener
```

`invalidateFeatureCache(tenantId)` (the service's, which every caller uses) drops
the cache and then announces the change through this fanout, **detached**: every
write that changes an entitlement already calls it after it commits, so that is
the moment, and the write never waits for (or fails on) a listener. Platform gate.
A listener must be idempotent and keep its own periodic reconcile: a detached
announcement can be lost, and a catalogue edit that changes many tenants at once
is not announced per tenant. First listener: `tenant_domain` (custom domains
suspended or reactivated with the plan).

### `feature_gate:pieces` — sellable pieces inside a module (2026-10-23, ADR-0015)

A metadata-only catalog point. A module that sells part of itself piece by piece declares each piece here, one contribution
per piece under its own module id: the key is the piece id (a lower-case letter, then letters and digits, **no underscore**,
at most 24), the metadata `{ label, description? }` in English, the export its `<module>.piece-list.ts` (`definePieces`, the
readable twin the module's test pins with `checkPieceDeclarations`). The keys are derived, never written: the entitlement key
`bundle:<moduleId>_<pieceId>` and the catalogue product `bundle_<moduleId>_<pieceId>`; both must pass the licence allowlist
and the catalogue's bundle key (pinned by `tests/feature_gate.pieces.test.ts`).

The piece check (`feature_gate.piece-check.ts`) reads the declarations and answers `pieceStates(tenantId, moduleId, { only?, audit? })`
in this order: the licence ceiling (an explicit `false` closes; a licence opens only the module's declared keys it names
`true`; a licence naming none of them opens the module's core only; a `null` ceiling (no licence, under the default `unrestricted`
unlicensed policy) says nothing; the `core` policy answers an empty ceiling, which closes every piece, for ROOT and with
monetization off too), then ROOT, then monetization off,
then `checkFeatureAccess(...).allowed === true`. Any failure, a piece the build does not declare included, is a 503
(`details.reason` `piece_check_failed`); it never reads the contributor state. A module calls it and never imports
`feature_gate.ceiling.ts` (`tests/feature_gate.license-readers.architecture.test.ts`). Without `only`, it answers in the
registry's order (each entry's `order`, then the piece id), not the module's `definePieces` order; a module that needs its own
order passes `only`. Users today: `dashboard_scada`, `dashboard_viewer`. Module author's how-to: `docs/guides/sellable-pieces.md`.

### `feature_gate:entitlement_source` — where entitlements come from

```ts
// (tenantId) => Promise<EntitlementState | null>
const resolve: EntitlementSource = async (tenantId) => ({
  status: 'ACTIVE',              // ACTIVE/TRIALING grant; PAST_DUE grants inside its window
  gracePeriodEndsAt: null,       // ISO string, or null
  features: [{ key: 'feature_email_send', type: 'BOOLEAN', value: 'true' }],
})
export default resolve
```

`null` means **this source has no arrangement for that tenant** — meaningfully
different from a state whose `status` is not live. The first says "not my
customer", the second says "my customer, and they have lapsed".

Four rules:

1. **Sources are additive.** A tenant holding both a subscription and a granted
   bundle gets the union. Merging rather than picking a winning source is what
   lets a second source be added later without re-deciding precedence per key.
   Since 2026-10-17 that is literal (`mergeFeatures`): one row per key, the most
   generous one — a BOOLEAN `true` wins, a LIMIT keeps the highest ceiling and
   `-1` beats any number. Before, the first source's row won (feature_gate.03).
   **Usage packs** (2026-11-01, docs/phases/53-setting-levels 53.9, D170): a LIMIT
   row marked `additive` is not a ceiling of its own; each such row adds its value
   to that most generous ceiling (two packs held, two rows, both added). It adds
   only to a LIMIT some source declares, since a quota nobody declares is unlimited
   and a pack alone would cap it; an unlimited ceiling stays unlimited and an
   unlimited pack makes it unlimited. The merge is the pure `feature_gate.merge.ts`.
2. **`grantsAll: true` is a wildcard** for arrangements that are not a feature
   list at all — the platform operator, a comped account. Without it the ROOT
   bypass would have had to be expressed as an exhaustive feature list that every
   new key silently breaks.
3. **Throwing fails the check closed** (500). "Cannot answer" is not "absent",
   and granting an entitlement nobody verified is how paid features leak.
4. **It runs on the cache-miss path of a hot check** — keep it to indexed reads.

`tenant_subscription` contributes today's answer
(`tenant_subscription.entitlement-source.ts`): its subscription row plus the
plan's feature rows, with ROOT reported as a wildcard. Since 2026-10-17 it
contributes a second source as well (`tenant_subscription.catalog-feature-source.ts`):
the features of the tenant's catalogue plan (`custom_domain`, `max_domains`, …,
defaults the sysadmin edits). The ROOT special case
lives on that side deliberately — "the platform operator is not bound to a plan"
is a statement about *that rail's* arrangement, not a general truth about
entitlement, and keeping it there means the gate needs no `tenant` import, which
would have re-closed one of the cycles this split removes.

### `feature_gate:entitlement_ceiling` — a deployment-wide cap (fleet 3b.10, F23)

A provider point, separate from the sources because a source is additive and would grant. Each contributor exports
`EntitlementCeilingProvider { ceiling(), baseline() }`. `checkFeatureAccess` applies the combined ceiling after the
additive merge, as a minimum: a BOOLEAN is on only when plan and ceiling both say on, a LIMIT is the smaller (`-1`
loses to any finite value). It also caps the ungated answers (no source installed, a wildcard arrangement). A key no
contributor names, or no contributor at all, changes nothing; on a key the plan never declared a ceiling can only add
a refusal. A `ceiling()` that throws or hangs (2 s) is replaced by that contributor's `baseline()`, never deny-all; an
unloadable contributor or a throwing `baseline()` fails the check closed (500). Resolved in a system context and
memoised per process for 10 s (1 s when degraded); a contributor whose answer changed calls
`invalidateEntitlementCeiling()`. The one contributor today is `fleet_license` (the platform license, allowlisted keys
`tenants`, `module:<id>`, `bundle:<key>`).

### Deployment-wide limits (fleet 3b.11)

`feature_gate.deployment-limit.ts` answers counts that belong to no tenant plan (customer tenants, nodes, regions) from
the ceiling alone: `checkDeploymentLimit(key, current)` allows while `current` is below a LIMIT cap (no grace), always
for `-1` or an uncapped key, never for a BOOLEAN off or `0`. `assertDeploymentLimit` also writes the
`fleet.license.limit_blocked` audit row and throws the 403 `FEATURE_NOT_AVAILABLE` with the numbers. The caller counts
its own rows; a caller that must serialise creations (`tenant`, under an advisory lock) uses
`evaluateDeploymentLimit`, `recordLimitBlocked` and `deploymentLimitError` inside its transaction.
`deploymentCaps()` lists every cap for the console.

## No source installed = no gating

With zero sources registered the gate **allows**, unlimited.

That is the point of the split rather than a loophole. Before it, those fifteen
modules could not exist without the billing rail, so "no rail" was unreachable.
Now it is reachable, and it means *nothing here sells plans* — an install with no
subscription module must not have its own mail queue refuse to send. It stays
sharply distinct from a source that is installed and answers no.

## Usage

```ts
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service'
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'

// Refuse with a 403 the caller does not have to shape:
await FeatureGateService.assertFeatureAccess(tenantId, FEATURE_KEYS.FEATURE_EMAIL_SEND)

// LIMIT with a live count, plus a 20% soft ceiling:
await FeatureGateService.assertFeatureAccess(
  tenantId, FEATURE_KEYS.MAX_MEMBERS, currentMemberCount, { gracePercent: 20 },
)

// Decide for yourself:
const { allowed, limit, inGrace } = await FeatureGateService.checkFeatureAccess(
  tenantId, FEATURE_KEYS.MAX_PRODUCTS, count,
)
```

Omitting the count on a `LIMIT` key asks *"is this feature available at all"*
rather than *"may I add one more"*, and is allowed rather than refused.

After anything that changes what a tenant is entitled to, drop the cache:

```ts
await FeatureGateService.invalidateFeatureCache(tenantId)
```

## `declared` — "never heard of it" is not "no"

A BOOLEAN result carries `declared`, and a gate that ignores it is a gate that
breaks the day it ships.

`checkFeatureAccess` returns `allowed: false` in two very different situations:
a live plan that names the key and sets it false, and a key no plan has ever
mentioned. Every tenant is in the second state on the day a new entitlement
gate lands, so treating the two the same revokes a live capability for all of
them — the regression commerce plan 09 §6.1/2 forbids for LIMITs, which means
exactly as much for entitlements.

LIMIT results do not carry the flag because `type === 'LIMIT'` already proves
the key was found; that is why the `max_variants_per_product` guard could be
written before this existed.

**The shape a new entitlement gate should have:**

```ts
const result = await FeatureGateService.checkFeatureAccess(tenantId, moduleFeatureKey('x'))
  .catch(() => null)                       // an outage must not block the domain
if (result?.type === 'BOOLEAN' && result.declared && !result.allowed) throw …
```

## Enforcement survey (2026-09-03)

A plan feature that nothing reads is a promise the product sells and does not
keep. `api_rate_limit` was in that state until DEP-12 was closed, and a sweep of
every key in `feature_gate.keys.ts` found it was not alone. Recorded here so the
gaps are visible rather than rediscovered.

**Enforced** — the `feature_*` service-gating family (AI, mail, SMS, storage,
webhooks, API keys, invoicing, gift cards, integrations, multi-warehouse,
promotion rules, product feeds, monthly orders), plus `max_members`,
`max_products`, `max_variants_per_product`, `max_languages`,
`max_dashboard_boards`, `max_dashboard_custom_widgets`, and — since 2026-09-03 —
`api_rate_limit`, `custom_domain` and `max_domains`.

**Superseded, not missing.** Four keys in the older top block were replaced by
the `feature_*` family and are dead rather than unenforced. They stay in the enum
because a stored plan row may still carry one, and deleting the constant would
not delete the row:

| dead key | the key that replaced it |
|---|---|
| `ai_features` | `feature_ai_chat` |
| `max_ai_requests` | `feature_ai_monthly_tokens` |
| `storage_gb` | `feature_storage_quota_bytes` |
| `api_access` | `feature_api_keys` |

**Genuinely unenforced** — each one a feature a plan can sell today with nothing
reading it:

| key | where the gate would go | note |
|---|---|---|
| ~~`max_invitations`~~ | ✅ `tenant_invitation` send, 2026-09-03 | means OUTSTANDING invitations — see below |
| ~~`max_categories`~~ | ✅ `commerce_catalog` category create, 2026-09-03 | mirrors `max_products` next door; the count is only read when a plan declares a ceiling |
| ~~`sso_login`~~ | ✅ `auth_saml` **enable**, 2026-09-03 | gated where the SALE is, not at login — see below |
| ~~`audit_logs`~~ | ✅ `audit_log` list + export, 2026-09-03 | the READ only — see below |
| ~~`advanced_analytics`~~ | ✅ `analytics` funnel/cohort/sources/devices, 2026-09-03 | the line was the blocker, and it was the owner's to draw — see below |
| `priority_support` | — | **not enforceable in code, and should not be.** It is an SLA promise about response times; the only way to "enforce" it would be to refuse or deprioritise tickets, which is an operational routing decision. It belongs in a support queue's ordering, if anywhere |

**`max_members` was enforced and still leaked.** Both seat checks — invite, and
direct add — counted ACTIVE members only. A pending invitation reserved nothing
and `accept()` never consulted the plan at all, so a tenant one seat below a
5-seat plan could send fifty invitations, each passing a check that saw four
members, and every acceptance walked in. The ceiling is now checked against
members *plus* unclaimed seats, contributed through the
`tenant_member:seat_reservation` point (`tenant_member` is the primitive
invitations are built on, so it must not import them back). The check stays at
ISSUE time for the same reason `sso_login` does: refusing an invitee at the
moment they click their link punishes the one person in the story who did
nothing wrong and cannot act on the refusal.

**`max_invitations` means outstanding, not cumulative.** Counting invitations
ever sent was the other reading available and it is the wrong one — it would bill
a tenant forever for staff turnover, and a five-year-old company would find
itself unable to replace a leaver. Outstanding invitations are a real, recurring
cost (each is a mail we send and a live credential) and the ceiling frees itself
as they are accepted, declined or expire.

**An undeclared LIMIT is not a limit of zero.** `assertFeatureAccess` refuses
anything a live plan does not mention, which is defensible for a boolean
capability and wrong for a ceiling — `max_members` used that helper, so a plan
that simply never listed the key blocked every invitation. Every gate added in
this sweep refuses only a DECLARED limit, and fails open when the gate itself
cannot be read.

**`audit_logs` gates reading, never writing.** The recorder is untouched on
every plan. An audit trail is a security control, and a lapsed subscription that
stops it makes the period around a downgrade — exactly when an account is most
likely to be in dispute, or being emptied by someone on their way out — the one
period with no record. A refused read is reversible the moment the tenant
upgrades; a gap in the record is not, and the tenant would have no way to know
what it lost. Purge and anonymize stay open too: those are erasure duties, and
gating them would trap a tenant holding data it is legally required to delete.
So does `verify`, which returns an integrity verdict rather than history — a
tenant should always be able to establish that the record we hold on its behalf
is intact.

**`advanced_analytics` needed a line, not a gate.** The key read nothing because
nobody had said where "basic" ends. The owner drew it on 2026-09-03: page views,
event counts, summary and plain time series are basic and every plan gets them;
funnel, cohort, source/attribution and device breakdowns are advanced. The split
lands cleanly because the module already routes them separately — `summary` and
`timeseries` answer "how much", the four report endpoints answer "who, from
where, and did they come back", which is the question somebody buys a tier for.
**`track` is never gated**, for the `audit_logs` reason: collection must not
stop, or an upgrade buys a hole where the downgrade was.

**`sso_login` is gated on ENABLING SAML, never on a login**, and the choice is
worth copying. Checking a plan at the login itself means a tenant whose
subscription lapses at 3am finds its whole workforce locked out at 9am — with no
way back in, because the way back in *is* SSO. A billing edge case must not
become an authentication outage. Gating the enable makes a downgrade read as
"you can no longer change this" instead of a locked door, and turning SSO OFF is
never blocked: a tenant must be able to stop using what it cannot pay for.
`auth_sso` (consumer "sign in with Google") is deliberately untouched — that is
not the enterprise feature a plan sells, and gating it would lock out free-tier
users who registered with it.

The pattern for closing one is in `tenant_domain.entitlement.ts`: read the key,
treat UNDECLARED as allowed (never as denied — that would switch a live feature
off for every plan predating the key), fail open on any gate error, and let the
plan win over any per-tenant setting that says the same thing.

## Limiting a countable resource

Do not re-implement "resolve the limit, count, compare, throw". `feature_gate.headroom.ts` is the one wrapper
(docs/phases/31-feature-gate/01); adding a limited resource is one `FEATURE_KEYS` entry plus one call:

```ts
await assertHeadroom(tenantId, FEATURE_KEYS.MAX_DEVICES, {
  count: () => repo.count({ where: { tenantId } }),   // or a number already in hand
  adding: rows.length,                                 // batch: default 1
  freeBaseline: 3,                                     // optional: what an undeclared key gets
  onGateError: 'closed',                               // REQUIRED, no default
  message: DEVICE_MESSAGES.LIMIT_REACHED,
})
```

| Situation | Answer |
|---|---|
| ROOT tenant | unlimited |
| LIMIT `-1` / `n` | unlimited / `n` (+ `gracePercent`) |
| key undeclared, BOOLEAN, or no source installed | `freeBaseline`, else unlimited |
| the gate throws | `'open'` -> unlimited, `'closed'` -> the error propagates |

**Failure policy (P1):** `'open'` for limits that protect UX (boards, widgets, languages), `'closed'` for limits
that protect cost (devices, messages, seats). A refusal is `AppError(message, 403, FORBIDDEN)` with
`{ key, limit, current, adding }` in `details`. `resolveLimit` (never counts), `checkLimit` (non-throwing, with a
probe count), `headroomSnapshot` (usage-vs-plan panel) share the same rules. Adopters: dashboard boards/widgets,
dynamic_page languages, pricing price lists, commerce_catalog products, telephony seats/numbers (wrappers keep
their exported names and error codes).

### Period quotas

`feature_gate.period-quota.ts`: `assertPeriodQuota(tenantId, quotaKey, { used, adding, onGateError })` and the
soft `checkPeriodQuota` -> `{ limit, used, remaining, inGrace }`. The used-so-far number is supplied by the caller;
`tenant_usage` wraps it as `assertMetricQuota(tenantId, metric, ...)` using the metric's declared `quotaKey`
(docs/phases/31-feature-gate/02), so `feature_gate` never imports `tenant_usage`.

## Dependencies

`logger`, `redis`. Deliberately short:

- **`common` is not declared** even though `AppError` and the extension registry
  come from it. `common` is PROTECTED, so declaring it changes nothing at
  runtime — and it *would* close a cycle in the activation graph, because
  `common` is not a leaf (`common → tenant_branding → storage → feature_gate`).
  That non-leafness is MIS-02's recorded debt, not something this module can fix.
- **`audit_log` is reached by a dynamic `import()`** and recorded in
  `ACCEPTED_FORWARD_DRIFT`, for the same cycle (`audit_log → common → …`). The
  audit row is fire-and-forget: a gate decision must not wait on, or be failed
  by, its own audit trail.

## Protected

`feature_gate` is in the PROTECTED set (`module-activation.service.next.ts`).
Disabling it would cascade through fourteen modules, and it has no table, screen
or setting for an operator to be disabling in the first place — it is always on
for the same reason `limiter` is. It is deliberately **not** in `FABRIC`: it
imports only fabric, so it cannot sit in a cycle on its own account, and adding
it there would buy nothing while costing the blindness that set warns about.
