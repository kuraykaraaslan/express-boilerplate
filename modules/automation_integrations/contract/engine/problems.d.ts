// GENERATED from modules/automation/server/engine/problems.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/** Phase 01 §1.3: problem codes returned by `compile`. Any problem refuses the deploy (07). */
export declare const PROBLEM_CODES: readonly ["required", "range", "unknown_block", "cycle_sync", "flow_cycle", "role", "confirm", "limit", "unsupported", "module_missing", "plan", "host_mismatch", "not_configured", "newer_contract", "bad_contract", "newer_block", "migration_failed", "kind_required", "cross_host", "cross_tenant", "regex_unsupported"];
export type ProblemCode = (typeof PROBLEM_CODES)[number];
/**
 * Why a node compiles as `unsupported` (02 §2.6): one list for import (07), compile (01 §1.3) and the editor (09). A
 * message that reaches such a node goes to `error` with the reason as its code.
 */
export declare const UNSUPPORTED_REASONS: readonly ["unknown", "edge_only", "host_mismatch", "newer_block", "migration_failed"];
export type UnsupportedReason = (typeof UNSUPPORTED_REASONS)[number];
export interface Problem {
    code: ProblemCode;
    flowId: string;
    nodeId?: string;
    message?: string;
    /** Set when the node compiles as `unsupported`, whether the code is `unsupported` or `host_mismatch`. */
    reason?: UnsupportedReason;
}
export declare function problem(code: ProblemCode, flowId: string, nodeId?: string, message?: string, reason?: UnsupportedReason): Problem;
