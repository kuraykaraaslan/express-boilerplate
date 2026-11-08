# process_host

Leaf infrastructure module (OD-12). Every non-Next process (`ws`, `telephony-gateway`, `telemetry-gateway` (observability, OTLP/gRPC ingest), `worker`, later
`iot-gateway` / `iot-worker`) starts through `startProcessHost(...)`, which gives it the **sidecar contract**
(`docs/phases/14-docker/02-process-targets.md`):

1. `GET /healthz` on its own port (200 unless the health report is `fail` or the process is draining; 503 otherwise),
2. SIGTERM/SIGINT drain within `SHUTDOWN_GRACE_MS`,
3. a Redis heartbeat into the process registry,
4. `GET /metrics` (per-process `prom-client` registry, `app_` prefix, `process_kind` label; `METRICS_ENABLED=true`,
   `Authorization: Bearer METRICS_SECRET` when set).

Requires `env`, `logger`, `redis` only. Zero tables, no `next/*`. `observability` reads from it
(`/admin/system/processes`); it never imports `observability`, `websocket` or a domain module
(`server/tests/process-host.boundary.test.ts`).

## Registry keys

| Key | Type | Content |
|---|---|---|
| `proc:kinds` | set | every kind that ever announced |
| `proc:nodes:<kind>` | zset (score = last beat ms) | node ids; entries older than 15 s are trimmed on read |
| `proc:node:<kind>:<nodeId>` | string, TTL 15 s | `ProcessNodeInfo` JSON (`kind`, `nodeId`, `version`, `port`, `startedAt`, `lastBeatAt`, `health`, `info`) |

Legacy `ws:nodes` / `tel:nodes` are dual-written for one release (`legacy` option); readers prefer the new key.

## Usage

```ts
const host = await startProcessHost({
  kind: 'worker', port: env.WORKER_HEALTH_PORT,
  health: async () => ({ status: 'ok' }),
  onDrain: async () => { /* close queues */ },
});
```

`host.server` is the HTTP server, so a process that needs one (Socket.IO) attaches to it.

### Child mode

With `PROC_CHILD=1` (set by the supervisor) `startProcessHost` opens **no port** (unless the caller passes its own
`server`, e.g. `ws` sharing a port through `cluster`), sends its health to the supervisor over IPC on every beat,
answers metrics requests over IPC (`getMetricsAsJSON`), runs its drain on an IPC `drain` and acknowledges with
`drained`, and drains when the parent channel disconnects (no orphans; the disconnect is watched from the moment the
channel exists, so a supervisor that dies while the child is still starting counts too). A `node:cluster` child (ws,
script-host, plugin-host: a shared port) does not drain then: Node exits a cluster worker at once on an unexpected
disconnect, before any handler runs, and nothing new could reach it anyway (the primary owned the port). It still heartbeats into
`proc:nodes:<kind>` with `port: 0` and `info: { role: 'child', childIndex, supervisor }`. A child on a server it
shares with its siblings answers `/healthz` there (its own liveness) but **not** `/metrics` (404): the group's metrics
are the supervisor's.

**Drains (07 task 7).** `onDrain(info)` receives `{ reason, graceMs?, force?, signal }`. `reason: 'signal'` (SIGTERM,
SIGINT, a lost supervisor) and `'shutdown'` (a group shutdown) drain as always, bounded by `SHUTDOWN_GRACE_MS`.
`'scale-down'` (the supervisor shrinks the group) may take the kind's grace instead: the force-exit is
`max(SHUTDOWN_GRACE_MS, graceMs)`, or none with `force: false`. A SIGTERM or a `shutdown` during a scale-down drain
**escalates** it: `info.signal` aborts and the `SHUTDOWN_GRACE_MS` bound starts. `drainUntil(isIdle, { maxMs, signal })`
(from `.../server/supervisor/child`) is the waiting half (ws: sockets gone or 10 min; telephony: 0 calls, no limit).
`trackHttpDrain(server)` (same file) is the HTTP half of the credential-less hosts' drain: the listener closes, idle
keep-alive connections close, every response from then on (one already being produced, a request still arriving on a busy
keep-alive connection) carries `Connection: close`, and the drain resolves once the server's `close` callback ran; the
connections left are cut (`closeAllConnections`) only past `maxMs` (the scale-down grace) or on escalation.

