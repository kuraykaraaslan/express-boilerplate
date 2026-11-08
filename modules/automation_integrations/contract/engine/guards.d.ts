// GENERATED from modules/automation/server/engine/guards.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * 08/14 flow protection (FP-5, 9, 10, 11, 13, 15, 16, 17, 19): the guards that stop a loop, a flood or a storm, their plan values and the
 * pure per-flow tracker of the automatic pause. Every guard that acts is counted under one name: per tenant in the usage month
 * (`guard:{name}`), per flow and node in the engine stats, on `/metrics` (`automation_guard_total{guard}`), and shown in the UI.
 *
 *  - `loop_guard`: an input caused by a flow beyond `MAX_CAUSE_DEPTH` (`cause.ts`) or a Run flow / link call loop (`run.ts`);
 *  - `rate`: a flow ran more than `runsPerMinute` times in a minute: it pauses itself, "loop suspected" (FP-10, FP-19); never a root (D22);
 *  - `fanout`: a node sent more than `maxFanout` messages for one input; the rest are dropped (FP-13);
 *  - `dedupe`: a device message seen again inside `dedupeWindowMs` is acknowledged without a run (FP-9);
 *  - `concurrency`: a flow at `maxConcurrentRuns` queues its next runs, at most `CONCURRENCY_QUEUE`, the oldest dropped (FP-10);
 *  - `size`: a message above `MAX_MSG_BYTES` (256 KiB, the router's own) is refused at the step that grew it (FP-13);
 *  - `retries`: an external call failed its last attempt; uncaught, it lands in the dead letters (`retries_exhausted`, FP-15);
 *  - `ttl`: a queued message older than `ttlMs` is dropped unprocessed (FP-11); a device message is exempt in its root flow, where
 *    it runs late rather than being lost (LG-7), and dropped only in the other flows it reaches. A device command or a notification
 *    asked for on a late message (`metadata.late`) is refused under this name too, and so is every node that skips or passes on a
 *    late message (`LatePolicy`, LG-21);
 *  - `command_rate`: more than `commandsPerMinute` commands to one device in a sliding minute; the rest are refused (FP-16);
 *  - `cooldown`: the same notification (reason) to the same recipient inside `notifyCooldownMs`; folded into a count the next one
 *    that goes out carries (FP-17).
 */
/**
 * 08/14 LG-21 (lead decision D8, 2026-10-28): what a node does with a late message (`metadata.late`: a device reading its root runs
 * after the reading's time-to-live, LG-7). `run`: the node runs and handles it itself (storage, the alarm rules' backfill, a gate that
 * refuses it, a feed told to send late data); `pass`: the node does nothing and the message goes on untouched through its first
 * output; `skip`: the node does nothing and the message stops there. `pass` and `skip` are counted `ttl` on the node. A node that
 * does not say (`NodeContribution.late`) is `skip` when it calls out (`external`: device commands, notifications, outbound calls,
 * records of other modules), else `run`: no physical or customer-facing action is taken on readings hours old.
 */
export type LatePolicy = 'run' | 'pass' | 'skip';
export declare const latePolicyOf: (n: {
    late?: LatePolicy;
    external?: boolean;
}) => LatePolicy;
export declare const GUARDS: readonly [
    "loop_guard",
    "rate",
    "fanout",
    "dedupe",
    "concurrency",
    "size",
    "retries",
    "ttl",
    "command_rate",
    "cooldown"
];
export type GuardName = (typeof GUARDS)[number];
export declare const isGuardName: (v: unknown) => v is GuardName;
/** Why a flow paused itself (FP-19), or `emergency_stop` (the tenant's stop), stored as the flow row's `stateReason`. */
export declare const PAUSE_REASONS: readonly [
    "loop_suspected",
    "failing",
    "emergency_stop"
];
export type PauseReason = (typeof PAUSE_REASONS)[number];
export declare const isPauseReason: (v: unknown) => v is PauseReason;
/** The guard values in effect for a tenant, in engine units (ms, counts). */
export interface GuardLimits {
    /** The shortest inject repeat (FP-5). */
    minRepeatMs: number;
    /** Runs of one flow in a minute before it pauses itself (FP-10, FP-19). */
    runsPerMinute: number;
    /** Failed runs of one flow in a row before it pauses itself (FP-19). */
    consecutiveFailures: number;
    /** Runs of one flow at once (FP-10). */
    maxConcurrentRuns: number;
    /** Messages one node may send for one input (FP-13). */
    maxFanout: number;
    /** How long a queued message lives (FP-11). */
    ttlMs: number;
    /** How long a device message is remembered for the dedupe (FP-9). */
    dedupeWindowMs: number;
    /** Commands to one device in a sliding minute (FP-16). */
    commandsPerMinute: number;
    /** How long the same notification to the same recipient is held back after one went out (FP-17). */
    notifyCooldownMs: number;
}
/**
 * One guard's plan value: the default when the plan has none, the floor and ceiling a plan is clamped to, the plan's unit as a
 * factor of the engine's (`scale`), and which end is the loose one (`loose`): a plan's "unlimited" (-1, `Infinity`) means that
 * end, so a plan may loosen a guard but never remove it. A smaller minimum interval is looser, and so is a shorter dedupe window (a
 * longer one drops more messages as copies) and a shorter notification cooldown (more notifications go out); for every other guard
 * a larger value is.
 */
export interface GuardPlanValue {
    key: string;
    default: number;
    floor: number;
    ceiling: number;
    scale: number;
    loose: 'low' | 'high';
}
export declare const GUARD_PLAN: Readonly<Record<keyof GuardLimits, GuardPlanValue>>;
/** A guard's value in engine units from the plan's answer: the default for none, the loose end for unlimited, clamped otherwise. */
export declare function effectiveGuard(spec: GuardPlanValue, planValue?: number | null): number;
/** Every guard at its default (a tenant whose plan has not answered yet, tests). */
export declare const DEFAULT_GUARDS: Readonly<GuardLimits>;
/** How many runs of a flow wait behind its concurrency cap; past it the oldest waiting one is dropped (FP-10). */
export declare const CONCURRENCY_QUEUE = 1000;
/** What tripped a flow's automatic pause, with the numbers its alert and audit name. */
export interface PauseTrip {
    flowId: string;
    reason: Exclude<PauseReason, 'emergency_stop'>;
    /** `loop_suspected`: runs in the last minute; `failing`: failed runs in a row. */
    count: number;
    limit: number;
    /** An exempt flow (a root) crossed the failure threshold: it is not paused, its admins and the platform are alerted (D5, D22). */
    exempt?: true;
}
export interface FlowGuard {
    /** A run of the flow started at `now`. */
    run(flowId: string, now: number): PauseTrip | undefined;
    /** A run of the flow ended; `failed` when an error nothing caught ended it. A success resets the count. */
    ended(flowId: string, failed: boolean): PauseTrip | undefined;
    /** The runs of the flow in the last minute (the editor and the Flows list read it beside the limit). */
    runsLastMinute(flowId: string, now: number): number;
}
