import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { DocumentKeysQuerySchema, MAX_LISTED_KEYS, queryObject } from './scene-binding.dto'
import { assertDocumentExists, sceneKindFor } from './scene-binding.access'
import { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings/document-keys?kind=&documentId= — the keys of one document, the equipment the Scene drawer matches to
 * the devices' elements (phase 42.2.3): `{ keys: [{ key, label, kind, catalogue? }], truncated, hash }`, at most 2 000 keys; `hash` is the document's current fingerprint (null: the kind has none), which the drawer compares with the one the binding was saved against (TK-6). `keysOf` of the kind
 * through the registry; a document that does not exist in the tenant is a 422 (the same answer as a save naming it), never an empty list.
 *
 * Gates: the board's read access (static), then the kind's own read permission; no new permission.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = DocumentKeysQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    const kind = await sceneKindFor(request, tenantId, q.kind, 'read')
    const doc = await assertDocumentExists(request, tenantId, kind, q.documentId)
    const keys = await kind.keysOf({ tenantId, locale: await appLocaleOf(request, tenantId) }, q.documentId)
    return NextResponse.json({ keys: keys.slice(0, MAX_LISTED_KEYS), truncated: keys.length > MAX_LISTED_KEYS, hash: doc.hash })
  } catch (e) {
    return normalizeError(e)
  }
}
