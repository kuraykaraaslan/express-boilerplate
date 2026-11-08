// GENERATED from modules/automation/server/engine/external.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * Phase 03 §3.6: per-call retries and terminal states of external calls (D-8). A node declared `external: true`
 * throws `ExternalError` for a failed call; only transient failures retry, every attempt carries the same
 * idempotency key, and the last failure leaves through `error` with `msg.error.attempts`.
 */
export interface RetryPolicy {
    attempts: number;
    backoff: 'exponential' | 'fixed';
    baseMs: number;
    maxMs: number;
}
export declare const RETRY_DEFAULTS: {
    readonly attempts: 3;
    readonly backoff: "exponential";
    readonly baseMs: 1000;
    readonly maxMs: 60000;
    readonly attemptsMax: 5;
    readonly jitter: 0.2;
};
/** The `retry_*` params of an external node (02 §2.2 fragments), clamped to the engine's ceilings. */
export declare function retryPolicy(params: Record<string, unknown>): RetryPolicy;
/**
 * Delay before attempt `attempt + 1` (attempt counts from 1): `base` for fixed, `base × 2^(attempt-1)` for
 * exponential, never above `maxMs`, ±20 % jitter, and a server's `Retry-After` honoured up to `maxMs`.
 */
export declare function backoffMs(policy: RetryPolicy, attempt: number, random?: () => number, retryAfterMs?: number): number;
export interface ExternalError extends Error {
    readonly code: string;
    readonly transient: boolean;
    readonly retryAfterMs?: number | undefined;
    /** Fields set on the message when this is the final failure (an HTTP error body, the status code). */
    readonly patch?: Record<string, unknown> | undefined;
    /** Fields the Runner spreads into the error's `details` (a limit outcome's `limit: { key, scope }`). */
    readonly details?: object | undefined;
}
export declare function httpFailure(status: number, retryAfterSeconds?: number, patch?: Record<string, unknown>): ExternalError;
/** `httpFailure` for a wait that is in ms already (the result of `parseRetryAfter`). */
export declare function httpFailureMs(status: number, retryAfterMs?: number, patch?: Record<string, unknown>): ExternalError;
export declare const timeoutFailure: (what: string) => ExternalError;
export declare const connectFailure: (what: string) => ExternalError;
export declare const resetFailure: (what: string) => ExternalError;
/** Failures that retrying cannot help: they leave through `error` at once, whatever attempts are left. */
export type NonRetryableKind = 'tls' | 'ssrf_blocked' | 'too_large' | 'circuit_open' | 'validation' | 'limit';
export declare const nonRetryable: (kind: NonRetryableKind, message?: string, details?: object) => ExternalError;
/** `Retry-After` as seconds or an HTTP date, in ms; undefined when absent or unusable. A date in the past is 0. */
export declare function parseRetryAfter(value: string | undefined, now: number): number | undefined;
/** Call classes and their timeouts (01 §1.4 table), in ms: default and ceiling. */
export declare const CALL_TIMEOUTS: {
    readonly external: {
        readonly default: 10000;
        readonly max: 30000;
    };
    readonly enqueue: {
        readonly default: 2000;
        readonly max: 5000;
    };
    readonly read: {
        readonly default: 2000;
        readonly max: 5000;
    };
};
