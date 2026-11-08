import type { NextRequest } from 'next/server'
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { selectEntityRelations, selectEntityType } from './entity-types'
import { selectSceneKind } from './scene-kinds'
import { DEVICE_ENTITY_TYPE, ASSET_ENTITY_TYPE } from './scene-binding'
import type { CardSubject } from './card-overlay'
import type { DashboardSceneKind, SceneDocumentRef } from './scene-binding.types'
import MSG from './dashboard.messages'
import { appLocaleOf } from './board-template.locale'

/**
 * The checks a scene binding's routes make beyond the board's own gate (phase 42, D42-9). The kind and the entity types come from the
 * registry, so nothing here reads another module's table; each check is the contribution's own permission, asked for the caller.
 */

/** The scene kind of a request, the caller holding its read or its write permission (404 for an unknown kind, 403 without it). */
export async function sceneKindFor(request: NextRequest, tenantId: string, key: string, mode: 'read' | 'write'): Promise<DashboardSceneKind> {
  const kind = await selectSceneKind(tenantId, key)
  await authorizeRequest({ request, tenantId, requiredPermission: mode === 'read' ? kind.readPermission : kind.writePermission, scope: 'TENANT' })
  return kind
}

/**
 * Which of the subject types the caller may read (each type's own read permission, asked through the registry): a type nothing
 * contributes any more, or one the caller may not read, is left out, so a count or a list never names a subject the caller could not open.
 */
export async function readableSubjectTypes(
  request: NextRequest, tenantId: string, session: Parameters<typeof grantedPermissions>[0]['session'], types: Iterable<string>,
): Promise<Set<string>> {
  const needs = new Map<string, string>()
  for (const t of new Set(types)) {
    try { needs.set(t, (await selectEntityType(tenantId, t)).requiredPermission) } catch { /* a type nothing contributes any more: its rows are not listed */ }
  }
  if (needs.size === 0) return new Set()
  const granted = await grantedPermissions({ request, tenantId, session, permissionIds: [...new Set(needs.values())] })
  return new Set([...needs].filter(([, permission]) => granted.has(permission)).map(([type]) => type))
}

/** The document of a binding, which must exist in the tenant (422 otherwise). */
export async function assertDocumentExists(request: NextRequest, tenantId: string, kind: DashboardSceneKind, documentId: string): Promise<SceneDocumentRef> {
  const found = await kind.byIds({ tenantId, locale: await appLocaleOf(request, tenantId) }, [documentId])
  const doc = found.find((d) => d.id.toLowerCase() === documentId.toLowerCase())
  if (!doc) throw new AppError(MSG.SCENE_DOCUMENT_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR)
  return doc
}

/**
 * Every device a binding names must be a device of the tenant the caller may read (422 otherwise): the device entity type's read
 * permission is asked first, so a binding cannot be used to learn which device ids exist.
 */
export async function assertDevicesReadable(request: NextRequest, tenantId: string, deviceIds: readonly string[]): Promise<void> {
  if (deviceIds.length === 0) return
  const type = await selectEntityType(tenantId, DEVICE_ENTITY_TYPE)
  await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
  const ctx = { tenantId, locale: await appLocaleOf(request, tenantId) }
  const found = new Set<string>()
  // the entity type answers at most BY_IDS_CAP ids at a time (it cuts the rest silently, which would read as "unknown device")
  for (let i = 0; i < deviceIds.length; i += BY_IDS_CAP) {
    for (const e of await type.byIds(ctx, deviceIds.slice(i, i + BY_IDS_CAP))) found.add(e.id.toLowerCase())
  }
  if (deviceIds.some((id) => !found.has(id.toLowerCase()))) throw new AppError(MSG.SCENE_DEVICE_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR)
}

/** The most ids one `byIds` call of an entity type is given (the iot_device and iot_asset types read 500 and drop the rest). */
export const BY_IDS_CAP = 500

/** The asset path above a device, at most this long (the provider walks at most 10 levels). */
export const MAX_ANCESTOR_ASSETS = 20
/** Devices under an asset are read up to this many: two are enough to tell one from many, the rest only say "many". */
export const MAX_DEVICES_UNDER = 101
const TOPOLOGY_PROVIDER = 'iot_asset'
const WALK_LIMIT = 1_000

/** A contribution that is not there (404) or whose module is off for the tenant (409) is a walk that cannot be made, not an error. */
async function orNone<T>(p: Promise<T>): Promise<T | null> {
  try { return await p } catch (e) {
    if (e instanceof AppError && (e.statusCode === 404 || e.statusCode === 409)) return null
    throw e
  }
}

