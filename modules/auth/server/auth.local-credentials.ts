import { env } from '@kuraykaraaslan-labs/env';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuthMessages from './auth.messages';

/**
 * `auth:local_credentials_policy`: may PEOPLE hold and use credentials of THIS deployment (a password, a TOTP secret, a passkey, a magic link)?
 *
 * On a fleet node whose region requires Fleet ID (docs/phases/02-fleet/12-fleet-identity.md section 3, decision F15: "no people's credentials on
 * nodes in required regions") people authenticate at the identity hub only; the node holds a shadow user with no credential. `auth` cannot know
 * that (it is core and imports no fleet module), so the question is a guard point that `fleet_agent` answers on a node. No contribution (a single
 * deployment, the fleet instance, a node without the fleet agent) means yes, exactly as before.
 *
 * Fail closed: a contribution that throws, times out or is paused blocks local credentials, because the guard only exists on deployments that put
 * people on Fleet ID, where a lost answer must not reopen local passwords. The answer is the same for the whole process for 30 seconds (the trust
 * bundle it reads changes rarely), so a login does not pay for it on every request.
 *
 * Only a fleet NODE (`FLEET_ROLE=node`) can put its people on an identity hub, so anywhere else the point is not consulted at all: a single
 * deployment or the fleet instance answers allowed without loading a contribution, and the fail-closed rule cannot lock one out.
 *
 * Break-glass shadow operators are not people and do not pass through here (their session is minted by challenge-response, fleet_agent).
 */
export const AUTH_LOCAL_CREDENTIALS_POINT = 'auth:local_credentials_policy';
const CACHE_MS = 30_000;

export interface LocalCredentialsVerdict { allowed: boolean; reason?: string }
export type LocalCredentialsPolicy = () => Promise<LocalCredentialsVerdict>;

let cache: { verdict: LocalCredentialsVerdict; until: number } | null = null;
/** Test seam. */
export function _resetLocalCredentialsCache(): void { cache = null; }

export async function localCredentialsVerdict(now: number = Date.now()): Promise<LocalCredentialsVerdict> {
  if (cache && cache.until > now) return cache.verdict;
  const ctx = systemCtx('local credentials policy of this deployment, no tenant');
  let verdict: LocalCredentialsVerdict;
  // keepQuarantined: a contribution paused by its breaker is still a contribution (EXT-3). Left out, a few failures of the fleet agent's answer
  // would read as "nobody objects" here and reopen local passwords; kept, ext.guard counts it unverifiable and the verdict is refused.
  if (env.FLEET_ROLE !== 'node' || (await ext.contributions(AUTH_LOCAL_CREDENTIALS_POINT, ctx, { keepQuarantined: true })).length === 0) {
    verdict = { allowed: true };
  } else {
    const { authLocalCredentialsPolicyLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/auth.local_credentials_policy');
    const { results, blocked } = await ext.guard<LocalCredentialsPolicy, LocalCredentialsVerdict>(
      AUTH_LOCAL_CREDENTIALS_POINT, ctx, authLocalCredentialsPolicyLoaders, (policy) => policy(),
    );
    const refusal = results.find((r) => !r.value || r.value.allowed !== true);
    verdict = blocked ? { allowed: false, reason: 'POLICY_UNAVAILABLE' } : refusal ? { allowed: false, reason: refusal.value?.reason ?? 'REFUSED' } : { allowed: true };
  }
  cache = { verdict, until: now + CACHE_MS };
  return verdict;
}

/** Throws 403 `LOCAL_CREDENTIALS_DISABLED` when people may not use local credentials here. */
export async function assertLocalCredentialsAllowed(): Promise<void> {
  const v = await localCredentialsVerdict();
  if (!v.allowed) throw new AppError(AuthMessages.LOCAL_CREDENTIALS_DISABLED, 403, ErrorCode.FORBIDDEN);
}

/**
 * The closed code a browser callback puts on its redirect (`?error=` on the login page, `?linkError=` on Connected Accounts) when it refuses
 * for this reason. Both pages map it to translated text; nothing else about the refusal is echoed.
 */
export const LOCAL_CREDENTIALS_DISABLED_CODE = 'local_credentials_disabled';

/**
 * The same verdict for routes that answer with a redirect or a list instead of an error: true when people may NOT sign in here with anything
 * of this deployment, which includes the node-local external identity providers (social SSO, tenant SAML, national identity, e-signature
 * login): on a gated node people sign in through Fleet ID only, and a provider identity linked here would be a second people credential
 * (FID-07, decision F15). Fails closed: a verdict that cannot be computed is a refusal.
 */
export async function localCredentialsRefused(): Promise<boolean> {
  try {
    return !(await localCredentialsVerdict()).allowed;
  } catch {
    return true;
  }
}
