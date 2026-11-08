/**
 * Machine access to the OPERATIONAL routes (observability phase 21, work order 2 item 7): a CI step can acknowledge an alert, declare an incident,
 * start a silence from a template and add an incident note through a key that holds exactly the scope of that one action. The routes keep their
 * console behaviour; this adds the second lane the configuration routes already have (`config/config.auth.ts`), with a stricter credential rule
 * because these routes change what people are paged about.
 *
 *  - TWO LANES, NEVER MIXED. A request with an `Authorization` header is judged ONLY as an api key; one without is a console session that must hold
 *    the permission the route always asked for. A bad key never falls back to a session.
 *  - EXACT SCOPES. `observability_ops:ack`, `:incident`, `:silence`, `:note`, one per action, matched against the key's own scope list. `admin`,
 *    `*`, `write`, `observability_config:*` and the MCP scopes grant NONE of them (a key that may apply a configuration, or run an MCP client, is
 *    not thereby allowed to page or close). `observability_ops:*` is not a scope either. Granted only by an administrator who ticks the box.
 *  - TENANT PINNED. The key's tenant is the tenant of the call; the URL tenant must equal it, and a mismatch is the same 401 as an unknown key
 *    (refused inside `api_key`'s verification, before the key's rate limit or row is touched).
 *  - A REFUSED CALL IS NOT A USE. The key's last use and usage count are stamped only for a call that passed every check here (review 2026-10-28).
 *  - EVERY REFUSAL BEFORE AUTHENTICATION IS THE SAME 401 (no key, unknown, expired, revoked, wrong scope, wrong tenant); a throttled key is a 429.
 *  - RATE LIMITED per key (`OPS_PER_MINUTE`, shared by the four actions) and AUDITED through `audit_log` (actor type API_KEY) for every call that got
 *    past authentication, refused or not; the audit row carries the action, the outcome and the target id, never the body.
 */
import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { moduleEnabledGate } from '../telemetry/telemetry.auth';
import { OPS_SCOPES, type OpsAction } from './ops.scopes';

export { OPS_SCOPES, type OpsAction };

export const OPS_PER_MINUTE = 30;

export interface OpsPrincipal {
  tenantId: string;
  lane: 'session' | 'api_key';
  /** The user (session lane) or the api key (key lane). */
  actor: { type: 'USER' | 'API_KEY'; id: string | null };
  action: OpsAction;
}

export interface VerifiedOpsKey { tenantId: string; apiKeyId: string; scopes: readonly string[]; isActive?: boolean }

export interface OpsAuthDeps {
  /**
   * Verify the bearer key (any scope) as a key of `tenantId`, without stamping its use. Throws an `AppError`. A key of another
   * tenant is refused before its rate limit or its row is touched.
   */
  verifyKey(request: { headers: { get(name: string): string | null } }, tenantId: string): Promise<VerifiedOpsKey>;
  /** Stamp the key's use (last used, usage count): called only for a call this lane let through. Best effort. */
  recordUse(request: { headers: { get(name: string): string | null } }, keyId: string): Promise<void>;
  enabled(tenantId: string): Promise<boolean>;
  /** The console's own guard for one permission; returns the user id. */
  session(request: NextRequest, tenantId: string, permission: string): Promise<string | null>;
  /** Throws a 429 `AppError` when the key used its budget. */
  admit(keyId: string, tenantId: string): Promise<void>;
  audit(entry: { tenantId: string; keyId: string; action: OpsAction; outcome: string; target: { type: string; id: string | null } }): Promise<void>;
}

export const REFUSED = () => new AppError('Invalid or unauthorized api key', 401, ErrorCode.UNAUTHORIZED, { headers: { 'WWW-Authenticate': 'Bearer realm="observability-ops"' } });

