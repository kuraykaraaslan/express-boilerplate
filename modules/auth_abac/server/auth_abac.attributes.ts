import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import { normalizeAmr } from '@kuraykaraaslan-labs/user_session/server/user_session.amr';
import type { AttributeBag } from './auth_abac.types';

/**
 * The authenticated principal, as returned by
 * `authenticateTenantByRequest` — the subset the PIP reads.
 *
 * Both fields are nullable to support PUBLIC routes via `authorizeRequest` (GUEST scope):
 * `user: null` is an anonymous caller (GUEST subject, no id/email); `user` set
 * with `tenantMember: null` is a logged-in non-member on a public route (GUEST
 * role, but identity retained for audit).
 */
export interface SubjectSource {
  // Accepts a full SafeUser (the auth result); only userId/email + optional
  // profile fields are read. `userProfile` is `unknown` so any SafeUser shape
  // assigns cleanly — profile enrichment reads it defensively. `null` = anonymous.
  user: (Pick<SafeUser, 'userId' | 'email'> & { userProfile?: unknown }) | null;
  // `tenantMemberId` tells a platform admin's virtual member apart (tenant_session isGlobalAdminMember).
  tenantMember: (Pick<SafeTenantMember, 'memberRole'> & { roleKeys?: string[] | null; tenantMemberId?: string }) | null;
  /**
   * Platform user role (USER/ADMIN) used as the subject `role` fallback for the
   * ACCOUNT / GLOBAL scopes, where the caller has NO tenant membership. Used ONLY
   * when `tenantMember` is absent; the tenant/guest scopes never set it, so their
   * "logged-in non-member → GUEST" behaviour is unchanged.
   */
  userRole?: string | null;
  /**
   * A platform admin acting in this tenant (tenant_session's virtual OWNER member). Read only for the installation's
   * roles (config/access.ts: such a caller is `sysadmin`, never the tenant's `owner`); never a subject attribute. A
   * caller that leaves it out is still recognised by its virtual member (auth_abac.install-verdict).
   */
  isGlobalAdmin?: boolean;
  /**
   * The session the caller authenticated with, for how they signed in: its `metadata.amr` (RFC 8176, recorded by the login path; on a node the
   * Fleet ID login copies the ID token's `amr`) becomes `subject.amr`, and the assurance level derived from it `subject.acr`, so a tenant
   * policy can demand a stronger method (12-fleet-identity.md section 5; FID-08). Absent (anonymous, a caller that passes none) adds neither.
   */
  userSession?: { metadata?: unknown } | null;
}

/** The assurance levels `subject.acr` takes, weakest first (the eIDAS names terms_consent's `loa` uses). */
export const SUBJECT_ACR = ['NONE', 'LOW', 'SUBSTANTIAL', 'HIGH'] as const;
export type SubjectAcr = (typeof SUBJECT_ACR)[number];

/**
 * The assurance level of a set of authentication methods: a passkey (`hwk`) is HIGH, a verified second factor (`mfa`, `otp`) SUBSTANTIAL, a
 * password or a federated login alone LOW, nothing recorded NONE: a login path RFC 8176 cannot name (a magic link), a break-glass session, a
 * session minted before methods were recorded, a shape this does not know. For recorded methods this is the ladder the hub's consent ledger
 * records (auth_oidc_provider `assuranceOf`); with nothing recorded the ledger writes `loa LOW` (terms_consent's floor) while this says NONE,
 * so a `deny when acr nin [...]` policy refuses such a session rather than ranking it as a password. Pure.
 */
export function acrOf(amr: readonly string[]): SubjectAcr {
  if (amr.includes('hwk')) return 'HIGH';
  if (amr.includes('mfa') || amr.includes('otp')) return 'SUBSTANTIAL';
  if (amr.includes('pwd') || amr.some((v) => v.startsWith('fed:'))) return 'LOW';
  return 'NONE';
}

