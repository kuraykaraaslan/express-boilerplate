# Webhook Module

Outgoing webhook system. Tenant admins configure HTTP endpoints and subscribe to events. When an event fires, the system signs and delivers a JSON payload to all matching endpoints.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `Webhook` | `webhooks` | Endpoint configuration per tenant |
| `WebhookDelivery` | `webhook_deliveries` | Delivery attempt log |

Both live in the **tenant DB**.

---

## Events

Events are declared by the modules that emit them, through the
`webhook:event_type` extension point (2026-10-22, `docs/phases/40-addon-seams`):
one contribution per event in the module's `module.json`, the event name as the
key and `{ scope, group, label, description }` as metadata, plus a
`<module>.webhook-events.ts` file listing the names for its emit sites. This
module owns no event list, so a new module (an IoT one, say) adds events without
editing it. Every event is delivered only to webhooks owned by the appropriate
tenant — platform-wide events fire on root-tenant webhooks
(`tenantId = ROOT_TENANT_ID`); tenant-local events fire on regular tenant
webhooks.

Examples (the full list is whatever the installed modules declare; `GET …/webhooks/events` returns it):

| Event | Scope | Fired when |
|---|---|---|
| `tenant.updated` | tenant | Tenant name/settings change |
| `member.created/updated/deleted` | tenant | Tenant membership changes |
| `invitation.sent/accepted/declined/revoked` | tenant | Invitation lifecycle |
| `subscription.created/updated/cancelled` | tenant | Subscription lifecycle |
| `subscription.paused/resumed` | tenant | Subscription pause/resume |
| `payment.completed/failed/refunded` | tenant | Payment lifecycle |
| `invoice.created/issued/paid` | tenant | Invoice lifecycle |
| `coupon.created/updated/redeemed/expired` | tenant | Coupon lifecycle |
| `product.created/updated/deleted` | tenant | Store product changes |
| `fulfillment.created/shipped/delivered/cancelled` | tenant | Order fulfillment lifecycle |
| `document.signed` / `identity.verified` | tenant | E-signature / identity verification |
| `api_key.created/deleted` | tenant | API key management |
| `order.created/confirmed/paid/fulfilled/cancelled/refunded` | tenant | Sales order lifecycle (commerce) |
| `cart.created/abandoned/converted` | tenant | Cart lifecycle — `cart.abandoned` is the cart-recovery trigger |
| `return.requested/approved/received/refunded` | tenant | Return (RMA) lifecycle |
| `review.created/approved/rejected` | tenant | Product review moderation |
| `user.created/updated/deleted/suspended` | platform | Global user lifecycle |
| `tenant.created/deleted/suspended` | platform | Tenant lifecycle |
| `plan.created/updated/deleted` | platform | Subscription plan changes |
| `subscription.assigned` | platform | Plan assignment from admin panel |

`webhook.catalog.ts` builds the catalog from those declarations once per
process (metadata only, no code loaded). Both the admin event picker and
`GET …/webhooks/events` consume it. Create, update and the manual trigger refuse
an event no installed module declares for the tenant's scope (422); an update may
keep an already-stored event whose module was removed. A dispatched event that
nobody declares is logged once (the emitter forgot its declaration).
`webhook.catalog.test.ts` checks every declaration (name, metadata, scope
agreement between modules declaring the same event, and that each module's
`.webhook-events.ts` lists exactly its declared events).

**Adding an event:** add the name to `<module>/server/<module>.webhook-events.ts`
and a `webhook:event_type` contribution to the module's `module.json`.

---

