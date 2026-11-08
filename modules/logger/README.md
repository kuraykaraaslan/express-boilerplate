# Logger Module

Winston-based, framework-agnostic structured logging singleton. Use it instead of `console.*` across the codebase. Every log line is auto-tagged with the active tenant/user/request IDs carried through `AsyncLocalStorage`, so downstream code can log without threading context by hand.

---

## Exports

| Export | Kind | Description |
|---|---|---|
| `Logger` (default) | class | Static `info`, `error`, `warn`, `debug`, `event` log methods plus `runWithContext` / `runRestricted` / `annotateContext` / `getContext` / `writesToConsole`. |
| `Logger` (named) | class | Same class, named re-export for convenience. |
| `LogContext` | interface | Per-request context shape (`tenantId?`, `userId?`, `requestId?`, `class?` (`R` or `X`), `nodeId?`, plus arbitrary string/number/boolean keys). |
| `resolveRequestId`, `runWithRequestContext`, `runWithJobContext` | functions | Context for entry points that are not the tenant API dispatcher (internal routes, the fleet exec path, background jobs); see *Request and job context*. |

The module has **no entities, no API routes, and no settings** — it is pure shared infrastructure. Its only dependency is `env`, which supplies every `LOG_*` setting.

---

## Responsibilities

- **Structured log lines.** Three process-wide Winston singletons (`infoLogger`, `errorLogger`, `warnLogger`, created by `makeLogger`) format each entry as `[<timestamp>] [<level>]<tags>: <message>` with a `MMM-DD-YYYY HH:mm:ss` timestamp.
- **Automatic context tagging.** `currentContext()` reads the active `LogContext` from an `AsyncLocalStorage` store; the formatter appends `[tenant=… user=… req=… node=… class=…]` for whichever are present. A line with none of them is byte-identical to what the logger always wrote.
- **Argument serialization.** Extra args passed to `info/error/warn/debug` are serialized (`JSON.stringify` for objects, `String(...)` otherwise) and appended to the message.
- **Redaction.** Object arguments are redacted by key (`password`, `token`, ... plus `LOG_REDACT_KEYS`) and every string by value pattern (JWT, email, card, IBAN). The value patterns apply to the MESSAGE text of every level, `warn` and `error` included (`LOG_REDACT_MESSAGES`, on by default; setting it to `false` is honoured only on the single role, a node or fleet role always redacts). UUIDs and E.164 numbers are deliberately left legible. Logging never throws: a failure in the log path is dropped.
- **Transport selection.** The **Console** is used when `LOG_TO_STDOUT` is true (any `NODE_ENV`; a container's log driver reads stdout), when `env.NODE_ENV` is `vercel` or `development`, and on a serverless platform. Otherwise lines go to a daily file `logs/<YYYY-MM-DD>.log` that rolls over when the (UTC) day changes, without a restart (`DailyFileStream`).
- **`debug`** is emitted through the info logger with a `[DEBUG]` prefix (there is no separate debug transport/level).

## Configuration (`LOG_*`)

All of them are in the env schema and all are **lenient**: a value that does not parse falls back to its default, it never stops boot.

| Variable | Default | Effect |
|---|---|---|
| `LOG_TO_STDOUT` | `false` | `true` or `1`: console transport in any `NODE_ENV`. |
| `LOG_FORMAT` | `text` (single role); `json` on a node/fleet role with `LOG_TO_STDOUT` | `text` or `json`. |
| `LOG_LEVEL` | unset | `debug` turns on global debug lines (per-tenant debug is `Logger.setTenantDebug`). |
| `LOG_SAMPLE_RATE` | unset | A fraction in (0,1) keeps that share of `info` lines. `warn`, `error` and `event` are never sampled. |
| `LOG_REDACT_KEYS` | unset | Extra key names to redact, comma separated. |
| `LOG_REDACT_MESSAGES` | `true` | Value-pattern redaction of `warn`/`error` message text; `false` only on the single role. |

## Log class and node id

`LogContext.class` is the telemetry class of the lines written inside a context (docs/phases/02-fleet/01-data-classification): `R` (regional, the default) or `X` (may carry restricted content such as SQL text). `G` is not a value, a log line is never global. `Logger.runRestricted(fn)` marks everything `fn` writes as `X`, and nothing opened inside it can lower it. The JSON line carries `class`; on a node (with `FLEET_NODE_ID`) it always does, with `R` as the default, so a collector can drop `class=X` and keep the rest. The text line shows `class=` only when it was set.

`nodeId` in a log line is the **fleet node uuid** (`FLEET_NODE_ID`), filled in once per process. It is not the random per-process id that `process_host` also calls `nodeId`; never join the two.

## Request and job context

The tenant API dispatcher opens `{ tenantId, requestId }` through `withObservability`. Other entry points use `runWithRequestContext(request.headers, fn, extra?)` (requestId from a well-formed inbound `x-request-id`, else a uuid; `extra` carries what the caller already knows, such as a command `jti`) or, in a background job, `runWithJobContext('<job>', fn)` (requestId `<job>.<8 hex>`). An inbound `x-request-id` must match `/^[A-Za-z0-9._-]{8,64}$/`, anything else is replaced.

---

## Context propagation

```ts
import Logger from '@/modules/logger';

// Wrap a request (typically in the proxy / route handler):
Logger.runWithContext({ tenantId, userId, requestId }, async () => {
  await doStuff(); // any Logger.* call inside is auto-tagged
});

// runWithContext merges over any already-active context.
const ctx = Logger.getContext(); // { tenantId, userId, requestId, ... }
```

---

## Usage

```ts
import Logger from '@/modules/logger';

Logger.info('User created', { userId });
Logger.error('DB failure', error);
Logger.warn('Quota near limit', { used, limit });
Logger.debug('Cache miss', { key });
```

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

A Winston-based, framework-agnostic structured logging singleton that auto-tags every log line with the active tenant/user/request IDs via AsyncLocalStorage, but is pure shared infrastructure with no per-tenant settings, entities, or behavior branching.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Global log level and transport choice are fixed at module load (makeLogger('info'/'warn'/'error') singletons; transport switches only on env.NODE_ENV). A tenant cannot raise verbosity (e.g. enable debug) for their own traffic, even though tenantId is already carried in LogContext and stamped on each line. | `logger.service.ts: makeLogger / makeTransports / static infoLogger\|errorLogger\|warnLogger` | Mostly intentional shared infra — the loggers are process-wide static singletons writing to one console/file sink, so true per-tenant level routing would require restructuring (per-context level filtering rather than per-tenant logger instances). Listing it because tenant-scoped log verbosity is a plausible SaaS feature and the tenantId context already exists to gate it; not a simple settings read today. | `logLevel` |

---

## Dependencies

- `winston` — logging engine and transports.
- `node:async_hooks` (`AsyncLocalStorage`) — request-scoped context store.
- `@/modules/env` — `NODE_ENV`, `FLEET_ROLE`, `FLEET_NODE_ID` and the `LOG_*` settings.