The registry withdrawal that precedes `onDrain` is bounded (`WITHDRAW_TIMEOUT_MS`, 2 s): during a Redis outage the shared
client would queue it forever and the drain would never start. A supervisor's own host passes `withdrawFirst: false`
(its drain, telling the children to drain, starts at once, alongside the withdrawal) and `shutdownGraceMs:
SHUTDOWN_GRACE_MS + 5 s` (`supervisorShutdownLimit`), so it outlives children that bound their drain by `SHUTDOWN_GRACE_MS`.

## Supervisor (docs/phases/14-docker/07, tasks 1–2, 7–8)

`server/supervisor/` scales a process kind on the machine it runs on: one supervisor per kind per machine forks child
processes (`child_process.fork`, not threads) of the kind's entry and adds or removes them by load.

**Cluster mode (07 task 7).** `startSupervisor({ …, cluster: true })` forks the children through Node's `cluster` module
with the supervisor as the cluster primary (`SCHED_RR`, `cluster.setupPrimary({ exec: entry, execArgv, args })`): a
child's `server.listen(port)` then shares one listening port with its siblings and the primary hands each new connection
to the next child. Same API, same IPC (the worker's `ChildProcess` is the handle; cluster's own traffic never reaches
`message`), same drain and restart. The supervisor's own `port` must be a different one (it cannot listen where its
children do). A draining child closes its server, so the primary stops routing to it while its connections stay. Used by
`ws` (`WS_SUPERVISOR_PORT`).

```ts
import { shouldSupervise, startSupervisor, runAsChild } from '@kuraykaraaslan-labs/process_host/server/supervisor';

if (shouldSupervise('automation-worker')) {          // PROC_AUTOMATION_WORKER_ENABLED=true and not a child
  await startSupervisor({ kind: 'automation-worker', entry: fileURLToPath(import.meta.url), port, policy: { naturalCeiling: partitions } });
} else {                                              // a child, or supervision off (exactly as before)
  await runAsChild('automation-worker', async (ctx) => {
    await startProcessHost({ kind: 'automation-worker', port, health, onDrain });   // child mode: no port
    ctx.reportSignalEvery(5_000, () => lagSeconds());                              // { type: 'signal', value }
  });
}
```

- **Roles.** The supervisor runs no domain work: it starts `min` children with `PROC_CHILD=1`, `PROC_CHILD_INDEX`,
  `PROC_KIND`, `PROC_SUPERVISOR_NODE`, restarts crashed ones, and serves one `/healthz` (worst child wins; a stale
  report is degraded; no running child is fail) and one `/metrics` (its series plus every child's, merged with
  prom-client's `AggregatorRegistry`) through `startProcessHost` on the kind's port.
- **Lifecycle.** `starting` (forked, until its first IPC message; killed after 60 s of silence) → `running` →
  `draining` → `stopped`. A crash restarts the slot after 1, 2, 4 … 60 s (the back-off resets after a minute of stable
  running). Three crashes in 5 min **freeze scale-up**, log `process_crash_loop` and set `process_crash_loop{kind}=1`;
  the freeze clears after 15 min without a crash.
- **IPC.** child → parent `{ type: 'ready' | 'signal' | 'cpu' | 'health' | 'drained' | 'metrics' }`, parent → child
  `{ type: 'drain', reason: 'scale-down' | 'shutdown', graceMs, force } | { type: 'metrics?' }`; every message carries the
  `__procsup` tag so other IPC traffic is ignored. Drain: `drain` → the child runs its drain and answers `drained` →
  SIGTERM; SIGTERM anyway after the kind's drain grace, SIGKILL `SHUTDOWN_GRACE_MS` + 5 s later (a SIGTERM during a drain
  gives the child its shutdown grace, so it is never killed inside it). A kind whose drain rule says `force: false`
  (telephony-gateway) is never cut short in a scale-down: at the end of each grace the supervisor logs and keeps waiting
  for `drained`. A group shutdown sends `shutdown` (escalating a slot that is already draining for a scale-down) and is
  always bounded by the grace.
