import type { NextRequest } from 'next/server';

/**
 * Phase 55 00.6 (P-6): the step-up of an identity-administration route, offered next to the guard every route already imports.
 *
 * The guard itself lives in auth (`auth/server/auth.step-up.service`): this file only reaches it, lazily, so a module that calls
 * `authorizeRequest` gains the step-up without a new import edge to auth (tenant_member and api_key would otherwise import
 * auth, which imports them back). Call it AFTER `authorizeRequest` and the route's own checks, BEFORE the effect: a caller the
 * route refuses learns nothing and burns no grant; a refused step-up (401 with `details.stepUp`) changes nothing.
 *
 *  - `requireActionStepUp`: strict (`requireStepUp`). Platform routes (GLOBAL scope), whose admin gate already demands a factor.
 *  - `requireActionStepUpWhenEnrolled`: workspace routes (TENANT scope). An administrator with a factor proves it; one without
 *    acts on the session (see auth's `requireStepUpWhenEnrolled` for why).
 *
 * Both refuse an impersonation session (403). A request authenticated by an API key is a machine caller (lane rule L-4: no
 * human control on a machine lane): it has no session to step up and is not asked; the route decides whether a key may act.
 */

export interface ActionStepUpSubject {
  user: { userId: string };
  userSession: { userSessionId: string; metadata?: unknown };
  isImpersonating?: boolean;
  /** Set by the guard for a `Bearer sk_…` caller. */
  apiKey?: unknown;
}

export interface ActionStepUpBinding {
  tenantId: string;
  /** The route's permission. */
  purpose: string;
  /** The one record the request acts on, when it names one. */
  target?: string;
}

export interface ActionStepUpProof {
  method: string;
  verifiedAt: Date;
}

const asSubject = (s: ActionStepUpSubject) => s as unknown as Parameters<typeof import('@kuraykaraaslan-labs/auth/server/auth.step-up.service')['requireStepUp']>[1];

/** Strict step-up. Answers how and when the factor was proved, for the route's audit row. */
export async function requireActionStepUp(request: NextRequest | { headers: Headers }, subject: ActionStepUpSubject, binding: ActionStepUpBinding): Promise<ActionStepUpProof> {
  const { requireStepUp } = await import('@kuraykaraaslan-labs/auth/server/auth.step-up.service');
  return requireStepUp(request, asSubject(subject), binding);
}

/**
 * Step-up when the administrator holds a factor that can step up (an authenticator app, or a passkey when the passkey method is
 * active for the tenant), the rule of a factor enrolment (`guardFactorEnrolment`). An administrator who holds none acts on the
 * session: the workspace did not require a second factor of them (tenant_session `twoFactorRequired` is its own choice), and
 * refusing would take the action away from every workspace that did not. A factor lookup that fails is a refusal (5xx), never
 * "no factor". An impersonation session is refused (403) either way; an API-key caller is not asked (L-4).
 * Answers what was asked, for the route's audit row.
 */
export async function requireActionStepUpWhenEnrolled(
  request: NextRequest | { headers: Headers }, subject: ActionStepUpSubject, binding: ActionStepUpBinding,
): Promise<'stepped_up' | 'session' | 'api_key'> {
  if (subject.apiKey) return 'api_key';
  const { requireStepUp, stepUpAvailableFor } = await import('@kuraykaraaslan-labs/auth/server/auth.step-up.service');
  const { assertNotImpersonating } = await import('@kuraykaraaslan-labs/auth/server/auth.step-up');
  assertNotImpersonating(asSubject(subject));
  if (!(await stepUpAvailableFor(subject.user.userId, binding.tenantId))) return 'session';
  await requireStepUp(request, asSubject(subject), binding);
  return 'stepped_up';
}
