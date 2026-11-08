/**
 * The AI firewall's request cascade in the request path (docs/phases/55-ai-firewall/04-tree-models.md 4.8, FWD-7, FWD-12): the limiter
 * (`Limiter.checkRateLimit`, the call every API handler makes first) hands each request that passed every limiter control to ONE
 * synchronous gate, which the firewall registers at boot (a runtime `common:boot_task` of ai_firewall). `common` is a leaf and the
 * limiter cannot import `ai_firewall` (the two would import each other), so the seam lives here, held on `globalThis` like the request
 * observer (`request-observer.ts`), because the instrumentation hook and the route bundles can each load this file.
 *
 * The gate is SYNCHRONOUS and must stay cheap (D55-21: no awaited Redis call beyond the limiter's own): it decides from what the
 * firewall already holds in its process and answers what to do with THIS request. The limiter applies the answer: `block` is a 403 with
 * the support reference and nothing else, `step_up` is the session step-up refusal auth already speaks (401 SESSION_STEP_UP_REQUIRED),
 * `delay` holds the answer for a moment (progressive delay of an anonymous caller). Anything else, no gate, a gate that throws: allow
 * (FWA-7). The deterministic controls ran before the gate and refuse whatever the gate says (FWA-2): the gate is only ever asked about
 * a request the limiter let through, and it can only add a refusal.
 *
 * A request is gated once: a handler that calls the limiter twice (its `api` and its `auth` scope) gets the first answer again.
 *
 * The gate's own refusals are not the address's misbehaviour (D55-129): the limiter's answer watcher asks `gateRefused` and does not count
 * a 401 or 403 the gate produced as a miss of the client address (D40-10(d)), so a model's verdict never turns into a rule-floor penalty for
 * everyone behind the address.
 */
import type { Lane } from './lane.policy';
import type { ObservedRequest } from './request-observer';

export interface GateRequest {
  /** The request (a NextRequest fits); the gate reads its headers only. */
  request: ObservedRequest;
  /** The limiter scope the handler asked for. */
  scope: 'api' | 'auth';
  /** The tenant the request is addressed to (its path), lower case; null outside a tenant. */
  tenantId: string | null;
  /** The lane whose controls apply here: the proxy's stamp weighed against the path (`claimedLaneOn`, `signInLane`). */
  lane: Lane;
  /** The person the request is signed in as, from its access token's signature alone (the limiter's `signedInSessionOf`), or null. */
  signedIn: { userId: string; sessionId: string } | null;
}

export type GateAnswer =
  | { readonly action: 'allow' }
  | { readonly action: 'step_up'; readonly reference: string }
  | { readonly action: 'delay'; readonly reference: string; readonly delayMs: number }
  | { readonly action: 'block'; readonly reference: string };

export type RequestGate = (input: GateRequest) => GateAnswer;

/** The longest a progressive delay may hold an answer, whatever a gate asks. */
export const GATE_DELAY_MAX_MS = 2_000;

const ALLOW: GateAnswer = Object.freeze({ action: 'allow' });
const GATE_KEY = Symbol.for('kuraykaraaslan-labs.common.requestGate');
const ANSWERS_KEY = Symbol.for('kuraykaraaslan-labs.common.requestGateAnswers');
const holder = globalThis as unknown as Record<symbol, unknown>;

export function setRequestGate(gate: RequestGate | null): void {
  holder[GATE_KEY] = gate;
}

/** Whether a gate is registered (the limiter skips building the input when none is). */
export function hasRequestGate(): boolean {
  return typeof holder[GATE_KEY] === 'function';
}

const answers = (): WeakMap<object, GateAnswer> =>
  (holder[ANSWERS_KEY] ??= new WeakMap<object, GateAnswer>()) as WeakMap<object, GateAnswer>;

const valid = (a: unknown): a is GateAnswer => {
  if (!a || typeof a !== 'object') return false;
  const x = a as { action?: unknown; reference?: unknown; delayMs?: unknown };
  if (x.action === 'allow') return true;
  if (typeof x.reference !== 'string' || x.reference.length === 0 || x.reference.length > 64) return false;
  if (x.action === 'delay') return typeof x.delayMs === 'number' && Number.isFinite(x.delayMs) && x.delayMs >= 0;
  return x.action === 'block' || x.action === 'step_up';
};

/** Whether the gate refused this request (a block or a step-up). Never throws. */
export function gateRefused(request: object): boolean {
  try {
    const a = answers().get(request);
    return a?.action === 'block' || a?.action === 'step_up';
  } catch {
    return false;
  }
}

/** Asks the gate about a request. Synchronous; never throws; allow without a gate, on an error or on an answer it cannot read. */
export function gateRequest(input: GateRequest): GateAnswer {
  try {
    const req = input.request as unknown as object;
    const seen = answers().get(req);
    if (seen) return seen;
    const gate = holder[GATE_KEY];
    if (typeof gate !== 'function') return ALLOW;
    const raw = (gate as RequestGate)(input);
    const answer = valid(raw) ? (raw.action === 'delay' ? { ...raw, delayMs: Math.min(GATE_DELAY_MAX_MS, raw.delayMs) } : raw) : ALLOW;
    answers().set(req, answer);
    return answer;
  } catch {
    return ALLOW;
  }
}