- **Budget.** cgroup v2 (`/sys/fs/cgroup/cpu.max`, `memory.max`, then the process's own cgroup), cgroup v1
  (`cpu.cfs_quota_us`/`cpu.cfs_period_us`, `memory.limit_in_bytes`), else `os.availableParallelism()` / total memory;
  never above the host. Children get `cores − PROC_RESERVED_CORES` (default 1) and `memory − PROC_RESERVED_MB`
  (default 256). `max(kind) = min(policy.max, cpu, floor(memory / childMemoryMb), naturalCeiling)`, never below `min`;
  `resolvePolicy` clamps a `min` above the natural ceiling to it, with a warning (`PROC_TELEPHONY_GATEWAY_MIN=2` would
  otherwise start a second gateway that cannot bind the SIP port).
- **Shared machine budget (design choice).** The supervisors of one machine agree **without Redis and without a lock**:
  each writes only its own claim file (`$PROC_BUDGET_DIR`, default `/tmp/nb-proc-budget/<kind>--<pid namespace>.json`,
  atomic rename, never through a link left at the temp path) with `{ priority, min, max, childMemoryMb, wants, ns, pool }`,
  reads the others (ignoring claims older than 30 s, and dead pids of its own PID namespace only: another container's
  `pid` means nothing here, so its claim lives as long as it is refreshed),
  and computes the split with the same pure function (`splitBudget`): every kind gets its `min`, then the rest goes in
  priority order — `ws`, `telephony-gateway` → `automation-worker` → `script-host`, `plugin-host` → `worker` — each up
  to what it currently wants. An idle high-priority kind holds only its minimum; when it wants more, lower kinds see
  their allocation shrink and drain down to it one child at a time (`reason: 'budget'`). `wants` is the group's size,
  plus one while the up condition holds and scale-up is not frozen (a frozen group never claims the child it cannot
  start). Inside a container `/tmp` is the container's own, so one container per kind just sees itself (its cgroup is
  its budget). Containers without limits on one host share the directory instead (below); `pool` keeps the split
  honest either way: `host` when the budget is the host's, the container's own namespace when it has a cgroup limit
  (it then splits only its own claims, ignoring the shared ones).
- **Scaling loop.** Every 5 s: sample the signal (default: the children's fresh reports combined by the policy's
  `aggregate`) and the group's CPU, smooth both over 30 s, then decide — up when the smoothed signal stays ≥ `upAt` for
  `upFor` (then `upCooldown`, default 60 s), down when it stays < `downAt` for `downFor` (and `downCooldown`, default
  5 min, since the last change); with a `downCpuBelow` policy the smoothed group CPU must also stay below it for that whole
  time, and no CPU reading means no signal-driven down (`min`, `max` and the budget still apply). With an `upStallSteps`
  policy (automation-worker: 2) the ups brake: after that many signal-driven ups in a row taken while the smoothed signal
  had not fallen below its value at the previous up, the next waits until it falls (or drops under `upAt`, or a down
  happens), or for `UP_STALL_HOLD_MS` (10 min) after the last up, so a signal more children do not lower never walks the
  group up to its budget.
- **CPU (07 task 5).** `runAsChild` makes every supervised child report its CPU every 5 s (`{ type: 'cpu', value }`: user +
  system time over wall time since the last report, percent of one core, `cpuSampler`), whatever its kind. The group's CPU is
  the **average** of the running children's fresh reports (a drained child's share goes to the others, so the group's load is
  what decides whether they can take it); it is published in `signal.cpu` and per child in `children[].cpu`, and on
  `/metrics` as `process_scale_cpu{kind}` (the threshold as `process_scale_threshold{edge="cpu_down"}`). One step at a
  time: no decision while a child starts; while one drains no further down, but an up is still allowed when the draining
  children still fit under the cap (a ws child drains for up to 10 min, a telephony child for a whole call); never below
  `min`, never above the effective max or the budget allocation, no signal-driven up while frozen.
- **Policies.** Defaults per kind in `supervisor.policy.ts` (`automation-worker` up at 2 s of lag for 30 s — D3 — and
  down below 0.5 s with the group CPU below 30 % for 10 min, `aggregate: 'max'` over the children's p95 lag, `childMemoryMb`
  512 from a rough measure; the signal is the automation README's "automation-worker process kind";
  `worker`, `ws`, `telephony-gateway`, `script-host`, `plugin-host` per the plan's table; unknown kinds get generic
  defaults). `ws`: the children's load ratio `max(connections / 5000, loop-lag p99 / 50 ms)` averaged, up at ≥ 1 for 60 s,
  down below 0.5 for 30 min, drain grace 11 min. `telephony-gateway`: `max(calls / capacity, CPU / 100 %)` averaged, up
  above 0.8 for 30 s, down below 0.3 for 20 min, **natural ceiling 1** (one SIP socket per IP), drain `force: false`
  (30 min warning cadence). `worker`, `script-host`, `plugin-host`: the table below. Env wins over code:
  `PROC_<KIND>_ENABLED` (code default off: one process as today; the images of the rolled-out kinds set it on),
  `PROC_<KIND>_MIN`, `_MAX`, `_UP_AT`, `_DOWN_AT`, `_UP_FOR` / `_DOWN_FOR` (ms), `_CHILD_MB`, `_DOWN_CPU` (percent of one
  core), `_DRAIN_MS` (the drain grace); `<KIND>` is the kind upper-cased with `-` → `_`.
