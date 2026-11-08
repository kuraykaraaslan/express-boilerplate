import { env } from '@kuraykaraaslan-labs/env';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';

/**
 * `auth:signup_zone`: may a sign-up that the fleet instance's zone chooser sent here (`/auth/onboarding?fleet=1&zone=<id>`) open a workspace on THIS
 * deployment, and which language does it start with? (docs/phases/02-fleet/14-zones-and-central-signup.md, F41.) `auth` imports no fleet module, so
 * this is a guard point `fleet_agent` answers on a node from its installed trust bundle.
 *
 *  - Not a fleet node, or no contribution: `null`, the zone means nothing here (a single installation signs up as before).
 *  - On a node: the contribution's verdict; a contribution that throws, times out or is paused refuses (fail closed): a workspace created on the wrong
 *    node would be created in the wrong country, which is the one thing a zone exists to prevent.
 */
export const AUTH_SIGNUP_ZONE_POINT = 'auth:signup_zone';

export type SignupZoneVerdict =
  | { ok: true; zoneId: string; domain: string; defaultLocale: string }
  | { ok: false; reason: string; chooserUrl: string | null };
export type SignupZoneResolver = (zoneId: string) => Promise<SignupZoneVerdict>;

export async function resolveSignupZone(zoneId: string): Promise<SignupZoneVerdict | null> {
  if (env.FLEET_ROLE !== 'node') return null;
  const ctx = systemCtx('the sign-up zone of this deployment, no tenant');
  if ((await ext.contributions(AUTH_SIGNUP_ZONE_POINT, ctx, { keepQuarantined: true })).length === 0) return null;
  const { authSignupZoneLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/auth.signup_zone');
  const { results, blocked } = await ext.guard<SignupZoneResolver, SignupZoneVerdict>(AUTH_SIGNUP_ZONE_POINT, ctx, authSignupZoneLoaders, (resolve) => resolve(zoneId));
  if (blocked) return { ok: false, reason: 'POLICY_UNAVAILABLE', chooserUrl: null };
  const refusal = results.find((r) => !r.value || r.value.ok !== true);
  if (refusal) return refusal.value && refusal.value.ok === false ? refusal.value : { ok: false, reason: 'REFUSED', chooserUrl: null };
  return results[0]?.value ?? null;
}
