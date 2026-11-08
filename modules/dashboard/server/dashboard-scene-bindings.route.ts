import { NextRequest, NextResponse } from 'next/server'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardSceneBindingService, { toSceneBindingView } from './scene-binding.service'
import { SceneBindingQuerySchema, parseCreateSceneBinding, parseSetSceneBinding, queryObject } from './scene-binding.dto'
import { DEFAULT_SLOT, deviceIdsOf, fieldDeviceProblems, kindHasRuleShape, staleRuleTargets } from './scene-binding'
import { assertDevicesReadable, assertDocumentExists, readableSubjectTypes, sceneKindFor } from './scene-binding.access'
import { listSceneKinds } from './scene-kinds'
import { assertSubjectReadable } from './card-overlay.subject'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import MSG from './dashboard.messages'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings — the scene bindings of one subject (`?subjectType=&subjectId=`, optionally `&slot=` and `&kind=`),
 * or the subjects that use one document (`?kind=&documentId=`, "who uses this drawing"). Phase 42, D42-9.
 *
 * The entry gate is the board's read access, as the overlays have; each kind's own read permission then decides which rows a caller
 * sees (a subject's rows of a kind the caller may not read are left out; with `kind` named it is a 403), and the subject type's read
 * permission is asked for a subject, as for an overlay. "Who uses" lists only subjects of a type the caller may read.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = SceneBindingQuerySchema.parse(queryObject(request.nextUrl.searchParams))

    if (q.documentId !== undefined) {
      if (!q.kind || q.subjectType !== undefined || q.subjectId !== undefined || q.slot !== undefined || q.expectedRevision !== undefined) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
      await sceneKindFor(request, tenantId, q.kind, 'read')
      const { rows, truncated } = await DashboardSceneBindingService.listForDocument(tenantId, q.kind, q.documentId)
      // a subject the caller may not read is not named to them
      const readable = await readableSubjectTypes(request, tenantId, ctx.session, rows.map((r) => r.subjectType))
      // `truncated`: the list was cut at the cap before the subjects the caller may not read were left out, so it may be longer than shown
      return NextResponse.json({ bindings: rows.filter((r) => readable.has(r.subjectType)).map(toSceneBindingView), truncated })
    }

    if (q.subjectType === undefined || q.subjectId === undefined || q.expectedRevision !== undefined) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
    const subject = { type: q.subjectType, id: q.subjectId }
    await assertSubjectReadable(request, tenantId, subject)
    if (q.kind) await sceneKindFor(request, tenantId, q.kind, 'read')
    let rows = await DashboardSceneBindingService.listForSubject(tenantId, subject, { slot: q.slot, kind: q.kind })
    if (!q.kind && rows.length) {
      const kinds = await listSceneKinds(tenantId)
      const granted = await grantedPermissions({ request, tenantId, session: ctx.session, permissionIds: kinds.map((k) => k.impl.readPermission) })
      const readable = new Set(kinds.filter((k) => granted.has(k.impl.readPermission)).map((k) => k.key))
      rows = rows.filter((r) => readable.has(r.kind))
    }
    return NextResponse.json({ bindings: rows.map(toSceneBindingView) })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * PUT …/dashboard/scene-bindings — sets a subject's scene (phase 42, D42-9): body `{ subjectType, subjectId, slot?, kind, documentId,
 * devices?, map?, hidden?, view?, rules?, expectedRevision? }`, saved whole. The entry gate is the board's write access (any member may
 * reach it); the real gates follow: the kind's write permission, the subject type's read permission, the subject must exist, the
 * document must exist (through the kind) and every device must be a readable device of the tenant. 409 when another save came first.
 *
 * `rules` of a kind that has a rule shape (`design`, phase 42.6) are judged by that shape (400 / 422 with the problems). A rule that names a scene key
 * the document does not have (or a row of one) is NOT refused and NOT dropped: it is saved as given, and the answer carries `warnings.rulesStaleTargets`
 * (`[{ index, field, name }]`) so the editor can flag it; the card ignores such a rule.
 *
 * `map` entries (phase 45, D45-3) may carry `fields` beside or instead of the element shortcut: each symbol field read from a telemetry key of one of the
 * scene's devices. A field whose device is not one of `devices` is a 422 whose `details.problems` name the key and the field (SM2-4). A field map that
 * names a scene key the document does not have is kept like a stale exception (the card skips it, the drawer lists it), never dropped.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    const dto = parseSetSceneBinding(await request.json())
    const subject = { type: dto.subjectType, id: dto.subjectId }
    // phase 45 (SM2-4): a field reads one of the scene's own devices; the message names the key and the field (422, as an unknown device is)
    const fieldDevices = fieldDeviceProblems({ devices: dto.devices, map: dto.map })
    if (fieldDevices.length) throw new AppError(MSG.SCENE_FIELD_DEVICE_UNBOUND, 422, ErrorCode.VALIDATION_ERROR, { details: { problems: fieldDevices } })
    const kind = await sceneKindFor(request, tenantId, dto.kind, 'write')
    await assertSubjectReadable(request, tenantId, subject, { mustExist: true, unknownMessage: MSG.SCENE_SUBJECT_UNKNOWN })
    const doc = await assertDocumentExists(request, tenantId, kind, dto.documentId)
    await assertDevicesReadable(request, tenantId, deviceIdsOf({ devices: dto.devices, map: dto.map }))
    const stale = await staleTargetsOf(request, tenantId, kind, dto)
    const { binding, created } = await DashboardSceneBindingService.set(tenantId, subject, {
      slot: dto.slot, kind: dto.kind, documentId: dto.documentId, documentHash: doc.hash,
      devices: dto.devices, map: dto.map, hidden: dto.hidden ?? null, view: dto.view ?? null, rules: dto.rules ?? null,
    }, ctx.userId, dto.expectedRevision)
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.scene_binding.set', resourceType: 'dashboard_scene_binding', resourceId: binding.bindingId,
      metadata: {
        subjectType: subject.type, subjectId: subject.id, slot: dto.slot, kind: dto.kind, documentId: dto.documentId, revision: binding.revision, created,
        ...(dto.rules ? { rules: dto.rules.length, ...(stale.length ? { staleRuleTargets: stale.length } : {}) } : {}),
      },
    })
    return NextResponse.json({ binding: toSceneBindingView(binding), ...(stale.length ? { warnings: { rulesStaleTargets: stale } } : {}) })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/scene-bindings — adds a NEW view to a subject (47.1, D106): body `{ subjectType, subjectId, kind, documentId, devices?, map?, hidden?, view?,
 * rules? }`, no slot. The server stores it in the next free slot of that subject and kind (`main` while it is free, then `view_2`, `view_3` …), so "Add a 3D view"
 * and "Add a drawing" never ask a person to name anything; the answer carries the slot it was given. The gates are a save's: the board's write access, the
 * kind's write permission, the subject type's read permission, the subject, the document and every device must exist. 201 with the binding (revision 1); 422
 * when the subject already holds `MAX_SUBJECT_VIEWS` views of the kind.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    const dto = parseCreateSceneBinding(await request.json())
    const subject = { type: dto.subjectType, id: dto.subjectId }
    const fieldDevices = fieldDeviceProblems({ devices: dto.devices, map: dto.map })
    if (fieldDevices.length) throw new AppError(MSG.SCENE_FIELD_DEVICE_UNBOUND, 422, ErrorCode.VALIDATION_ERROR, { details: { problems: fieldDevices } })
    const kind = await sceneKindFor(request, tenantId, dto.kind, 'write')
    await assertSubjectReadable(request, tenantId, subject, { mustExist: true, unknownMessage: MSG.SCENE_SUBJECT_UNKNOWN })
    const doc = await assertDocumentExists(request, tenantId, kind, dto.documentId)
    await assertDevicesReadable(request, tenantId, deviceIdsOf({ devices: dto.devices, map: dto.map }))
    const stale = await staleTargetsOf(request, tenantId, kind, dto)
    const { binding } = await DashboardSceneBindingService.create(tenantId, subject, {
      kind: dto.kind, documentId: dto.documentId, documentHash: doc.hash,
      devices: dto.devices, map: dto.map, hidden: dto.hidden ?? null, view: dto.view ?? null, rules: dto.rules ?? null,
    }, ctx.userId)
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.scene_binding.set', resourceType: 'dashboard_scene_binding', resourceId: binding.bindingId,
      metadata: {
        subjectType: subject.type, subjectId: subject.id, slot: binding.slot, kind: dto.kind, documentId: dto.documentId, revision: binding.revision, created: true, allocated: true,
        ...(dto.rules ? { rules: dto.rules.length, ...(stale.length ? { staleRuleTargets: stale.length } : {}) } : {}),
      },
    })
    return NextResponse.json({ binding: toSceneBindingView(binding), ...(stale.length ? { warnings: { rulesStaleTargets: stale } } : {}) }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}

/** The names `dto.rules` use that the document has no equipment key for (best effort: a document whose keys cannot be read flags nothing). */
async function staleTargetsOf(
  request: NextRequest, tenantId: string, kind: Awaited<ReturnType<typeof sceneKindFor>>, dto: { kind: string; documentId: string; rules?: Array<Record<string, unknown>> | null },
) {
  if (!dto.rules || dto.rules.length === 0 || !kindHasRuleShape(dto.kind)) return []
  try {
    const keys = await kind.keysOf({ tenantId, locale: await appLocaleOf(request, tenantId) }, dto.documentId)
    // levels and rooms are no equipment: an item is what an override can reach
    return staleRuleTargets(dto.kind, dto.rules, keys.filter((k) => k.kind !== 'level' && k.kind !== 'room').map((k) => k.key))
  } catch {
    return []
  }
}

/**
 * DELETE …/dashboard/scene-bindings?subjectType=&subjectId=&kind=[&slot=][&expectedRevision=] — the subject falls back to the next
 * rung (D42-5). `expectedRevision` is the revision the editor holds (0: none); another one is a 409 naming the stored revision, as a save.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    const q = SceneBindingQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    if (q.subjectType === undefined || q.subjectId === undefined || !q.kind || q.documentId !== undefined) throw new AppError(MSG.SCENE_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
    const subject = { type: q.subjectType, id: q.subjectId }
    const slot = q.slot ?? DEFAULT_SLOT
    await sceneKindFor(request, tenantId, q.kind, 'write')
    await assertSubjectReadable(request, tenantId, subject, { unknownMessage: MSG.SCENE_SUBJECT_UNKNOWN })
    const removed = await DashboardSceneBindingService.reset(tenantId, subject, slot, q.kind, q.expectedRevision)
    if (removed) {
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.scene_binding.reset', resourceType: 'dashboard_scene_binding', resourceId: removed.bindingId,
        metadata: { subjectType: subject.type, subjectId: subject.id, slot, kind: q.kind, documentId: removed.documentId, revision: removed.revision },
      })
    }
    return NextResponse.json({ ok: true, removed: !!removed })
  } catch (e) {
    return normalizeError(e)
  }
}
