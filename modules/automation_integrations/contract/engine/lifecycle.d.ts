// GENERATED from modules/automation/server/engine/lifecycle.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * Phase 01 §1.6: node lifecycle. `starting` → `running`; `degraded` (start failed, retrying); `failed` (fatal, no
 * retry); `stopped`. `start` is bounded by 10 s. Retry 5 s × attempt, capped at 60 s, with no attempt limit, so a
 * broker that returns after an hour is used again without a redeploy.
 */
export declare const START_TIMEOUT_MS = 10000;
export declare const RETRY_STEP_MS = 5000;
export declare const RETRY_MAX_MS = 60000;
export type NodeState = 'starting' | 'running' | 'degraded' | 'failed' | 'stopped';
export type LifecycleEvent = 'started' | 'start_failed' | 'recovered';
export interface NodeStatus {
    fill: 'yellow' | 'green' | 'red' | 'grey';
    shape: 'ring' | 'dot';
    text: string;
}
export interface Scheduler {
    /** Returns a cancel function. */
    after(ms: number, fn: () => void): () => void;
}
export declare const realScheduler: Scheduler;
/** An executor marks a start error fatal when the config can never work. */
export interface FatalStartError extends Error {
    fatal: true;
    code?: string;
}
export interface StartError extends Error {
    readonly code: string;
    readonly fatal: boolean;
}
export interface LifecycleEventInfo {
    event: LifecycleEvent;
    code?: string;
    message?: string;
    /** `start_failed`: the failure cannot be retried. */
    fatal?: boolean;
    /** `start_failed`: the number of the attempt that failed (1 for the first). */
    attempt?: number;
    /** `recovered`: the number of the attempt that succeeded. */
    attempts?: number;
}
export interface LifecycleOptions {
    /** Absent: the node has nothing to start and is running at once. */
    start?: (signal: AbortSignal) => Promise<void> | void;
    stop?: () => Promise<void> | void;
    scheduler?: Scheduler;
    onEvent?: (e: LifecycleEventInfo) => void;
    startTimeoutMs?: number;
}
export interface NodeLifecycle {
    state: NodeState;
    attempt: number;
    lastError?: {
        code: string;
        message: string;
    };
    readonly signal: AbortSignal;
    readonly running: boolean;
    readonly status: NodeStatus;
    /** Resolves after the first attempt; later retries run on the scheduler. */
    start(): Promise<void>;
    stop(): Promise<void>;
}
