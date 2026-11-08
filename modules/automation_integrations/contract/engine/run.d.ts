// GENERATED from modules/automation/server/engine/run.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { type BreakerEvent, type BreakerState, type ScriptKillReason } from './breaker';
import { type LifecycleEvent, type NodeStatus, type Scheduler } from './lifecycle';
import { type Cause, type Lineage } from './cause';
import { type CompiledFlow, type CompiledNode } from './compile';
import { ContextStore } from './context';
import { NodeStateStore, type StateBackend } from './state-store';
import type { CallClass } from '../registry/node.types';
import { HoldStore } from './holds';
import { type FlowMsg } from './message';
import { type GuardLimits, type GuardName } from './guards';
import { type SideEffectStore } from './side-effects';
/**
 * Phase 01 §1.4: work queue of `(node, port, msg)` jobs, the copy rule, ports and the error path. `send()` enqueues
 * and never recurses. Slices of ≤ 256 steps or ≤ 10 ms (router MYD numbers, `O1:120-121`); fairness across tenants,
 * lanes and overflow belong to the host (03 §3.3). Around the loop: the per-node breaker and script-kill block (§1.5),
 * `max_parallel`, held messages, the dry run of a test run, the scrubber and the run observer (08). One Runner serves
 * all flows of a tenant, so none of these assume one run at a time.
 */
export declare const SLICE_STEPS = 256;
export declare const SLICE_MS = 10;
/** Router `limits.window` of the large class: keys, timestamps and parts a node may hold. */
export declare const WINDOW_LIMIT = 10000;
/** Queue length of gates and rate limiters (the router's large class). */
export declare const QUEUE_LIMIT = 1000;
/** One node holds at most 16 MiB (01 §1.7); the number lives with the ledger in `holds.ts`. */
export { MAX_HELD_BYTES_PER_NODE } from './holds';
/** What a node may ask of its host: the latest stored value of an entity key, and the path of the record time. */
export interface HostApi {
    latestValue?(tenantId: string, entityId: string, key: string): Promise<unknown>;
    tsPath?: string;
    /** Usage a node reports as it goes (10 §10.6): script CPU time, in ms. */
    meter?(tenantId: string, name: 'script_cpu_ms', n: number): void;
    /** The state of a config node's connection for this tenant (01 §1.6): `degraded` while it is backing off after a failure, undefined when it is healthy or has not been used. Nodes that name the config show it. */
    connectionState?(tenantId: string, ref: string): {
        state: 'degraded';
        attempt: number;
    } | undefined;
    /** The script service and the MQTT connection pool; the node that reads one types it. Absent until the host wires it. */
    script?: unknown;
    mqtt?: unknown;
    /** One targeted delivery through the `webhook` module (`action.webhook`, 05 §5.21). */
    webhook?: unknown;
    /** Switches another flow of the tenant on or off (`action.flow_enable`, 05 §5.13): the deploy service under the run's system actor. */
    flows?: unknown;
    /** The user ids that own an entity (`action.notify`'s `originator_owner`): the owner lookup of the choices list that declares its `entityType`; undefined when no list knows the type (11 §11.5). */
    owners?(tenantId: string, entityType: string, id: string): Promise<string[] | undefined>;
    /** One HTTP call to a resolved `config.http_endpoint` for a contributed node (`integrations_hub.invoke`, 05 §5.22). Absent on a host that offers none. */
    http?: HostHttp;
    /**
     * How a host message enters a flow at its `trigger.flow_input` (`AutomationHost.entry`, 08/14 FP-4): the `iot` host splits telemetry
     * into one message per record there, as its `trigger.message` does, because a root flow's entry is its Flow input. A message another
     * flow hands over with `action.flow_run` never passes through it. Absent: the message goes on unchanged.
     */
    entry?(ctx: RunContext, msg: FlowMsg): Promise<void> | void;
}
/**
 * The request of a contributed node's HTTP call (`HostApi.http`). The node renders the parts; the host owns everything that keeps
 * the call safe: the endpoint's auth (a node never sets a credential header), the egress guard (scheme, host and port come only from
 * the endpoint's base URL, the host must be on its allowed hosts, the path cannot climb out of the base path, then the pinned
 * private-address check), the timeout, the response size cap and the typed failures the Runner retries (03 §3.6).
 */
