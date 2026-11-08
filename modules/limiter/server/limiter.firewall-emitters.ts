import { emitSecuritySignal, type ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { tallySecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';

/**
 * limiter's high-volume signals for the AI firewall (docs/phases/55-ai-firewall/01 §1.4c, 02 §2.6), registered as kinds in
 * limiter.firewall-signals.ts:
 *
 *  - `limiter.rate_limited`: a request refused by the limiter (a bucket, an endpoint budget, the tenant plan's allowance, an address ban or the
 *    global blocklist). Under a flood that is one refusal per request, so it is TALLIED, never emitted per refusal
 *    (common.firewall-tally.ts): one signal per tenant, lane, actor, scope and refusing control every few seconds, with the count.
 *  - `limiter.address_divided`: the misbehaviour script divided an address's signed-in ceiling (limiter.misbehaviour.ts, D40-10(d)). At most
 *    once per address per 15 minutes, so emitted as it happens.
 *
 * Both fail open (FWA-7): synchronous, never throw, never wait; the refusal and the division are exactly what they were without them. The
 * attributes are codes the limiter chose (the scope, which control refused, the endpoint name), never a path or a header value.
 */

export const RATE_LIMITED_SIGNAL = 'limiter.rate_limited';
export const ADDRESS_DIVIDED_SIGNAL = 'limiter.address_divided';

/** Which control refused: an address's bucket or ceiling, a person's own bucket, a sign-in endpoint's budget, the tenant plan, a request
 * without an address (the shared strict bucket), an address ban of the sign-in endpoints, the global blocklist. */
export const REFUSING_CONTROLS = ['address', 'user', 'endpoint', 'plan', 'unknown_client', 'ban', 'blocklist'] as const;
export type RefusingControl = (typeof REFUSING_CONTROLS)[number];

export interface RateLimitedNote {
  /** The tenant the request was addressed to; null or the ROOT tenant = the platform. */
  tenantId: string | null;
  lane: Lane | 'unknown';
  scope: string;
  by: RefusingControl;
  /** The sign-in endpoint (login, register, forgot, otp-send) whose budget refused, when `by` is `endpoint`. */
  endpoint?: string | null;
  /** The address's rate-limit bucket (an IPv4 address, an IPv6 /64), or null when the request had none. */
  address: string | null;
  /** The person whose own bucket refused (`by: 'user'`). */
  userId?: string | null;
}

const platformOr = (tenantId: string | null): string | null => (tenantId === ROOT_TENANT_ID ? null : tenantId);

/**
 * The actor of a refusal: the person whose own bucket refused, else the address, else nobody we can name. The plan's allowance is the
 * whole tenant's spending, not the behaviour of the address that happened to make the request that found it spent: a plan refusal is
 * about nobody (`anon`), the tenant being its subject (D55-70), so no innocent address piles up deny signals for it.
 */
export function refusalActor(n: Pick<RateLimitedNote, 'by' | 'address' | 'userId'>): ActorRef {
  if (n.by === 'plan') return { kind: 'anon', id: 'anonymous' };
  if (n.by === 'user' && n.userId) return { kind: 'user', id: n.userId };
  if (n.address) return { kind: 'ip', id: n.address };
  return { kind: 'anon', id: 'anonymous' };
}

/** One limiter refusal, tallied (see the header). Never throws. */
export function noteRateLimited(n: RateLimitedNote): boolean {
  try {
    const tenantId = platformOr(n.tenantId);
    return tallySecuritySignal({
      tenantId,
      lane: n.lane,
      kind: RATE_LIMITED_SIGNAL,
      actor: refusalActor(n),
      subject: n.by === 'plan' && tenantId ? { type: 'tenant', id: tenantId } : null,
      outcome: 'deny',
      // a ban or the blocklist refusing again is a known bad address knocking; a bucket refusal is often a busy client
      severity: n.by === 'ban' || n.by === 'blocklist' ? 'medium' : 'low',
      attrs: { scope: n.scope, by: n.by, endpoint: n.by === 'endpoint' ? (n.endpoint ?? null) : undefined },
      source: 'limiter',
    });
  } catch {
    return false;
  }
}

/** The misbehaviour script divided an address's signed-in ceiling (platform-wide, as the division is). Never throws. */
export function noteAddressDivided(n: { address: string; divisor: number; misses: number; seconds: number }): boolean {
  try {
    return emitSecuritySignal({
      tenantId: null,
      kind: ADDRESS_DIVIDED_SIGNAL,
      actor: { kind: 'ip', id: n.address },
      outcome: 'deny',
      severity: n.divisor > 2 ? 'high' : 'medium',
      attrs: { divisor: n.divisor, misses: n.misses, seconds: n.seconds },
      source: 'limiter',
    });
  } catch {
    return false;
  }
}
