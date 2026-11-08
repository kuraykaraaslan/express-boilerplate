// GENERATED from modules/automation/server/engine/holds.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { EngineError, type FlowMsg } from './message';
/** One node holds at most 16 MiB (01 §1.7), so it cannot fill a partition's 64 MiB cap. */
export declare const MAX_HELD_BYTES_PER_NODE: number;
export interface HoldError extends EngineError {
    readonly code: 'park_limit' | 'queue_full';
}
export interface HoldOptions {
    maxBytesPerNode?: number;
    /** The tenant's parked-bytes budget (plan key in 10); absent = unlimited. */
    tenantBudgetBytes?: number;
}
export interface HoldStore {
    /**
     * Books a message a node keeps (`ctx.hold(msg)`). A replayed `_msgid` is booked once. Over the node's cap:
     * `park_limit`; over the tenant's budget: `queue_full`.
     */
    account(flowId: string, nodeId: string, msg: FlowMsg): void;
    /** Frees what `account` booked for this message (`ctx.release(msg)`); a message that was not booked changes nothing. */
    unaccount(flowId: string, nodeId: string, msg: FlowMsg): void;
    /** Whether this node has the message booked: a send of it is its release, which keeps the stored `_msgid` (01 §1.2, §1.7). */
    has(flowId: string, nodeId: string, msgId: string): boolean;
    bytes(flowId?: string, nodeId?: string): number;
}
