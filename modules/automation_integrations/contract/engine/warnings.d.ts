// GENERATED from modules/automation/server/engine/warnings.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import type { CompiledFlow } from './compile';
/**
 * Deploy warnings (03 §3.5, 04 §4.4): things a deploy accepts but the author should know. A warning never refuses a deploy
 * and never changes how the flow runs. Pure over compiled flows, so the deploy and the
 * editor read the same facts.
 */
export declare const WARNING_CODES: readonly ["inline_holds_lane", "http_response_unreachable", "script_not_router_compatible", "script_cloud_helpers", "self_trigger"];
export type WarningCode = (typeof WARNING_CODES)[number];
export interface Warning {
    code: WarningCode;
    flowId: string;
    nodeId: string;
    message: string;
}
export declare function helperNamespacesIn(code: string): string[];
export declare function deployWarnings(flows: readonly CompiledFlow[]): Warning[];