- **Wired kinds.** `automation-worker` (07 task 4): `scripts/automation-worker.ts` through automation's `runAutomationWorker`
  (image target `automation-worker`, compose service in profile `workers`). Task 7: `worker` (`scripts/worker.ts` through
  `runProcessKind`, below); `ws` (`websocket.process.ts`, cluster mode on `WS_PORT`, supervisor on `WS_SUPERVISOR_PORT`
  4014, websocket README "Scaling"); `telephony-gateway` (the gateway entry, one child, supervisor on
  `TELEPHONY_HEALTH_PORT`, telephony README "Scaling"); `script-host` (`modules/automation/script-host/host-process.ts`,
  supervisor on `AUTOMATION_SCRIPT_HOST_SUPERVISOR_PORT` 4015) and `plugin-host`
  (`modules/plugin_runtime/server/host/plugin-host.process.ts`, supervisor on `PLUGIN_HOST_SUPERVISOR_PORT` 4501) through
  the local supervisor (below). Since task 8 the images of worker, automation-worker, script-host and plugin-host set
  `PROC_<KIND>_ENABLED=true` (the code default stays off, so `npm run …` and tests run one process; ws and telephony stay off
  in compose until their Prometheus target moves); `false` in the container's environment runs one process.
- **Budget = container limits (07 task 8).** In a container the cgroup limits ARE the budget: set `cpus:` / `mem_limit:` (or
  `deploy.resources.limits`) per service (both compose files document it at the top). Without a limit a container sees the
  whole host: so that unlimited containers on one host split it rather than each sizing for all of it, the node stack
  mounts one `proc_budget` volume at `PROC_BUDGET_DIR=/var/lib/nb-proc-budget` on worker, automation-worker, ws and
  telephony-gateway (the sidecar image creates the mount point as the app user). plugin-host runs untrusted code and
  shares no writable volume with credentialed services: give it its own limits. The pinned release template does not
  carry the volume yet (as it carries no limit), so worker and ws get it only from that file until it does.

### One spawn, one drain protocol (07 task 7)

Every supervisor, Redis-backed or local, uses the same two mechanisms:

- **Spawn** (`supervisor.cluster.ts`, `spawnChildren`): plain `child_process.fork` children (`forkSpawn`), or, with
  `cluster`, `node:cluster` workers with the supervisor as the cluster primary (`clusterSpawn`, `SCHED_RR` round-robin on
  every platform): every child's `server.listen(port)` shares one listening port, the supervisor serves its own
  `/healthz`/`/metrics` on another, and a draining child that closes its server leaves the rotation while its open
  connections stay. `startSupervisor({ cluster: true })` (ws on 4001) and `startLocalSupervisor` (cluster by default: the
  script host on 4012, the plugin host on 4500) both call it. The handle is the worker's `ChildProcess`, so the IPC
  protocol is unchanged.
- **Drain** (supervisor side `Supervisor.drain`, child side `supervisor.drain.ts` `createDrainSequence`, run by both
  `startProcessHost` and `runLocalChild`): `drain { reason: 'scale-down' | 'shutdown', graceMs, force }`. A scale-down may
  take the kind's grace (at least `SHUTDOWN_GRACE_MS`), or no bound with `force: false`; a SIGTERM, a lost supervisor or a
  `shutdown` is bounded by `SHUTDOWN_GRACE_MS` (default 10 s; the local child reads it from the raw environment); a
  `shutdown` during a scale-down escalates it (`DrainInfo.signal` aborts, the short bound starts). The kind's drain gets a
  `DrainInfo` either way.

### One entry, supervised or not: `runProcessKind` (07 task 7)

`server/supervisor/supervisor.process-kind.ts` is the automation-worker pattern made generic for a kind that holds Redis and
starts through `startProcessHost`: `runProcessKind({ kind, port, entry, host, start, signal, perNode })` becomes the supervisor
when `shouldSupervise(kind)` (it never calls `start`, so the kind's modules load only in children when `start` imports them
lazily), otherwise `startProcessHost(host)` (child mode under a supervisor), then `start(ctx)`, then the signal report every
`signal.everyMs` (5 s). `perNode` runs once per node (the supervisor, or the single process; never a child).
`scripts/worker.ts` is written this way (and so has no top-level await: the root package is CommonJS for tsx;
`scripts/sidecar-entries.test.ts` compiles every entry run-sidecar loads as CJS).