/**
 * What the resolver needs of the topology (D42-5, D42-6), read through the registry seams only (`dashboard:entity_relations` and the entity
 * types), never a table of another module:
 *
 *  - the assets that contain the subject, nearest first (a `CONTAINS` walk in direction `to`, at most `MAX_ANCESTOR_ASSETS`), each one an
 *    asset that exists and the caller may read: for a device its placement and what is above it, for an asset what is above it (a floor
 *    or a room under a bound building). `assetCodes` names each of them, and the subject itself when it is an asset, by the entity type's
 *    `label` (an asset's code, D42-4), so the caller can work out the page's view;
 *  - for an asset: the devices under it (a `CONTAINS` walk in direction `from`), existing and readable, at most `MAX_DEVICES_UNDER`.
 *    When the walk was cut before it could tell one device from several, no device is named: a placeholder, never a guess.
 *
 * The caller must hold the provider's permission and each entity type's read permission; without them (or without the provider)
 * the walk is empty and the subject falls through to the card's default, so a binding is never a way to learn what is not readable.
 */
export interface SubjectTopology {
  ancestorAssetIds?: string[]
  deviceIds?: string[]
  /** An asset's code by id, for the ancestors (and the subject when it is an asset): the path the page's view is derived from. */
  assetCodes?: Record<string, string>
}

export async function walkSubjectTopology(
  request: NextRequest, tenantId: string, session: Parameters<typeof grantedPermissions>[0]['session'], subject: CardSubject,
  /** Which of the permissions the caller holds; the session's own answer by default, a display link asks it as the issuer through the display. */
  allowed?: (permissionIds: string[]) => Promise<ReadonlySet<string>>,
): Promise<SubjectTopology> {
  const isDevice = subject.type === DEVICE_ENTITY_TYPE
  const isAsset = subject.type === ASSET_ENTITY_TYPE
  if (!isDevice && !isAsset) return {}
  const provider = await orNone(selectEntityRelations(tenantId, TOPOLOGY_PROVIDER))
  const assetType = await orNone(selectEntityType(tenantId, ASSET_ENTITY_TYPE))
  const deviceType = isAsset ? await orNone(selectEntityType(tenantId, DEVICE_ENTITY_TYPE)) : null
  if (!provider || !assetType || (isAsset && !deviceType)) return {}
  const needs = [...new Set([provider.requiredPermission, assetType.requiredPermission, ...(deviceType ? [deviceType.requiredPermission] : [])])]
  const granted = allowed ? await allowed(needs) : await grantedPermissions({ request, tenantId, session, permissionIds: needs })
  if (!needs.every((p) => granted.has(p))) return {}
  const ctx = { tenantId, locale: await appLocaleOf(request, tenantId) }

  const found = await provider.query(ctx, {
    root: { type: subject.type, id: subject.id }, direction: 'to', maxLevel: 10, lastLevelOnly: false,
    filters: [{ relationType: 'CONTAINS', entityTypes: [ASSET_ENTITY_TYPE] }], limit: MAX_ANCESTOR_ASSETS,
  })
  const wanted = [...new Set(found.filter((r) => r.type === ASSET_ENTITY_TYPE).map((r) => r.id.toLowerCase()))].slice(0, MAX_ANCESTOR_ASSETS)
  // the subject asset is read with its ancestors (its code is the last step of the path); a subject that is not an asset of the tenant adds nothing
  const refs = wanted.length || isAsset ? await assetType.byIds(ctx, isAsset ? [...wanted, subject.id.toLowerCase()] : wanted) : []
  const byId = new Map(refs.map((e) => [e.id.toLowerCase(), e]))
  const ancestorAssetIds = wanted.filter((id) => byId.has(id))
  const assetCodes: Record<string, string> = {}
  for (const id of [...ancestorAssetIds, ...(isAsset ? [subject.id.toLowerCase()] : [])]) {
    const code = byId.get(id)?.label
    if (code) assetCodes[id] = code
  }
  const top: SubjectTopology = { ancestorAssetIds, assetCodes }
  if (isDevice) return top

  const below = await provider.query(ctx, {
    root: { type: subject.type, id: subject.id }, direction: 'from', maxLevel: 10, lastLevelOnly: false,
    filters: [{ relationType: 'CONTAINS' }], limit: WALK_LIMIT,
  })
  const ids = [...new Set(below.filter((r) => r.type === DEVICE_ENTITY_TYPE).map((r) => r.id.toLowerCase()))]
  const cut = below.length >= WALK_LIMIT
  const exist = new Set((ids.length ? await deviceType!.byIds(ctx, ids.slice(0, MAX_DEVICES_UNDER)) : []).map((e) => e.id.toLowerCase()))
  const deviceIds = ids.slice(0, MAX_DEVICES_UNDER).filter((id) => exist.has(id))
  return { ...top, deviceIds: cut && deviceIds.length < 2 ? [] : deviceIds }
}
