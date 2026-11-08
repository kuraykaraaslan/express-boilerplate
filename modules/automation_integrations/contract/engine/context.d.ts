// GENERATED from modules/automation/server/engine/context.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { type StateBackend } from './state-store';
/**
 * Phase 01 §1.8: `flow.*` (per flow) and `global.*` (tenant-wide), stores
 * `memory` (default) and `persist`. Path `<scope>[.<store>:]<key>[.<deep.path>]`, as on the router (`O1:790`).
 * Caps: 1 MiB per flow context and 4 MiB global per tenant; a write over a cap fails with `limit`. A write replaces
 * one key (an `HSET` of one field, never a whole hash). `persist` snapshots to `automation_context` are 07.
 */
export declare const MAX_FLOW_CONTEXT_BYTES: number;
export declare const MAX_GLOBAL_CONTEXT_BYTES: number;
export type ContextScope = 'flow' | 'global';
export type ContextStoreName = 'memory' | 'persist';
export interface ContextPath {
    scope: ContextScope;
    store: ContextStoreName;
    key: string;
    /** Path inside the stored value. */
    deep: string[];
}
/** Nesting of a stored value, as for user fields (§1.1). */
export declare const MAX_CONTEXT_DEPTH = 8;
/**
 * `flow.count`, `global.persist:site.limits[2]`, `flow.memory:cfg['a b'].c`. A key is a plain name (no `.`, `:`, `[`
 * or whitespace) or a bracket: `[2]`, `['a b']`, `["a b"]`. Any malformed path is `bad_context_path`, and so is a
 * first key that breaks the router's name rule `^[A-Za-z_][A-Za-z0-9_]{0,31}$` (§1.1, `context.uc:66`): what is
 * inside the stored value is free.
 */
export declare function parseContextPath(path: string): ContextPath;
export interface ContextCaps {
    flowBytes?: number;
    globalBytes?: number;
}
export interface ContextStore {
    get(path: string): unknown;
    /** `get` for a path that is parsed already (the expression scope passes parsed segments). */
    getAt(p: ContextPath): unknown;
    /**
     * Writing `undefined` removes the key, or the nested property of a deep path. A value that is not JSON (a function,
     * NaN, a class instance, nesting above 8) is `range`; a write over the cap is `limit` and leaves the old value.
     */
    set(path: string, value: unknown): void;
    setAt(p: ContextPath, value: unknown): void;
    delete(path: string): void;
    /** The top-level keys of a scope as one object for expressions and scripts: `persist` first, `memory` over it. */
    snapshot(scope: ContextScope): Record<string, unknown>;
    keys(scope: ContextScope, store?: ContextStoreName): string[];
}
