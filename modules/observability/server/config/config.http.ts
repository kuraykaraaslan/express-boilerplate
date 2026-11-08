import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import YAML from 'yaml'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { BodyTooLargeError, readBounded } from '../telemetry/telemetry.http'
import { authenticateConfigCaller, authorizeConfig, defaultConfigAuthDeps, type ConfigAuthDeps } from './config.auth'
import { ConfigRequestDTO, DetachDTO, MAX_CONFIG_BYTES } from './config.dto'
import { CONFIG_KINDS, type ConfigKind } from './config.kinds'
import { ConfigProblemsError, applyConfig, detach, exportFor, listManaged, prepare } from './config.service'
import { observabilityOpenApi } from './config.openapi'

/**
 * The handlers behind `/api/observability/config*` and `/api/observability/openapi` (observability phase 21.2). Each route file is a one-line
 * adapter; the logic and its dependencies live here so the security tests can drive it with a fake verifier.
 *
 * Order, and why: rate limit; the DECLARED size against the ceiling (before any work for a caller we have not authenticated); authenticate
 * (which lane, which kinds); bounded read of the body; validate; plan; write. Every response is `no-store`: an apply response can carry the
 * credentials a create issued.
 */

/** The JSON envelope around a document of at most `MAX_CONFIG_BYTES` characters. */
const MAX_BODY_BYTES = MAX_CONFIG_BYTES * 2 + 4096

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

type Params = { params: Promise<{ tenantId: string }> }

function kindsOf(raw: unknown): ConfigKind[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return CONFIG_KINDS.filter((k) => raw.includes(k))
}

async function readBody(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError('Request body too large', 413, ErrorCode.VALIDATION_ERROR)
  let bytes: Uint8Array
  try { bytes = await readBounded(request as never, MAX_BODY_BYTES) } catch (e) {
    if (e instanceof BodyTooLargeError) throw new AppError('Request body too large', 413, ErrorCode.VALIDATION_ERROR)
    throw e
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new AppError('The request body is not valid JSON', 400, ErrorCode.VALIDATION_ERROR) }
}

function guardSize(request: NextRequest): void {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError('Request body too large', 413, ErrorCode.VALIDATION_ERROR)
}

/** GET: the live state as a document. `?kinds=monitors,slos&scope=managed|all&format=json|yaml`. */
export async function handleExport(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const sp = request.nextUrl.searchParams
    const kinds = kindsOf((sp.get('kinds') ?? '').split(',').filter(Boolean)) ?? []
    const want = kinds.length ? kinds : [...CONFIG_KINDS]
    await authorizeConfig(request, tenantId, 'read', want, deps)
    const { document, warnings } = await exportFor(tenantId, want, { scope: sp.get('scope') === 'managed' ? 'managed' : 'all' })
    if (sp.get('format') === 'yaml') {
      return new NextResponse(YAML.stringify(document), { headers: { ...NO_STORE, 'Content-Type': 'application/yaml', 'Content-Disposition': 'attachment; filename="observability.yaml"' } })
    }
    return json({ document, warnings })
  } catch (e) { return normalizeError(e) }
}

/** POST: what a document would change. Writes nothing. */
export async function handlePlan(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    guardSize(request)
    const raw = await readBodyAfterAuthKinds(request, tenantId, 'read', deps)
    const { plan } = await prepare(tenantId, raw.request)
    return json({ plan })
  } catch (e) { return normalizeError(e) }
}

/** POST: write what the plan says. Requires the manage permission of every requested kind (or the write scope). */
export async function handleApply(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    guardSize(request)
    const raw = await readBodyAfterAuthKinds(request, tenantId, 'write', deps)
    const result = await applyConfig(tenantId, raw.request, raw.principal.actor)
    return json(result)
  } catch (e) { return normalizeError(e) }
}

/**
 * The kinds a request names decide which permissions it needs, so the body has to be read before the guard can finish; but a body from a
 * caller that has not authenticated at all must not be parsed. So the order is: size ceiling, authenticate the caller (a key in full, a
 * session as a signed-in person, `authenticateConfigCaller`), read, then authorize a session for the kinds named.
 */
async function readBodyAfterAuthKinds(request: NextRequest, tenantId: string, access: 'read' | 'write', deps: ConfigAuthDeps) {
  const keyPrincipal = await authenticateConfigCaller(request, tenantId, access, CONFIG_KINDS, deps)
  const body = await readBody(request)
  const parsed = ConfigRequestDTO.safeParse(body)
  if (!parsed.success) throw new ConfigProblemsError(parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message.slice(0, 200) })))
  const kinds = parsed.data.kinds && parsed.data.kinds.length ? parsed.data.kinds : [...CONFIG_KINDS]
  const principal = keyPrincipal ?? await authorizeConfig(request, tenantId, access, kinds, deps)
  return { request: parsed.data, principal }
}

/** GET: the code-managed resources (the console lists them with a detach action). */
export async function handleManaged(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const kinds = kindsOf((request.nextUrl.searchParams.get('kinds') ?? '').split(',').filter(Boolean)) ?? []
    const want = kinds.length ? kinds : [...CONFIG_KINDS]
    await authorizeConfig(request, tenantId, 'read', want, deps)
    return json({ items: await listManaged(tenantId, want) })
  } catch (e) { return normalizeError(e) }
}

/** POST: hand a code-managed resource to the console. */
export async function handleDetach(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    guardSize(request)
    const keyPrincipal = await authenticateConfigCaller(request, tenantId, 'write', CONFIG_KINDS, deps)
    const body = await readBody(request)
    const parsed = DetachDTO.safeParse(body)
    if (!parsed.success) throw new ConfigProblemsError(parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message.slice(0, 200) })))
    const principal = keyPrincipal ?? await authorizeConfig(request, tenantId, 'write', [parsed.data.kind], deps)
    await detach(tenantId, parsed.data.kind, parsed.data.id, principal.actor)
    return json({ ok: true })
  } catch (e) { return normalizeError(e) }
}

/** GET: the OpenAPI document of the observability REST surface (any holder of a config read grant). */
export async function handleOpenApi(request: NextRequest, { params }: Params, deps: ConfigAuthDeps = defaultConfigAuthDeps): Promise<Response> {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeConfig(request, tenantId, 'read', ['routes'], deps)
    return json(observabilityOpenApi())
  } catch (e) { return normalizeError(e) }
}