export interface HostHttpRequest {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    /** Below the endpoint's base path; values the node substituted are URL-encoded by the node already. */
    path: string;
    query?: Record<string, string>;
    /** Never `Authorization`, `Cookie`, `Host`, the transport's own headers or the endpoint's auth header: refused with `invalid_value`. */
    headers?: Record<string, string>;
    /** A JSON value sent as `application/json` (at most 256 KiB); absent: no body. */
    json?: unknown;
    /**
     * The header that carries the run's idempotency key (stable across retries); absent: none is sent. A POST or PATCH without one is
     * not retried on an ambiguous failure (a timeout, a reset connection, a 5xx): only a failure that surely never reached the server
     * (connection refused, name not found, 408, 425, 429) stays transient, so the call is never applied twice.
     */
    idempotencyHeader?: string;
    /** 1 000-30 000 ms, default 10 000. */
    timeoutMs?: number;
    /** 1 KiB-256 KiB, default 64 KiB; one byte more fails with `too_large`. */
    maxBytes?: number;
}
/** The answer of a call below 400: the body parsed as JSON when the server says it is JSON, else text; credential headers dropped. */
export interface HostHttpResponse {
    status: number;
    contentType: string;
    body: unknown;
    headers: Record<string, string>;
}
export interface HostHttp {
    /**
     * Sends the request through `endpoint` (a handle from `ctx.config`, presented as `config.http_endpoint`). A status of 400 or more,
     * a timeout, a refused target and an oversize answer are thrown as the engine's typed failures (`http_status` with `statusCode` and
     * `payload` on the failed message, `timeout`, `ssrf_blocked`, `too_large`, ...), so the Runner retries the transient ones with the
     * same idempotency key. In a dry run nothing leaves: the resolved request is recorded with `ctx.would` and the result is null.
     */
    call(ctx: RunContext, msg: FlowMsg, endpoint: ConfigHandle, req: HostHttpRequest): Promise<HostHttpResponse | null>;
}
/** What `RunContext.notifyGate` answers (08/14 FP-17). */
export interface NotifyGate {
    late: boolean;
    send: string[];
    held: string[];
    heldBefore: number;
    /** Gives back the cooldown claimed for these recipients of `send`: nobody of them was told. Never throws. */
    release(recipients: readonly string[]): Promise<void>;
}
/** The part of the node context (02 §2.3) the run loop provides so far. */
export interface RunContext {
    tenantId: string;
    /** `host` is the host key (`generic`, `iot`, …): `logic.script` runs differently per host. */
    flow: {
        id: string;
        version: number;
        host: string;
    };
    /** The identity this run acts as: the system actor `automation:{flowSlug}@v{version}` (07 §7.6). Not writable by a flow. */
    actor: string;
    node: {
        id: string;
        type: string;
        name?: string;
        params: Record<string, unknown>;
    };
    /** An array maps by position to the declared outputs; `null` skips a port. */
    send(msg: FlowMsg | (FlowMsg | null)[], port?: string): void;
    error(msg: FlowMsg, code: string, text: string, details?: object): void;
    /** A copy: a node cannot change the cause its own calls carry. */
    cause(): Cause;
    /** Aborted on stop, undeploy and redeploy. */
    signal: AbortSignal;
    clock: {
        now(): number;
    };
    /** Evaluates the node param `param` (a `{ kind, v }` value, §1.9) against `msg`; throws `expression` on error. */
    value(param: string, msg: FlowMsg): unknown;
    /** Evaluates a `{ kind, v }` value spec that is not a node param (a row of `rules` or `ops`). */
    valueOf(spec: unknown, msg: FlowMsg): unknown;
    /** Evaluates the expression in node param `param` (default `fallback`); a bad one is `invalid_value`. */
    expr(param: string, msg: FlowMsg, fallback?: string): unknown;
    exprOf(src: string, msg: FlowMsg): unknown;
    /** A secret the node learned at call time (an OAuth access token): the scrubber redacts it from every record, log and error from now on. */
    registerSecret(secret: string): void;
    /** One line to the flow's log (scrubbed by the host, 10) and one run-record action line (08). */
    log(level: 'info' | 'notice' | 'warn' | 'err', text: string): void;
    /** `log('warn', text)`: a warning line in the flow's log (02 §2.3). */
    warn(text: string): void;
    /** Monotonic milliseconds for windows and timers (the injected clock). */
    mono(): number;
    /** The host's optional members; an empty object on a host that offers none. */
    host: HostApi;
    /** The host's read-only metadata keys beside the engine's (§1.1); the field rules of `msg` writes need them. */
    systemMetadata: readonly string[];
    /** Class limits: `window` caps the keys, timestamps and parts a node may hold (router `limits.window`). */
    limits: {
        window: number;
        queue: number;
    };
    /** The node status line the editor shows (08). */
    status(s: {
        fill: string;
        shape: string;
        text: string;
    } | null): void;
    /** In-memory scratch of this node (timer ids and the like): lost on restart, never persisted. */
    volatile: Map<string, unknown>;
    /** How many messages of this node the runner is stepping at once with this one (a wave, `Executor.batch`); 1 otherwise. */
    wave: number;
    /**
     * Starts a new run from this node on `port` (default: its first output): for timers and watchers that have no
     * input message. The message is built from `partial`; its `_run` and `_msgid` are fresh (01 §1.2).
     */
    emit(partial: Partial<FlowMsg> & {
        originator?: {
            type: string;
            id: string;
        };
    }, port?: string): void;
    /** Runs `fn` after `ms` (in memory here; the host makes waits over 60 s durable, 03 §3.5). Returns an id for `cancel`. */
    timer(ms: number, fn: () => Promise<void> | void): string;
    cancel(id: string | null | undefined): void;
    /**
     * Books a message a node keeps across runs (01 §1.7): the node writes it to its state under a held-message key itself,
     * and `hold` books the bytes against 16 MiB per node (`park_limit`) and the tenant's parked-bytes budget (`queue_full`),
     * once per `_msgid`. `release(msg)` gives them back. A node books what it still holds again on start (`rebookHeld`).
     */
    hold(msg: FlowMsg): void;
    release(msg: FlowMsg): void;
    /** One run-record action line (08). */
    action(text: string): void;
    /** True in a test run for a node that is not a safe read: it must not leave the process, and says what it would do. */
    dryRun: boolean;
    /** Records what the node would have done (text cut to 256); does nothing outside a dry run. */
    would(text: string, args?: Record<string, unknown>): void;
    /** Script kills (06 §6.3): the third one blocks the node for 60 s. Not a breaker exception. */
    breaker: {
        recordScriptKill(reason?: ScriptKillReason): 'blocked' | undefined;
        blockedUntil(): number | undefined;
    };
    /** Renders the node param `param` as a `{{ }}` template against `msg`; throws `expression` on error. */
    template(param: string, msg: FlowMsg, fallback?: string): string;
    clone<T>(msg: T): T;
    /** Per-node state (§1.7) and the state partition of `msg` for this node's `stateful` declaration. */
    state: NodeStateStore;
    stateKey(msg: FlowMsg): string;
    /** `flow.*` / `global.*` context (§1.8). */
    context: ContextStore;
    /** Stable across retries and replays and distinct per tenant; `call` numbers a node's external calls for one message (§1.2). */
    idempotencyKey(msg: FlowMsg, call?: number): string;
    /**
     * When the first attempt of this node's call for this input started: the same on every retry of it (a parked call: when it was
     * parked), so a value the call derives from the time (a point's timestamp) is the same on each attempt (08/14 FP-18).
     */
    callStartedAt(): number;
    /**
     * 08/14 FP-16 (and LG-21): asked before a command goes to a device, once per device and call. Refused when the message is late
     * (`metadata.late`: acting on readings hours old switches equipment on stale values; counted `ttl`) or when the device already
     * had the tenant's commands a minute (`commandsPerMinute`, default 30; counted `command_rate`); the node then sends nothing and
     * leaves the message through `error` with code `limit`. A retry of the same call is not counted again. A test run claims nothing.
     */
    deviceCommand(msg: FlowMsg, deviceId: string, call?: number): Promise<{
        ok: true;
    } | {
        ok: false;
        guard: 'ttl' | 'command_rate';
        message: string;
    }>;
    /**
     * 08/14 FP-17 (and LG-21): which recipients (`recipientKeyOf` keys) of a notification for `reason` get it now. A late message
     * (`metadata.late`) notifies nobody (counted `ttl`); otherwise a recipient told the same reason by this flow inside the tenant's
     * cooldown (`notifyCooldownMs`, default 10 min) is held back and counted (`cooldown`). `heldBefore`: the most notifications held
     * back for one recipient of `send` since that recipient's last one, for the node to say ("+n"). A retry of the same call answers
     * as its first attempt did. A test run claims nothing. `release(recipients)`: the node tells it which of `send` were not told after
     * all (every delivery failed, or none was made), so their claim is given back and the next notification goes out; call it before
     * leaving through `error` or throwing.
     */
    notifyGate(msg: FlowMsg, reason: string, recipients: readonly string[], call?: number): Promise<NotifyGate>;
    /** A config node by ref; throws `not_configured` when missing or not ready. Secrets never enter a message or a log. */
    config(ref: string): Promise<ConfigHandle>;
    /**
     * Renders a `{{ }}` template that is not a node param; `encode` runs on each substituted value (URL segments) and also
     * gets the value itself (JSON bodies). Like `template`: one step budget, and more than 64 KiB (`MAX_STR`) of output, or
     * of one value before it is encoded, throws `limit`.
     */
    templateOf(text: string, msg: FlowMsg, encode?: (s: string, value: unknown) => string): string;
    /** `action.emit`: an internal event other flows hear with `trigger.event` (source `flow`). */
    event(kind: string, data: unknown, depth: number): Promise<'ok' | 'rate_limited' | 'loop_guard'>;
    /** `action.timer`: start (again) a named timer, or cancel it with `null`; false when too many timers. */
    namedTimer(name: string, ms: number | null): Promise<boolean>;
    /** Hands `msg` to the `trigger.link_in` nodes named `name` (any flow of the tenant); returns how many. `callId` marks a `link_call`. */
    link(name: string, msg: FlowMsg, callId?: string): number;
    /** `action.link_out` mode return: answers the waiting `logic.link_call`; false when none waits. */
    linkReturn(msg: FlowMsg, name?: string): boolean;
    /** `action.http_response`: publishes the reply of the run's synchronous webhook; throws `no_reply_pending` / `reply_sent`. */
    reply(msg: FlowMsg, response: {
        status: number;
        headers: Record<string, string>;
        body: string;
    }): Promise<void>;
    /** One value to the debug ring of the flow (08). */
    debug(value: unknown, path: string, topic?: string): void;
    /**
     * Only a node that declares `originatorRewrite` and is allowlisted. The runtime looks up the tenant that owns the
     * entity (`RunnerOptions.tenantOf`), never the node; another tenant's entity or an unknown one is `cross_tenant`.
     */
    setOriginator(msg: FlowMsg, ref: {
        type: string;
        id: string;
    }): Promise<void>;
}
export interface Executor {
    /** May be async, bounded by 10 s; throw `{ fatal: true }` when the config can never work (§1.6). */
    start?(ctx: RunContext): Promise<void> | void;
    stop?(ctx: RunContext): Promise<void> | void;
    input?(ctx: RunContext, msg: FlowMsg): Promise<void> | void;
    /**
     * Runs when an event the node declared in `wake` arrives (03 §3.5, G-159), with the event as the message: the node usually
     * releases a message it holds from an earlier run (`ctx.send` of the held message) and drops the event itself.
     */
    wake?(ctx: RunContext, msg: FlowMsg): Promise<void> | void;
    /**
     * The node checks `ctx.dryRun` itself and reports `ctx.would` instead of acting (08 §8.11). In a test run the Runner
     * does not call an `external` node that is neither a safe read nor dry-run aware: it records "would run (not
     * simulated)" and passes the message on, so a contributed node that forgot the check still never leaves the process.
     */
    dryRunAware?: boolean;
    /**
     * The node takes a wave (06 §6.1): when the runner reaches one of its jobs it also takes up to `batch - 1` more of the node's
     * queued jobs (from the next `WAVE_SCAN` in the queue, in queue order) and steps them together, so an executor that coalesces
     * its calls (`logic.script`) sends one request for all of them. Each message is still its own visit, with its own errors and sends.
     */
    batch?: number;
    /**
     * How many waves of the node may be in flight at once (with `batch`); absent = 1: the runner awaits each wave before it steps the
     * next job. Above 1 a wave is started and the tenant's queue goes on, until that many of the node's waves wait; then the runner
     * waits for one of them. For a node whose wave is one round trip (a database write), so the round trip no longer bounds the
     * tenant's rate. Entries of one lane stay in order: the host starts a lane's next entry only when this one's runs have settled.
     */
    waves?: number;
}
export interface OutageError extends Error {
}
export type RunEvent = {
    kind: 'uncaught';
    flowId: string;
    nodeId: string;
    code: string;
    message: string;
    run: string;
}
/** Every error a node reports, caught or not (the error log, node counters and alerts read this one). */
 | {
    kind: 'error';
    flowId: string;
    nodeId: string;
    type: string;
    run: string;
    code: string;
    message: string;
    caught: boolean;
    originator: {
        type: string;
        id: string;
    };
    limit?: {
        key?: string;
        scope?: string;
    };
    /** On a `timeout`: how long the node had been running (ms) and its call deadline (`limit`, ms; absent when the node has none) (08 §8.5). */
    timing?: {
        ms: number;
        limit?: number;
    };
} | {
    kind: 'hop_limit';
    flowId: string;
    nodeId: string;
    run: string;
}
/** A redelivery or DLQ replay of a message the node already holds was not taken again (01 §1.7): `automation_dropped_total{reason="held_replay"}`. */
 | {
    kind: 'held_replay';
    flowId: string;
    nodeId: string;
    run: string;
} | {
    kind: BreakerEvent;
    flowId: string;
    nodeId: string;
    code: 'circuit_open' | 'blocked';
}
/** A script killed for time or memory (06 §6.3): the metric counts it whether or not it blocked the node. */
 | {
    kind: 'script_kill';
    flowId: string;
    nodeId: string;
    reason: ScriptKillReason;
} | {
    kind: 'originator_rewritten';
    flowId: string;
    nodeId: string;
    run: string;
    from: {
        type: string;
        id: string;
    };
    to: {
        type: string;
        id: string;
    };
} | {
    kind: 'outage';
    flowId: string;
    nodeId: string;
    run: string;
} | {
    kind: 'debug';
    flowId: string;
    nodeId: string;
    run: string;
    path: string;
    topic?: string;
    value: unknown;
} | {
    kind: 'reply_late';
    flowId: string;
    nodeId: string;
    replyId: string;
} | {
    kind: 'log';
    flowId: string;
    nodeId: string;
    run: string;
    level: string;
    text: string;
} | {
    kind: 'action';
    flowId: string;
    nodeId: string;
    run: string;
    text: string;
} | {
    kind: 'state_evicted';
    flowId: string;
    nodeId: string;
    key: string;
}
/**
 * A flow protection acted (08/14, `engine/guards.ts`): counted per flow, node and tenant and shown in the UI. `text` (scrubbed) is
 * set on the event the flow log and the editor show, once per input for a guard that drops many messages of it.
 */
 | {
    kind: 'guard';
    guard: GuardName;
    flowId: string;
    nodeId: string;
    run: string;
    text?: string;
} | {
    kind: LifecycleEvent;
    flowId: string;
    nodeId: string;
    code?: string;
    message?: string;
    fatal?: boolean;
    attempt?: number;
    attempts?: number;
};
/** What a step sent on one port. `to` is empty when the port is not wired: that message leaves the flow. */
export interface StepOut {
    port: string;
    to: string[];
    /** A snapshot taken at send time; absent when the run is not captured. */
    msg?: FlowMsg;
}
/**
 * One node visit of a run (08 §8.4). Visits of one run are numbered `i` from 1 in the order they start; the trigger
 * node is visit 1 of a run that `inject` started. A visit that ends in `continuations.park` is `parked`: its call runs
 * later as a continuation step (same `i` space restarts, `attempt` says which try it is).
 */
