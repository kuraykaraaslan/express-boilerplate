# Tenant Usage Module

Tracks per-tenant usage counters (API calls, AI tokens, storage bytes, email sends) by month. Counters are stored in Redis for low-latency O(1) increments and flushed to the `tenant_usage` PostgreSQL table by a background CRON job for durable reporting and plan-limit enforcement.

## What it does

- Provides `TenantUsageService` with static methods to increment counters and read/flush usage.
- The `TenantUsage` TypeORM entity persists monthly aggregates with a `UNIQUE(tenantId, month)` constraint.
- Redis keys expire automatically after 32 days so stale data is cleaned up.

## Redis key pattern

```
tenant:{tenantId}:usage:{metric}:{YYYY-MM}
```

Example: `tenant:abc-123:usage:apiCalls:2026-05`

Metrics: `apiCalls`, `aiTokens`, `storageBytes`, `emailSends`, `smsSends`

## Incrementing counters

```typescript
import { TenantUsageService } from '@/modules/tenant_usage/tenant_usage.service';

// In an API route or middleware:
await TenantUsageService.incrementApiCall(tenantId);

// After an AI completion:
await TenantUsageService.incrementAiTokens(tenantId, tokensUsed);

// After a file upload:
await TenantUsageService.incrementStorageBytes(tenantId, fileSizeBytes);

// After a successful email/sms delivery:
await TenantUsageService.incrementEmailSends(tenantId, 1);
await TenantUsageService.incrementSmsSends(tenantId, 1);
```

### Wired call sites (live in this codebase)

| Caller | Counter | Trigger |
|---|---|---|
| `modules/ai/ai.service.ts` (`chat` / `chatStream` / `embed`) | `aiTokens` | provider returns `usage.totalTokens` |
| `modules/storage/storage.service.ts` (`uploadFile`, `uploadFromUrl`) | `storageBytes` | after `UploadedFile` audit insert |
| `modules/notification_mail/notification_mail.service.ts` (`_sendMail` worker) | `emailSends` | provider returns `success: true` |
| `modules/notification_sms/notification_sms.service.ts` (`_sendShortMessage` worker) | `smsSends` | provider returns `success: true` |

`apiCalls` increment is wired at the route-middleware layer (Limiter hook); endpoints do not call it directly.

## Reading usage

```typescript
const usage = await TenantUsageService.getUsage(tenantId);
// { apiCalls: 42, aiTokens: 8000, storageBytes: 1048576, emailSends: 0, smsSends: 0 }

// For a specific past month:
const lastMonth = await TenantUsageService.getUsage(tenantId, '2026-04');
```

`getUsage` reads from Redis first and falls back to the DB when Redis has no data (e.g. after a restart or for historical months).
It does so per counter: one Redis does not have, or one a count re-created that has not taken its stored value back yet, is
answered with the table's value (in the current month it is created and settled on the spot, so the next read finds it; lead
decision D26, below).

## Flushing to the database

Call `flushToDb` from a CRON job (e.g. hourly) to persist counters durably:

```typescript
// In a CRON handler:
const month = TenantUsageService.currentMonth();
await TenantUsageService.flushToDb(tenantId, month);
```

`flushToDb` reads every declared counter of the month (and today's and yesterday's day counters) with their TTLs and brings the
`tenant_usage_metrics` rows up to them. Only a settled counter is written (D26, below); a counting metric's stored value is never
lowered, and `storageBytes` is stored net of deletions.

## Background job

`tenant_usage.job.ts` runs an hourly BullMQ flush (queue `tenant-usage-flush`, concurrency 1): it loads every `ACTIVE` tenant and calls `flushToDb` for the current month, so the 32-day-TTL Redis counters are persisted before they can expire at month end. Triggered by `scheduleUsageFlushJob()` at boot (self-hosted) or `POST /api/cron/usage-flush` with the `CRON_SECRET` bearer token (serverless).

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Per-tenant monthly usage metering (API calls, AI tokens, storage bytes, email/SMS sends) — Redis counters flushed to a tenant-scoped table by an hourly job.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `TenantUsage` | `tenant_usage` | month, apiCalls, aiTokens, storageBytes, emailSends, smsSends |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `tenant_usage.service.ts` — per-tenant Redis counters keyed `tenant:<tenantId>:usage:<metric>:<month>` (the `increment*` methods); best-effort, never blocks the originating action.
- `tenant_usage.service.ts:getUsage / flushToDb` — read/persist each tenant's monthly usage via `tenantDataSourceFor(tenantId)` (Redis-first, DB fallback).
- `tenant_usage.job.ts` — the hourly flush iterates every `ACTIVE` tenant and writes that tenant's counters into its own `TenantUsage` row.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Counter retention TTL (32 days) | `tenant_usage.service.ts:TTL_SECONDS` | Fixed to the billing month for all tenants | intentionally global — N/A |
| Flush cadence & worker concurrency | `tenant_usage.job.ts` | Single shared cron + worker, not per-tenant | intentionally global — N/A |

