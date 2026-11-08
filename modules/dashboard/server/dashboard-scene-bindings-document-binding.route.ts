import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardSceneBindingService, { toSceneBindingView } from './scene-binding.service'
import { DocumentBindingQuerySchema, queryObject } from './scene-binding.dto'
import { DEVICE_ENTITY_TYPE } from './scene-binding'
import { readableSubjectTypes, sceneKindFor } from './scene-binding.access'
import { assertSubjectReadable } from './card-overlay.subject'
import { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings/document-binding?kind=&documentId=[&deviceIds=] — the links a drawing carries to a card that draws it as a picture of its own
 * (e2e run 1, E19): `{ binding?, document? }`. The binding is the ONE binding of the document such a card takes its links from when no binding of its own
 * subject is for that drawing (`DashboardSceneBindingService.forDocument`: with `deviceIds`, the devices the card shows, the one binding that names any of
 * them; without them the document's only binding; none when there are several, never a guess between two plants). `document` is the drawing's name and
 * fingerprint, as the resolve answer carries them. An empty answer: no binding to take.
 *
 * Gates, as the other scene reads: the board read access, the kind's own read permission (404 for an unknown kind, 403 without it), the device type's read
 * permission for `deviceIds` (`assertSubjectReadable`, 404 for a build without devices), and a binding found is answered only to a caller who may read its
 * subject's type (otherwise the same empty answer as none, so the answer names no subject the caller could not open). The caller's tenant only.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = DocumentBindingQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    const kind = await sceneKindFor(request, tenantId, q.kind, 'read')
    // the device type's read permission (the gate is the type's: one ask covers every id named)
    if (q.deviceIds?.length) await assertSubjectReadable(request, tenantId, { type: DEVICE_ENTITY_TYPE, id: q.deviceIds[0]! })
    const found = await DashboardSceneBindingService.forDocument(tenantId, q.kind, q.documentId, q.deviceIds ?? [])
    if (!found || !(await readableSubjectTypes(request, tenantId, ctx.session, [found.subjectType])).has(found.subjectType)) return NextResponse.json({})
    const id = found.documentId.toLowerCase()
    const document = (await kind.byIds({ tenantId, locale: await appLocaleOf(request, tenantId) }, [found.documentId])).find((d) => d.id.toLowerCase() === id) ?? null
    return NextResponse.json({ binding: toSceneBindingView(found), document })
  } catch (e) {
    return normalizeError(e)
  }
}