## API Routes (tenant-scoped, ADMIN+)

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[id]/api/webhooks/capabilities` | Which webhook actions the caller holds (`{ capabilities }`, below) |
| GET | `/tenant/[id]/api/webhooks/events` | List subscribable events for this tenant's scope |
| GET | `/tenant/[id]/api/webhooks/metrics` | Delivery metrics (`?webhookId=&days=`) |
| GET | `/tenant/[id]/api/webhooks/report` | Time series, failure analysis, auto-disabled endpoints, per-endpoint reliability (`?webhookId=&days=`) |
| GET | `/tenant/[id]/api/webhooks` | List endpoints |
| POST | `/tenant/[id]/api/webhooks` | Create endpoint: 201 `{ webhook, secret }`, the signing secret ONCE |
| GET | `/tenant/[id]/api/webhooks/[wid]` | Get endpoint |
| PATCH | `/tenant/[id]/api/webhooks/[wid]` | Update endpoint |
| DELETE | `/tenant/[id]/api/webhooks/[wid]` | Delete endpoint |
| POST | `/tenant/[id]/api/webhooks/[wid]/rotate-secret` | Rotate the signing secret (OWNER): `{ webhook, newSecret, overlapMs }` |
| POST | `/tenant/[id]/api/webhooks/[wid]/test` | Send test delivery (sync, `event:'test'`) |
| POST | `/tenant/[id]/api/webhooks/[wid]/trigger` | Trigger a real catalog event with a sample payload (async): `{ message, deliveryId }` |
| GET | `/tenant/[id]/api/webhooks/[wid]/deliveries` | List deliveries: `{ data, total }`, list columns only |
| POST | `/tenant/[id]/api/webhooks/[wid]/deliveries/[did]/redeliver` | Re-queue a FAILED / DEAD_LETTERED delivery |
| GET | `/tenant/[id]/api/webhooks/[wid]/deliveries/replay-dead-letter` | How many dead letters the replay would re-send now: `{ count }` |
| POST | `/tenant/[id]/api/webhooks/[wid]/deliveries/replay-dead-letter` | Re-queue every dead letter: `{ message, replayed, skipped }` |

### Answers and refusals the console branches on (docs/phases/41-ui-fixes/12)

Every refusal is an `AppError`; where the console must tell cases apart it carries a stable `details.reason`.

| Route | Answer | Refusals (`status` / `details.reason`) |
|---|---|---|
| POST create | 201 `{ webhook, secret }` — `secret` is the 64-hex signing secret, in this answer only (1.3); list, get and update never carry it | 400 (DTO), 422 (undeclared event) |
| POST rotate-secret | 200 `{ webhook, newSecret, overlapMs }`; `webhook.previousSecretExpiresAt` is the previous secret's end date. Inside an open overlap only the current secret is replaced and `overlapMs` is not applied (1.7) | 404 |
| POST test | 200 `{ delivery }` | 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN` |
| POST trigger | 200 `{ message, deliveryId }` | 422 `EVENT_FILTERED_OUT` + `details.event`, `details.filter` (the endpoint's filter would drop the sample), 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`, 422 undeclared event |
| POST redeliver | 200 `{ message }` | 409 `DELIVERY_NOT_REDELIVERABLE` + `details.status` (the row is PENDING or SUCCESS: already claimed or delivered), 409 `TEST_DELIVERY_NOT_REDELIVERABLE`, 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`, 404 |
| POST replay-dead-letter | 200 `{ message, replayed, skipped }` | 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`; an unknown endpoint is `0 / 0` |

**Dead-letter count before "Replay":** `GET …/webhooks/<wid>/deliveries/replay-dead-letter` → `{ count }`, under the
replay's own permission `webhook.deliveries.replay` (1.4): DEAD_LETTERED rows of the endpoint, test sends excluded, **no
time window** — the replay's own criteria (`webhook.dead-letters.ts` `replayableDeadLetterWhere`). The report's
`reliability.deadLetteredCount` is the same number for a reader of reports. The deliveries list with
`?status=DEAD_LETTERED` is not the same number: its `total` counts test sends too.

**Deliveries list rows** (`WebhookDeliveryListRow`): `deliveryId, webhookId, tenantId, event, status, attempts,
maxAttempts, responseStatus, errorMessage, duration (ms), nextRetryAt, createdAt, updatedAt`. No `payload`,
`requestBody` or `responseBody` (3.8). The legacy `deliveries` key is gone; read `data`.

**Capabilities** (`GET …/webhooks/capabilities`, gated by `webhook.endpoints.read`, 3.1): `{ capabilities: {
createEndpoints, updateEndpoints, deleteEndpoints, rotateSecret, sendTest, trigger, readDeliveries, redeliver,
replayDeadLetters, readMetrics, readReports, readEvents, readSettings, updateSettings } }`, each a boolean from the
PDP for the exact permission its route requires (`WEBHOOK_CAPABILITY_PERMISSIONS`; the settings pair is
`tenant_setting.config.read` / `.update`). A display, not a decision: every route judges again.

### Platform webhooks (root-tenant admins only)

Mirror the routes above under `/tenant/[ROOT_TENANT_ID]/api/webhooks/...`.
The handlers require root-tenant admin auth and bind every operation to
`tenantId = ROOT_TENANT_ID`. There is no separate service or table —
`WebhookService` and the `Webhook`/`WebhookDelivery` tables back both
surfaces.

---

## Service layout

`WebhookService` is the public coordinator (event dispatch, manual (re)delivery,
test delivery, metrics passthrough); the heavy machinery is split into focused
collaborators:

| File | Responsibility |
|---|---|
| `webhook.service.ts` (`WebhookService`) | Dispatch (`dispatchEvent`/`dispatchPlatformEvent`), redeliver/replay, `sendTest`/`triggerEvent`, metrics delegators, the shared `QUEUE` handle |
| `webhook.crud.service.ts` (`WebhookCrudService`) | Endpoint CRUD + `rotateSecret` |
| `webhook.queue.ts` | BullMQ producer (`webhookQueue`) + lazy worker (`startWebhookWorker`, started by the `common:boot_task` consumer phase) + `enqueueDelivery` |
| `webhook.delivery.service.ts` (`WebhookDeliveryService`) | Signed HTTP delivery, retry/dead-letter, circuit breaker |
| `webhook.redeliver.service.ts` | Manual redeliver / dead-letter replay / test send / manual trigger: row claims, plan gate, audit rows |
| `webhook.dead-letters.ts` | `REDELIVERABLE_STATUSES` + `replayableDeadLetterWhere` (what a replay re-sends and the count counts) |
| `webhook.job-resolve.ts` | The worker's side: re-load the endpoint, send only a PENDING row of an active endpoint |
| `webhook.metrics.service.ts` (`WebhookMetricsService`) | `listDeliveries` + aggregate `getMetrics` + the report |
| `webhook.config.ts` | Delivery tuning constants/types + per-tenant `resolveDeliveryConfig` |
| `webhook.filters.ts` | `passesEventFilter` (per-event payload matching) |
| `webhook.crypto.ts` | `signPayload` / `generateSecret` |

---

## Security

Every request carries HMAC signature headers (secret is per-endpoint, never returned via the API). `secret` and
`previousSecret` are field-encrypted at rest (P9-6: the entity's `encryptedColumnTransformer`; secrets stored before the
change are encrypted by the `db:post_deploy` step `encrypt_secrets`). A secret this node cannot decrypt is never signed
with: the attempt fails with `SECRET_UNREADABLE` and follows the retry schedule (an unreadable previous secret is dropped).
The delivery job data carries ids (the delivery's `claimId` among them), the frozen request body, its content type and
the retry-delay list only — never a
secret, the URL, the custom headers or the allowlist (P9-5): the worker re-loads the endpoint by id and opens its secrets
when the job runs (`webhook.job-resolve.ts`), so a rotation or a fixed URL applies to every job still waiting.

**The signing secret is shown once** (41-ui-fixes/12 1.3, decision a): in the create answer (`secret`) and in the
rotation answer (`newSecret`). No other answer carries it. **A rotation while the previous secret is still inside its
overlap window replaces only the current secret** (1.7, decision b revised): the previous secret and its end date are
left as they are, so subscribers still verifying with it keep working until then, and a leaked new secret can be
replaced at once. It used to move the current secret into the overlap slot and drop the one subscribers still verified
with, at once. The row is read locked. The console's confirm says which of the two a rotation will do.

**Manual sends** (41-ui-fixes/12 2.1, decision d): test, trigger, redeliver and replay are each gated by the plan feature
like dispatch (403 `WEBHOOKS_NOT_IN_PLAN`), refused on a disabled endpoint (409 `ENDPOINT_DISABLED`) and audited with the
caller as actor (`webhook.test_sent`, `webhook.event_triggered`, `webhook.delivery_redelivered`,
`webhook.dead_letters_replayed`; resource `Webhook`/`webhookId`). A replay a queue hand-off stopped half way is audited
too, with what was queued, skipped and `failedDeliveryId`. A **triggered** event is marked so the receiver can tell
it from a real one: `manual: true` in the body (a top-level member of the platform envelope, an extension attribute of a
CloudEvent; both signed, since the body is what is signed) and the `X-Webhook-Manual: true` header (read from the stored
body, so its retries and redeliveries carry it too; `X-Webhook-*` is reserved, so a custom header cannot forge or hide it).
A dispatched event has neither, and its bytes are unchanged.

| Header | Signed value | Notes |
|---|---|---|
| `X-Webhook-Signature` | `HMAC-SHA256(secret, body)` | **v1**, legacy — kept during a deprecation window |
| `X-Webhook-Signature-V2` | `HMAC-SHA256(secret, "<timestamp>.<body>")` | **v2**, replay-resistant (preferred) |
| `X-Webhook-Timestamp` | unix seconds | bind the signature to a time; reject stale deliveries |
| `X-Webhook-Signature-Prev` / `-V2-Prev` | as above with the previous secret | only during a secret-rotation window |
| `X-Webhook-Manual` | `true` | only on an event an admin triggered by hand (its body also says `manual: true`) |

**SSRF protection:** webhook URLs are user-controlled, so deliveries are guarded
(`webhook.ssrf.ts`). The destination host is checked at create/update time (sync,
no-DNS pre-check) **and** at delivery time (authoritative DNS resolution, rebinding-
resistant). Private / loopback / link-local / metadata ranges (127/8, 10/8,
172.16/12, 192.168/16, 169.254/16, `::1`, `fc00::/7`, `fe80::/10`, …) are blocked,
redirects are not followed (`redirect: 'manual'`), and an explicit per-webhook
`ipAllowlist` (IPs/CIDRs) is the override for intentionally-internal targets.

### Verification example (Node.js, v2)

```typescript
import crypto from 'crypto';

function verifyWebhook(body: string, timestamp: string, signatureV2: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  // Reject deliveries older than 5 minutes to blunt replay.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureV2));
}
```

---

## Delivery

- Queue: BullMQ (`webhookDeliveryQueue`), concurrency 10
- Timeout, max attempts, and backoff are **per-tenant settings** (see *Settings*); the values below are the defaults:
  - Timeout: 15 seconds per attempt (`webhookRequestTimeoutMs`)
  - Max attempts: 3 (`webhookMaxAttempts`)
  - Backoff: the configured list, one wait per retry — 60s → 5min → 15min (`webhookRetryDelaysMs`)
- **Retry timing** (41-ui-fixes/12 4.2): the job carries the tenant's delay list (frozen at enqueue) and its backoff type
  is `webhook`, a custom strategy the worker installs (its `backoffStrategy` setting is `webhookBackoffStrategy`): retry *n*
  waits the *n*-th delay, a retry past the list the last one. The row's `nextRetryAt` is computed from the same list, so
  it is when the job really runs. (BullMQ's `exponential` used to double the first delay.) A job queued by an older build
  still says `exponential` and keeps BullMQ's own timing; a job with `type: 'webhook'` needs a worker of this build.
- Delivery record updated after each attempt with status, HTTP code, response body (truncated to 4 KB), and duration
- **At most once per request** (41-ui-fixes/12 1.4–1.6, decision c):
  - *Redeliver* claims the row with ONE conditional UPDATE (`status IN ('FAILED','DEAD_LETTERED')` and not a test send,
    with the tenant and endpoint predicates) to a fresh PENDING attempt under a new `claimId`; 0 rows → 409
    `DELIVERY_NOT_REDELIVERABLE`. The job id is deterministic per claim, `redeliver-<deliveryId>-<claimId>`: the same
    claim is one job, a later legitimate redeliver of the same row is a new one. The job runs the row's own
    `maxAttempts` with the tenant's delays. A failed queue hand-off after the claim marks the row FAILED with
    `Queue unavailable: the delivery was not enqueued.` (as `enqueueDelivery` does, webhook.11), which keeps it
    redeliverable — only while the row is still PENDING under that hand-off's own claim.
  - *A job belongs to its claim* (1.5): every enqueue and every claim writes a fresh `webhook_deliveries.claimId`
    (migration `071_webhook_delivery_claim_id.sql`) and puts the same id in the job's data. A job whose id no longer
    matches the row's (a retry or deferred job of an earlier claim, still in the queue after the row was redelivered)
    sends nothing and leaves the row alone. A row written before 071 and a job of an older build carry none and still
    match each other.
  - *Replay* claims each dead letter the same way (test sends excluded, no time window); a row another request claimed
    first is counted in `skipped`, never queued twice.
  - *The worker* sends only for a delivery row that is still PENDING under the job's claim, of an endpoint that still
    exists and is active.
    A row that is no longer PENDING is left alone (nothing sent). A row whose endpoint was disabled since the enqueue (by
    an admin or the circuit breaker) is set to **DEAD_LETTERED with `errorMessage = 'ENDPOINT_DISABLED'`** and nothing is
    sent, so retries, deferred and redelivered jobs stop with the endpoint, and after re-enabling it the row can be
    redelivered or replayed with the other dead letters. Such a row was never sent: the metrics count it as `skipped`
    (its own outcome), not as a failure, in the success rate, the daily chart and the error patterns (3.6, 4.3). A
    deleted endpoint dead-letters the row with `the webhook endpoint no longer exists` (unchanged).

---

## Endpoint configuration

Each endpoint supports optional per-webhook configuration (DB columns added in
`003_webhook_endpoint_capabilities.sql`):

| Field | Purpose |
|---|---|
| `headers` | Extra HTTP headers merged into every request. **Reserved** names (`Content-Type`, `Content-Length`, `Host`, `User-Agent`, `X-Webhook-*`) are rejected at the DTO layer **and** stripped again in `webhook.delivery.service.ts` (defense in depth). Header values are validated single-line (no CR/LF). |
| `eventFilters` | `{ "<event>": { "<dot.path>": value } }`. Before enqueue, the event's payload is matched against the filter for that event — non-matching deliveries are skipped. Events with no filter always deliver. |
| `tags` | Free-form labels for organising endpoints in the admin UI. |

All three are editable from the create/edit modal on the Webhooks admin page and
never expose the signing secret (`SafeWebhook`).

---

## Reliability

- **Per-endpoint rate limit** (`rateLimitPerMinute`, or the `webhookDefaultRateLimitPerMinute`
  setting as fallback): a sliding-window limiter (`checkWebhookRateLimit`, reusing the
  tenant-plan zset algorithm). When an endpoint is over its limit the delivery is **deferred**
  ~60s via a BullMQ delay rather than dropped.
- **Circuit breaker**: `consecutiveFailures` increments on each failed delivery and resets on
  success. When it reaches `webhookCircuitBreakerThreshold` (default 10) the endpoint is
  **auto-disabled** (`isActive=false`, `autoDisabledAt` set) and stops receiving events — including
  the retries and redeliveries already queued (the worker dead-letters them as `ENDPOINT_DISABLED`). The
  admin UI shows an *Auto-disabled* badge; toggling the endpoint back on clears the breaker
  (resets the counter and `autoDisabledAt`). **A test send moves the breaker neither way** (4.2): a
  failed test does not count toward disabling, a passing one does not reset real failures.
- **Pending sweep after a lost job** (D252, `webhook.pending-sweep.ts`): a Redis that lost its data
  lost the delivery jobs, and their rows stayed PENDING for ever. Every 10 minutes (the repeatable
  `webhook-pending-sweep`, re-added by the BullMQ repeat keeper after a data loss; HTTP twin
  `POST /api/cron/webhook-pending-sweep`, CRON_SECRET) the sweep reads, tenant by tenant in each
  tenant's context, PENDING rows whose next attempt was due more than 15 minutes ago (at most 50 per
  tenant and 200 per run, oldest first). A row with a live job is left alone; more than 5 000 live
  jobs and the run does nothing (absence cannot be proven). The others are re-enqueued with the
  **delivery id as the job id** (a second run adds nothing; a finished job of that id is removed
  first) and exactly the job a manual redeliver queues, so the receiver sees the same
  `X-Webhook-Delivery` and a fresh signature over the same bytes; the row keeps its attempt count.
  A row older than a day, or whose endpoint is deleted or disabled, is dead-lettered with a reason
  instead (replay it from the dead letters). SUCCESS, FAILED and DEAD_LETTERED rows are never read.
  The worker ends a job whose row is already SUCCESS or DEAD_LETTERED without sending, so a second
  job of one delivery never sends twice after it ended. At-least-once otherwise: receivers
  deduplicate on `X-Webhook-Delivery`.

---

## Observability & manual trigger

- **Metrics** (`WebhookService.getMetrics`, `GET …/webhooks/metrics`): counts by status,
  success rate over terminal deliveries, average + p95 latency (`PERCENTILE_CONT`), and a
  per-event breakdown over a time window. Surfaced as stat cards on the Webhooks admin page.
  Rows never sent because the endpoint was disabled (`ENDPOINT_DISABLED` dead letters) are `skipped`:
  counted in `total`, not in `byStatus` nor the success rate; the report's days carry them as
  `skipped` too, and neither the error patterns nor the response-code histogram include them (3.6, 4.3).
- **Manual trigger** (`WebhookService.triggerEvent`, `POST …/webhooks/[wid]/trigger`): enqueue a
  real `<event>` delivery with an admin-supplied sample payload to verify an integration
  end-to-end — distinct from `/test` (which sends `event:'test'` synchronously). Available from
  the row actions menu ("Trigger event…"). It bypasses the subscription list (the admin chose the
  event) but **not the endpoint's event filter**: a sample the filter would drop is refused (422
  `EVENT_FILTERED_OUT`), so the admin is never told the endpoint receives what it never would. The
  delivery is marked manual (`manual: true`, `X-Webhook-Manual: true`) and audited.

---

## Dispatching from other modules

```typescript
import WebhookService from '@/modules/webhook/webhook.service';

// Tenant-scoped event — call after a member is created:
await WebhookService.dispatchEvent(tenantId, 'member.created', {
  tenantMemberId: member.tenantMemberId,
  userId: member.userId,
  role: member.memberRole,
});

// Platform-wide event (user.*, tenant.*, plan.*, subscription.assigned) —
// routes to root-tenant webhooks without threading ROOT_TENANT_ID by hand:
await WebhookService.dispatchPlatformEvent('user.created', {
  userId: user.userId,
  email: user.email,
});
```

`dispatchEvent` / `dispatchPlatformEvent` are fire-and-forget safe — they catch internal errors and log them without throwing, so a webhook failure never breaks the producing operation. Dispatch **after** the DB commit so a rolled-back operation cannot emit a phantom event.

These are already wired into the user, tenant, tenant_member, tenant_invitation, api_key, payment (inbound provider webhooks), tenant_subscription (plans + assignment), and payment_subscription (subscription lifecycle) services.

---

## Settings

Surfaced at `/tenant/[tenantId]/admin/webhooks/settings` (gear button in the Webhooks page header) via the shared `ModuleSettingsPage` scaffold. UI field metadata: `webhook.settings.fields.ts`. The global worker-pool knob (`webhookWorkerConcurrency`) is intentionally **not** exposed here — it is a shared resource, not a per-tenant setting.

| Key | Type | Default | Notes |
|---|---|---|---|
| `webhookMaxAttempts` | number | `3` | Attempts (the first one included) before a delivery is dead-lettered; 1-10. |
| `webhookRetryDelaysMs` | text (CSV) | `60000,300000,900000` | The wait before retry 1, 2, … (ms): 1 to 9 values, each 1000-86400000; past the list, the last value. |
| `webhookRequestTimeoutMs` | number | `15000` | Per-delivery request timeout (ms), 1000-120000. |
| `webhookCircuitBreakerThreshold` | number | `10` | Consecutive failures before an endpoint auto-disables, 1-100000 (test sends do not count). |
| `webhookDefaultRateLimitPerMinute` | number | — | Fallback per-endpoint rate limit (deliveries/min) when a webhook has none; blank or 0 = unlimited. |

**Saves are validated** (41-ui-fixes/12 4.1) where every module's settings are, `tenant_setting.validation.ts`
(`WEBHOOK_INTEGER_SETTINGS`, `parseDelayList`): a value outside these ranges is a 400 with `details.key` and
`details.messageKey` (`tenant_setting.errors.integerRange` / `integerMin` with `vars`, or
`tenant_setting.errors.delayList` with `vars: { min, max, count }`). `webhook.config.ts` reads them per tenant at
dispatch/delivery time via `SettingService.getByKeys` (Redis-cached) with the SAME table (`resolveDeliveryConfig`), so a
save and a read cannot disagree. A value stored before the rule: a whole number outside the range is clamped into it (its
direction kept: 50 attempts read as 10), anything that is not a whole number reads as the default, and a delay list with
any bad entry reads as the default schedule whole (dropping the entry would shift every later delay onto the wrong retry).
Read/written via `GET/PUT /tenant/[tenantId]/api/admin-settings`.

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

A tenant-scoped outbound webhook system (subscriptions, signed/retried async deliveries, circuit breaker, metrics) where each real tenant owns its endpoints and deliveries and overrides delivery tuning via settings, with the root tenant holding platform-wide event webhooks.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `webhookMaxAttempts` | number | `3` | tenant | How many delivery attempts before a delivery is dead-lettered (1-10, validated on save); written into each delivery's maxAttempts and the BullMQ job attempts (a redelivery uses the row's own maxAttempts). | `webhook.config.ts` |
| `webhookRetryDelaysMs` | text | `60000,300000,900000` | tenant | Comma-separated waits (ms) before each retry; frozen into the job and waited by the custom `webhook` backoff, the same list that sets nextRetryAt. | `webhook.config.ts` |
| `webhookRequestTimeoutMs` | number | `15000` | tenant | Per-request HTTP timeout for a delivery (1000-120000ms) via AbortSignal.timeout. | `webhook.config.ts` |
| `webhookCircuitBreakerThreshold` | number | `10` | tenant | Consecutive failed deliveries before an endpoint is auto-disabled (1-100000); a success resets the counter; test sends do not count. | `webhook.config.ts` |
| `webhookDefaultRateLimitPerMinute` | number | — | tenant | Fallback per-endpoint delivery rate limit (deliveries/min) applied when a webhook row has no rateLimitPerMinute; blank or 0 means unlimited. | `webhook.config.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `Webhook` | `webhooks` | url, secret, previousSecret, previousSecretExpiresAt, events, headers, eventFilters, tags, isActive, consecutiveFailures, autoDisabledAt, ipAllowlist, rateLimitPerMinute, name, description |
| `WebhookDelivery` | `webhook_deliveries` | event, payload, status, attempts, maxAttempts, requestBody, responseStatus, responseBody, errorMessage, duration, nextRetryAt |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `webhook.dispatch.service.ts:dispatchEvent / hasWebhookFeature` — Webhook dispatch is feature-gated per tenant: tenants whose active plan lacks the feature_webhooks subscription feature get no enqueue and no delivery; root tenant is short-circuited as always-allowed. The manual sends (test, trigger, redeliver, replay) apply the same gate and refuse with 403 `WEBHOOKS_NOT_IN_PLAN`.
- `webhook.config.ts:resolveDeliveryConfig` — Max attempts, retry backoff delays, request timeout, circuit-breaker threshold, and default rate limit are all resolved per tenantId from SettingService (with module defaults as fallback), so delivery reliability/timing differs per tenant.
- `webhook.queue.ts:enqueueDelivery` — Per-endpoint sliding-window rate limit: effective limit is webhook.rateLimitPerMinute or the tenant's webhookDefaultRateLimitPerMinute; when exceeded the delivery is deferred ~60s rather than enqueued immediately.
- `webhook.filters.ts:passesEventFilter` — Per-endpoint eventFilters (dot-path equality conditions) decide whether a matching event is actually delivered, so two tenants/endpoints subscribed to the same event can receive different subsets.
- `webhook.delivery.service.ts (circuit breaker)` — Endpoints are auto-disabled once consecutiveFailures crosses the tenant-configured circuit-breaker threshold; the threshold and thus disable behavior varies per tenant.
- `webhook.delivery.service.ts / webhook.ssrf.ts` — Per-endpoint custom headers are merged (reserved names stripped) and the per-endpoint ipAllowlist overrides the default SSRF private/reserved-range block, so destination policy differs per webhook.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| BullMQ delivery worker concurrency is hardcoded to 10 in the shared worker definition. | `webhook.queue.ts (startWebhookWorker concurrency: 10)` | Intentionally global shared infrastructure (a single process-wide worker pool serves all tenants), so it is correctly NOT per-tenant; noted only for completeness. A per-tenant fairness/throughput cap would be a separate queue-level concern, not this knob. | — |
| Secret rotation overlap window is a hardcoded 48h default parameter (overlapMs) rather than a tenant setting. | `webhook.crud.service.ts:rotateSecret (overlapMs default 48*60*60*1000)` | How long the previous signing secret stays valid during rotation is a security/operability tradeoff that some tenants may want longer or shorter; today it is a fixed default with no per-tenant override surfaced in settings. | `webhookSecretRotationOverlapMs` |
| Rate-limit deferral delay when an endpoint is over its limit is hardcoded to 60000ms. | `webhook.queue.ts:enqueueDelivery (deferDelayMs = 60_000)` | The deferral window is tied conceptually to the per-minute rate limit but is a fixed constant; tenants tuning rate limits cannot adjust how long over-limit deliveries are deferred. | `webhookRateLimitDeferMs` |
| Response body capture cap is hardcoded to 4096 bytes. | `webhook.delivery.service.ts (responseBody slice(0, 4096))` | How much of the subscriber response is persisted for debugging is a per-tenant storage/observability tradeoff; currently global with no override. | `webhookResponseBodyMaxBytes` |

### Platform/root-only settings (not per-tenant)

Configured once at the root tenant; identical for all tenants:

- `webhookWorkerConcurrency` — Global BullMQ worker-pool concurrency (currently hardcoded to 10 in webhook.queue.ts (startWebhookWorker)). Documented as a shared-infra knob deliberately excluded from per-tenant settings; not actually read from the setting store today.

## CloudEvents envelope (optional, per endpoint)

An endpoint can ask for CloudEvents 1.0 in STRUCTURED content mode: `format: "cloudevents"` on create or update (default `json`: every existing endpoint keeps the platform envelope, byte for byte; migration `070_webhook_format.sql`). Decision D-OBS-11 (observability); code in `server/webhook.envelope.ts`.

```json
{ "specversion": "1.0", "id": "<uuid>", "source": "urn:nb:tenant:<tenantId>", "type": "dev.kuray.nb.incident.opened",
  "datacontenttype": "application/json", "time": "2026-10-18T12:00:00.123Z", "data": { ...the platform payload... }, "tenantid": "<tenantId>", "webhookid": "<webhookId>" }