---

## Entity registration

`TenantUsage` is registered in `modules/db/db.ts` (single DataSource).


## Declared period metrics (docs/phases/31-feature-gate/02)

The six original metrics (`apiCalls`, `aiTokens`, `storageBytes`, `emailSends`, `smsSends`, `webhookCalls`) are
declared by `tenant_usage` itself; any other module declares its own through the `tenant_usage:metric` point
(contribution key = metric key, `metadata: { label, unit, period: 'month'|'day', quotaKey? }`) and increments by key:
`TenantUsageService.increment(tenantId, 'widgetRenders', n)` or `incrementBatch(tenantId, Map)` (one `MULTI`).
Unknown keys are logged and dropped. Redis keys are unchanged (`tenant:<id>:usage:<metric>:<YYYY-MM>` plus daily keys).

- Storage: `tenant_usage_metrics (tenantId, period, metric, value)` unique on that triple; the flush job writes every
  declared metric there (the six legacy columns keep being written for one release; **remove them after the next
  release** and drop the legacy fallback in `getMetricUsage`). Migration `001_usage_metrics_backfill.sql` adds the
  lookup index and backfills the current month.
- Read: `getMetricUsage(tenantId, metric, period?)` - Redis hot counter, then the table, then the legacy column.
- Quota: `assertMetricQuota` / `checkMetricQuota` (see feature_gate README); alerts at 80 % / 95 % / overage now cover
  every declared metric with a `quotaKey`.
- **Quota alerts to people** (2026-11-01, docs/phases/53-setting-levels 53.9, D173): beside its webhooks, the alert sweep
  announces each threshold, a quota used up (exactly the limit, where requests now stop; once a month) and an overage on
  the `tenant_usage:quota_alert` hook point (`announceQuotaAlert`, server/tenant_usage.extension-points.ts), with the
  metric's label and unit and the limit with the usage packs held. tenant_subscription's listener tells the tenant's
  owners and admins and points them to the packs.
- Usage feed: `GET /api/tenant-usage/metrics` (permission `tenant_usage.metrics.read`) lists declared metrics with
  label, unit, value and quota. No screen consumes it yet.

## Redis down during a quota reservation (lead decision D25, 2026-10-28)

`reserveMetricQuota` counts and checks in one INCRBY. When that INCRBY fails, the reservation still admits within the
plan: a lost device message is worse than a bill a few minutes late (D25 in `docs/audits/2026-10-28-lead-decisions.md`;
it settles `S23.automation.57e`). What it admits is owed, never lost:

- The plan decides on the table's last flushed value plus the units already owed for the period (the ledger's SUM, read
  at most every 5 s per tenant, metric and period, plus what the process recorded since), and the admitted units
  are written to `tenant_usage_unbilled` (migration `003_usage_unbilled.sql`, RLS pair, append-only while pending). A
  `releaseMetricQuota` whose month counter Redis cannot lower writes its units back as a negative row.
- `reconcileUnbilled(tenantId)` (`server/tenant_usage.unbilled.ts`) locks up to 1 000 rows, deletes them and adds them to
  the month and day counters in one MULTI, inside one tenant transaction: a Redis error rolls the delete back. A month
  that is over is flushed to the table afterwards; one whose counter has expired goes to its table row instead. A MULTI
  command Redis refuses alone (a counter holding a non-integer) does not roll back, since Redis applied the rest: the
  rows go and that counter's units are counted `lost`. An aborted MULTI (null reply) rolls back.
- It runs for every tenant before the hourly flush (job and cron route), and in a process that wrote rows as soon as one
  of its reservations reaches Redis again (at most every 10 s). One call runs at most 50 passes per tenant; the rest is
  backlog for the next run, so rows that keep arriving cannot hold the flush job on one tenant.
- Postgres down as well: the plan and the usage table cannot be read, so a metered reservation is refused (a closed quota
  refuses when its plan cannot be read). Only a reservation the plan already admitted whose ledger insert fails, or a
  release, is let through and counted `lost`.
