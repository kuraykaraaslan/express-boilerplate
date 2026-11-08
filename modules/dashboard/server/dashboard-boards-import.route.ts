import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { assertCanWrite } from './board.crud.service'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import { BoardPackageSchema, packageVersionProblem } from './board-package'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { planBoardImport, planBundleImport, resolveReferences } from './board-package.import'
import { BoardBundleSchema, bundleVersionProblem, isBundleDocument } from './board-package.bundle'
import { buildImportEnv } from './board-package.env'
import DashboardBoardPackageService from './board-package.service'
import MSG from './dashboard.messages'
import { elementAuthoringFor } from './element-authoring'

type Ctx = { params: Promise<{ tenantId: string }> }

const ImportBoardDTO = z
  .object({
    /** The package, validated whole by `BoardPackageSchema`; an unknown key anywhere is a 400. */
    package: BoardPackageSchema,
    /** `true` (the default) reports what would happen and writes nothing. */
    dryRun: z.boolean().default(true),
    title: z.string().min(1).max(120).optional(),
    scope: z.enum(['TENANT', 'PRIVATE']).default('PRIVATE'),
  })
  .strict()

/** The same body with a bundle (19.6) in `package`: `title` renames the bundle's first board only. */
const ImportBundleDTO = ImportBoardDTO.extend({ package: BoardBundleSchema }).strict()

/**
 * POST …/dashboard/boards/import — import a board package (phase 19.2).
 *
 * Two steps on purpose: a dry run (the default) returns the plan's report, the apply
 * (`dryRun: false`) writes. Both run the same plan, built from what THIS caller can resolve in THIS
 * tenant, so the report is exactly what the apply would do. The package is untrusted: it is parsed
 * strictly, its widgets are looked up again by kind and key and gated like a manual placement, and
 * the board and its placements are created through the normal services (never written directly).
 * Only a board the caller could create by hand is created: `dashboard.boards.write`, plus
 * `dashboard.boards.manage` for a shared (`TENANT`) one, and the plan's board limit.
 *
 * `package` may also be a bundle (19.6, `board-package.bundle.ts`); the report then carries
 * `bundle.boards` (one report per member) and `bundle.remap`. Every report carries `resolved`: the
 * boards, data sources and commands the package points at, resolved for this caller.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write', alsoCheck: ['dashboard.boards.manage'],
    })
    const body = await request.json()
    const raw = (body as { package?: unknown } | null)?.package
    // A file from a newer package or bundle format: a clear refusal before the strict parse (phase 21).
    const tooNew = packageVersionProblem(raw) ?? bundleVersionProblem(raw)
    // The constant leads (the client translates it); a newer file keeps its own one, whose text says to update the app.
    if (tooNew) {
      const code = tooNew.newer ? MSG.PACKAGE_FROM_NEWER_VERSION : MSG.PACKAGE_FORMAT_UNSUPPORTED
      throw new AppError(`${code}: ${tooNew.message}`, 422, ErrorCode.VALIDATION_ERROR)
    }
    if (isBundleDocument(raw)) return await importBundle(request, tenantId, ctx, ImportBundleDTO.parse(body))
    const dto = ImportBoardDTO.parse(body)
    assertCanWrite({ scope: dto.scope }, ctx.granted.has('dashboard.boards.manage'))

    const env = await buildImportEnv({ request, tenantId, ctx, pkg: dto.package })
    const plan = planBoardImport(dto.package, env, dto.scope)
    const report = {
      board: { title: dto.title ?? plan.board.title, scope: dto.scope },
      counts: plan.counts,
      issues: plan.issues,
      references: dto.package.references,
      resolved: resolveReferences([dto.package], env),
    }
    if (dto.dryRun) return NextResponse.json({ dryRun: true, report })

    await assertBoardHeadroom(tenantId, dto.scope, ctx.userId)
    const board = await DashboardBoardPackageService.apply(tenantId, { userId: ctx.userId }, plan, { scope: dto.scope, title: dto.title, authoring: elementAuthoringFor(request, tenantId, ctx.session) })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.import', resourceType: 'dashboard_board',
      resourceId: board.boardId, metadata: { ...plan.counts, issues: plan.issues.length, scope: dto.scope },
    })
    return NextResponse.json({ dryRun: false, board, report }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * A bundle (19.6): one dry run for every member against one environment, a report per board, and the
 * remap table (bundle ref → new board; `boardId` is null until the apply). The apply checks the board
 * limit for all members up front, then creates all of them or none (`applyBundle`).
 */
async function importBundle(
  request: NextRequest,
  tenantId: string,
  ctx: Awaited<ReturnType<typeof dashboardContext>>,
  dto: z.infer<typeof ImportBundleDTO>,
) {
  assertCanWrite({ scope: dto.scope }, ctx.granted.has('dashboard.boards.manage'))
  const packages = dto.package.boards.map((m) => m.package)
  const env = await buildImportEnv({ request, tenantId, ctx, pkg: packages })
  const plan = planBundleImport(dto.package, env, dto.scope)
  const titleOf = (b: (typeof plan.boards)[number]) => (b.root && dto.title) || b.plan.board.title
  const titles = new Map(plan.boards.map((b) => [b.ref, titleOf(b)]))
  const report = (ids?: Map<string, string>) => ({
    board: { title: titleOf(plan.boards[0]), scope: dto.scope },
    counts: plan.counts,
    issues: plan.issues,
    references: dto.package.boards[0].package.references,
    resolved: resolveReferences(packages, env, titles),
    bundle: {
      boards: plan.boards.map((b) => ({ ref: b.ref, root: b.root, title: titleOf(b), counts: b.plan.counts, issues: b.plan.issues })),
      remap: plan.boards.map((b) => ({ ref: b.ref, title: titleOf(b), boardId: ids?.get(b.ref) ?? null })),
    },
  })
  if (dto.dryRun) return NextResponse.json({ dryRun: true, report: report() })

  await assertBoardHeadroom(tenantId, dto.scope, ctx.userId, plan.boards.length)
  const created = await DashboardBoardPackageService.applyBundle(tenantId, { userId: ctx.userId }, plan, { scope: dto.scope, title: dto.title, authoring: elementAuthoringFor(request, tenantId, ctx.session) })
  for (const [i, c] of created.entries()) {
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.import', resourceType: 'dashboard_board',
      resourceId: c.board.boardId,
      metadata: { ...plan.boards[i].plan.counts, issues: plan.boards[i].plan.issues.length, scope: dto.scope, bundle: plan.boards.length },
    })
  }
  const ids = new Map(created.map((c) => [c.ref, c.board.boardId]))
  return NextResponse.json({ dryRun: false, board: created[0].board, boards: created.map((c) => c.board), report: report(ids) }, { status: 201 })
}
