import { NextRequest, NextResponse } from 'next/server'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardSceneBindingService from './scene-binding.service'
import { SlotsQuerySchema, queryObject } from './scene-binding.dto'
import { DEFAULT_SLOT } from './scene-binding'
import { BY_IDS_CAP, readableSubjectTypes, sceneKindFor } from './scene-binding.access'
import { listSceneKinds } from './scene-kinds'
import { assertSubjectReadable } from './card-overlay.subject'
import { subjectViewsOf, tenantSlotLabels, withStoredView } from './scene-binding.names'
import { sceneViewWords } from './scene-binding.words'
import { dashboardContext } from './dashboard.route.helpers'
import type { DashboardSceneKind } from './scene-binding.types'
import MSG from './dashboard.messages'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/** The order a subject's views are listed in: 2D drawings first (the Scene tab's preference), then 3D views, then any other kind. */
const KIND_ORDER = ['diagram', 'design']

/**
 * GET …/dashboard/scene-bindings/slots — the views a card's "Which view" setting offers, by NAME (docs/phases/07-dashboard/47; the slot is the value a card
 * stores, never what a person reads). Two answers:
 *
 *  - `?kind=` — the tenant-wide list, for a card whose subject is only known when its page runs (it follows the page's device): every slot the kind's
 *    bindings use in the tenant, `main` first and always present (the default every card draws): `{ slots: [{ slot, label }] }`. The label is the slot's
 *    place in the allocation order ("First 3D view", "3D view 2"; a slot named by hand: the kind's word) and the names of the drawings it holds, the most
 *    used first, counted only over the subject types the caller may read (as "used by" is), so no name hints at a subject the caller could not open.
 *  - `?subjectType=&subjectId=[&kind=]` — ONE subject's views (47.1): `{ views: [{ slot, kind, documentId, documentName, status, label }], slots: [{ slot,
 *    label }] }`, the label "3D view · Pool plant · Ankara" with "(2)" for a second view whose label would read the same (test 3 #34). Without `kind`, the views of
 *    every kind the caller may read; with it, only that kind (403 without its read permission), and `slots` then also offers `main` when the subject has
 *    no view in it yet (the card's default). A card that names its own device asks this way.
 *  - `&slot=` (with `kind`, either answer; phase 47 review R47-3) — the view the card stores: when the answer would not hold it (a slot typed by hand that the
 *    subject lacks, or that no binding uses any more), it is listed after the others as "3D view · not set up on this device" (on a subject) or with "not set
 *    up anywhere" (across the tenant), so the card's picker never falls back to showing the slot.
 *
 * Gates, as the other binding reads: the board's read access (static), the kind's own read permission, and for a subject the subject type's read
 * permission (`assertSubjectReadable`, as the subject listing of …/scene-bindings asks); every read is the caller's tenant. No new permission.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = SlotsQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    // the stored view is one of a kind: without the kind it names nothing
    if (q.slot !== undefined && !q.kind) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
    const kindCtx = { tenantId, locale: await appLocaleOf(request, tenantId) }

    if (q.subjectType !== undefined || q.subjectId !== undefined) {
      if (q.subjectType === undefined || q.subjectId === undefined) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
      const subject = { type: q.subjectType, id: q.subjectId }
      await assertSubjectReadable(request, tenantId, subject)
      const kinds = q.kind ? [{ key: q.kind, impl: await sceneKindFor(request, tenantId, q.kind, 'read') }] : await readableKinds(request, tenantId, ctx.session)
      const rows = (await DashboardSceneBindingService.listForSubject(tenantId, subject, q.kind ? { kind: q.kind } : {})).filter((r) => kinds.some((k) => k.key === r.kind))
      const names = await documentNames(kindCtx, kinds, rows.filter((r) => r.status === 'ok'))
      const words = await sceneViewWords(kindCtx.locale)
      const views = subjectViewsOf(rows, (kind, id) => names.get(`${kind}:${id.toLowerCase()}`) ?? null, words, KIND_ORDER)
      const listed = views.map((v) => ({ slot: v.slot, label: v.label }))
      if (q.kind && !listed.some((s) => s.slot === DEFAULT_SLOT)) listed.unshift({ slot: DEFAULT_SLOT, label: words.first(q.kind) })
      const slots = q.kind ? withStoredView(listed, q.kind, q.slot, subject.type, words) : listed
      return NextResponse.json({ views, slots })
    }

    if (!q.kind) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
    const kind = await sceneKindFor(request, tenantId, q.kind, 'read')
    const used = await DashboardSceneBindingService.listSlots(tenantId, q.kind)
    const groups = await DashboardSceneBindingService.slotDocuments(tenantId, q.kind)
    const readable = await readableSubjectTypes(request, tenantId, ctx.session, groups.map((g) => g.subjectType))
    const uses = groups.filter((g) => readable.has(g.subjectType))
    const names = await documentNames(kindCtx, [{ key: q.kind, impl: kind }], uses.map((u) => ({ kind: q.kind!, documentId: u.documentId })))
    const words = await sceneViewWords(kindCtx.locale)
    return NextResponse.json({ slots: tenantSlotLabels(q.kind, used, uses, (id) => names.get(`${q.kind}:${id.toLowerCase()}`) ?? null, words, q.slot) })
  } catch (e) {
    return normalizeError(e)
  }
}

/** Every scene kind active for the tenant whose read permission the caller holds (a subject's listing of every kind). */
async function readableKinds(request: NextRequest, tenantId: string, session: Parameters<typeof grantedPermissions>[0]['session']) {
  const all = await listSceneKinds(tenantId)
  const granted = await grantedPermissions({ request, tenantId, session, permissionIds: all.map((k) => k.impl.readPermission) })
  return all.filter((k) => granted.has(k.impl.readPermission))
}

/**
 * The names of the documents `rows` name, by `<kind>:<id>` (lower-case id): one `byIds` per kind (at most `BY_IDS_CAP` ids; the kind answers only what
 * exists in the tenant). A kind that cannot answer (its module failing) names nothing: its views then read by their kind's word alone.
 */
async function documentNames(
  kindCtx: { tenantId: string; locale: string }, kinds: ReadonlyArray<{ key: string; impl: DashboardSceneKind }>, rows: ReadonlyArray<{ kind: string; documentId: string }>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const k of kinds) {
    const ids = [...new Set(rows.filter((r) => r.kind === k.key).map((r) => r.documentId.toLowerCase()))].slice(0, BY_IDS_CAP)
    if (ids.length === 0) continue
    try {
      for (const d of await k.impl.byIds(kindCtx, ids)) names.set(`${k.key}:${d.id.toLowerCase()}`, d.name)
    } catch {
      // a kind whose module cannot answer names nothing; the views stay listed by their kind's word
    }
  }
  return names
}
