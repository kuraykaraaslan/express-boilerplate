import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { moduleEnabledGate } from '../telemetry/telemetry.auth'
import { CONFIG_PERMISSIONS, CONFIG_SCOPE_READ, CONFIG_SCOPE_WRITE, type ConfigKind } from './config.kinds'
import type { Actor } from './config.service'

/**
 * Who may read or write the configuration (observability phase 21.2): two lanes that never mix.
 *
 *  - A request carrying an `Authorization` header is judged ONLY as an `api_key` credential holding `observability_config:read` (read)
 *    or `observability_config:write` (read and write). The tenant is the key's, and the URL's tenant must be the same (a mismatch is
 *    the same 401 as an unknown key). The coarse `read` and `write` verbs satisfy neither scope; `admin` and the `*` wildcard do,
 *    because they mean "everything in this workspace".
 *  - Anything else is a session, and it must hold, for EVERY kind the request touches, the permission the same action has in the
 *    console (`CONFIG_PERMISSIONS`): a person who may manage alerts but not SLOs cannot apply a file with SLOs in it.
 *
 * The API key stands for an administrator of the workspace who chose, when minting it, to hand over exactly this: it is equivalent to the
 * whole set of `.manage` permissions, which is why the scope exists as its own pair instead of riding on `write`.
 */

export interface ConfigPrincipal { tenantId: string; actor: Actor; lane: 'session' | 'api_key' }

export interface ConfigAuthDeps {
  /** Verify the bearer key for `scope`, pinned to `tenantId`. Throws an `AppError`. */
  verifyKey(request: NextRequest, tenantId: string, scope: string): Promise<{ tenantId: string; apiKeyId: string }>
  /** Is the module on for this workspace? */
  enabled(tenantId: string): Promise<boolean>
  /** The console's own guard for one permission; returns the user id. */
  session(request: NextRequest, tenantId: string, permission: string): Promise<string | null>
  /** A person is signed in to this workspace (no permission yet): the check before a body is read. Throws an `AppError`. */
  signedIn(request: NextRequest, tenantId: string): Promise<void>
}

const REFUSED = () => new AppError('Invalid or unauthorized api key', 401, ErrorCode.UNAUTHORIZED)

export const defaultConfigAuthDeps: ConfigAuthDeps = {
  async verifyKey(request, tenantId, scope) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.verify.service'))
    if (!mod) throw new AppError('API access is unavailable', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true })
    try {
      const key = await mod.verifyFromAuthHeader(request, tenantId, scope)
      return { tenantId: key.tenantId, apiKeyId: key.apiKeyId }
    } catch (e) {
      // A throttled key stays throttled, a key without the scope says so (its holder already has it); every other refusal looks the same.
      if (e instanceof AppError && (e.statusCode === 429 || e.statusCode === 403)) throw e
      throw REFUSED()
    }
  },
  enabled: moduleEnabledGate,
  async session(request, tenantId, permission) {
    // Loaded here, not at the top: the key lane never needs the guard, and a test of that lane must not have to stand one in.
    const { authorizeRequest } = await import('@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' })
    return user?.userId ?? null
  },
  async signedIn(request, tenantId) {
    const { default: TenantSessionNextService } = await import('@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next')
    await TenantSessionNextService.authenticateTenantByRequest({ request, tenantId })
  },
}

export async function authorizeConfig(
  request: NextRequest, tenantId: string, access: 'read' | 'write', kinds: readonly ConfigKind[], deps: ConfigAuthDeps = defaultConfigAuthDeps,
): Promise<ConfigPrincipal> {
  if (kinds.length === 0) throw new AppError('Nothing to authorize', 400, ErrorCode.VALIDATION_ERROR)
  if (request.headers.has('authorization')) {
    const key = await deps.verifyKey(request, tenantId, access === 'write' ? CONFIG_SCOPE_WRITE : CONFIG_SCOPE_READ)
    // verifyFromAuthHeader pins the tenant already; this is the second line, against a verifier that does not.
    if (key.tenantId !== tenantId) throw REFUSED()
    if (!(await deps.enabled(key.tenantId))) throw new AppError('Observability is not enabled for this workspace', 403, ErrorCode.FEATURE_NOT_AVAILABLE)
    return { tenantId: key.tenantId, actor: { type: 'API_KEY', id: key.apiKeyId }, lane: 'api_key' }
  }
  const permissions = [...new Set(kinds.map((k) => CONFIG_PERMISSIONS[k][access === 'write' ? 'manage' : 'read']))]
  let userId: string | null = null
  for (const permission of permissions) userId = (await deps.session(request, tenantId, permission)) ?? userId
  return { tenantId, actor: { type: 'USER', id: userId }, lane: 'session' }
}

/**
 * Who is calling, before any byte of the body is parsed (probe lane finding 2026-11-03: a caller with no credential used to get the
 * document's validation problems back). The key lane is judged in full here, since its scope does not depend on the kinds; the session
 * lane only for a signed-in person of the workspace, because the permissions it needs depend on the kinds the body names, which
 * `authorizeConfig` checks once the body is read. Returns the key lane's principal, null for a session.
 */
export async function authenticateConfigCaller(
  request: NextRequest, tenantId: string, access: 'read' | 'write', allKinds: readonly ConfigKind[], deps: ConfigAuthDeps = defaultConfigAuthDeps,
): Promise<ConfigPrincipal | null> {
  if (request.headers.has('authorization')) return authorizeConfig(request, tenantId, access, allKinds, deps)
  await deps.signedIn(request, tenantId)
  return null
}
