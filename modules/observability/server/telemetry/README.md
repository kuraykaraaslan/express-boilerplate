# Telemetry (phases 17 and 18 of the observability plan)

Tenants ship OTLP logs, traces and metrics to NB; NB stores them behind a port and lets the same tenants explore them. Decision record:
[ADR-0009](../../../../docs/adr/0009-telemetry-backend-behind-a-port-prometheus-loki-tempo-reference.md). Spec:
`docs/phases/09-observability/17-otlp-ingest-and-storage.md` and `18-explore-and-correlation.md`.

## Shape

```
client ──OTLP/HTTP (json | protobuf, gzip)──▶ /api/telemetry/otlp/v1/{traces,logs,metrics}   ┐ one pipeline: otlp.pipeline.ts
client ──OTLP/gRPC (unary Export, gzip)────▶ telemetry-gateway sidecar (node:http2, :4317)  ┘
            Bearer <tenant ingest key>              │ key -> tenant (api_key, scope telemetry:write)
                                                    │ size + rate limits (TelemetryLimits), plan guard
                                                    │ decode -> stamp tenant (overwrites) -> scrub PII -> tail-sample
                                                    ▼
                                           TelemetryBackend (port)
                                  memory │ Loki │ Tempo │ Prometheus │ composite
                                                    ▲
admin session ─structured query objects──▶ /api/telemetry/query/*, /correlate, /saved-queries, /lifecycle
            (observability.telemetry.read)          │ tenant from the URL + session, never from the body
                                                    │ zod strict schemas, range / points / rows caps
```

| File | Role |
|---|---|
| `telemetry.backend.ts`, `telemetry.types.ts` | The port, its errors, the record and query vocabulary and the strict query schemas |
| `adapters/` | `memory` (tests, dev), `loki`, `tempo`, `prometheus`, `composite`; `query.{logql,promql,traceql}.ts` are the only places a tenant string meets backend syntax |
| `otlp.codec.ts`, `otlp.protobuf.ts` | OTLP JSON decode/encode and a dependency-free protobuf decoder (+ metrics encoder), verified against bytes from the OTel JS SDK |
| `otlp.ingest.ts`, `otlp.pipeline.ts`, `otlp.route.shared.ts`, `otlp-*.route.ts` | The ingest (decode, stamp, scrub, sample, write), the ONE security path around it (`runOtlpPipeline`: key, gate, limits, bounded read, gunzip), the HTTP translation and its three route files |
| `otlp.grpc.ts`, `../../telemetry-gateway/` | OTLP/gRPC transport on `node:http2` (framing, status trailers, `RetryInfo`) and the `telemetry-gateway` sidecar that runs it |
| `telemetry.env.ts` | The validated `TELEMETRY_*` settings (from `modules/env`) as the string record the readers take |
| `telemetry.job-propagation.ts` | Trace context across BullMQ: the propagator the shared queue factory calls |
| `telemetry.probe-targets.ts`, `telemetry.store-health.ts` | The platform watches the telemetry store it offers |
| `telemetry.tenant.ts`, `telemetry.scrub.ts`, `telemetry.sampling.ts` | Tenant stamping, PII scrubbing (Sentry rules), tail sampling |
| `telemetry.limits.ts` | `TelemetryLimits`: the seam phase 16 wires to feature_gate and metering |
| `telemetry.auth.ts` | Ingest key verification through the optional `api_key` module |
| `telemetry.query.service.ts`, `telemetry.servicemap.ts`, `query-*.route.ts`, `correlate.route.ts` | Query API, facets, service map and RED, correlation |
| `telemetry.saved-queries.ts`, `telemetry.lifecycle.ts`, `telemetry.tenant-purge.ts` | Saved queries (tenant setting), retention and erasure, purge step |
| `telemetry.propagation.ts`, `telemetry.log-export.ts`, `telemetry.exemplars.ts` | Trace context for jobs and requests, OTLP log export of NB's own logs, exemplars |
| `telemetry.dashboard-source.ts` | `dashboard:data_source` contribution |
| `tests/backend.contract.ts` | The contract every adapter must pass |

## Configuration