export interface StepEvent {
    run: string;
    flowId: string;
    i: number;
    /** Start time and duration on the Runner's clock. */
    t: number;
    ms: number;
    node: CompiledNode;
    /** The message as the node received it, before the node ran; absent when the run is not captured. */
    input?: FlowMsg;
    error?: {
        code: string;
        message: string;
        caught: boolean;
    };
    outs: StepOut[];
    attempt?: number;
    parked?: boolean;
    /** A continuation's call failed transiently and was handed back with a back-off: it runs again later, so its outcome is still open. */
    rescheduled?: boolean;
}
/**
 * The run record, the trace, the node counters and the test runner are built on this. The Runner interleaves runs and
 * runs external calls concurrently, so nothing here assumes one run at a time; an observer that throws is ignored.
 * `end` fires whenever the last job of a run has ended, before `settled()` resolves: a parked continuation counts as
 * ended, so a run that resumes later ends again.
 */
export interface RunObserver {
    /**
     * False when nothing reads the snapshots: no step of any run keeps an input or an output copy. It is per observer, so
     * it also covers a continuation (`runContinuation`), which has no `begin` and no per-run state to ask.
     */
    captures?: boolean;
    /** A run starts at `node`. `capture: false` keeps the input and output snapshots out of this run's steps. Do not keep `msg`. */
    begin?(e: {
        run: string;
        flowId: string;
        node: CompiledNode;
        msg: FlowMsg;
        lineage: Lineage;
    }): {
        capture?: boolean;
    } | void;
    step?(e: StepEvent): void;
    end?(e: {
        run: string;
        flowId: string;
        abandoned: boolean;
    }): void;
}
/**
 * An external call whose last attempt failed with nothing to catch it (08/14 FP-15): the host writes it to the tenant's dead letters
 * (`retries_exhausted`), from where a replay runs the node again on the same message (`Runner.retry`), with the same idempotency key.
 */
