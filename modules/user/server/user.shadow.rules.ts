import { createHash } from 'node:crypto';

/**
 * Pure rules of a Fleet ID shadow user on a tenant node (FID-07; 12-fleet-identity.md section 4.2; decisions F10 and F14).
 *
 * - The subject is the pairwise `sub` the hub issued for this node (F14): base64url, 16 to 128 characters, the same rule as the database CHECK
 *   `ck_users_identity_sub`. Anything else is refused before a query runs.
 * - The e-mail of the row is either the person's real address, released by the hub (F10), or a synthetic, non-routable placeholder derived from the
 *   subject. The hub sends `email` only for a person with an accepted workspace membership on this node who agreed to the release; the node
 *   additionally requires `email_verified: true` (an address the person has not proved must never match a workspace invitation) and lets a tenant
 *   opt out of releasing through its own logins.
 * - A tenant opt-out cannot take back an address another workspace on this node already received: the shadow row is one per person per node, shared
 *   by every workspace there, and the hub is the authority on whether the release stands. When the hub stops sending the address (the membership
 *   ended, the person withdrew), the next login replaces it with the placeholder.
 */
export const IDENTITY_SUB_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const SHADOW_EMAIL_DOMAIN = 'fleet.invalid';
const MAX_EMAIL_LENGTH = 254;
// Deliberately plain: one @, no whitespace, a dot in the domain. The hub already validated the address; this only keeps garbage out of `users.email`.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

export const isIdentitySub = (sub: unknown): sub is string => typeof sub === 'string' && IDENTITY_SUB_RE.test(sub);

/** The placeholder address of a shadow user without a released e-mail: `fid+<32 hex of sha256(sub)>@fleet.invalid`, undeliverable by construction (RFC 2606). */
export function shadowPlaceholderEmail(sub: string): string {
  return `fid+${createHash('sha256').update(sub, 'utf8').digest('hex').slice(0, 32)}@${SHADOW_EMAIL_DOMAIN}`;
}

export const isShadowPlaceholderEmail = (email: string): boolean => /^fid\+[0-9a-f]{32}@fleet\.invalid$/.test(email);

/** What the ID token said about the address. `email` is absent unless the hub released it (F10). */
export interface ShadowEmailClaims { email?: unknown; emailVerified?: unknown }

export interface ShadowEmailDecision {
  /** The address the row should hold. */
  email: string;
  released: boolean;
  /** True when the row keeps what it has (a tenant opt-out in front of an address another workspace already received). */
  keep: boolean;
}

/**
 * The address a shadow row should hold after this login.
 * @param tenantAllowsRelease false when the tenant being logged into opted out of the e-mail release (F10).
 * @param current the row's present state, or null for a first login.
 */
export function decideShadowEmail(
  sub: string,
  claims: ShadowEmailClaims,
  tenantAllowsRelease: boolean,
  current: { email: string; emailReleased: boolean } | null,
): ShadowEmailDecision {
  const placeholder = shadowPlaceholderEmail(sub);
  const raw = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const usable = raw.length > 0 && raw.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(raw) && !raw.endsWith(`@${SHADOW_EMAIL_DOMAIN}`) && claims.emailVerified === true;
  if (!usable) return { email: placeholder, released: false, keep: false };
  if (tenantAllowsRelease) return { email: raw, released: true, keep: false };
  if (current?.emailReleased) return { email: current.email, released: true, keep: true };
  return { email: placeholder, released: false, keep: false };
}

/**
 * The previous subjects the hub reports for a person who signs in to a node a workspace MOVED to (decision F32): the pairwise subjects the same person had on
 * the nodes that workspace lived on, which the shadow rows imported with the workspace still carry. A valid subject each, distinct, none equal to the current
 * one, at most `MAX_PREVIOUS_SUBS`; anything else is dropped (never an error: the login still works, the continuity just does not happen).
 */
export const MAX_PREVIOUS_SUBS = 50;
export function cleanPreviousSubs(sub: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (isIdentitySub(v) && v !== sub && !out.includes(v) && out.length < MAX_PREVIOUS_SUBS) out.push(v);
  return out;
}

/** The address a retired shadow row keeps (unique by construction, undeliverable): its subject is released, its address is nobody's. */
export const retiredShadowEmail = (userId: string): string => `retired+${userId.replace(/-/g, '')}@${SHADOW_EMAIL_DOMAIN}`;