export const defaultOpsAuthDeps: OpsAuthDeps = {
  async verifyKey(request, tenantId) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.service'));
    if (!mod) throw new AppError('API access is unavailable', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
    try {
      // The exact scope is this lane's own rule (below), so the use is stamped only once the lane let the call through.
      return await mod.default.verifyFromAuthHeader(request, tenantId, undefined, { deferUsage: true }) as unknown as VerifiedOpsKey;
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 429) throw e;
      throw REFUSED();
    }
  },
  async recordUse(request, keyId) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.service'));
    mod?.default.recordUseFromRequest(request, keyId);
  },
  enabled: moduleEnabledGate,
  async session(request, tenantId, permission) {
    const { authorizeRequest } = await import('@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' });
    return user?.userId ?? null;
  },
  async admit(keyId, tenantId) {
    const { check } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service');
    const res = await check(`ops:${keyId}`, 'api', { limit: OPS_PER_MINUTE, tenantId });
    if (!res.success) throw new AppError('Rate limit exceeded for this key', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true, headers: { 'Retry-After': String(res.retryAfter) } });
  },
  async audit(e) {
    const line = `[ops] tenant=${e.tenantId} key=${e.keyId} action=${e.action} outcome=${e.outcome}`;
    try {
      const mod = await ifActive(e.tenantId, 'audit_log', () => import('@kuraykaraaslan-labs/audit_log/server/audit_log.service'));
      if (!mod) { Logger.info(line); return; }
      await mod.default.log({
        tenantId: e.tenantId, actorId: e.keyId, actorType: 'API_KEY', action: `observability.ops.${e.action}`, severity: 'medium',
        resourceType: e.target.type, resourceId: e.target.id, metadata: { outcome: e.outcome },
      });
    } catch (err) {
      Logger.warn(`${line} (audit_log failed: ${err instanceof Error ? err.message : String(err)})`);
    }
  },
};

/** Pure: does this key's own scope list grant the action? Exact match only. */
export function keyHoldsScope(scopes: readonly string[], action: OpsAction): boolean {
  return scopes.includes(OPS_SCOPES[action]);
}

export async function authorizeOps(
  request: NextRequest, tenantId: string, action: OpsAction, sessionPermission: string, deps: OpsAuthDeps = defaultOpsAuthDeps,
): Promise<OpsPrincipal> {
  if (!request.headers.has('authorization')) {
    const userId = await deps.session(request, tenantId, sessionPermission);
    return { tenantId, lane: 'session', actor: { type: 'USER', id: userId }, action };
  }
  const key = await deps.verifyKey(request, tenantId);
  if (key.isActive === false || key.tenantId !== tenantId || !keyHoldsScope(key.scopes, action)) throw REFUSED();
  if (!(await deps.enabled(key.tenantId))) throw new AppError('Observability is not enabled for this workspace', 403, ErrorCode.FEATURE_NOT_AVAILABLE);
  await deps.admit(key.apiKeyId, key.tenantId);
  // A refused call is not a use of the key: its row is stamped only here, past every check of the lane.
  void deps.recordUse(request, key.apiKeyId).catch(() => undefined);
  return { tenantId: key.tenantId, lane: 'api_key', actor: { type: 'API_KEY', id: key.apiKeyId }, action };
}

/**
 * Run `fn` for an authorised principal and audit the outcome when the lane is a key (a session is audited by the services and the console as
 * before). The audit never fails the call, and an `AppError` of `fn` is audited with its status and rethrown.
 */
export async function runAudited<T>(principal: OpsPrincipal, target: { type: string; id: string | null } | ((result: T) => { type: string; id: string | null }), fn: () => Promise<T>, deps: OpsAuthDeps = defaultOpsAuthDeps): Promise<T> {
  const note = (outcome: string, result?: T) => principal.lane === 'api_key' && principal.actor.id
    ? deps.audit({ tenantId: principal.tenantId, keyId: principal.actor.id, action: principal.action, outcome, target: typeof target === 'function' ? (result === undefined ? { type: 'unknown', id: null } : target(result)) : target }).catch(() => undefined)
    : Promise.resolve();
  try {
    const out = await fn();
    await note('ok', out);
    return out;
  } catch (e) {
    await note(e instanceof AppError ? `error_${e.statusCode}` : 'error_500');
    throw e;
  }
}
