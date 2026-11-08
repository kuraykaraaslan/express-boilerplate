import { NextRequest, NextResponse } from 'next/server'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardSceneBindingService from './scene-binding.service'
import { BULK_CHUNK, BULK_MAX_DEVICES, BulkBindDTO, BulkCountQuerySchema, queryObject } from './scene-binding.dto'
import { DEVICE_ENTITY_TYPE, copiedMapFor, twinIndexMap } from './scene-binding'
import { scanUnboundDevices, type BulkScan } from './scene-binding.bulk-scan'
import { assertDocumentExists, sceneKindFor } from './scene-binding.access'
import { selectEntityType } from './entity-types'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import MSG from './dashboard.messages'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/** The most pages one call reads (of `BULK_MAX_DEVICES` devices each): 10 000 devices looked at, however many of them are bound already. */
const BULK_MAX_PAGES = 20

/**
 * The next `BULK_MAX_DEVICES` UNBOUND devices of one profile the caller may read, through the device entity type of the registry (its read
 * permission asked first, so a bulk call is no way to learn which devices exist). The devices are paged by name (`offset` of the entity type)
 * and the ones that already have a binding for (slot, kind) are left out as each page comes, so a profile of more than 500 devices is
 * finished by repeated calls: each takes the next 500 that still have none (`scanUnboundDevices`).
 */
async function unboundDevicesOfProfile(request: NextRequest, tenantId: string, profileId: string, slot: string, kind: string): Promise<BulkScan> {
  const type = await selectEntityType(tenantId, DEVICE_ENTITY_TYPE)
  await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
  const locale = await appLocaleOf(request, tenantId)
  return scanUnboundDevices({
    pageSize: BULK_MAX_DEVICES,
    maxUnbound: BULK_MAX_DEVICES,
    maxPages: BULK_MAX_PAGES,
    page: async (offset) => {
      const { rows, total } = await type.find({ tenantId, locale }, { subtypes: [profileId], limit: BULK_MAX_DEVICES, ...(offset > 0 ? { offset } : {}) })
      return { ids: rows.slice(0, BULK_MAX_DEVICES).map((r) => r.id.toLowerCase()), total }
    },
    boundAmong: (ids) => DashboardSceneBindingService.boundAmong(tenantId, DEVICE_ENTITY_TYPE, ids, slot, kind),
  })
}

/**
 * GET …/dashboard/scene-bindings/bulk?profileId=&kind=[&slot=] — how many devices of a profile have no binding for (slot, kind) yet
 * (phase 42.3.2, D42-7): `{ devices, unbound, total, truncated }`. `unbound` is what the next POST would bind (at most `BULK_MAX_DEVICES`: the
 * next unbound devices by name, the bound ones passed over), `devices` how many devices were looked at to find them, `total` the profile's whole
 * count, `truncated` that there may be more devices not looked at (so more unbound ones can follow a run). Gates: the board's read access,
 * the kind's read permission, the device type's read permission.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const parsed = BulkCountQuerySchema.safeParse(queryObject(request.nextUrl.searchParams))
    if (!parsed.success) throw new AppError(MSG.SCENE_BULK_QUERY_INVALID, 400, ErrorCode.VALIDATION_ERROR)
    const q = parsed.data
    await sceneKindFor(request, tenantId, q.kind, 'read')
    const scan = await unboundDevicesOfProfile(request, tenantId, q.profileId, q.slot, q.kind)
    return NextResponse.json({ devices: scan.scanned, unbound: scan.unbound.length, total: scan.total, truncated: scan.truncated })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/scene-bindings/bulk — the bulk action of D42-7 (phase 42.3.2): body `{ subjectType: 'iot_device', profileId, kind, slot?,
 * documentId, mapFrom?, copyMap?, copyFrom? }` binds every device of the profile that has NO binding for (slot, kind) to the document, each with itself in the
 * main role and revision 1. It never overwrites a row and never writes a profile-level default: a device that already has a binding is
 * `skipped`, so a second call binds nothing. Each call takes the next `BULK_MAX_DEVICES` devices (by name) that have none, passing over the
 * bound ones, so a profile of any size is finished by repeated calls; `truncated` says there may be more to look at. `{ bound, skipped,
 * truncated }`, `skipped` the devices looked at that were not newly bound.
 *
 * Gates: the board's write access (static), the kind's WRITE permission, the device type's read permission (the devices are read through
 * it), and the document must exist (through the kind). Written in chunks of `BULK_CHUNK`, one transaction each, and audited ONCE for the
 * whole call (`dashboard.scene_binding.bulk`, with the counts), not once per device.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    const dto = BulkBindDTO.parse(await request.json())
    const kind = await sceneKindFor(request, tenantId, dto.kind, 'write')
    const scan = await unboundDevicesOfProfile(request, tenantId, dto.profileId, dto.slot, dto.kind)
    const ids = scan.unbound
    const doc = await assertDocumentExists(request, tenantId, kind, dto.documentId)
    const keys = dto.mapFrom === 'twin-index' ? await kind.keysOf({ tenantId, locale: await appLocaleOf(request, tenantId) }, dto.documentId) : []
    const audit = (bound: number, extra: Record<string, unknown>) => auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.scene_binding.bulk', resourceType: 'dashboard_scene_binding', resourceId: dto.profileId,
      metadata: {
        subjectType: DEVICE_ENTITY_TYPE, profileId: dto.profileId, slot: dto.slot, kind: dto.kind, documentId: dto.documentId, mapFrom: dto.mapFrom, bound,
        ...(dto.copyMap ? { copiedEntries: Object.keys(dto.copyMap).length, ...(dto.copyFrom ? { copyFrom: dto.copyFrom } : {}) } : {}), ...extra,
      },
    })
    // phase 45 slice 16 (D45-5): the connections of one device applied to the devices bound by this call, on top of the identity / twin-index map
    const copied = dto.copyMap ? (deviceId: string) => copiedMapFor(dto.copyMap!, dto.copyFrom, deviceId) : null
    const baseMapOf = dto.mapFrom === 'twin-index' ? (deviceId: string) => twinIndexMap(keys, deviceId) : () => ({})
    const mapOf = copied ? (deviceId: string) => ({ ...baseMapOf(deviceId), ...copied(deviceId) }) : baseMapOf
    // each chunk commits on its own: when a later one fails the earlier ones stay written, so the audit row says how many (once, never one per chunk)
    let written = 0
    let result: { bound: number; skipped: number }
    try {
      result = await DashboardSceneBindingService.bulkBindDevices(tenantId, {
        kind: dto.kind, slot: dto.slot, documentId: dto.documentId, documentHash: doc.hash, deviceIds: ids, userId: ctx.userId, chunk: BULK_CHUNK,
        mapOf,
        onChunk: (n) => { written += n },
      })
    } catch (e) {
      if (written > 0) await audit(written, { skipped: null, failed: true })
      throw e
    }
    if (result.bound > 0) await audit(result.bound, { skipped: result.skipped })
    // `skipped`: looked at and not written by this call (already bound when read, or bound by a save that came in between)
    return NextResponse.json({ bound: result.bound, skipped: scan.scanned - result.bound, truncated: scan.truncated })
  } catch (e) {
    return normalizeError(e)
  }
}
