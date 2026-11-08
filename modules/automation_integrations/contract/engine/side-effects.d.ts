// GENERATED from modules/automation/server/engine/side-effects.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/**
 * 08/14 side-effect guards: where the harm of a loop or a storm happens, at the node that acts.
 *
 *  - FP-16 **per-device command rate**: at most `commandsPerMinute` commands of the tenant's flows to one device in a sliding minute
 *    (default 30); the rest are refused and counted (`command_rate`). A loop that toggles a relay, a valve or a motor wears out
 *    the equipment it switches; nothing upstream sees that, so the node that sends the command asks first (`RunContext.deviceCommand`).
 *  - FP-17 **notification cooldown**: one notification per recipient and reason in `notifyCooldownMs` (default 10 min); the rest
 *    are held back and counted (`cooldown`), and the next one that goes out to that recipient carries how many were held
 *    (`RunContext.notifyGate`). An alarm storm then sends one mail or SMS per person, not hundreds (an SMS costs money).
 *
 * The counts live in the host's store (`SideEffectStore`, Redis on a worker: every worker of the tenant shares them); a store that
 * cannot answer falls back to this process's own memory (`MemorySideEffectStore`), so a Redis blip loosens the guard to one
 * process's view rather than removing it or refusing every command. Pure apart from the store.
 */
export interface SideEffectStore {
    /**
     * FP-16: claims one command to `deviceId` at `now` in the sliding minute, true when fewer than `perMinute` were claimed in the
     * 60 s before. `callKey` (the call's idempotency key) makes a retry of the same call claim nothing new: it was counted once.
     */
    commandSlot(tenantId: string, deviceId: string, callKey: string, perMinute: number, now: number): Promise<boolean>;
    /**
     * FP-17: may `key` (a recipient and a reason) be notified now? The first call inside `windowMs` claims the key for `callKey` and
     * answers `send` with the count held back since the last one went out (then reset); a later call with another `callKey` is held
     * back and counted once, however often that held call comes again (a retry, a redelivery). The same `callKey` as the claim's
     * answers as its first call did.
     */
    cooldown(tenantId: string, key: string, callKey: string, windowMs: number, now: number): Promise<{
        send: boolean;
        held: number;
    }>;
    /**
     * FP-17: gives back the claim `callKey` holds on `key` because nobody was told (every delivery failed, or none was made): the
     * claim goes and the count it took over is held again, so the next notification goes out and still names what was held back. A
     * claim of another call (the window passed and someone else holds it) is left alone.
     */
    cooldownRelease(tenantId: string, key: string, callKey: string, windowMs: number, now: number): Promise<void>;
}
/** How long a held-back count is kept after its window, so the next notification can still name it (a day at least). */
export declare const HELD_COUNT_TTL_MS = 86400000;
export interface MemorySideEffectStore {
    commandSlot(tenantId: string, deviceId: string, callKey: string, perMinute: number, now: number): Promise<boolean>;
    cooldown(tenantId: string, key: string, callKey: string, windowMs: number, now: number): Promise<{
        send: boolean;
        held: number;
    }>;
    cooldownRelease(tenantId: string, key: string, callKey: string, windowMs: number, now: number): Promise<void>;
}
/**
 * A store that falls back to this process's memory when the shared one throws (`onError` is told, once per failure). The fallback
 * holds its own counts: a guard keeps acting through an outage of the shared store, on what this process has seen.
 */
export declare function withMemoryFallback(store: SideEffectStore, onError?: (e: unknown) => void): SideEffectStore;
/**
 * The cooldown key of one recipient of one notification: the flow, the node's reason and the recipient (a user id, an address: the
 * node's own key for it), hashed (sha256, 32 hex) so no address or text sits in the store. The flow is part of it: two flows that
 * tell the same person the same words are two sources.
 */
export declare function cooldownKeyOf(flowId: string, reason: string, recipient: string): string;