export interface RetryDeadLetter {
    flowId: string;
    nodeId: string;
    msg: FlowMsg;
    depth: number;
    lineage: Lineage;
    code: string;
    message: string;
    attempts: number;
}
export interface EventPort {
    /** Returns `ok`, or the refusal the node reports (`rate_limited`, `loop_guard`). */
    emit(args: {
        tenantId: string;
        source: string;
        kind: string;
        data: unknown;
        depth: number;
        lineage: Lineage;
    }): Promise<'ok' | 'rate_limited' | 'loop_guard'>;
}
export interface DurableTimerPort {
    start(tenantId: string, name: string, ms: number): Promise<boolean>;
    cancel(tenantId: string, name: string): Promise<boolean>;
    /**
     * A durable wake of the tenant's runtime at `at` (01 §1.7, G-009 c): an in-memory wait longer than `MEMORY_TIMER_MS` lives only
     * while the runtime does; when the runtime is evicted or the worker restarts and no entry of the tenant arrives, the wake's entry
     * rebuilds it, and its nodes re-arm their waits from the stored due times. Coalesced by the host; best effort.
     */
    wake?(tenantId: string, at: number): Promise<void>;
}
/** A config node of the tenant (a connection or credential set), secrets already substituted host-side (P7). */
export interface ConfigHandle {
    type: string;
    values: Record<string, unknown>;
    /** The secret values of this config and the ones derived from them (a Basic header); registered with the scrubber. */
    secrets?: readonly string[];
}
export interface ConfigPort {
    /** Null when the ref does not exist or is not ready (a secret omitted on import). */
    get(tenantId: string, ref: string): Promise<ConfigHandle | null>;
}
export interface ReplyPort {
    /** False when nobody waits any more (the route gave up): the late reply is counted `reply_late`. */
    publish(replyId: string, response: {
        status: number;
        headers: Record<string, string>;
        body: string;
    }): Promise<boolean>;
}
/** A parked external call (§3.5): the node's input, resumed with the same keys after a crash or a back-off. */
export interface ContinuationItem {
    id: string;
    tenantId: string;
    flowId: string;
    flowVersion: number;
    nodeId: string;
    msg: FlowMsg;
    attempt: number;
    depth: number;
    lineage: Lineage;
    k: number;
    /** The node's type and params version when it parked (07 §7.7, D-11): it resumes only on the same type and the same or a newer `v`. Absent on items parked before they were recorded. */
    nodeType?: string;
    nodeV?: number;
    /** When the call was first parked (the runner's clock); kept across back-offs, so the host can apply the 7-day cap (03 §3.5). Absent on items parked before it was recorded. */
    parkedAt?: number;
}
/** Where parked continuations live; the host provides a durable one (Redis), tests an in-memory one. */
export interface ContinuationPort {
    park(item: ContinuationItem): Promise<void>;
    /** Hands a failed attempt back with a back-off; the item keeps its id. */
    reschedule(item: ContinuationItem, delayMs: number): Promise<void>;
    complete(item: ContinuationItem): Promise<void>;
}
/** The engine's deadline sits this long after the node's own limit, so a node that times itself out reports its own failure. */
export declare const CALL_GRACE_MS = 1000;
/**
 * automation.04: the most node jobs one run may queue across all its hops. The hop limit bounds a chain, not a fan-out: a loop
 * that goes back through a split via an async node (a wait, a timer) doubles its live work each pass without ever reaching the
 * hop limit. Past this many jobs the run is cut: an `error` (`run_job_cap`) is reported once and its further messages are dropped.
 */
