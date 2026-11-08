// GENERATED from modules/automation/server/engine/cause.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * Phase 01 §1.2: the loop guard lives in the run context, not in writable metadata (LF #6).
 * The engine runs each executor call inside `runWithCause`; a host's enqueue path reads `currentCause()`.
 */
export declare const MAX_CAUSE_DEPTH = 4;
export interface Lineage {
    origin: string;
    parentRun?: string;
    /** Set on a DLQ replay (the dead-lettered entry id, 03 §3.4): the run repeats the original `_run`, `_msgid`s and keys. */
    replayOf?: string;
}
export interface Cause {
    flowId: string;
    nodeId: string;
    run: string;
    depth: number;
    lineage: Lineage;
    /** The identity the run acts as (`runActor`); set by the Runner for every executor call. */
    actor?: string;
}
/**
 * 07 §7.6: a run executes as the system actor `automation:{flowSlug}@v{version}` (the approval records the human who allowed
 * it). A flow slug is `^[a-z0-9_-]{1,32}$`, so the string is unambiguous. Nothing else (a node, a payload, a message) can
 * name the actor: the Runner derives it from the compiled flow.
 */
export declare const runActor: (flowId: string, version: number) => string;
export declare function runWithCause<T>(cause: Cause, fn: () => T): T;
/** The cause of the call in progress, or undefined outside an executor call. */
export declare function currentCause(): Cause | undefined;
/** Explicit hand-off for a side effect that crosses a process (a queue job): a plain, serialisable copy. */
export declare function causeSnapshot(): Cause | undefined;
export interface EntryStart {
    depth: number;
    lineage?: Lineage;
    /** True when a flow side effect caused this input; false for an external input. */
    caused: boolean;
    dropped: boolean;
}
/**
 * Decide the depth of a new input. An input caused by a flow starts at `depth + 1`; above 4 the host drops it
 * and counts `loop_guard`. Entries a run creates carry `{ origin, parentRun: _run }`.
 */
export declare function entryFromCause(cause?: Cause | undefined): EntryStart;
/** The slice of a host input the guard touches (`HostInput` satisfies it). */
interface CausedInput {
    depth?: number;
    lineage?: {
        origin: string;
        parentRun?: string;
        replayOf?: string;
    };
    metadata?: Record<string, unknown>;
}
/**
 * The loop guard on a host's enqueue path (01 §1.2, LF #6). An input raised while an executor call is in progress (a domain
 * event a contributor service dispatched, any host enqueue) reads the ALS cause: it starts one deeper than the run that caused
 * it, carries `{ origin, parentRun }`, and shows the cause as `metadata.automation`. Above `MAX_CAUSE_DEPTH` it is dropped
 * (`loop_guard`). An input outside any call, or one that already carries its own depth (`action.emit` computes it), is left alone.
 */
export declare function applyCause<T extends CausedInput>(input: T, cause?: Cause | undefined): {
    ok: true;
    input: T;
} | {
    ok: false;
};
/** Read-only value exposed as `metadata.automation` (shows the cause). */
export declare function causeMetadata(cause: Cause): {
    flowId: string;
    nodeId: string;
    run: string;
    depth: number;
    actor?: string;
};
export {};