All opt-in; with nothing set no telemetry is stored and the routes answer 503. The variables are declared, typed, defaulted and validated in `modules/env`
(`env.schema.platform.ts`, covered by `modules/env/server/tests/env.telemetry.test.ts`), documented in `.env.example`, and a bad value fails at boot with the schema's message
(an unknown `TELEMETRY_BACKEND` used to switch telemetry off silently). `TELEMETRY_LOG_EXPORT_KEY` is secret-class (deliver it as a file; redacted in boot errors).

| Variable | Meaning |
|---|---|
| `TELEMETRY_BACKEND` | `off` (default), `memory` (dev only), `reference` (needs at least one URL below) |
| `TELEMETRY_LOKI_URL`, `TELEMETRY_TEMPO_URL`, `TELEMETRY_TEMPO_OTLP_URL`, `TELEMETRY_PROMETHEUS_URL` | One signal per URL; a signal without a URL answers 501 |
| `TELEMETRY_PROMETHEUS_ADMIN_API` | `true` when Prometheus runs with `--web.enable-admin-api` (enables tenant series deletion; the compose profile does) |
| `TELEMETRY_PROMETHEUS_TENANT_HEADER` | Send the tenant in this header too (Mimir: `X-Scope-OrgID`) |
| `TELEMETRY_BACKEND_TIMEOUT_MS` | Per backend request, default 10000 |
| `TELEMETRY_LOG_EXPORT`, `TELEMETRY_LOG_EXPORT_URL`, `TELEMETRY_LOG_EXPORT_KEY` | Export NB's own logs as OTLP (needs an ingest key; the URL is required when the export is on) |
| `TELEMETRY_EXEMPLARS` | `true` to put trace ids on the latency histogram (switches the metrics scrape to OpenMetrics) |
| `TELEMETRY_GATEWAY_GRPC_PORT` (4317), `_HEALTH_PORT` (4014), `_BIND`, `_MAX_MESSAGE_BYTES` (4 MiB), `_MAX_STREAMS` (64), `_TLS_CERT_FILE` / `_TLS_KEY_FILE` | The OTLP/gRPC sidecar |

### Running the backends

The `telemetry` profile of `infra/compose/docker-compose.node.yml` runs the three stores from the files in `infra/observability/node/telemetry` (Loki 3.7.8, Tempo 2.10.8, Prometheus 3.15.0: the
versions the live suites ran against). They publish no port: a request names its tenant in a header and nothing in the store authenticates it, so the web tier is the only client. Settings for the web tier:
`TELEMETRY_BACKEND=reference`, `TELEMETRY_LOKI_URL=http://telemetry-loki:3100`, `TELEMETRY_TEMPO_URL=http://telemetry-tempo:3200`, `TELEMETRY_TEMPO_OTLP_URL=http://telemetry-tempo:4318`,
`TELEMETRY_PROMETHEUS_URL=http://telemetry-prometheus:9090`, `TELEMETRY_PROMETHEUS_ADMIN_API=true`.

### Backend prerequisites (verified live, see below)

