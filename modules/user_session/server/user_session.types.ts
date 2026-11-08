import { z } from "zod";
import { SessionStatusEnum } from "./user_session.enums";
import { TenantMemberRoleEnum } from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums";

export const SessionMetaSchema = z.object({
  // Coarse geo-location derived from the login IP at session creation
  // (country/city level). Annotated best-effort into this passthrough jsonb bag
  // by user_session.crud.service — never a DB column / migration.
  geo: z.object({
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable(),
    // 38-security 3.1: what velocity math and the Tor / proxy / VPN response need. Optional: sessions written before carry none.
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    isTor: z.boolean().optional(),
    isProxy: z.boolean().optional(),
    isVpn: z.boolean().optional(),
  }).optional(),
  // 38-security 3.3: the risk step-up of a person with no enrolled second factor is an e-mailed one-time code (the e-mail method is allowed for
  // this session's sign-in step only); otp/send and otp/verify read this flag.
  stepUpEmail: z.boolean().optional(),
  impersonation: z.object({
    impersonatorUserId: z.string().uuid(),
    impersonatorSessionId: z.string().uuid(),
    tenantId: z.string().uuid().optional(),
    targetTenantRole: TenantMemberRoleEnum.optional(),
    // auth_impersonation.05: which flow started it ('system': a platform ADMIN; 'tenant': a tenant OWNER / ADMIN), so every
    // request can re-check that the impersonator still stands where the flow requires.
    flow: z.enum(['system', 'tenant']).optional(),
  }).optional(),
  // Fleet break-glass session (docs/phases/02-fleet 04 §6): minted by challenge-response against a dual-approved grant. Not refreshable (its life IS the
  // grant's window) and dropped when the grant is revoked or expires. `scope` is `NODE` or `TENANT:<tenantId>`; the session's own tenantId already limits
  // where it is valid.
  breakGlass: z.object({
    grantId: z.string().uuid(),
    scope: z.string().max(64),
    expiresAt: z.string().datetime(),
  }).optional(),
  // "Remember me" was ticked at login: widens the sliding window and the
  // absolute cap (see SessionPolicy.rememberMeMaxHours). Read on every refresh.
  rememberMe: z.boolean().optional(),
  // Central login (auth.central-login.ts): a root-tenant session of somebody who is not a root member. It carries no
  // role there; tenant auth refuses it like any non-member but does not count it as a failed attempt.
  accountOnly: z.boolean().optional(),
  // auth.05: the account must change its password (an admin set `mustChangePassword`, or the password outlived
  // `passwordMaxAgeDays`). Every route refuses the session 403 PASSWORD_CHANGE_REQUIRED except the change-password
  // step (PASSWORD_CHANGE_STEP_PERMISSIONS in auth_abac); a successful change clears it.
  passwordChangeRequired: z.boolean().optional(),
  // Phase 55 00.6: an administrator (or the firewall) asked THIS session to prove a second factor again. Every route refuses it
  // 401 SESSION_STEP_UP_REQUIRED with `details.stepUp` (as requireStepUp does) except the step-up itself and reading the session
  // (SESSION_STEP_UP_PERMISSIONS in auth_abac); a step-up that succeeds on the session clears it (auth.step-up.service finishStepUp).
  // No reason and no actor here: this bag is shown to the person; both are in the audit row.
  stepUpRequired: z.object({
    at: z.string().datetime(),
    source: z.enum(['admin', 'firewall']),
  }).optional(),
  // A session minted from a Fleet ID login on a fleet node (FID-07, 12-fleet-identity.md section 4.2): `sid` is the per-client session id of the
  // ID token, which a back-channel logout token names; `maxHours` caps the session from its creation, whatever the tenant policy allows
  // (the hub's SSO session is the long one; the node session ends and the next login is one click there).
  fleetId: z.object({
    sid: z.string().max(128).nullable(),
    maxHours: z.number().int().min(1).max(24 * 30),
    // Set on a session DERIVED from a Fleet ID session (the tenant switcher's exchange): the original login's own deadline, which the derived
    // session never outlives, so a hop to another tenant cannot restart the cap.
    notAfter: z.string().datetime().optional(),
  }).optional(),
  // How the person authenticated (RFC 8176 `amr`, normalised by user_session.amr.ts): written by the login path
  // and extended once by a verified second factor. Fleet ID copies it into the ID token.
  amr: z.array(z.string().max(64)).max(8).optional(),
  // D28: 'device' for a sign-in of a native or device-bearer client (absent: a browser). The session cap takes its victims from the
  // sign-in's own lane first, so a client without a device cookie cannot push out the person's browser session.
  audience: z.enum(['web', 'device']).optional(),
  // Self-reported hardware for a device-bearer session (phone, tablet,
  // watch, TV, …) — see DeviceInfoDTO in auth.dto.ts. Absent for a web
  // cookie session, where `userAgent` already carries the browser/OS.
  device: z.object({
    type: z.enum(['phone', 'tablet', 'watch', 'tv', 'desktop', 'other']).optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    osVersion: z.string().optional(),
    appVersion: z.string().optional(),
  }).optional(),
}).passthrough();

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

// Helper to coerce dates from JSON (handles both Date and string)
const dateOrString = z.union([z.date(), z.string().datetime()]).transform(val => 
  typeof val === 'string' ? new Date(val) : val
);

const dateOrStringNullable = z.union([z.date(), z.string().datetime()]).transform(val => 
  typeof val === 'string' ? new Date(val) : val
).nullable();

export const UserSessionSchema = z.object({
  userSessionId: z.string().uuid(),
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  accessToken: z.string(),
  refreshToken: z.string(),
  deviceFingerprint: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  sessionStatus: SessionStatusEnum.default("ACTIVE"),
  otpVerifyNeeded: z.boolean().nullish().transform(val => val ?? false),
  sessionExpiry: dateOrString,
  createdAt: dateOrStringNullable,
  updatedAt: dateOrStringNullable,
  metadata: SessionMetaSchema.nullable().optional(),
});

export const SafeUserSessionSchema = UserSessionSchema.omit({
  accessToken: true,
  refreshToken: true,
  deviceFingerprint: true,
});

/**
 * One row of the account page's session list (D28): the safe session plus when it was last seen (ISO; null when unknown) and whether it
 * belongs to the SAME browser as the caller's own session (`thisDevice`, another organization's session of this browser; the device id
 * itself never leaves the server).
 */
export type ListedUserSession = z.infer<typeof SafeUserSessionSchema> & { lastActiveAt: string | null; thisDevice?: boolean };

export type UserSession = z.infer<typeof UserSessionSchema>;
export type SafeUserSession = z.infer<typeof SafeUserSessionSchema>;