### The local supervisor for credential-less kinds (07 task 7)

The script host and the plugin host must not hold `REDIS_URL` or `DATABASE_URL` (a script or plugin that escaped its isolate
must find nothing), and importing `startProcessHost` / `startSupervisor` would load the env schema (which requires
`DATABASE_URL`), the logger and Redis. So:

- `startLocalSupervisor` (`supervisor.local.ts`) runs the **same core** with no env, logger or Redis import (the core logs
  through `supervisor.log.ts`, a console seam `startSupervisor` points at the platform logger; `process-host.boundary.test.ts`
  walks the imports transitively). Its children are cluster workers (the shared spawn above, `cluster: false` forks plain
  ones), so callers keep their URL. The supervisor serves `GET /healthz` (group), `GET /metrics` (`METRICS_ENABLED=true`,
  bearer `METRICS_SECRET` when set) and `GET /supervisor` — `{ state, events, signal, health, port, version }` in the
  `proc:sup:*` shapes, kept in memory (`memorySupervisorPublisher`) — on its **own** port (`supervisor.local-ports.ts`:
  script host 4015, plugin host 4501; ws's Redis-backed supervisor has 4014).
- `runLocalChild` (`supervisor.local-child.ts`): the child side without `startProcessHost`: `start` (listen), health every 5 s,
  the signal every `signal.everyMs`, CPU (from `runAsChild`); a `drain` (or a lost supervisor) runs the shared drain sequence
  around the kind's `drain` (stop taking work, finish what is in flight), answers `drained` and exits.
- `WaitWindow` (`supervisor.wait-window.ts`): a rolling window of wait times and its nearest-rank p95 (0 without a sample),
  the signal of both kinds (FairGate scheduling wait; wait for a free sandbox).
- **In the Scaling view through a relay** (`supervisor.relay.ts`, `startSupervisorRelay`): the worker (`runProcessKind`
  `perNode`: its supervisor, or the single process) polls `GET /supervisor` of the script host it already announces
  (`AUTOMATION_SCRIPT_HOST_URL`'s host, port `AUTOMATION_SCRIPT_HOST_SUPERVISOR_PORT`) and of its node's plugin host
  (`PLUGIN_HOST_URL`'s host, `PLUGIN_HOST_SUPERVISOR_PORT`) every 5 s, and writes `proc:sup:<kind>:<nodeId>` and a
  `proc:nodes:<kind>` supervisor row (`info.relayedBy`) under the supervisor's own `nodeId`, plus the decisions and signal
  samples newer than the lists' heads (one relay per tick through `SET NX proc:sup:relay:<kind>:<nodeId>`, so two relays
  never push an item twice). A supervisor that does not answer is skipped and expires from the view within 15 s. The
  local hosts are credential-less and run untrusted code, so the relay hands them nothing: no bearer by default (never the
  worker's `METRICS_SECRET`); a host given its own `PROC_SUPERVISOR_TOKEN` (the local supervisor's `/supervisor` and
  `/metrics` require it, else `METRICS_SECRET` if it has one, else they are open on the internal network) gets the same
  value from the worker's `AUTOMATION_SCRIPT_HOST_SUPERVISOR_TOKEN` / `PLUGIN_HOST_SUPERVISOR_TOKEN`. It reads at most
  512 KB, relays only a `nodeId` of the generated shape (8 hex characters, it names Redis keys), and every bearer is
  compared in constant time.

| kind | signal (child → supervisor, `aggregate: max`) | up | down | drain |
|---|---|---|---|---|
| `worker` | seconds the oldest waiting job has waited, over the queues the child consumes in every process (`redis.bullmq-wait.ts`, `common` `consumedQueues('every')`; leader-only consumers excluded) | ≥ 30 s for 2 min | < 1 s for 15 min; max 4 | `runDrainHooks`: every consumer `close()` (finish the job in flight), leader lock released first |
| `script-host` | FairGate scheduling wait p95 (ms, last 10 s) | > 50 ms for 30 s | < 10 ms and CPU < 30 % for 10 min | close the listener, answer every request received (batch in flight and queued), stop the isolates |
| `plugin-host` | wait for a free sandbox p95 (ms, last 10 s; the borrow timeout when a call gave up) | > 50 ms for 30 s | < 10 ms and CPU < 30 % for 10 min | close the listener, answer every request received, dispose the sandboxes |

### Published state (D4)

| Key / metric | Content |
|---|---|
| `proc:sup:<kind>:<nodeId>` (string, TTL 15 s, every 5 s) | `SupervisorStateV1`: `{ v, kind, nodeId, hostname, pid, startedAt, updatedAt, policy, budget: { cpu, memoryMb, max, allocation, source }, children: [{ index, pid, startedAt, state, health, restarts, signal, cpu?, restartAt? }], signal: { value, upAt, downAt, edge, since, cpu?, downCpuBelow? }, frozen?: { since, crashes, clearsAt }, status: steady \| scaling \| cooling \| frozen, lastDecision? }` |
| `proc:sup:events:<kind>:<nodeId>` (list, newest first, last 200, TTL 24 h) | `SupervisorEvent`: `{ ts, action: up \| down \| restart \| freeze \| unfreeze, from, to, reason, signal, index? }` |
| `proc:sup:signal:<kind>:<nodeId>` (list, newest first, last 720 = 1 h at 5 s, TTL 1 h) | `SignalSample`: `{ ts, value }`, the smoothed signal at every sample (`value` null without a reading). Added for the observability Scaling view's last-hour line (07 task 6): the state carries only the current value. Written by `Supervisor.tick` through the optional `SupervisorPublisher.signal`. |
| `process_children{kind,state}` · `process_scale_signal{kind}` · `process_scale_threshold{kind,edge}` · `process_scale_cpu{kind}` | children per state, smoothed signal, thresholds (`up`, `down`, `cpu_down`), smoothed group CPU |
| `process_scale_decisions_total{kind,action,reason}` · `process_child_restarts_total{kind}` · `process_crash_loop{kind}` | decisions, restarts, frozen flag |

The supervisor announces itself in `proc:nodes:<kind>` with the **same** `nodeId` and `info.role = 'supervisor'`, so a
reader finds `proc:sup:<kind>:<nodeId>` from the registry without a key scan. The types are a stable import:
`@kuraykaraaslan-labs/process_host/server/supervisor/types` (no runtime code); `readSupervisorState` /
`readSupervisorEvents` / `readSupervisorSignal` (oldest first, optional cut-off) read them back.

A child's info in `proc:nodes:<kind>` carries `role: 'child'`, `childIndex` and `supervisor` (the supervisor's `nodeId`)
next to the entry's own info providers; for `automation-worker` that includes `automation.partitions` (the partitions the
child holds), which the Scaling view joins onto the child row — no extra field in the supervisor state.

