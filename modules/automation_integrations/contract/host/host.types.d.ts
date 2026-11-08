// GENERATED from modules/automation/server/host/host.types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { HostApi } from '../engine/run';
/**
 * Phase 03 §3.1: the host contract (`automation:host`). A host is where flows run: it owns the input stream, the
 * dispatch policy and the capabilities. `generic` runs in the NB worker, `iot` in the iot-worker.
 */
export interface EntryScope {
    scopeType: string;
    label: string;
    /** The `automation:choices` list that names the scope ids; required unless the scope is `hostWide`. */
    choices?: string;
    /** Always bound: 07 refuses to remove the last binding. */
    required: boolean;
    maxBindings?: number;
    /**
     * The scope has one binding for the whole host, with `scopeId` ''. Only a host-wide scope takes the empty id, and it takes no
     * other: a root op with '' on a scope that is not host-wide answers `scope_id_required`, a non-empty id on a host-wide one
     * `scope_id_not_allowed` (07 §7.2). A seed's `bindAs` binds '' and so must name a host-wide scope.
     */
    hostWide?: boolean;
}
export interface TestRunnerSupport {
    /** `declaration` | `pasted` | `last_run` | the host's own sources. */
    sampleSources: string[];
    metadataDefaults(tenantId: string, msgType: string): Promise<Record<string, unknown>>;
    /** Node types whose reads may run for real in a dry run. */
    safeReads: string[];
}
export type HostInputKind = 'event' | 'schedule' | 'inject' | 'webhook' | 'timer' | (string & {});
export interface HostInput {
    kind: HostInputKind;
    msgType: string;
    originator: {
        type: string;
        id: string;
    };
    payload: unknown;
    metadata?: Record<string, unknown>;
    /** Targeted entries (schedule, inject, webhook, timer) start only at the named node. */
    target?: {
        flowId: string;
        nodeId: string;
        rev: number;
    };
    /** `replayOf` marks a DLQ replay: its run ids derive from `origin` so side effects repeat their keys (§3.4, §3.7). */
    lineage?: {
        origin: string;
        parentRun?: string;
        replayOf?: string;
    };
    /** Loop-guard depth of an entry a flow created (01 §1.2); above 4 the host drops it as `loop_guard`. */
    depth?: number;
    /** The caller's idempotency base (a schedule tick, an `Idempotency-Key` header). */
    key?: string;
    /** Synchronous webhook reply (04 §4.4). */
    reply?: {
        id: string;
        deadline: number;
    };
}
/**
 * `invalid`: the input is not a well-formed `HostInput` (`checkHostInput`). `loop_guard`: the input was caused by a flow's own call and is
 * already `MAX_CAUSE_DEPTH` levels deep (01 §1.2). `plan`: the tenant's plan declares `module:automation` and says no (OD-29); its
 * deployed flows stay stored and run again once the entitlement is back.
 */
export type Refusal = 'too_big' | 'quota' | 'backpressure' | 'unknown_target' | 'host_offline' | 'loop_guard' | 'invalid' | 'plan';
/** A decoded stream entry. `deliveries` > 1 means a redelivery. */
export interface HostEntry {
    id: string;
    tenantId: string;
    partition: number;
    deliveries: number;
    input: HostInput;
}
/** A (flow, node) that wants an entry, with the filter pre-compiled by the trigger index (04 §4.1). */
export interface DispatchTarget {
    flowId: string;
    nodeId: string;
    /** Run the node's executor `wake` with the entry, not a run from the node's input (G-159). */
    wake?: true;
    /**
     * The node is a root flow's entry for the fleet's data (the IoT host's rule 1): a device message past its time-to-live still runs
     * here when the flow is one of the tenant's roots (08/14 FP-11, LG-7). Every other target of a late message drops it.
     */
    root?: true;
}
export interface DispatchPolicy {
    /** Which trigger nodes of the tenant's compiled set start a run for this entry. */
    select(entry: HostEntry): DispatchTarget[];
}
export interface HostLimits {
    maxMessageBytes: number;
    tenantAdmitted: number;
    tenantInflightAsync: number;
    partitionUnsettled: number;
    partitionParkedBytes: number;
    streamHardLength: number;
    tenantBacklogMs: number;
    /** An entry whose runs outlive this is an engine fault (03 §3.4): twice the largest in-memory wait (a 60 s timer), 120 s. */
    runOverrunMs: number;
}
/**
 * A host's `limits` declaration (03): overrides of the runtime limits inside the engine's ceilings, and the plan entitlement that
 * gates its flows (10 §10.4: "each host names its key in its `limits`"). `entitlement` absent: the host's flows are not gated by
 * an automation entitlement (the IoT host follows its own layer's, `iot_automation/10`).
 */
export interface HostLimitsDeclaration extends Partial<HostLimits> {
    /** The entitlement key create, deploy, restore, inject and worker admission ask for this host's flows; `module:automation` for `generic`. */
    entitlement?: string;
}
export interface AutomationHost {
    /** `generic` | `iot`; a duplicate key fails the host registry. */
    key: string;
    label: string;
    msgTypes: Array<{
        type: string;
        label: string;
        sample?: unknown;
    }>;
    /** Metadata the host sets and marks read-only. */
    systemMetadata: string[];
    entryScopes: EntryScope[];
    /** Extra `trigger.event` sources (04 §4.6). */
    eventSources?: string[];
    /** The host's own dispatch; default is the trigger index (§3.3). */
    dispatch?: DispatchPolicy;
    /** Default: `${originator.type}:${originator.id}`. */
    laneKey?(entry: HostEntry): string;
    capabilities: {
        writeBarrier: boolean;
        syncReply: boolean;
    };
    testRunner: TestRunnerSupport;
    limits?: HostLimitsDeclaration;
    /** Types it cannot run (IoT: edge-only types with their cloud equivalent). */
    foreignTypes?: Record<string, {
        reason: string;
        hint?: string;
    }>;
    /** Latest-value reader for enrichment and delta seeding. */
    latestValue?(tenantId: string, entityId: string, key: string): Promise<unknown>;
    /** Path of the record time (`logic.delta`, `logic.dedup`); absent: the arrival time is the message time. */
    tsPath?: string;
    /**
     * How one of the host's messages enters a flow at its `trigger.flow_input`, a root flow's entry (08/14 FP-4): handed to the nodes
     * as `HostApi.entry`. It sends what the flow gets (`ctx.send`), or fails it (`ctx.error`). Absent: the message goes on unchanged.
     */
    entry?: HostApi['entry'];
    /**
     * The sample of a message `entry` hands a root's Flow input, in a block `sample`'s shape (`{ msg }`): the editor tests a root's
     * Flow input with it (`GET blocks` `entrySample`), as the Flow input declares none of its own. Absent: no sample there.
     */
    entrySample?: unknown;
    /** Stream partitions (P); the generic host uses `AUTOMATION_PARTITIONS` (default 64, one value per cluster). */
    partitions: number;
    /**
     * The Redis key family of a host that runs in another process (`iot`): the flow list and the editor read, replay and discard its
     * dead letters (`{streamPrefix}:dlq:<tenantId>`) under it. Absent: this process cannot reach them (the generic host's are its own).
     */
    streamPrefix?: string;
    /**
     * Producer for a host that runs in another process and cannot be wired into the runtime's producer map (03 §3.1,
     * a descriptor plus enqueue). Optional: the generic host is fed by its own `StreamProducer`.
     */
    enqueue?(tenantId: string, input: HostInput): Promise<{
        entryId: string;
    } | {
        refused: Refusal;
    }>;
}
