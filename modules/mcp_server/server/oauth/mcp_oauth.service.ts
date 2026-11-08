/**
 * The platform's OAuth 2.1 authorization server for its own MCP resource (docs/phases/57-mcp-server D57-8; ADR-0022). Not a proxy:
 * tokens issued here are for this workspace's MCP servers only and are never forwarded anywhere (F5).
 *
 *   authorize   code flow only, PKCE S256 only, exact redirect_uri match against the client's metadata document, RFC 8707 resource
 *               (the workspace's MCP base or one server of it), scope `mcp:read`; a code lives 60 s and is taken once
 *   token       authorization_code (PKCE, client, redirect and resource checked again) and refresh_token (rotated on every use; a
 *               refresh token used twice revokes the whole grant and raises a high signal)
 *   revoke      RFC 7009: always 200; a refresh token revokes its grant, an access token is dropped
 *   verify      for the MCP grant lane of the tenant guard: the access token's record, the grant's status read on every request
 *
 * Errors follow RFC 6749 §5.2 (`error`, `error_description`) and never say which check failed beyond what a client needs.
 */
import { tallySecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import Logger from '@kuraykaraaslan-labs/logger';
import { ACCESS_TOKEN_PREFIX, AUTH_CODE_PREFIX, CODE_CHALLENGE_RE, REFRESH_TOKEN_PREFIX, hashToken, newToken, pkceMatches } from './mcp_oauth.crypto';
import { McpClientError, resolveClient, type McpClient } from './mcp_oauth.client';
import { ACCESS_TOKEN_SECONDS, GRANT_LIFETIME_DAYS, oauthStore, type GrantRow, type OauthStore } from './mcp_oauth.store';
import { mcpUrls, servedResource, type McpUrls } from './mcp_oauth.urls';
import { isDecoyAccessToken, noteDecoyTokenTouch } from './mcp_oauth.decoy';
import { WRITE_CONSENT_MAX_SESSION_AGE_MS } from '../mcp_server.protocol';

/** The scopes this server grants: `mcp:read` (read tools), `mcp:write` (create and update tools, consented right after a sign-in). */
export const SUPPORTED_SCOPES = ['mcp:read', 'mcp:write'] as const;
export const DEFAULT_SCOPE = 'mcp:read';

export type OauthErrorCode =
  | 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope'
  | 'access_denied' | 'unsupported_response_type' | 'invalid_target' | 'server_error' | 'temporarily_unavailable';

export interface OauthDeps {
  store: OauthStore;
  urls(tenantId: string): Promise<McpUrls>;
  /** The workspace's MCP switch and its extra client hosts. */
  policy(tenantId: string): Promise<{ enabled: boolean; allowedClientHosts: ReadonlySet<string> }>;
  client(clientId: unknown, extraHosts: ReadonlySet<string>): Promise<McpClient>;
  audit(tenantId: string, entry: { action: string; actorId: string | null; actorType: 'USER' | 'SYSTEM'; grantId: string; severity: 'low' | 'medium' | 'high'; metadata?: Record<string, unknown> }): Promise<void>;
  now(): Date;
}

export const defaultOauthDeps: OauthDeps = {
  store: oauthStore,
  urls: mcpUrls,
  async policy(tenantId) {
    const { getMcpPolicy } = await import('../mcp_server.settings-policy');
    const p = await getMcpPolicy(tenantId);
    return { enabled: p.enabled, allowedClientHosts: p.allowedClientHosts };
  },
  client: (clientId, extra) => resolveClient(clientId, extra),
  async audit(tenantId, e) {
    try {
      const mod = await ifActive(tenantId, 'audit_log', () => import('@kuraykaraaslan-labs/audit_log/server/audit_log.service'));
      if (!mod) { Logger.info(`[mcp-oauth] tenant=${tenantId} ${e.action} grant=${e.grantId}`); return; }
      await mod.default.log({
        tenantId, actorId: e.actorId, actorType: e.actorType, action: e.action, severity: e.severity, resourceType: 'mcp_oauth_grant',
        resourceId: e.grantId, metadata: { surface: 'mcp', ...(e.metadata ?? {}) },
      });
    } catch (err) {
      Logger.warn(`[mcp-oauth] audit failed for ${e.action}: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  now: () => new Date(),
};

export class OauthError extends Error {
  constructor(readonly code: OauthErrorCode, readonly description: string, readonly status = 400) { super(description); }
}

// ── authorize ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export type AuthorizeCheck =
  | { ok: true; client: { clientId: string; clientName: string; host: string }; redirectUri: string; scope: string; resource: string; state: string | null }
  /** `redirectTo` is set only once client and redirect_uri were verified: before that an error is shown, never redirected (RFC 6749 §4.1.2.1). */
  | { ok: false; error: OauthErrorCode; description: string; redirectTo?: string };

const one = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function paramsFrom(source: URLSearchParams | Record<string, unknown>): AuthorizeParams {
  const get = (k: string) => (source instanceof URLSearchParams ? source.get(k) ?? undefined : one(source[k]));
  const out: AuthorizeParams = {};
  for (const k of ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const) {
    const v = get(k);
    if (v !== undefined) out[k] = v.slice(0, k === 'state' ? 512 : 1024);
  }
  return out;
}

function errorRedirect(redirectUri: string, issuer: string, error: OauthErrorCode, description: string, state: string | null): string {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', issuer);
  return u.toString();
}

export function parseScope(raw: string | undefined): string | null {
  const parts = (raw ?? DEFAULT_SCOPE).split(' ').filter(Boolean);
  if (parts.length === 0) return DEFAULT_SCOPE;
  if (!parts.every((p) => (SUPPORTED_SCOPES as readonly string[]).includes(p))) return null;
  return [...new Set(parts)].sort().join(' ');
}

export async function checkAuthorize(tenantId: string, params: AuthorizeParams, deps: OauthDeps = defaultOauthDeps): Promise<AuthorizeCheck> {
  const [urls, policy] = await Promise.all([deps.urls(tenantId), deps.policy(tenantId)]);
  if (!policy.enabled) return { ok: false, error: 'access_denied', description: 'MCP is switched off for this workspace.' };
  let client: McpClient;
  try {
    client = await deps.client(params.client_id, policy.allowedClientHosts);
  } catch (e) {
    const reason = e instanceof McpClientError ? e.reason : 'metadata_unavailable';
    return { ok: false, error: reason === 'client_not_allowed' ? 'unauthorized_client' : 'invalid_client', description: e instanceof Error ? e.message : 'Unknown client.' };
  }
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: 'invalid_request', description: 'redirect_uri is not one the client registered.' };
  }
  const state = params.state ?? null;
  const fail = (error: OauthErrorCode, description: string): AuthorizeCheck =>
    ({ ok: false, error, description, redirectTo: errorRedirect(redirectUri, urls.issuer, error, description, state) });
  if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (params.code_challenge_method !== 'S256' || !CODE_CHALLENGE_RE.test(params.code_challenge ?? '')) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const scope = parseScope(params.scope);
  if (!scope) return fail('invalid_scope', `Supported scopes: ${SUPPORTED_SCOPES.join(' ')}.`);
  const served = servedResource(urls, params.resource ?? urls.base);
  if (!served) return fail('invalid_target', 'resource must be this workspace\'s MCP address.');
  return { ok: true, client: { clientId: client.clientId, clientName: client.clientName, host: client.host }, redirectUri, scope, resource: served.resource, state };
}

/** The person's decision on the consent screen. Re-validates everything; returns where to send the browser. */
export async function decideAuthorize(
  tenantId: string, userId: string, params: AuthorizeParams, approve: boolean, deps: OauthDeps = defaultOauthDeps,
  session: { signedInAt: Date | null } = { signedInAt: null },
): Promise<{ redirectTo: string } | { error: OauthErrorCode | 'reauth_required'; description: string }> {
  const check = await checkAuthorize(tenantId, params, deps);
  if (!check.ok) return check.redirectTo ? { redirectTo: check.redirectTo } : { error: check.error, description: check.description };
  const urls = await deps.urls(tenantId);
  if (!approve) return { redirectTo: errorRedirect(check.redirectUri, urls.issuer, 'access_denied', 'The person declined.', check.state) };
  // D57-8: letting an app change records is consented to only right after a sign-in.
  if (check.scope.split(' ').includes('mcp:write')) {
    const fresh = session.signedInAt && deps.now().getTime() - session.signedInAt.getTime() <= WRITE_CONSENT_MAX_SESSION_AGE_MS;
    if (!fresh) return { error: 'reauth_required', description: 'Sign out and sign in again, then connect the app: letting it change records needs a fresh sign-in.' };
  }
  const code = newToken(AUTH_CODE_PREFIX);
  await deps.store.putCode(hashToken(code), {
    tenantId, userId, clientId: check.client.clientId, clientName: check.client.clientName, clientHost: check.client.host,
    redirectUri: check.redirectUri, codeChallenge: params.code_challenge!, resource: check.resource, scope: check.scope,
  });
  const u = new URL(check.redirectUri);
  u.searchParams.set('code', code);
  if (check.state) u.searchParams.set('state', check.state);
  u.searchParams.set('iss', urls.issuer);
  return { redirectTo: u.toString() };
}

// ── token ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function refusedTokenSignal(tenantId: string, reason: string, clientId: string | undefined): void {
  tallySecuritySignal({
    tenantId, kind: 'mcp_server.token.refused', lane: 'public-anon', actor: { kind: 'anon', id: 'anon' },
    outcome: 'deny', severity: 'medium', source: 'mcp_server', attrs: { reason, clientHost: clientId ? safeHost(clientId) : undefined },
  });
}
const safeHost = (u: string): string | undefined => { try { return new URL(u).hostname.slice(0, 253); } catch { return undefined; } };

async function issueAccessToken(grant: GrantRow, deps: OauthDeps): Promise<string> {
  const token = newToken(ACCESS_TOKEN_PREFIX);
  await deps.store.putAccessToken(hashToken(token), {
    tenantId: grant.tenantId, grantId: grant.grantId, userId: grant.userId, clientId: grant.clientId, resource: grant.resource, scope: grant.scope,
  });
  return token;
}

export async function exchangeToken(tenantId: string, form: URLSearchParams, deps: OauthDeps = defaultOauthDeps): Promise<TokenResponse> {
  const policy = await deps.policy(tenantId);
  const grantType = form.get('grant_type');
  const clientId = form.get('client_id') ?? undefined;
  const refuse = (code: OauthErrorCode, description: string, reason: string, status = 400): never => {
    refusedTokenSignal(tenantId, reason, clientId);
    throw new OauthError(code, description, status);
  };
  if (!policy.enabled) refuse('access_denied', 'MCP is switched off for this workspace.', 'mcp_off');
  if (!clientId) refuse('invalid_request', 'client_id is required.', 'no_client');

  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const pending = code.startsWith(AUTH_CODE_PREFIX) ? await deps.store.takeCode(hashToken(code)) : null;
    if (!pending || pending.tenantId !== tenantId) return refuse('invalid_grant', 'The code is invalid or expired.', 'bad_code');
    if (pending.clientId !== clientId) refuse('invalid_grant', 'The code was issued to another client.', 'client_mismatch');
    if (form.get('redirect_uri') !== pending.redirectUri) refuse('invalid_grant', 'redirect_uri does not match.', 'redirect_mismatch');
    if (!pkceMatches(form.get('code_verifier') ?? '', pending.codeChallenge)) refuse('invalid_grant', 'The code_verifier does not match.', 'pkce');
    const resource = form.get('resource');
    if (resource !== null && resource.replace(/\/+$/, '') !== pending.resource) refuse('invalid_target', 'resource does not match the authorization.', 'resource_mismatch');
    const refresh = newToken(REFRESH_TOKEN_PREFIX);
    const now = deps.now();
    const grant = await deps.store.insertGrant({
      tenantId, userId: pending.userId, clientId: pending.clientId, clientName: pending.clientName, clientHost: pending.clientHost,
      resource: pending.resource, scope: pending.scope, refreshHash: hashToken(refresh),
      expiresAt: new Date(now.getTime() + GRANT_LIFETIME_DAYS * 24 * 3600 * 1000),
    });
    await deps.audit(tenantId, {
      action: 'mcp_server.grant.created', actorId: pending.userId, actorType: 'USER', grantId: grant.grantId, severity: 'medium',
      metadata: { clientHost: pending.clientHost, scope: pending.scope },
    });
    return { access_token: await issueAccessToken(grant, deps), token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope: grant.scope };
  }

  if (grantType === 'refresh_token') {
    const raw = form.get('refresh_token') ?? '';
    if (!raw.startsWith(REFRESH_TOKEN_PREFIX)) refuse('invalid_grant', 'The refresh token is invalid.', 'bad_refresh');
    const hash = hashToken(raw);
    const grant = await deps.store.grantByRefresh(tenantId, hash);
    if (!grant) {
      // A refresh token that was already rotated away: whoever holds it is not the client that rotated it. Revoke the family.
      const reused = await deps.store.grantByPreviousRefresh(tenantId, hash);
      if (reused && reused.status !== 'revoked') {
        await deps.store.setStatus(tenantId, reused.grantId, { status: 'revoked', revokedReason: 'refresh_reused' });
        await deps.audit(tenantId, {
          action: 'mcp_server.grant.refresh_reused', actorId: null, actorType: 'SYSTEM', grantId: reused.grantId, severity: 'high',
          metadata: { clientHost: reused.clientHost, lane: 'machine-mcp' },
        });
      }
      return refuse('invalid_grant', 'The refresh token is invalid.', reused ? 'refresh_reused' : 'bad_refresh');
    }
    if (grant.clientId !== clientId) refuse('invalid_grant', 'The refresh token was issued to another client.', 'client_mismatch');
    if (grant.status !== 'active' || grant.expiresAt.getTime() <= deps.now().getTime()) refuse('invalid_grant', 'The grant is no longer active.', 'grant_inactive');
    const next = newToken(REFRESH_TOKEN_PREFIX);
    if (!(await deps.store.rotateRefresh(tenantId, grant.grantId, hash, hashToken(next)))) refuse('invalid_grant', 'The refresh token is invalid.', 'rotation_lost');
    return { access_token: await issueAccessToken(grant, deps), token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: next, scope: grant.scope };
  }

  return refuse('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.', 'grant_type');
}

// ── revoke (RFC 7009) ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function revokeToken(tenantId: string, form: URLSearchParams, deps: OauthDeps = defaultOauthDeps): Promise<void> {
  const raw = form.get('token') ?? '';
  const clientId = form.get('client_id');
  if (raw.startsWith(ACCESS_TOKEN_PREFIX)) {
    const rec = await deps.store.getAccessToken(hashToken(raw));
    if (rec && rec.tenantId === tenantId && rec.clientId === clientId) await deps.store.dropAccessToken(hashToken(raw));
    return;
  }
  if (raw.startsWith(REFRESH_TOKEN_PREFIX)) {
    const grant = await deps.store.grantByRefresh(tenantId, hashToken(raw));
    if (grant && grant.clientId === clientId && (await deps.store.setStatus(tenantId, grant.grantId, { status: 'revoked', revokedReason: 'client_revoked' }))) {
      await deps.audit(tenantId, { action: 'mcp_server.grant.revoked', actorId: null, actorType: 'SYSTEM', grantId: grant.grantId, severity: 'low', metadata: { by: 'client' } });
    }
  }
}

// ── verify (the MCP grant lane) ───────────────────────────────────────────────────────────────────────────────────────

export interface GrantPrincipal {
  grantId: string;
  userId: string;
  clientId: string;
  clientHost: string;
  resource: string;
  scope: string;
}

/**
 * The grant behind a presented access token, or null for anything that is not a live token of this workspace. Fails CLOSED: an
 * unreachable Redis or database throws, and the guard answers 401 (F23). The grant's status is read on every call, so a revoked or
 * suspended grant stops at once on every instance.
 */
export async function verifyAccessToken(tenantId: string, raw: string, deps: OauthDeps = defaultOauthDeps, meta: { ip?: string | null } = {}): Promise<GrantPrincipal | null> {
  if (!raw.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  if (isDecoyAccessToken(raw, tenantId)) { noteDecoyTokenTouch(tenantId, meta.ip ?? null); return null; }
  const rec = await deps.store.getAccessToken(hashToken(raw));
  if (!rec || rec.tenantId !== tenantId) return null;
  const grant = await deps.store.grantById(tenantId, rec.grantId);
  if (!grant || grant.userId !== rec.userId) return null;
  const now = deps.now();
  if (grant.expiresAt.getTime() <= now.getTime() || grant.status === 'revoked') return null;
  if (grant.status === 'suspended' && (!grant.suspendedUntil || grant.suspendedUntil.getTime() > now.getTime())) return null;
  void deps.store.touch(tenantId, grant.grantId, now).catch(() => undefined);
  return { grantId: grant.grantId, userId: grant.userId, clientId: grant.clientId, clientHost: grant.clientHost, resource: grant.resource, scope: grant.scope };
}

// ── the person's and the admin's views ────────────────────────────────────────────────────────────────────────────────

export interface SafeGrant {
  grantId: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientHost: string;
  resource: string;
  scope: string;
  status: GrantRow['status'];
  suspendedUntil: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export function safeGrant(g: GrantRow): SafeGrant {
  const iso = (x: Date | null) => (x ? x.toISOString() : null);
  return {
    grantId: g.grantId, userId: g.userId, clientId: g.clientId, clientName: g.clientName, clientHost: g.clientHost, resource: g.resource,
    scope: g.scope, status: g.status, suspendedUntil: iso(g.suspendedUntil), createdAt: g.createdAt.toISOString(), lastUsedAt: iso(g.lastUsedAt),
    expiresAt: g.expiresAt.toISOString(), revokedAt: iso(g.revokedAt), revokedReason: g.revokedReason,
  };
}

/** Revokes a grant for good (a person's own, or any grant for an admin). False when there is no such live grant for this caller. */
export async function revokeGrantBy(
  tenantId: string, grantId: string, actor: { userId: string; admin: boolean }, deps: OauthDeps = defaultOauthDeps,
): Promise<boolean> {
  const grant = await deps.store.grantById(tenantId, grantId);
  if (!grant || (!actor.admin && grant.userId !== actor.userId)) return false;
  if (!(await deps.store.setStatus(tenantId, grantId, { status: 'revoked', revokedReason: actor.userId === grant.userId ? 'user_revoked' : 'admin_revoked' }))) return false;
  await deps.audit(tenantId, {
    action: 'mcp_server.grant.revoked', actorId: actor.userId, actorType: 'USER', grantId, severity: 'low',
    metadata: { by: actor.userId === grant.userId ? 'owner' : 'admin', clientHost: grant.clientHost },
  });
  return true;
}
