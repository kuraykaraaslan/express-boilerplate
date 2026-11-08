import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardSceneBindingService from './scene-binding.service'
import { DocumentsQuerySchema, MAX_LISTED_DOCUMENTS, queryObject } from './scene-binding.dto'
import { readableSubjectTypes, sceneKindFor } from './scene-binding.access'
import { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings/documents?kind=[&search=][&limit=] — the documents of one kind as the Scene drawer lists them (phase
 * 42.2.3): `{ documents: [{ id, name, updatedAt?, usedBy }], total, truncated }`, by name, at most 100. The documents come from the
 * kind through the registry (the dashboard reads no document table); `usedBy` is one grouped count over the binding index, counted
 * only over the subject types the caller may read, so a count never hints at a subject the caller could not open.
 *
 * Gates, as the other binding reads: the board's read access (static), then the kind's own read permission (404 for an unknown kind,
 * 403 without it) — no new permission.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = DocumentsQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    const kind = await sceneKindFor(request, tenantId, q.kind, 'read')
    const { rows, total } = await kind.list({ tenantId, locale: await appLocaleOf(request, tenantId) }, { search: q.search || undefined, limit: q.limit ?? MAX_LISTED_DOCUMENTS })
    const documents = rows.slice(0, MAX_LISTED_DOCUMENTS)
    const counts = await DashboardSceneBindingService.usedByCounts(tenantId, q.kind, documents.map((d) => d.id))
    const readable = await readableSubjectTypes(request, tenantId, ctx.session, counts.map((c) => c.subjectType))
    const usedBy = new Map<string, number>()
    for (const c of counts) if (readable.has(c.subjectType)) usedBy.set(c.documentId, (usedBy.get(c.documentId) ?? 0) + c.n)
    return NextResponse.json({
      documents: documents.map((d) => ({ id: d.id, name: d.name, ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}), usedBy: usedBy.get(d.id.toLowerCase()) ?? 0 })),
      total,
      truncated: total > documents.length,
    })
  } catch (e) {
    return normalizeError(e)
  }
}