export declare const MAX_RUN_JOBS = 100000;
export interface RunnerOptions {
    tenantId: string;
    /** automation.04: the per-run job cap (default `MAX_RUN_JOBS`). */
    maxRunJobs?: number;
    flows: readonly CompiledFlow[];
    executors: ReadonlyMap<string, Executor>;
    clock?: {
        now(): number;
    };
    scheduler?: Scheduler;
    /** A host lowering the ceiling of a call class (01 §1.4, `automation:host` limits): never above the class's own. */
    callMaxMs?: Partial<Record<CallClass, number>>;
    /** This tenant's state and context storage (production: Redis); default in memory. */
    backend?: StateBackend;
    /** The host's read-only metadata keys (`AutomationHost.systemMetadata`, 03 §3.1): a node write to one is `readonly_field`. */
    systemMetadata?: readonly string[];
    /** `sys.*` reads of expressions (host-provided, e.g. the router's device state). */
    sys?: (key: string) => unknown;
    /** Config nodes (`ctx.config`); without it every ref is `not_configured`. */
    configs?: ConfigPort;
    /** Event bridge for `action.emit` (04 §4.6): enqueues a `flow` event on every host with a listener. */
    events?: EventPort;
    /** Named timers of `action.timer` beyond 60 s are durable and fire as `timer` entries (04 §4.5). */
    durableTimers?: DurableTimerPort;
    /** Synchronous webhook replies (04 §4.4): the route waits on the id the host put in `metadata.replyId`. */
    reply?: ReplyPort;
    /** Durable continuations for `external` nodes; without it they run inline (the lane stays held). */
    continuations?: ContinuationPort;
    /** Host key for derived run ids (`generic`, `iot`, …). */
    hostKey?: string;
    /** Called after a timer callback ran, so the host loop schedules a slice for the jobs it queued. */
    onWork?: () => void;
    /** The tenant's IANA zone for `fmt_time`. */
    timeZone?: string;
    /** Optional members of the host for nodes that read its data (`logic.delta` seeding, record time). */
    hostApi?: HostApi;
    /** Node types allowed to rewrite the originator (registry allowlist); default `logic.originator` only. */
    originatorRewrite?: readonly string[];
    /** The tenant that owns an originator entity; without it (or for an unknown entity) `setOriginator` fails closed. */
    tenantOf?(ref: {
        type: string;
        id: string;
    }): Promise<string | undefined>;
    /** Sees every run and step (08). */
    observer?: RunObserver;
    /** Gets every event as it happens. The host sets `keepEvents: false` once it has a sink, so `events` stays empty. */
    onEvent?: (e: RunEvent) => void;
    /** Keep events in `Runner.events` (default true). The `error` event is delivered to `onEvent` only. */
    keepEvents?: boolean;
    /** This tenant's held messages and their budget; default an unlimited store of its own. */
    holds?: HoldStore;
    /**
     * A test run (08 §8.11): `ctx.dryRun` is true for every node type not in `safeReads`, which must not leave the
     * process, and `would` receives what they say they would have done. Events, named timers, replies and links are
     * neutralised here, so a node does not have to.
     */
    dryRun?: {
        safeReads: ReadonlySet<string>;
        would(item: {
            node: string;
            type: string;
            text: string;
            args: Record<string, unknown>;
        }): void;
    };
    /**
     * Test mode of the copy rule (01 §1.4): a node whose declaration says `mutates: false` (a trigger aside) gets a deep-frozen
     * copy of its message, so a write to it throws and fails the test. What such a node sends on is cloned at send time, so a frozen
     * message never reaches a later node that may mutate. Off by default: production pays nothing.
     */
    freezeNonMutating?: boolean;
    /** Takes secrets out of every sink: error messages and details, log, debug and action lines (10 §10.2). */
    scrub?: {
        text(s: string): string;
        value<T>(v: T): T;
        add(s: string): unknown;
    };
    /**
     * The slugs of the tenant's root flows (`LoadedTenant.roots`, 08/14 FP-4): an `action.flow_run` into one fails with `forbidden`, the
     * runtime half of the deploy check. Absent: none is known here and only the deploy check guards.
     */
    roots?: ReadonlySet<string>;
    /**
     * The tenant's flow protections (08/14, `GuardLimits`), read each time a guard acts so a plan change reaches a live runtime. Absent:
     * neither the fan-out cap nor the concurrency cap applies (a bare runner of the engine's tests); every host runtime and the test
     * runner pass them.
     */
    guards?: () => Pick<GuardLimits, 'maxFanout' | 'maxConcurrentRuns'> & Partial<Pick<GuardLimits, 'commandsPerMinute' | 'notifyCooldownMs'>>;
    /**
     * Where the side-effect guards count (08/14 FP-16, FP-17): commands per device and notification cooldowns, shared by the tenant's
     * workers. Absent (or without `guards`): neither applies, a late message is still refused.
     */
    sideEffects?: SideEffectStore;
    /** Writes an external call that failed its last attempt, uncaught, to the dead letters (FP-15). Absent: none is written. */
    deadLetter?: (item: RetryDeadLetter) => void;
}
export interface SliceResult {
    steps: number;
    /** True when the queue is empty. */
    idle: boolean;
}
export interface Runner {
    readonly events: RunEvent[];
    /** `stopped`: messages a disabled node swallowed. */
    readonly stats: {
        steps: number;
        exceptions: number;
        stopped: number;
    };
    readonly pending: number;
    /**
     * A retired runtime that still has runs in flight past the engine's longest wait (`runOverrunMs`, 07 §7.7) is an engine fault:
     * before it is disposed, every run still in flight is given up. Its queued jobs are dropped, its run ends (the record says
     * `abandoned`) and whoever waits on it is released, so the entry waiting on it no longer blocks its lane for good; the host
     * dead-letters that entry (`run_abandoned`), which keeps it for a replay. A job of a forsaken run that ends later is ignored.
     * Returns the runs given up.
     */
    forsake(): string[];
    /** True if `forsake` gave the run up. */
    wasForsaken(run: string): boolean;
    /**
     * Resolves when every job of the run has ended (a parked continuation counts as ended: it is durable). The host
     * settles an input entry on this and XACKs it (§3.4).
     */
    settled(run: string): Promise<void>;
    /**
     * `settled` for the run and every run started in its scope (`trigger.complete`, `trigger.status`, 04 §4.5), recursively: those
     * runs have no stream entry, so an entry acknowledged on its own runs alone left them in memory only (lost on a crash) and let
     * the lane's next entry overtake a multi-hop complete handler (03 §3.4). Resolves to every run of the tree, the root first, so
     * the host can read their abandon flags and steps.
     */
    settledTree(run: string): Promise<string[]>;
    readonly inflight: number;
    /** Starts a run at a node's input. The cause defaults to the executor call in progress, if any. */
    inject(flowId: string, nodeId: string, msg: FlowMsg, entry?: import("./cause").EntryStart, opts?: {
        wake?: boolean;
    }): boolean;
    /**
     * FP-19: stops starting runs of a flow that paused itself as a suspected loop, until the runtime is rebuilt without it (the pause
     * is a deploy). Runs in progress finish; what reaches the flow meanwhile, and the runs waiting for a concurrency slot, are dropped
     * and counted under `rate`.
     */
    pauseFlow(flowId: string): void;
    /** Runs waiting behind their flow's concurrency cap (`GET flows/{id}/status`, the editor's banner). */
    waitingRuns(flowId: string): number;
    /**
     * FP-15: replays a dead-lettered external call (`retries_exhausted`): the node runs again on the message it failed with, with the
     * same `_msgid` and so the same idempotency key, as a run of its own that settles the replayed entry. False when the node is gone,
     * disabled or no longer external (the replay is then a drop, as a targeted entry whose node a deploy removed).
     */
    retry(item: Pick<RetryDeadLetter, 'flowId' | 'nodeId' | 'msg' | 'depth' | 'lineage'>): boolean;
    /**
     * Starts every node whose executor has `start` (§1.6). Resolves after each node's first attempt; a failing node
     * retries on the scheduler (5 s × attempt, cap 60 s) while the others run.
     */
    startAll(): Promise<void>;
    /**
     * Handover at a deploy (07 §7.7, G-098): the runtime that replaces this one has re-armed every node's waits from the stored held
     * keys, so the node timers armed here now would fire a second time; they are cancelled. A run still in progress here finishes,
     * and a timer it arms from now on (state the new runtime did not load) or a named `action.timer` (known only here) still fires.
     * Returns how many timers were cancelled.
     */
    quiesce(): number;
    /**
     * `nodes`-mode handover (07 §7.5, §7.7; G-098): the node state that lives only in a runner's memory follows a node the deploy
     * did not change, so an unchanged node is not reset by a deploy of its neighbours. For every node of this runner that `keep`
     * accepts and that `from` (the runtime being replaced) knows: its breaker (state, failures, cooldown and script-kill block;
     * the same object, so a run `from` still finishes counts on it too), the status line it set itself and the red status of an
     * uncaught error. Nothing of a node `keep` refuses (changed, new, or every node of a `full` deploy) comes over: it starts
     * fresh. Lifecycles are not moved: a started node's context belongs to the runtime that started it. Call it before the
     * first entry reaches this runner. Returns the nodes adopted.
     */
    adopt(from: Runner, keep: (flowId: string, nodeId: string) => boolean): number;
    readonly timersArmed: number;
    stopAll(): Promise<void>;
    /** The lifecycle status while a node is not running, else the line the node set itself. */
    status(flowId: string, nodeId: string): NodeStatus | undefined;
    /** The status of every top-level node of a flow that has one; `undefined` for a flow this runner does not serve. */
    statuses(flowId: string): Record<string, NodeStatus> | undefined;
    /** Ids of the top-level nodes of a flow, for a payload that lists every node (counters of an idle one are zero). */
    nodeIds(flowId: string): string[] | undefined;
    /** Runs jobs until the slice budget is spent or the queue is empty. */
    runSlice(maxSteps?: number, maxMs?: number): Promise<SliceResult>;
    readonly queued: number;
    /** Runs the queued jobs until none is left, without waiting for inline external calls still in flight. */
    drainQueue(): Promise<void>;
    /** Runs until the queue is empty and every inline external call has ended (tests, the test runner). */
    drain(): Promise<void>;
    readonly parks: number;
    /** True once if the run hit an outage; the host leaves its entry pending instead of acknowledging it. */
    takeAbandoned(run: string): boolean;
    /**
     * Runs a parked continuation (the host's poller calls this, 03 §3.5). The item is completed unless the attempt was
     * handed back with a back-off; a crash before `complete` leaves it due again, and it runs with the same keys.
     */
    runContinuation(item: ContinuationItem): Promise<'done' | 'rescheduled' | 'gone'>;
    /** The breaker of a node as of now: `blocked` after repeated script kills, else the breaker's own state. */
    breakerState(flowId: string, nodeId: string): BreakerState | 'blocked';
    /** The nodes whose breaker is not closed, for the `automation_breakers_open` gauge (08). A cooled-down one reads `half_open`. */
    openBreakers(): Array<{
        flowId: string;
        nodeId: string;
        state: Exclude<BreakerState, 'closed'> | 'blocked';
    }>;
    /**
     * OD-29: the tenant may no longer start runs (its plan declares `module:automation` off). Every in-memory named timer is cancelled
     * and one a run still arms later fires into nothing, so a self-re-arming `action.timer` loop ends here. Returns how many were cancelled.
     */
    stopNamed(): number;
    /** The flow's `flow.*` context (the host seeds or reads it; tests set it up). */
    flowContext(flowId: string): ContextStore;
    /** Bytes a node holds (08 metrics). */
    heldBytes(flowId: string, nodeId: string): number;
    /** The code of the first uncaught error of a run, once: a synchronous webhook answers 500 `{ error: code }` (04 §4.4). */
    takeUncaught(run: string): string | null;
}
