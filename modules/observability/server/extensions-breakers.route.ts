import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { extensionRegistry } from '@kuraykaraaslan-labs/common/server/extension-registry'
import { PLUGIN_VERSION_SCOPE } from '@kuraykaraaslan-labs/common/server/extensions/breaker'
import { listOpenBreakers } from './observability.extension-health'
import { closeBreakerNow, keepBreakerOpen, type BreakerTarget } from './observability.breaker-actions'

type Ctx = { params: Promise<{ tenantId: string }> }

/** "Keep open" is for an incident, not a switch: a contribution that should stay off is disabled or banned instead. */
const MAX_HOLD_MS = 7 * 24 * 60 * 60_000

const BreakerActionDTO = z.object({
  /** A tenant id, `system`, or `plugin-version` (then `pluginVersionId` names the version). */
  scope: z.union([z.string().uuid(), z.literal('system'), z.literal(PLUGIN_VERSION_SCOPE)]).optional(),
  contributionId: z.string().trim().min(1).max(300).optional(),
  pluginVersionId: z.string().uuid().optional(),
  action: z.enum(['close', 'hold']),
  /** For `hold`: until when, as epoch milliseconds or an ISO date-time. */
  until: z.union([z.number().int().positive(), z.string().datetime({ offset: true })]).optional(),
  reason: z.string().trim().min(1).max(500),
}).superRefine((v, ctx) => {
  const plugin = v.pluginVersionId !== undefined || v.scope === PLUGIN_VERSION_SCOPE
  if (plugin && !v.pluginVersionId) ctx.addIssue({ code: 'custom', path: ['pluginVersionId'], message: 'Name the plugin version' })
  if (plugin && v.contributionId) ctx.addIssue({ code: 'custom', path: ['contributionId'], message: 'A plugin version is named by pluginVersionId alone' })
  if (!plugin && (!v.scope || !v.contributionId)) ctx.addIssue({ code: 'custom', path: ['contributionId'], message: 'Name the scope and the contribution' })
  if (v.action === 'hold' && v.until === undefined) ctx.addIssue({ code: 'custom', path: ['until'], message: 'Say until when it stays paused' })
})

/**
 * Contributions paused by the extension breaker (docs/phases/37-extensions/04): what, why, and until when.
 * A workspace sees its own; the root tenant sees every tenant's, the system scope and plugin versions with `?all=1`.
 * `guard` marks a contributor to a guard point: while it is paused the actions it guards are refused (EXT-3).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.extensions.read', scope: 'TENANT' })
    const all = tenantId === ROOT_TENANT_ID && request.nextUrl.searchParams.get('all') === '1'
    const items = (await listOpenBreakers(all ? undefined : tenantId)).map((r) => ({
      ...r,
      guard: r.scope !== PLUGIN_VERSION_SCOPE && extensionRegistry.getPoint?.(r.point)?.pattern === 'guard',
    }))
    return NextResponse.json({ items })
  } catch (e) { return normalizeError(e) }
}

/**
 * POST { scope, contributionId | pluginVersionId, action: 'close' | 'hold', until?, reason } — close a paused
 * contribution now, or keep it paused (no probe) until a time. A workspace acts on its own contributions; the system
 * scope, another tenant's and a plugin version (shared by every tenant that installed it) are the platform operator's,
 * from the root tenant behind the admin gate. Audited, with the reason.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.extensions.manage', scope: 'TENANT' })
    const dto = BreakerActionDTO.parse(await request.json())
    const target: BreakerTarget = dto.pluginVersionId
      ? { kind: 'plugin-version', pluginVersionId: dto.pluginVersionId }
      : { kind: 'contribution', scope: dto.scope!, contributionId: dto.contributionId! }
    let actorId = auth.user?.userId ?? null
    if (!(target.kind === 'contribution' && target.scope === tenantId)) {
      if (tenantId !== ROOT_TENANT_ID) throw new AppError('Only the platform operator can act on this breaker', 403, ErrorCode.FORBIDDEN)
      const operator = await authorizeRequest({ request, requiredPermission: 'observability.extensions.manage', scope: 'GLOBAL' })
      actorId = operator.user?.userId ?? actorId
    }
    const actor = { actorId, actingTenantId: tenantId, reason: dto.reason }
    if (dto.action === 'close') return NextResponse.json({ success: true, ...(await closeBreakerNow(target, actor)) })
    const until = typeof dto.until === 'number' ? dto.until : Date.parse(dto.until!)
    const now = Date.now()
    if (!(until > now)) throw new AppError('`until` must be in the future', 400, ErrorCode.VALIDATION_ERROR)
    if (until - now > MAX_HOLD_MS) throw new AppError('A breaker can be kept open for at most 7 days', 400, ErrorCode.VALIDATION_ERROR)
    return NextResponse.json({ item: await keepBreakerOpen(target, until, actor) })
  } catch (e) { return normalizeError(e) }
}