```
sent with `Content-Type: application/cloudevents+json; charset=utf-8`. The signature headers (`X-Webhook-Signature`, `-V2`, `X-Webhook-Timestamp`) and `X-Webhook-Event` are identical in both formats and computed over the body that is sent. `id` is generated once per event and stored in the delivery's request body, so a retry and a manual redelivery carry the SAME id (CloudEvents consumers deduplicate on `source` + `id`); a redelivered body keeps the format it was made in. `data` is the platform payload exactly as before (a consumer switching formats finds the same fields under `data`). `tenantid` and `webhookid` are extension attributes (1 to 20 lowercase letters or digits, JSON strings).

Verified against the specification TEXT (v1.0.2: `spec.md` required attributes `specversion`, `id`, `source`, `type`; optional `datacontenttype`, `time`; the attribute-name rule for extensions; `formats/json-format.md` and the structured-mode content type; `bindings/http-protocol-binding.md`), by `webhook.cloudevents.test.ts` (attribute checks) and by a live delivery over real HTTP to a local receiver through the real queue, signing and delivery record (`webhook.cloudevents.live.test.ts`, `OBS_LIVE=1`). **Assumed, not verified:** acceptance by a third-party consumer or the official SDK validators (no CloudEvents SDK was run), the `dev.kuray.nb.` type prefix and the `urn:nb:tenant:` source scheme are our choices (the spec only asks for a reverse-DNS-style type and a URI-reference source), batch mode and binary mode are not offered, and the admin console has no format selector yet (set it through the API).
