# telemetry

Readings over time as a Core platform domain (`edition: core`, `tier: platform`). Plan and decisions:
[`docs/phases/42-telemetry`](../../docs/phases/42-telemetry/README.md) (owner decisions TM-OD-1…7, engineering decisions
ED-1…15, the 2026-10-24 performance verification). The store was extracted from `iot_telemetry` on 2026-10-24 (OD-164); the
table shape is the measured one of the IoT benchmark (`docs/concepts/iot-telemetry/reference/2026-10-23-schema-benchmark.md`).

## What it owns

| Table | Role |
|---|---|
| `telemetry_msg_r{7,30,90,365,1095}` | One row per message per retention class: `(tenantId, entityId, ts, msgHash)`, numeric values by key id in `numKeyIds` / `numVals`, the rest in `other` (jsonb). Hypertables, raw retention 7/7/30/90/90 days, chunks sized by the install (ED-15) |
| `telemetry_1m_r{d}` → `telemetry_1h_r{d}`, `telemetry_1d_r{d}` | 1-minute aggregates (sum, count, min, max, last) filled by this module's job; hour and day rollups derived by `db:time_series` |
| `telemetry_keys` | The per-tenant key dictionary (`(tenantId, key) → keyId`), shared by every kind |
| `telemetry_latest` | The latest value per entity and key, `kindId` = the kind, strict `>` on `ts` |
| `telemetry_kinds` | Kind name ↔ small id (`kindId` on the raw, minute and latest rows, ED-10; `iot_device` = 1); platform reference data, RLS-exempt |
| `telemetry_class_bindings` | Which retention class a tenant writes a kind into (history; the current row has `validTo NULL`) |
| `telemetry_1m_state`, `telemetry_1m_dirty` | The minute job's watermarks and the dirty-minute hints the writer leaves for late rows |

Another lane (a kind that declares `lane`) gets the same family under `telemetry_<lane>_*`; the default lane only is declared today.
Every table carries `tenantId`, RLS with FORCE; app roles reach the hypertables only through the `<table>_v` access views owned by
`tele_owner` (`db.time-series.ts`).

## How a module stores readings

1. Contribute an **entity kind** to `telemetry:entity_kind` (`server/telemetry.kinds.ts`, `TelemetryEntityKind`): the kind name, its
   keys (`declared` or `open`), its retention (`fixedClass` or `resolveClass`), `canRead(ctx, entityIds)` (default deny), whether
   dashboards may list it, whether flows or bindings may write it, its lane and its per-tenant write budget.
2. Write through `getTelemetryWriter().write(tenantId, kind, rows)` — one call per **wave** of rows of one kind (≥ 1 s or ≥ 100 rows
   for a small kind, ED-12), never one transaction per reading. The writer applies the key and value rules, the kind's rule, the
   retention class per tenant and kind, the key dictionary, the raw insert through the access view, the latest upsert, the late-row
   hint, then records the touched pair for the rollup job and queues the commit listeners.
3. Read through `getTelemetryQueryService()` (`latest`, `range`) with the kind; apply the kind's `canRead` before answering a user.

Rules the writer enforces (ED-11, ED-12): listeners run after the write resolved (`telemetry.listeners.ts`, bounded queue, never
awaited); the budget is checked once per wave and a kind with `budgetRowsPerSecond: null` (`iot_device`) skips it; one lane per
call; the rollup job visits only the pairs the writer touched (`telemetry.touched.ts`), with a full sweep every 15 runs.

## API, dashboard, flows, purge

- `GET /api/telemetry/kinds` (the registered kinds), `GET /api/telemetry/latest?kind&entityId&keys`, `GET /api/telemetry/series?kind&entityId&keys&from&to&bucket&agg&limit`
  behind `telemetry.read`; every entity passes the kind's `canRead` for the caller (a refusal is 404). `series` reads raw up to 24 h,
  then the finest rollup under the 10 000-bucket cap (`bucket: auto|raw|1m|1h|1d`, `agg: avg|min|max|last|sum|count|increase`).
