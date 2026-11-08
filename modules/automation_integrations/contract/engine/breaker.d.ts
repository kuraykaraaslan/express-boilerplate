// GENERATED from modules/automation/server/engine/breaker.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * Phase 01 §1.5: one breaker per node instance. Counts exceptions only (caught ones too); trips at 20 in 60 s; open
 * means a message leaves through the error path with `circuit_open` without running the node; after 60 s it
 * half-opens and lets one message run: success closes it, an exception re-opens it. No automatic flow suspension.
 *
 * Script kills (06 §6.3, TB's rule): a script killed for time or memory is not an exception. Each kill sets
 * `expires = now + 60 s`; the third counted kill blocks the node (`blocked`) until `expires`, which is 60 s after the
 * last counted kill and not a sliding window. Once `expires` has passed the count starts again. A redeploy builds a
 * fresh breaker, which clears it.
 */
export declare const BREAKER_TRIP = 20;
export declare const BREAKER_WINDOW_MS = 60000;
export declare const BREAKER_COOLDOWN_MS = 60000;
/** Script kills that block a node, and how long the block lasts (the numbers are re-exported by `limits.ts`). */
export declare const BREAKER_KILLS_TO_BLOCK = 3;
export declare const BREAKER_BLOCK_MS = 60000;
export type BreakerState = 'closed' | 'open' | 'half_open';
export type BreakerEvent = 'breaker_open' | 'breaker_closed';
/** Why a script was killed: `time` (CPU or wall limit) or `memory`. */
export type ScriptKillReason = 'time' | 'memory';
/** What opened the breaker: the exception count (`circuit_open`) or three script kills (`blocked`). */
export interface BreakerInfo {
    code: 'circuit_open' | 'blocked';
}
export interface Breaker {
    state: BreakerState;
    /** True when the node may run this message. In half-open exactly one probe is admitted. */
    allow(now: number): boolean;
    /** The state at `now` without admitting anything: an open breaker whose cooldown has passed reads `half_open`. */
    stateAt(now: number): BreakerState;
    /** When a blocked node unblocks; undefined when it is not blocked at `now`. */
    blockedUntil(now: number): number | undefined;
    blocked(now: number): boolean;
    /**
     * A script killed for time or memory. Returns `'blocked'` on the kill that blocks the node. Kills during a block
     * change nothing.
     */
    recordScriptKill(now: number, reason?: ScriptKillReason): 'blocked' | undefined;
    recordException(now: number): void;
    recordSuccess(): void;
}
