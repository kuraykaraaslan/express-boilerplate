// GENERATED from modules/automation/server/engine/state-store.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { type FlowMsg } from './message';
/**
 * Phase 01 §1.7: node state keyed `(flowId, nodeId, key)`, partitioned as the contribution's
 * `stateful: { by, defaultKey }` says. Small-state caps: 10 000 keys per node (LRU, counted `state_evicted`) and
 * 1 MiB per flow. Held messages are budgeted apart and live with the host (03 §3.4).
 */
export declare const MAX_STATE_KEYS_PER_NODE = 10000;
export declare const MAX_STATE_BYTES_PER_FLOW: number;
/**
 * A key that starts with this marks a held message (a `logic.delay` wait, a debounced or queued message): it is booked by
 * `ctx.hold` against the node's 16 MiB and the tenant's parked-bytes budget, so it counts against neither the 1 MiB-per-flow
 * small-state cap nor the 10 000-keys-per-node LRU, which would otherwise drop a waiting message (05 §5.10, NU-11; G-160).
 */
export declare const HELD_KEY_PREFIX = "\u0001";
/** Is this backend field (`nodeId|key`) a held message? */
export declare const isHeldField: (field: string) => boolean;
/** UTF-8 bytes of a string: what the 1 MiB caps and the Redis hashes count (not UTF-16 code units). */
export declare const utf8Bytes: (s: string) => number;
export interface Stateful {
    /** The param that partitions state: a message path (`key` on state-key nodes), or with `enum` an enum param (`group_by`). */
    by: string;
    /**
     * `by` is an enum param, not a path: `originator` is one state per originator (`type:id`) and `flow` is one per node
     * (`''`), so the stored default and the unset param give the same key. Any other text is still read as a path.
     */
    enum?: boolean;
    /** Used when that param is empty: `originator`, `flow` (one state per node), or a message path. */
    defaultKey: 'originator' | 'flow' | string;
}
/** Reads a dotted path (`payload.deviceId`, `payload.items[0]`) from a message; undefined when any step is missing. */
export declare function readPath(root: unknown, path: string): unknown;
/**
 * The state partition of one message for one node (DD-1, 05 §5.2). `by` names a param whose value is a message path
 * (`msg.topic`, `msg.payload.deviceId`; the `msg.` prefix is optional; with `enum` the words `originator` and `flow`
 * name the partition). Text is the key, anything else its JSON, a
 * path that reads nothing is `''` (the router's behaviour). A param that is empty falls back to `defaultKey`:
 * `originator` (`type:id`), `flow` (`''`: one state per node) or a path. `''` is the node's single shared partition.
 * `read` lets a caller resolve paths beyond `msg.` (`flow.*`, `global.*`).
 */
export declare function partitionKey(s: Stateful | undefined, params: Record<string, unknown>, msg: FlowMsg, read?: (path: string) => unknown): string;
/**
 * The storage the host provides, one namespace per (tenant, flow). The production backend is one Redis hash per
 * (tenant, flow) with field `nodeId|key` (§1.7); this interface is what the engine needs from it.
 */
export interface StateBackend {
    get(flowId: string, field: string): string | undefined;
    set(flowId: string, field: string, value: string): void;
    delete(flowId: string, field: string): boolean;
    /** Fields of a flow in least-recently-used order, oldest first. */
    fields(flowId: string): string[];
    /** Small-state bytes of a flow: fields and values, in UTF-8 (held messages, `isHeldField`, are not counted). */
    bytes(flowId: string): number;
}
export interface MemoryStateBackend {
    get(flowId: string, field: string): string | undefined;
    set(flowId: string, field: string, value: string): void;
    delete(flowId: string, field: string): boolean;
    fields(flowId: string): string[];
    bytes(flowId: string): number;
}
export interface NodeStateOptions {
    maxKeys?: number;
    maxFlowBytes?: number;
    onEvict?: (key: string) => void;
}
export interface NodeStateStore {
    get<T = unknown>(key: string): T | undefined;
    has(key: string): boolean;
    /**
     * Throws `range` for a value that is not JSON (undefined, a function, NaN) and `limit` when the flow would pass
     * 1 MiB; evicts the node's least recently used key past 10 000 keys.
     */
    set(key: string, value: unknown): void;
    delete(key: string): boolean;
    keys(): string[];
    readonly size: number;
}
/** `ctx.state` as the node helpers take it. `set` returns nothing: an eviction surfaces through `onEvict`. */
export type KeyedState = Pick<NodeStateStore, 'get' | 'has' | 'set' | 'delete' | 'keys'>;
/**
 * Phase 01 §1.7 (G-009, G-098): the messages a held-message value keeps, by the layouts the holding nodes write: a queued
 * item is the message itself (`heldFifo`), a wait or a window keeps `{ msg }` (delay, debounce, trigger, timer, stats), a
 * dedup pack keeps `{ pack: { msgs: [{ msg }] } }`. Group fields, queue ranges and counters keep none. `key` is the state
 * key (without the `nodeId|` of the backend field).
 */
export declare function heldMessagesOf(key: string, value: unknown): FlowMsg[];
/** What a redeploy or an undeploy dropped: the nodes that lost state and the held messages that went with it (07 §7.7). */
export interface StateDrop {
    nodes: string[];
    messages: number;
}
/**
 * Redeploy of a flow (IA/02:44-46, 07 §7.7): a node keeps its state when its signature is unchanged. A node whose
 * signature changed but that keeps its id and type loses its small state and carries its held messages over (their
 * keys stay; the node re-arms and re-books them on start, G-098); a removed node, or one whose type changed, loses all of
 * it, and its held messages are counted dropped. `signatures` maps every node id of the new revision to its signature
 * (`planDeploy`'s `restartSignature` is the one source); `types` maps it to its type (`typesOf`): without it, or for state
 * stored before types were, a changed node loses everything. `versions` maps it to its params version `v` (`versionsOf`, D-11): held
 * messages carry over only to the same or a newer `v` (a newer declaration migrated the params forward and reads what the older
 * one held); a lower `v` (a rollback to an older block version) cannot read them, so they are dropped and counted. Without
 * `versions`, or for state stored before versions were, the version is not checked. A node whose state predates the stored signatures is
 * kept. Signatures and types are stored in the backend, so a restart or a partition move keeps them. Call it before the
 * new revision's stores are built. Returns the nodes whose state was dropped (all or the small part) and the number of
 * held messages dropped.
 */
export declare function syncNodeState(backend: StateBackend, flowId: string, signatures: ReadonlyMap<string, string>, types?: ReadonlyMap<string, string>, versions?: ReadonlyMap<string, number>): StateDrop;
/** Undeploy of a flow: all its node state goes. Returns the number of held messages dropped with it (07 §7.7). */
export declare function dropFlowState(backend: StateBackend, flowId: string): number;