- `GET /api/telemetry/admin/store` and `/admin/telemetry/store` (`telemetry.admin.read`): kinds, the workspace's retention bindings, keys,
  latest rows per kind, lanes, chunk interval, the listener queue.
- `dashboard:data_source` `telemetry` (`latest` as a record, `series` over the board window; exposed kinds only; cached per user).
- `automation:node` `action.save_reading` (generic host): a flow stores readings of a kind with `acceptsExternalWrites` (narrowed by `canWrite`).
- External writers beyond flows (an IoT reading binding, docs/phases/42-telemetry/13): a kind that accepts them may also name the
  `writePermission` a person needs to bind to it, offer `entityOptions` for a picker and take the rows on its own path (`writeExternal`,
  e.g. the asset's FIRST marks). All three are optional; a kind without `writePermission` is never a binding target.
- `tenant:purge_step`: every table of the tenant, bindings, keys, the Redis key hash; `purgeEntity()` for owners that hard-delete an entity.
- Entity purge queue (`server/telemetry.entity-purge.job.ts`, `common:boot_task` `telemetry_entity_purge`): an owner that deletes an entity calls `enqueueEntityPurge({ tenantId, kind, entityId })` after its own delete committed. A BullMQ queue `telemetry-entity-purge` on the shared Redis, its worker at concurrency 1 in the scheduler, so big purges run one after the other. A job (`purgeEntityTelemetryWindowed`) deletes the entity's raw and minute rows in one-day windows, each its own tenant transaction with a 50 ms rest between, then its hour and day rollups and latest rows; retried 5 times with an exponential back-off from 30 s; one job per entity (the job id), idempotent. A kind that is not registered fails the job rather than being guessed into a lane. `iot_device` queues its deleted devices this way.
- `feature_gate:entitlement_changed`: plan-driven kinds move to their new class (close + open; reads cover both).
- `backfillReadings()` (`server/telemetry.backfill.ts`): history goes to the writer, the minute table or the hour/day rollups by age — never
  through the hot writer with old timestamps.

## Jobs

- `telemetry-minute-rollup` (`common:boot_task`, phase `scheduler`, one per lane): the 1-minute aggregates every minute, 50 s budget,
  adaptive slices, 50 % DB share, advisory lock per lane, tenant and class.
- `db-time-series-rollup` / retention (db's own jobs) fill the hour and day rollups and drop whole chunks per class table.

The minute job's DB share, steps per tenant and class and full-sweep period are ROOT-tenant settings
(`/admin/telemetry/settings`, ROOT only; `server/telemetry.settings-policy.ts`), read once per pass; unset they are 50 %, 30 and 15.

## Environment

- `TELEMETRY_CHUNK_INTERVAL_RAW` — `1 hour` | `1 day` | `7 days`; unset = 1 hour when `iot_telemetry` is installed, 1 day otherwise.
  Applied forward-only to existing hypertables by the deploy phase (`set_chunk_time_interval`).

## Migration

`server/migrations/002_kind_column.sql` adds the kind column with a constant default (no table rewrite) and the kinds registry.
`server/migrations/001_telemetry.sql` renames an IoT-era install's `iot_ts_*` objects in place (tables, constraints, indexes,
access views, db's rollup bookkeeping rows) and re-keys the class bindings per kind; on a fresh database it creates the tables.
`iot_telemetry` 002 drops the empty old-named tables its own 001 still creates on a fresh install.

## Tests

`server/tests/`: the rules and hash, the key dictionary, the writer, the minute rollup and the time-series declaration; the database
tests run on a real TimescaleDB (`TIMESCALE_TEST=1 TIMESCALE_TEST_URL=…`), each file in a database of its own
(`telemetry.timescale.fixtures.ts`).
