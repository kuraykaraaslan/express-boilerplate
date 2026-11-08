// GENERATED from modules/automation/server/engine/compile.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { ParamSpec } from '../catalog/types';
import { type MigrationSource } from './migrate';
import { type Problem, type ProblemCode, type UnsupportedReason } from './problems';
import type { CallClass } from '../registry/node.types';
import type { Stateful } from './state-store';
import type { NodeFeedback } from './feedback';
import type { LatePolicy } from './guards';
/** Phase 01 §1.3. Flow shape is `roltek-automation-1` (07 §7.10); ports and error path are §1.4. */
export declare const MAX_NODES_PER_FLOW = 500;
export declare const ERROR_PORT = "error";
export interface FlowNodeDoc {
    id: string;
    type: string;
    params: Record<string, unknown>;
    /** Params version the node was saved at; missing means 1 (02 §2.4). */
    v?: number;
    name?: string;
    disabled?: boolean;
}
export interface FlowEdgeDoc {
    from: string;
    from_port: string;
    to: string;
}
export interface FlowDoc {
    id: string;
    version: number;
    nodes: FlowNodeDoc[];
    edges: FlowEdgeDoc[];
}
export type NotReadyReason = 'module_missing' | 'plan' | 'host_mismatch' | 'not_configured';
/** What compile needs from a node declaration (02 §2.2); the registry resolves `outputs` for the node's params. */
export interface ParamIssue {
    code: Extract<ProblemCode, 'required' | 'range'>;
    path: string;
    message?: string;
}
export interface NodeDeclView extends MigrationSource {
    type: string;
    /** Checks migrated params with the same rules the editor uses (vendored `validateParams`, §1.3 step 2). */
    validate?: (params: Record<string, unknown>) => readonly ParamIssue[];
    /**
     * Param schema, resolved with the declaration. Only the `expr`, `template` and `path` checks of §1.3 step 3 read it;
     * step 2 stays `validate`. Absent = nothing to check.
     */
    params?: Readonly<Record<string, ParamSpec>>;
    /** The declaration is for the router only (`runtimes` lacks `cloud`): the node imports and compiles as `unsupported`. */
    edgeOnly?: boolean;
    outputs: readonly string[];
    async?: boolean;
    /** Default true: a node that does not say `mutates: false` is assumed to write the message. */
    mutates?: boolean;
    /**
     * The node's own declaration says `mutates: false` in so many words (a registry view sets it; `mutates` there is the
     * router's taint default). Absent: `mutates === false`. A test run deep-freezes the message of such a node (§1.4).
     */
    readOnly?: boolean;
    holds?: boolean;
    /** `off` = never trips (02 §2.2); default `on`. */
    breaker?: 'on' | 'off';
    /** State partition (02 §2.2): which param, and the default key. */
    stateful?: Stateful;
    /** May change `msg.originator` (also needs the registry allowlist, §1.1). */
    originatorRewrite?: boolean;
    /** Calls outside the process: lane release, continuation and retries (03 §3.5-3.6). */
    external?: boolean;
    /** The domain events that wake a node of this type although it is no trigger (03 §3.5, G-159; `NodeContribution.wake`). */
    wake?: {
        source: string;
        kinds: readonly string[];
    };
    /** What the node writes back to the flows and what a trigger hears, for these params (08/14 FP-6, `NodeContribution.feedback`). */
    feedback?: NodeFeedback;
    /** What the node does with a late message, for these params (08/14 LG-21, `NodeContribution.late`); absent: `latePolicyOf`'s default. */
    late?: LatePolicy;
    /** The call class of the node's calls and its own default and ceiling (01 §1.4); the engine bounds each call by it. */
    timeout?: {
        class: CallClass;
        default?: number;
        max?: number;
    };
    barrier?: string;
    whenMissing?: 'error' | 'pass';
    /** Absent = every host. */
    hosts?: readonly string[];
    /** The declaration is known but its contributor is disabled for the tenant (00 §A.3). */
    ready: {
        ready: true;
    } | {
        ready: false;
        reason: NotReadyReason; /** Where the tenant fixes it (a config page). */
        page?: string;
    };
}
/** Pure lookup: no I/O, so compile runs in Next (deploy, test runner) and in every host. */
export interface RegistryView {
    get(type: string, params: Record<string, unknown>): NodeDeclView | undefined;
}
export interface HostView {
    key: string;
    barriers: ReadonlySet<string>;
}
export type CompiledNodeKind = 'live' | 'unsupported' | 'pass' | 'module_missing';
export interface CompiledNode {
    id: string;
    type: string;
    /** Migrated params; the stored ones for an `unsupported` node. */
    params: Record<string, unknown>;
    v: number;
    name?: string;
    /** Declared output ports in order (the index a `send([a, b])` array maps to). */
    outputs: readonly string[];
    breaker: 'on' | 'off';
    stateful?: Stateful;
    originatorRewrite: boolean;
    external: boolean;
    /** Events that run the node's executor `wake` (G-159); in the trigger index like a `trigger.event`. */
    wake?: {
        source: string;
        kinds: readonly string[];
    };
    /** What the node does with a late message (08/14 LG-21); absent: `skip` for an external node, else `run` (`latePolicyOf`). */
    late?: LatePolicy;
    /** The config nodes this node names, by slug (its top-level `ref` params), for the fan-out of a connection failure (08 §8.5). */
    configs?: readonly string[];
    /** Per-call deadline (01 §1.4): the declared class, the effective milliseconds and the ceiling. Absent = the node bounds itself. */
    timeout?: {
        class: CallClass;
        ms: number;
        max: number;
    };
    kind: CompiledNodeKind;
    /** Why the node is `unsupported` (02 §2.6); a message reaching it goes to `error` with this as its code. */
    reason?: UnsupportedReason;
    disabled: boolean;
    async: boolean;
    /** It, or a node after it, mutates or holds the message (copy rule, §1.4). */
    taint: boolean;
    /** The declaration says `mutates: false`: a test run hands the node a deep-frozen message (§1.4). */
    mutates?: false;
    /** port → target node ids, in edge order. */
    out: ReadonlyMap<string, readonly string[]>;
}
export interface CompiledFlow {
    id: string;
    version: number;
    /** 07 §7.6: layout-free content hash of the flow. `deploy` mode only. */
    approvalHash?: string;
    nodes: ReadonlyMap<string, CompiledNode>;
}
/** A live trigger node, for the host's index (03 §3.3); the host derives its keys (04 §4.1). */
export interface TriggerEntry {
    flowId: string;
    nodeId: string;
    type: string;
    params: Record<string, unknown>;
    /** A node that is woken by an event, not started by it (G-159): `params` is `{ source, kind }` of one of its wake kinds. */
    wake?: true;
}
export interface CompileResult {
    flows: CompiledFlow[];
    problems: Problem[];
    /** Enabled, live entry triggers (`trigger.*` but not the run-scope `catch`, `status` and `complete`), in flow and node order. */
    triggers: TriggerEntry[];
}
export interface CompileOptions {
    /** `deploy` refuses a node of a disabled contributor; `run` compiles it to a stub (§1.3). */
    mode: 'deploy' | 'run';
}
/** The slugs of the config nodes a node names: its top-level params declared `type: 'ref'` that hold a non-empty string. */
export declare function configRefsOfNode(d: Pick<NodeDeclView, 'params'> | undefined, params: Record<string, unknown>): string[];
/**
 * The per-call deadline of a node that declares a call class (01 §1.4): the `timeout_ms` param when it is a number, else the
 * declared default, never above the declared ceiling and never above the class ceiling.
 */
export declare function callTimeoutOf(d: Pick<NodeDeclView, 'timeout'> | undefined, params: Record<string, unknown>): {
    class: CallClass;
    ms: number;
    max: number;
} | undefined;
export declare function compile(flowSet: readonly FlowDoc[], registry: RegistryView, host: HostView, options: CompileOptions): CompileResult;
/** Run-scope triggers fire from the engine inside a run, never from a host event (§1.3 step 5, §1.4). */
export declare const RUN_SCOPE_TRIGGERS: ReadonlySet<string>;
/**
 * The `msg.error.code` a message gets when it reaches a node that cannot run (02 §2.6): the unsupported reason, or
 * `module_missing` for the stub of a disabled contributor. `undefined` for a node that runs.
 */
export declare function stubErrorCode(node: Pick<CompiledNode, 'kind' | 'reason'>): string | undefined;