/** The session's recorded methods, validated against the RFC 8176 vocabulary (anything else is dropped, never trusted as a claim). */
function sessionAmr(session: { metadata?: unknown }): string[] {
  const amr = (session.metadata as { amr?: unknown } | null | undefined)?.amr;
  return normalizeAmr(Array.isArray(amr) ? amr : []);
}

/** Plain, framework-agnostic view of the request environment. */
export interface EnvironmentSource {
  ip?: string;
  method?: string;
  now?: string;
  userAgent?: string;
  host?: string;
}

/**
 * Build the subject attribute bag: identity + coarse role + (optional) profile
 * enrichment. Only allow-listed fields are copied — never the raw user object
 * (keeps PII out of decisions/logs).
 *
 * `role` is always present. For a PUBLIC/anonymous caller (`user: null`) the
 * subject is `{ role: 'GUEST' }` with NO `id`/`email` — the PDP normalizer maps
 * 'GUEST' to undefined (permit when no policy) and audit attributes it to SYSTEM.
 * A logged-in non-member (`user` set, `tenantMember: null`) is still GUEST role
 * but keeps id/email so the decision is attributed to the real user — UNLESS a
 * `userRole` is supplied (ACCOUNT/GLOBAL scope), in which case that platform role
 * is used instead of GUEST.
 */
export function resolveSubjectAttributes(source: SubjectSource): AttributeBag {
  const role = source.tenantMember?.memberRole ?? source.userRole ?? 'GUEST';
  const bag: AttributeBag = { role };
  // `roles` is the built-in role PLUS any custom groups the member holds
  // (phase 6.3), so a policy can say `subject.roles contains 'content.editor'`.
  // The engine needs no change: `contains`/`in` already handle a string[]
  // attribute — roles are DATA, which is the whole point of the phase.
  //
  // `permissions` is deliberately NOT built here. It is the union of the
  // groups' permission sets, which is a database read, and this function is
  // synchronous and pure on purpose (it is the piece that is exhaustively unit
  // tested). The async enricher in the PDP adapter adds it.
  const custom = source.tenantMember?.roleKeys ?? [];
  bag.roles = custom.length ? [role, ...custom] : [role];
  if (source.user) {
    bag.id = source.user.userId;
    bag.email = source.user.email;
    const profile = source.user.userProfile as
      | { department?: unknown; jobTitle?: unknown }
      | null
      | undefined;
    if (profile) {
      if (typeof profile.department === 'string') bag.department = profile.department;
      if (typeof profile.jobTitle === 'string') bag.jobTitle = profile.jobTitle;
    }
    if (source.userSession) {
      const amr = sessionAmr(source.userSession);
      bag.amr = amr;
      bag.acr = acrOf(amr);
    }
  }
  return bag;
}

/** Environment attributes for context-aware policies (IP/time/method). */
export function resolveEnvironmentAttributes(source: EnvironmentSource): AttributeBag {
  const bag: AttributeBag = {};
  if (source.ip) bag.ip = source.ip;
  if (source.method) bag.method = source.method;
  if (source.now) bag.now = source.now;
  if (source.userAgent) bag.userAgent = source.userAgent;
  if (source.host) bag.host = source.host;
  return bag;
}

// Per resource type, the fields safe to expose to policies. Prevents arbitrary
// domain objects (and their PII) from leaking into decisions; unknown types get
// the shared minimal set.
const RESOURCE_ALLOW_LIST: Record<string, readonly string[]> = {
  default: ['ownerId', 'tenantId', 'status', 'visibility'],
};

/**
 * Project a domain object into a policy-safe resource bag: `{ type }` plus only
 * the allow-listed attributes present on the object. Anything not on the list
 * (arbitrary PII) is dropped.
 */
export function buildResource(
  type: string,
  obj: Record<string, unknown>,
): { type: string } & AttributeBag {
  const allow = RESOURCE_ALLOW_LIST[type] ?? RESOURCE_ALLOW_LIST.default;
  const bag: AttributeBag = {};
  for (const field of allow) {
    if (obj[field] !== undefined && obj[field] !== null) bag[field] = obj[field];
  }
  return { type, ...bag };
}
