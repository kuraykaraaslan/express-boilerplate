import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardSceneBindingService, { toSceneBindingView } from './scene-binding.service'
import { ResolveQuerySchema, queryObject } from './scene-binding.dto'
import { sceneKindFor, walkSubjectTopology } from './scene-binding.access'
import { assertSubjectReadable } from './card-overlay.subject'
import { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings/resolve?subjectType=&subjectId=&kind=[&slot=][&cardDefault=true] — which scene a subject shows
 * (phase 42, D42-5): `{ rung, binding?, focusRole?, view?, viewNote? }` (`view`: what the card looks at, D42-6; `viewNote`: why a part of it was left out, a code held twice), `rung` one of `subject`, `ancestor`, `single-device`, `card-default`,
 * `placeholder`. The card says whether it has a default scene of its own (`cardDefault`). A subject without a row of its own is
 * walked through the topology seam (`dashboard:entity_relations` of iot_asset): a device up its asset path (nearest ancestor row
 * first), an asset down to its devices (one device = that device's row) and up its own path (a floor or a room under a bound building). Only for a caller who may read what the walk names.
 *
 * The same gates as the read of a subject's bindings: the board's read access, the subject type's read permission and the kind's.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = ResolveQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    const subject = { type: q.subjectType, id: q.subjectId }
    await assertSubjectReadable(request, tenantId, subject)
    const kind = await sceneKindFor(request, tenantId, q.kind, 'read')
    // the workspace's language (D576), never the browser's
    const locale = await appLocaleOf(request, tenantId)
    const answer = await DashboardSceneBindingService.resolve(tenantId, {
      subject, slot: q.slot, kind: q.kind, cardDefault: q.cardDefault,
      topology: () => walkSubjectTopology(request, tenantId, ctx.session, subject),
      keysOf: (documentId) => kind.keysOf({ tenantId, locale }, documentId),
    })
    // the document the binding names (its name and fingerprint), as the board-open answer carries it: the card compares the fingerprint with the one the binding was saved against (TK-6)
    const document = answer.binding
      ? (await kind.byIds({ tenantId, locale }, [answer.binding.documentId])).find((d) => d.id.toLowerCase() === answer.binding!.documentId.toLowerCase()) ?? null
      : undefined
    return NextResponse.json({
      rung: answer.rung,
      ...(answer.binding ? { binding: toSceneBindingView(answer.binding) } : {}),
      ...(document !== undefined ? { document } : {}),
      ...(answer.focusRole !== undefined ? { focusRole: answer.focusRole } : {}),
      ...(answer.view ? { view: answer.view } : {}),
      ...(answer.viewNote ? { viewNote: answer.viewNote } : {}),
    })
  } catch (e) {
    return normalizeError(e)
  }
}
