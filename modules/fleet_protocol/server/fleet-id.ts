import { z } from 'zod';

/**
 * What both ends of Fleet ID agree on without talking (12-fleet-identity.md section 4.2; FID-07). Pure.
 *
 * - The issuer: an https URL whose path ends with `/api/fleet-id` (the provider's routes on the fleet instance), in normalised form only, because
 *   every relying party compares it byte for byte with the ID token's `iss` (a value that would normalise is refused here, never mismatched later).
 *   The control plane puts it in the trust bundle (`fleetId.issuer`), so a node learns it through the channel it already verifies.
 * - The endpoints: fixed paths under the issuer, the same `auth_oidc_provider.discovery` serves, so a node never needs to fetch and trust a
 *   discovery document to find them.
 * - The client id of a node: `node:<nodeId>`, the client the control plane registers for the node with `identity.client.register` (one client per
 *   node, F12). Derived rather than distributed, so the bundle stays the same bytes for every node.
 */
export const FLEET_ID_BASE_PATH = '/api/fleet-id';
export const FLEET_ID_ISSUER_MAX = 255;
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isFleetIdIssuer(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > FLEET_ID_ISSUER_MAX || /[\s#?*]/.test(raw)) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false;
  if (!u.pathname.endsWith(FLEET_ID_BASE_PATH)) return false;
  // origin + pathname is the normalised form (lower-case host, no default port, no dot segment): it must be the string itself.
  return u.origin + u.pathname === raw;
}

/**
 * `workspaceLinks` is the hub's workspace-list endpoint (FID-09): a node reports that a person it just signed in is an active member of one of its
 * workspaces, and that a membership ended, authenticated with the same RP key as at the token endpoint. Not an OIDC endpoint, so not in discovery.
 */
export interface FleetIdEndpointSet { issuer: string; authorize: string; token: string; userinfo: string; jwks: string; logout: string; workspaceLinks: string }

export function fleetIdEndpoints(issuer: string): FleetIdEndpointSet {
  return { issuer, authorize: `${issuer}/authorize`, token: `${issuer}/token`, userinfo: `${issuer}/userinfo`, jwks: `${issuer}/jwks`, logout: `${issuer}/logout`, workspaceLinks: `${issuer}/workspace-links` };
}

/** `node:<nodeId>`, or null for a node id the registry would not accept. */
export function fleetIdClientId(nodeId: string): string | null {
  return NODE_ID_RE.test(nodeId) ? `node:${nodeId}` : null;
}

/**
 * The hub's "my workspaces" page (FID-09, `auth_oidc_provider` `/auth/fleet-id/workspaces`): a page on the issuer's origin under the issuer's own
 * prefix (the path before `/api/fleet-id`), the same place the hub's login and consent pages live. A node links to it from its own tenant switcher.
 * Null for a value that is not a Fleet ID issuer.
 */
export function fleetIdWorkspacesPage(issuer: string): string | null {
  if (!isFleetIdIssuer(issuer)) return null;
  const u = new URL(issuer);
  return `${u.origin}${u.pathname.slice(0, u.pathname.length - FLEET_ID_BASE_PATH.length)}/auth/fleet-id/workspaces`;
}

/**
 * What a node reports in its heartbeat so the control plane can register (or re-key) its Fleet ID client with `identity.client.register` (FID-07,
 * decisions F12 and F15). Class G: a PUBLIC key and the node's own public URIs, no tenant or person data.
 *
 * - `READY`: the node app is a relying party. `rpJwk` is the public JWK of its dedicated RP key (never the agent's NODE_SIGN key, F12); a JWK with
 *   any private member is not representable (strict schema). `redirectUris` and `backchannelLogoutUri` are the exact https URIs the hub will
 *   compare byte for byte, in the form that does not normalise, so what is reported is what gets registered. The client id is not reported: the
 *   control plane derives it from the node id that signed the heartbeat (`fleetIdClientId`), so a node cannot name another node's client.
 * - `NOT_READY`: the node app is not a relying party now, and why (a closed set): no verified trust bundle, no Fleet ID issuer in it, the region
 *   forbids Fleet ID, a node id or application host that cannot form a client, or an RP key the app cannot create or load (no field encryption key).
 *   The control plane then has nothing to register.
 * - Absent from a heartbeat: the agent could not ask the app (or predates this field); the control plane keeps its last report, which then ages.
 */
export const FLEET_ID_URI_MAX = 512;
export const FLEET_ID_MAX_REDIRECT_URIS = 10;
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const JWK_KID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Absolute https, no user info, no fragment, no whitespace or wildcard, at most 512 characters, and already in its normalised form. */
export function isExactHttpsUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > FLEET_ID_URI_MAX || /[\s#*]/.test(raw)) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || !u.hostname) return false;
  return u.toString() === raw;
}

const exactUri = z.string().refine(isExactHttpsUri, 'not an exact https URI');

/** The public JWK of a node's RP key: EC P-256 (what the node app generates) or OKP Ed25519, with a kid; any private member is refused (strict). */
export const FleetIdRpPublicJwkSchema = z.union([
  z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(B64URL_43), y: z.string().regex(B64URL_43), kid: z.string().regex(JWK_KID), alg: z.literal('ES256').optional(), use: z.literal('sig').optional() }).strict(),
  z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string().regex(B64URL_43), kid: z.string().regex(JWK_KID), alg: z.literal('EdDSA').optional(), use: z.literal('sig').optional() }).strict(),
]);
export type FleetIdRpPublicJwk = z.infer<typeof FleetIdRpPublicJwkSchema>;

export const FLEET_ID_NOT_READY_REASONS = ['NO_TRUST_BUNDLE', 'NOT_CONFIGURED', 'REGION_FORBIDDEN', 'BAD_NODE_ID', 'BAD_APP_HOST', 'NO_RP_KEY'] as const;
export type FleetIdNotReadyReason = (typeof FLEET_ID_NOT_READY_REASONS)[number];

export const FleetIdClientReportSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('READY'),
    rpJwk: FleetIdRpPublicJwkSchema,
    redirectUris: z.array(exactUri).min(1).max(FLEET_ID_MAX_REDIRECT_URIS).refine((a) => new Set(a).size === a.length, 'duplicate redirect URI'),
    backchannelLogoutUri: exactUri.optional(),
  }).strict(),
  z.object({ status: z.literal('NOT_READY'), reason: z.enum(FLEET_ID_NOT_READY_REASONS) }).strict(),
]);
export type FleetIdClientReport = z.infer<typeof FleetIdClientReportSchema>;

/** A source's answer cut to the schema: the report when it is valid as a whole, otherwise `undefined` (the heartbeat then says nothing). */
export function fleetIdClientReportOf(raw: unknown): FleetIdClientReport | undefined {
  const r = FleetIdClientReportSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}
