// GENERATED from modules/automation/server/engine/feedback.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { type FlowDoc } from './compile';
import { type Problem } from './problems';
import type { Warning } from './warnings';
/**
 * 08/14 FP-6, the self-trigger analysis of a deploy: a flow that writes something it listens to (a domain event it creates, an alarm
 * entry its own Device message trigger hears) starts itself again. The runtime cuts such a chain only after four cause hops
 * (`MAX_CAUSE_DEPTH`), so it still runs four rounds of side effects (four leads, four mails); this finds it before it runs.
 *
 *  - **Refused** (`flow_cycle` at the writing node) when the feedback is certain: the node writes the signal every time it succeeds
 *    (`certain`), a trigger of the same flow hears that exact signal, and the trigger reaches the node through nothing that can stop
 *    a message: only its main ports, through action blocks (they pass the message on once they acted) and `logic.change`, and the
 *    trigger has no `filter` of its own.
 *  - **Warned** (`self_trigger`) otherwise: the trigger's own `filter` (the trigger index applies it to every listener, so it may be
 *    the very condition that stops the loop), a filter, a switch or a script on the way, an error port, or a writer that writes only
 *    sometimes (an alarm block writes an alarm entry only on a transition). The deploy goes ahead and the author is told.
 *
 * What a node writes and what a trigger hears is the contribution's (`NodeContribution.feedback`): the engine knows no module's
 * events. A flow's own `action.emit` heard by its `trigger.event` is the chain check's (`chain.ts`, `flow_cycle` at any shape), so
 * it is not repeated here. Pure: it reads documents and the declared signals, nothing else.
 */
export interface FeedbackSignal {
    /** What carries the signal back to the flows: `event` (a `trigger.event`), `iot` (a message type of the iot host). */
    channel: string;
    /** For `event`: the event source (`domain`, `flow`, ...); a listener's empty or `*` source hears every source. */
    source?: string;
    /** The kind or message type; a listener's key may be a pattern (`''`, `*`, `prefix*`). */
    key: string;
    /** A writer's signal: true when the node writes it every time it succeeds (a create always announces what it created). */
    certain?: boolean;
}
/**
 * The channel of a call to an automation webhook (`POST /api/automation/hooks/{hookId}`): an outbound call whose path names one
 * writes it, and a `trigger.webhook` hears it (LG-26). The hook id is made at deploy and is not in the flow, so any such call is
 * heard by any webhook trigger of the same flow, never as certain: a warning.
 */
export declare const HOOK_CHANNEL = "hook";
/** What one node of a flow makes the platform deliver back (`writes`) and what a trigger hears (`hears`), for its params. */
export interface NodeFeedback {
    hears?: readonly FeedbackSignal[];
    writes?: readonly FeedbackSignal[];
}
/** Whether a listener's signal hears a written one. */
export declare function feedbackMatches(hear: FeedbackSignal, write: FeedbackSignal): boolean;
/**
 * The self-trigger findings of `flows` (the enabled flows a deploy edits). `feedbackOf` answers a node's declared signals for its
 * params (the registry view); a type that declares none takes no part. One finding per writing node and trigger.
 */
export declare function selfTriggerFindings(flows: readonly FlowDoc[], feedbackOf: (type: string, params: Record<string, unknown>) => NodeFeedback | undefined): {
    problems: Problem[];
    warnings: Warning[];
};