* Prometheus: `--web.enable-otlp-receiver` (endpoint `/api/v1/otlp/v1/metrics`); `--enable-feature=exemplar-storage` for exemplars; `--web.enable-admin-api` for tenant erasure. Prometheus is
  single-tenant: tenants are separated by the `nb_tenant_id` datapoint label (and Mimir's header when configured). A query without the matcher sees every tenant, which is why the adapter never emits one.
* Loki 3 with `auth_enabled: true` (tenant in `X-Scope-OrgID`, a missing header is 401), `allow_structured_metadata: true`, TSDB schema v13, `compactor.retention_enabled` and a `delete_request_store`.
* Tempo with `multitenancy_enabled: true` and the OTLP receiver on 4318 (and 4317 for gRPC); the spans carry the resource attribute `nb.tenant_id`. **`ingestion_time_range_slack` is raised to 1 h** in the shipped file:
  with the default 2 m a span older than a few minutes is stored and fetchable by id but never appears in search; a late batch from a slow exporter is normal.

## Security model

* **Tenant on ingest** is the tenant of the verified ingest key. The URL, headers and every attribute that names a tenant in the payload are
  ignored or overwritten (`telemetry.tenant.ts`).
* **Tenant on query** is the URL workspace after the session guard. Query bodies are strict structured objects: field names are identifiers, values
  are quoted literals, unknown keys are a 400. Filters on tenant-like field names are refused.
* **Raw LogQL / PromQL / TraceQL** exists for the ROOT tenant only (`observability.telemetry.raw`), and is a 404 elsewhere.
* **Caps** are contract: time range, points per series, rows, traces, spans, filters, body size. Over-cap is a 400 that names the cap.
* **Credentials**: ingest keys are `api_key` rows (hashed at rest, shown once); a refused key and an unknown key are indistinguishable.
* **Erasure** needs the OWNER floor, the workspace id typed back, and writes an audit row.
* Security tests: `tests/otlp.ingest.security.test.ts`, `tests/telemetry.routes.security.test.ts` (route x identity matrix),
  `tests/telemetry.query.security.test.ts`, `tests/query.injection.test.ts`.

## Adapters and what was verified

Run against REAL servers on 2026-10-18 by `node scripts/telemetry-live.mjs` (downloads and caches the release binaries outside the repository, verifies them against each project's checksum list, starts the three
servers from the shipped configuration, runs the live suites, stops them). 30 live tests plus a slow erasure test; output kept in `docs/guides/observability/telemetry-live-evidence.md`.

| Adapter | Live | What the real server answered |
|---|---|---|
| memory | n/a | reference semantics, passes the full contract |
| Loki 3.7.8 | **yes** | Push JSON with structured metadata (third element) accepted (204). Without `X-Scope-OrgID`: 401. Another tenant's header: empty result, even when the query names this tenant's label. By default the response merges structured metadata into the stream labels (plus a derived `detected_level`); the `X-Loki-Response-Encoding-Flags: categorize-labels` header returns it apart: the adapter reads both. **A dotted attribute name is not a valid key**: it comes back as `http_route`, not `http.route` (filtering by the dotted name works). The delete API refuses `start=1` (needs RFC3339 or unix seconds; the adapter now sends `2000-01-01T00:00:00Z`) and an `end` in the future, answers 204 and lists the request as `received`. Per-tenant limits and retention are overrides in a file reloaded within 10 s: shown working (`max_entries_limit_per_query` for one tenant, 400 after the reload) |
| Tempo 2.10.8 | **yes** | The OTLP/HTTP receiver **takes OTLP JSON** (200 `{"partialSuccess":{}}`, 400 on malformed JSON; a request with no tenant is refused). `GET /api/traces/<id>` (v1 `batches`) and `/api/v2/traces/<id>` (`trace.resourceSpans`) return **trace and span ids as base64** and enums as names (`SPAN_KIND_SERVER`); the search returns **hex without leading zeros** (31 characters for a trace id starting with `0`): the adapter decodes the first and pads the second, both live-tested. Search hits carry `serviceStats` (span and error counts per service): now used for `spanCount`/`errorCount`. Another tenant: 404; no header: 401. There is **no delete API** (`DELETE /api/traces/<id>` is answered like a GET and deletes nothing): traces are erased by retention only. A trace becomes searchable about 4 s after the write with `trace_idle_period`/`flush_check_period` of 2 s (12 to 21 s with Tempo's defaults); by id it is available at once. Per-tenant overrides (`compaction.block_retention`) are a reloaded file, visible at `/status/overrides/<tenant>` |
| Prometheus 3.15.0 | **yes** | The OTLP receiver **takes OTLP JSON as well as protobuf** (200); garbage is 400. The adapter keeps sending protobuf. Single-tenant: both tenants' series sit in one store and only the generated `nb_tenant_id` matcher separates them. `delete_series` hides a tenant's data from data queries at once; **metric and label names stay listed by the label-values and series APIs until the head is compacted** (tombstones are not applied there); the adapter also calls `clean_tombstones`. Exemplars are returned by `query_exemplars` when `exemplar-storage` is on |

The contract suite (`tests/backend.contract.ts`, 16 tests) passes against the real composite, each test in its own freshly generated pair of tenants. Two expectations of the contract became options
(`logKeysAreUnderscored` for Loki's key rewriting; "erase everything" is an explicit refusal when a signal cannot be erased) because the real stores differ from the in-memory reference there.

Erasure end to end (Loki, `telemetry.erasure.live.test.ts`, opt-in `TELEMETRY_LIVE_ERASURE=1`): the delete request is accepted at once and the data is removed only after the ingester's chunks are flushed, the cancel period has passed and the compactor has
run: **268 s and 312 s in two runs** with the live script's shortened `delete_request_cancel_period` (10 s) and `compaction_interval` (15 s); the shipped defaults are 24 h and 10 m, so an erasure of logs takes about a day and says `scheduled` until then. Metrics erasure is immediate; trace erasure does not exist.

Not verified live: Mimir and VictoriaMetrics (no adapter claims them), Loki and Tempo against object storage (the shipped config uses the local filesystem), and anything with Docker.

## Exemplars (17.4)

`telemetry.exemplars.ts` holds the pieces and a test against the real `prom-client`. Two facts from that test matter: the registry must be switched to OpenMetrics **before** an exemplar histogram is created (the constructor throws otherwise),
and an exemplar histogram only accepts the object form of `observe`. Wiring (phase 22): `initMetrics` calls `prepareExemplars` and `recordHttpRequest` observes through `observeRequest`; both are no-ops unless `TELEMETRY_EXEMPLARS=true`.

**Proven live** (`node scripts/telemetry-exemplars-live.mjs`): an endpoint built like `metrics.ts` is scraped by a real Prometheus with exemplar storage on; Prometheus asks for `application/openmetrics-text` and the endpoint answers it;
three requests in three traces produce three exemplars; the exemplar query returns them with the labels of the series, each with a 32-hex trace id; the trace id opens the trace in a real Tempo (and not for another tenant).
The query side is the explore track's: `MetricQuery.exemplars`, the port's `queryExemplars` (Prometheus: `/api/v1/query_exemplars` under the same tenant matcher, ids validated), and the query service answering `exemplars: { supported, items }` next to the series; the live run uses `queryExemplars` directly. `infra/observability/node/telemetry/scrape.d/nb-app.yml` labels the platform's own series with the ROOT tenant id so ROOT can explore them. The explorer UI that renders the pivot belongs to the explore track.

## Trace context for jobs (17.3)

The producer and worker sides are the shared `createQueue` / `createWorker` of the redis module (`redis.bullmq.ts`): they call a registered `JobPropagator`; observability registers `traceJobPropagator` in a `consumer` boot task
(`startJobTracePropagation`, every process that boots). On enqueue the payload gets `__trace` = `{ traceparent, requestId }` from the active span and the request id of the log context; around the processor the carrier is removed from `job.data`,
the OpenTelemetry context continues the producer's span, and the log context takes the producer's request id. No producer is edited: every queue made with the factory (observability's own six, `notification_push`, `tenant_export`,
`messaging` moderation, `e_signature`, `auth_e_signature`, `tenant` maintenance) is covered; a queue made with a bare `new Queue` is not (it still works and starts a new trace in the worker).

**Proven with a real Redis and real BullMQ** (`telemetry.job-propagation.live.test.ts`): a synthetic request opens a span, logs and enqueues; a second BullMQ Worker runs the job. The exported OTLP log lines of the request and of the job carry
the same trace id, the job's span is a child of the request's span (same trace id), the request id travelled, and the handler sees a clean payload. Without the propagator the job starts its own trace (asserted as the baseline).

## OTLP/gRPC and the `telemetry-gateway` sidecar (17.2)

`otlp.grpc.ts` implements unary `Export` of traces, logs and metrics on `node:http2` with the gRPC framing written out (5-byte prefix, `grpc-encoding: gzip`, status trailers, `grpc-status-details-bin` with a `RetryInfo` on 429 so exporters back off).
It is a transport: authentication, the module gate, size and rate limits, the plan, decoding, tenant stamping over any client value, scrubbing and sampling are `runOtlpPipeline` (`otlp.pipeline.ts`), the same function the HTTP routes call.
Hardening beyond it: the message length in the prefix is checked against the tenant's limit before any of the message is buffered; nothing is read before the key verified; exactly one message per call; a stream cap and an idle timeout; RST_STREAM(NO_ERROR) after an early refusal so
the sender stops; every refusal of a key is the same status and message (`UNAUTHENTICATED`, "Invalid or unauthorized ingest key").

It runs as the `telemetry-gateway` process kind (`modules/observability/telemetry-gateway`), wired like the other sidecars: `scripts/run-sidecar.mjs` and `scripts/build-sidecars.mjs` entries, the `telemetry-gateway` Dockerfile target (ports 4317 and 4014, `/healthz`),
the `telemetry-gateway` service of `docker-compose.yml` (profile `telemetry`), CI build and smoke (`scripts/ci/image-smoke.sh`), `npm run telemetry-gateway:start`. It heartbeats into the process registry as `telemetry-gateway` (add `telemetry-gateway:1` to
`EXPECTED_PROCESSES` where it runs), serves `/metrics` (`telemetry_gateway_calls_total{signal,grpc_status}`) when `METRICS_ENABLED`, refuses to start with `TELEMETRY_BACKEND=off`, and warms its lazy dependencies before it listens (a cold first call took 10 s).
The node release stack (`docker-compose.node.yml`) does not carry the gateway: its image list is the signed release inputs, an owner decision.

Tests: `tests/otlp.grpc.security.test.ts` (33 tests, a real HTTP/2 client against the real server: spoofed tenant overwritten, bad/revoked/unknown key identical, the module gate, oversize refused before buffering, a gzip bomb, the rate limit applying across streams and connections with
a RetryInfo, malformed calls, a dead store is UNAVAILABLE without detail) and `telemetry-gateway/gateway.boundary.test.ts` (nothing reaches `next/*`).
**Proven live** (`node scripts/telemetry-grpc-live.mjs`): `otelcol-contrib` 0.163.1 exports traces, logs and metrics over gRPC with gzip to the real gateway process (tsx), with the REAL key store (the test database, keys created through the real `api_key` service, one revoked, observability switched on for the two
tenants and back off afterwards) and a local Redis, into the live Loki, Tempo and Prometheus. A tenant named in the payload (three spellings) is overwritten; tenant B sees none of tenant A's three signals; a missing, unknown and revoked key get the same status and message straight at the gateway; a
5 MiB message and a gzip bomb get `RESOURCE_EXHAUSTED`; `/healthz`, the process registry heartbeat and `/metrics` are there. Creating a key for a tenant whose plan has no API keys is refused by the platform's own gate, so the second tenant's key row was inserted the way the service stores it.

## The platform watches its own store (17.6)

Two paths, one runbook (`docs/guides/observability/telemetry-store-full.md`): `telemetry.store-health.ts` asks each configured store whether it is ready on the ROOT tenant's minutely alert pass (works for private stores, the default compose profile),
and `telemetry.probe-targets.ts` (`observability:probe-target`, ROOT only) makes an HTTP monitor of each store that has a public name (the control plane's probes refuse private addresses by design, so a Compose-network store gets the first path only). Both
carry `annotations.runbook`. Capacity numbers: `docs/guides/observability/telemetry-capacity.md`; backup and restore: `telemetry-backup-restore.md`.

## Kui components in the pages

The pages (`ui/telemetry/`) use the vendored kui-react components (`common/ui/*.component.tsx`, vendored by `scripts/kui/vendor-observability.mjs`): **TraceWaterfall**
for a trace (and inside `CorrelationPanel`), **LogViewer** for the logs page and the related logs (virtualised, severity, search, facets on the loaded lines, context lines,
follow mode for the live tail with the page's own drop notice), **ServiceMap** for the services tab (the RED table and the table of call counts stay beside it: the API
counts the calls of a trace sample, not calls per second, so edge badges carry the error ratio and p95 only). The logs page lists oldest first with the newest at the bottom
(the viewer follows the end); the server facets on the left still narrow the QUERY, the viewer's chips narrow what is loaded. Selecting a line does not open the drawer
(selection follows the keyboard): "Related signals" does. `ConversationTimeline` shows a conversation on the LLM page.

## Phase 18 leftovers (2026-10-18, branch `feat/observability-explore`)

What was added on top of the explorer, each with its test file. Nothing here ran against live Loki, Tempo or Prometheus.

| Feature | Where | Notes |
|---|---|---|
| **Live tail** (18.2) | `telemetry.tail.ts` (poller), `telemetry.tail.session.ts` (one tail), `telemetry.tail.namespace.ts` (the `/telemetry-tail` namespace, `websocket:namespace`), `tail-ticket.route.ts` (`POST /api/telemetry/tail-ticket`), `telemetry.tail.realtime.ts` (contract and limits) | See "Live tail" below |
| **Board templates** (18.4) | `telemetry.board-templates.ts` (`dashboard:board_template`: RED, USE, golden signals) on the data source `telemetry.dashboard-source.ts` (new queries `metric_value`, `service_red_value`, filters on `metric_series`) | Parameters have defaults; `*` means "all" because the dashboard refuses a card whose parameter is empty |
| **Exemplars and pivots** (18.4) | `Exemplar` in the port (`queryExemplars`, `capabilities.exemplars`), OTLP decode (JSON and protobuf), memory adapter, Prometheus `query_exemplars`; `exemplars: true` on a metric query; trace -> metrics links | Prometheus side is a recorded-fixture fake only |
| **Saved panels** (18.4) | `telemetry.saved-panels.ts`, `saved-panels*.route.ts` | A tenant setting like saved queries; the stored query is the metric query minus range, step and exemplar flag |
| **Related signals** (18.5) | `correlate` accepts `{ window, labels }`; `alerts-alert-id-changes.route.ts`; UI `related-signals.component.tsx` on the incident dialog (tab) and the alert list (dialog) | Falls back, visibly, to the window's warnings and errors when no log carries the labels; degrades to a sentence on 503/501/403 |
| **Attribute comparison** (18.6) | `telemetry.compare.ts` (pure scoring), `telemetry.compare.service.ts`, `query-compare.route.ts`, `compare-settings.route.ts`; UI tab "Compare" of the traces page | Off by default per workspace (`observabilityTelemetryAttributeComparison`); 409 while off |
| **Release health and web vitals** (18.7) | `web-vitals.snippet.ts` + `web-vitals.route.ts`, `telemetry.browser-keys.ts` + `browser-keys.route.ts`, `telemetry.release-health.ts` + `query-release-health.route.ts`; UI `/admin/telemetry/releases` | Recipe, key-exposure trade-off and guards: [BROWSER.md](./BROWSER.md) |
| **Gauge aggregations** | `q50`, `q75`, `q90`, `q95`, `total` in `METRIC_AGGREGATIONS` | Quantile and sum of the raw observations of a gauge (PromQL `quantile_over_time`, `sum_over_time`) |

### Live tail

`TelemetryBackend.tailLogs(tenant, filter, cursor, opts)` is one poll step; every adapter implements it with `pollLogTail` over its own `queryLogs`, so a tail behaves
the same on the memory backend and on Loki (a native Loki `/tail` WebSocket is not used: polling `query_range` gives the same answer without holding a connection per
tenant to a server this repository never ran). The first call starts at "now" (no backlog), a poll reads `[watermark - 2 s, now]` and drops the lines the cursor says were
delivered, a batch holds at most 100 lines (the newest; the rest are counted in `dropped`, a lower bound when `truncated`), and the cursor is bounded.

`POST /api/telemetry/tail-ticket` (`observability.telemetry.read`, empty body) mints one single-use ticket whose payload is `{ tenantId (URL workspace after the guard), userId,
session }`. The socket connects to `<wsUrl>/telemetry-tail` with it; `tail:start` carries `{ filter }` only, validated with the REST log query's strict schema (no range, rows
or order; a tenant field or an unknown key is `tail:error invalid_filter`). There is no client `join`. Bounds: 20 sockets per tenant and 3 per user (gateway, cluster wide),
30 inbound frames a minute, 100 lines per poll every 2 s, 20 000 lines and 15 minutes per session (then `tail:end`, and `server:reauth` re-runs the permission check), a poll is
skipped while the socket's write buffer is not drained (nothing is buffered), backoff and give-up on backend failures, tails end when the tenant's logs are erased. Without a
gateway URL the ticket route answers `ticket: null` and the logs page keeps its 5 second refresh.

**The gateway reads the backend from its own configuration.** With `TELEMETRY_BACKEND=memory` the gateway process has its own empty store (the memory backend is per process), so
live tail is only meaningful against the reference backend; the memory backend serves tests and single-process development.

### Still open in phase 18

everything that needs the live servers (`live` track); the kui components are mounted (see "Kui components in the pages"). The trace summary has no span or error
counts on Tempo (its search does not return them): the column shows "-".
