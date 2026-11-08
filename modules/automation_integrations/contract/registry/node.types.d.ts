// GENERATED from modules/automation/server/registry/node.types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { Executor, RunContext } from '../engine/run';
import type { CALL_TIMEOUTS } from '../engine/external';
import type { Params } from '../engine/migrate';
import type { Stateful } from '../engine/state-store';
import type { NotReadyReason } from '../engine/compile';
import type { ProblemCode } from '../engine/problems';
import type { NodeFeedback } from '../engine/feedback';
import type { LatePolicy } from '../engine/guards';
import type { BlockDecl, BlockRisk, ParamSpec, WhenCondition } from '../catalog/types';
export type { ConfigTypeContribution } from './config.types';
export type { Params };
export type { HostHttp, HostHttpRequest, HostHttpResponse } from '../engine/run';
/**
 * Phase 02 §2.2: what a module contributes to `automation:node`. Contributors use `import type` only (§2.8).
 * The declaration is the router's `blocks.d` shape (kui-react `BlockDecl`) plus the cloud fields below.
 */
/** The call classes of 01 §1.4, derived from the table the runtime enforces (`engine/external.ts`). */
export type CallClass = keyof typeof CALL_TIMEOUTS;
/** What a contributed node sees at run time: the Runner's context (the contributor imports it from here, §2.8). */
export type NodeContext = RunContext;
export type Reason = NotReadyReason;
/**
 * A param with the cloud additions. `cloud` is the cloud's range or default where it differs from the router's (§2.5):
 * the registry merges it over `min`/`max`/`default` at register, so validation and the catalog see the cloud numbers.
 * A `ref` param names a config type (`config`) or every type that provides a capability (`capability`).
 */
export type NodeParamSpec = ParamSpec & {
    cloud?: {
        min?: number;
        max?: number;
        default?: unknown;
    };
    config?: string;
    capability?: string;
    /** A `secret` param the platform creates (an inbound hook secret): the one secret a node declaration may carry (10 §10.1). */
    generated?: boolean;
};
export interface NodeDeclaration extends BlockDecl {
    /** Icon name, as the `blocks.d` files carry it. */
    icon?: string;
    params?: Record<string, NodeParamSpec>;
    /** Params version, default 1; every node is stamped `v` from it (§2.4). */
    version?: number;
    mutates?: boolean;
    async?: boolean;
    status?: boolean;
    remote_input?: boolean;
    /** `<module>` or `plan:<key>` features: a missing one gives `ready: false` (§2.6). */
    features?: string[];
    /** Absent: `"error"`. `"pass"` forwards messages when the contributor is disabled (§1.3). */
    whenMissing?: 'error' | 'pass';
    runtimes?: Array<'edge' | 'cloud'>;
    help?: string;
    sample?: unknown;
    /** Confirmation level of the declared risk; default follows the risk class (02 §2.7). */
    confirm?: ConfirmLevel;
    /** Raises the risk for some param values: every listed condition is required; the highest matching risk wins. */
    risk_when?: Array<{
        when: WhenCondition | WhenCondition[];
        risk: BlockRisk;
        confirm?: ConfirmLevel;
    }>;
}
export type ConfirmLevel = 'none' | 'check' | 'typed';
export interface ReadyResult {
    ready: boolean;
    reason?: NotReadyReason;
    /** Where the user can fix it, e.g. the connections page; carried to the catalog next to `reason` (§2.6). */
    page?: string;
}
export interface DeployCheckCtx {
    tenantId: string;
    flowId: string;
    nodeId: string;
    params: Params;
    /** The deployer's permission keys (deploy checks run with the deployer's permissions, 02 §2.7). */
    permissions: ReadonlySet<string>;
    /** Types of every node of the flow, for checks that look at neighbours. */
    flowTypes: readonly string[];
    /** What the deploying host offers; absent in tests that do not care. */
    host?: {
        key: string;
        latestValue: boolean;
        msgTypes?: readonly string[];
    };
    /** The non-secret params of the config the deploy will see under `slug` (a config in the same deploy wins over the stored one); null when there is none. Absent in tests that do not care. */
    config?: (slug: string) => {
        type: string;
        params: Record<string, unknown>;
    } | null;
    /** Whether an entity of a type exists in this tenant (`ChoicesRegistry.entityExists`); `undefined` when no list can say. Absent in tests that do not care. */
    entity?: (entityType: string, id: string) => Promise<boolean | undefined>;
}
export interface NodeContribution {
    type: string;
    declaration: NodeDeclaration;
    executor: Executor & {
        event?: (...a: never[]) => unknown;
    };
    migrations?: Record<number, (params: Params) => Params>;
    /** Absent = every host. */
    hosts?: string[];
    /**
     * Permission ids this node's `deployCheck` asks the deployer for (a module tier such as an RPC level, 02 §2.7). The deploy
     * routes resolve them with the caller's grants and hand the granted ones to `DeployCheckCtx.permissions`.
     */
    deployPermissions?: readonly string[];
    /** Output ports that depend on params in ways `outputs` cannot say (`logic.link_call`: its target's return names). */
    outputsFor?: (params: Params) => string[];
    /**
     * Wake on events (03 §3.5, G-159): the domain events this node listens to although it is not a trigger. A deployed, enabled node
     * of this type is in its flow's trigger index for these kinds; a matching event runs its executor `wake` (never `input`), which
     * usually releases a message it holds from an earlier run (`approval.request` waiting for the decision). `kinds` are exact or
     * end in `*` (a prefix).
     */
    wake?: {
        source: string;
        kinds: readonly string[];
    };
    /**
     * 08/14 FP-6, the deploy's self-trigger analysis (`engine/feedback.ts`): what a node of this type makes the platform deliver back to
     * the flows (`writes`: a domain event its service announces, an alarm entry) and, for a trigger, what it hears (`hears`), for its
     * params. A flow that hears what it writes is warned at deploy, and refused when the feedback is certain. Absent: the node takes
     * no part. Pure and quick: it runs at every deploy and pre-flight.
     */
    feedback?: (params: Params) => NodeFeedback;
    /**
     * 08/14 LG-21 (lead decision D8): what a node of this type does with a late message (`metadata.late`), for its params (`LatePolicy`).
     * Absent: `skip` when the node is `external`, else `run`. A node that acts on the world and still runs a late message must
     * handle it itself (a gate that refuses it, a feed whose author chose to send late data).
     */
    late?: LatePolicy | ((params: Params) => LatePolicy);
    ready?: (tenantId: string) => Promise<ReadyResult>;
    /** Deploy-time check of one node of this type (07 §7.5); a returned problem refuses the deploy. */
    deployCheck?: (c: DeployCheckCtx) => Promise<Array<{
        code: ProblemCode;
        message?: string;
    }>>;
    external?: boolean;
    barrier?: string;
    safeRead?: boolean;
    lookup?: boolean;
    parallel?: boolean;
    timeout?: {
        class: CallClass;
        default?: number;
        max?: number;
    };
    breaker?: 'on' | 'off';
    stateful?: Stateful;
    holds?: boolean;
    originatorRewrite?: boolean;
}
/** Where a contribution came from; `moduleId` decides readiness when that module is disabled for the tenant. */
export interface ContributionSource {
    moduleId: string;
}
export interface TenantHostContext {
    tenantId: string;
    host: string;
    /** Module ids enabled for the tenant. */
    enabledModules: ReadonlySet<string>;
    /** Plan feature keys the tenant has (`plan:<key>` features). */
    planKeys: ReadonlySet<string>;
}