## Leader lock

`withLeader(kind, job, run, opts?)` (`server/leader-lock.ts`) runs `run({ token, signal })` only while this process
holds `proc:leader:<kind>:<job>` (SET NX PX 15 s, renewed every 5 s by compare-and-PEXPIRE, released on `stop()` by
compare-and-DEL). Every term takes a fencing token (`INCR proc:leader:<kind>:<job>:fence`). Contenders retry every
5 s, so a dead leader is replaced within ~20 s. A lost lock (or one that cannot be renewed before it expires) aborts
`signal` and calls the cleanup `run` returned. It resolves after the first attempt, so with one process the work starts
exactly when it used to. Only single-key commands: works on a single node, Sentinel or Cluster.

Renewal never waits for `run`: the lock calls have their own serial chain and `run` executes beside it, so a leader
won late (the previous one died) keeps renewing while it starts every single-owner scheduler, however long that takes.
Every lock call is bounded (`callTimeoutMs`, default the renew interval): the shared client queues commands while
disconnected and never rejects them, so without the bound a partitioned leader would never notice. A leader that
cannot renew steps down (aborting `signal`) while the lock is still certainly its own. A cleanup returned by a `run`
that settles after its term ended runs at once, and `stop()` waits for it.

Applied to the single-owner work: `common` `startBackgroundJobs` / `bootRuntime` take a `leader` runner, and
`scripts/worker.ts` and `instrumentation.ts` pass `withLeader('worker', …)`, so every `common:boot_task` of phase
`scheduler` (the BullMQ repeatable registrations, cron owners and sweeps, the automation purge) runs in one process of
the cluster under `proc:leader:worker:schedulers`. Tasks declared `parallel: true` (`automation_generic_host`,
`messaging_moderation_ai`, `storage_virus_scan`) run in every process.