- Metrics: `tenant_usage_unbilled_units_total{metric,outcome}` (`recorded`, `released`, `reconciled`, `lost` = units
  neither Redis nor the ledger could keep) and `tenant_usage_unbilled_backlog_rows` (left after the flush job's pass).
  Alerts (observability `alert-rules.ts`): `UsageUnbilledRecorded` (warning), `UsageUnbilledLost` (critical),
  `UsageUnbilledBacklog` (warning, 90 min).
- Not covered: an INCRBY whose reply is lost after Redis applied it is recorded too, so that unit is billed twice; a
  commit that fails, or an EXEC reply lost, after the reconcile's MULTI ran applies the rows again on the next pass. A
  Redis that restarts EMPTY is D26's case (next section).

## Redis restarts with empty data (lead decision D26, 2026-10-28)

Before D26 the next count re-created a lost counter from 0, the plan was checked against that, and the hourly flush
overwrote the month's `tenant_usage_metrics` row with the smaller value: recorded usage was lost and the plan limit could be
passed after a restart. D26 in `docs/audits/2026-10-28-lead-decisions.md`; the review round of the same day replaced the
first build's per-counter marker and "reply equals its delta" test with the rules below.

- **A counter with a TTL is settled**: its value includes what its period stored before it. Every count runs its INCRBY or
  DECRBY and a TTL read in one MULTI (`countOn`, `server/tenant_usage.reseed.ts`), in `increment` (month and day),
  `incrementBatch`, `decrementStorageBytes`, `reserveMetricQuota`, `releaseMetricQuota` and the D25 reconcile. A TTL of -1
  means a count re-created the counter (Redis lost it, or it is the period's first count) and nobody has settled it yet.
- **Settling** (`settleCounter`) reads the period's stored value and runs `SETTLE_SCRIPT` (`server/tenant_usage.keys.ts`):
  while the counter still has no TTL, the stored value is added and the TTL set, in one atomic step. Any number of callers,
  in any process, may settle the same counter; the script applies once. Only the counter a metric is billed from has a
  stored value (the month's, or the day's for a day metric); any other re-created counter just gets its TTL.
- **Until a counter is settled nothing trusts its bare value.** The count and the missing TTL are one snapshot, so a caller's
  true value is its reply plus the stored value, whoever settles: `reserveMetricQuota` decides on that sum (concurrent
  reservations right after a restart cannot pass the limit); `getMetricUsage` and `getUsage` add the stored value; the flush
  does not write the counter, settles it, and writes it once settled.
- **A settle that fails** (Postgres or Redis error) leaves the counter without a TTL. A reservation then has no usage to
  decide on: `onGateError: 'closed'` refuses (503) and gives the units back, `'open'` admits. The next reservation, the next
  flush, or (at most every 10 s per process) the next plain count of it tries again, so a failure that outlives the process
  is settled by the hourly flush. The units counted meanwhile are added to the stored value once; the flush never stores a
  counter that lacks it, so nothing is counted twice.
- **What a flush stores**: a counting metric's value only rises (a settled counter below its row can only be one restored from
  an older Redis snapshot, or one a reservation gave units back to); `storageBytes` (`GAUGE_METRICS`) is a level, stored as its
  net value, down to 0, so a restart puts back what is in use, not the month's peak.
- Metric `tenant_usage_counter_reseeds_total{metric,outcome}` (`reseeded`, `failed`: once per counter and failure). Alerts
  (observability `alert-rules.ts`): `UsageCounterReseeded` (warning) and `UsageCounterReseedFailed` (critical).
- Not covered: usage counted after the last flush and before Redis lost the counter is gone (at most one flush interval;
  Redis persistence covers it). A Redis restored from an older snapshot brings settled counters back below their rows: the
  rows keep the higher value, the plan reads the counter until it passes the row again.
- **Deploy note**: before D26, `decrementStorageBytes` created a month counter without a TTL when a file was deleted before
  any upload of the month; such a counter would be taken for a re-created one and get its stored value added a second time.
  Give those a TTL once, just before the new code serves (idempotent): `redis-cli --scan --pattern 'tenant:*:usage:*' | while
  read k; do [ "$(redis-cli TTL "$k")" = "-1" ] && redis-cli EXPIRE "$k" 2764800; done`.
  Tests: `tenant_usage.reseed.test.ts`.

## 2026-10-24 — on the Core telemetry store, and the wide table folded (42-telemetry/06)

`tenant_usage` requires `telemetry` and contributes the kind `tenant_usage` (`server/tenant_usage.telemetry.ts`): every increment's delta is
folded per metric and minute window and written as one reading at the window's end; `GET /api/tenant-usage/metrics/[metric]/series`
(`tenant_usage.metrics.read`) serves the curve from the store. The Redis counters and `tenant_usage_metrics` stay the quota source. The wide
monthly `tenant_usage` table is folded away (step 5 of the phase): the flush writes the open table only, `getUsage`'s fallback, `getHistory`
and the export collection read it, migration `002_fold_legacy_usage.sql` copies every month of the legacy columns across; the `TenantUsage`
entity is deprecated and the table is dropped in the next release. Tests: `tenant_usage.telemetry.test.ts` and the adapted suites.
