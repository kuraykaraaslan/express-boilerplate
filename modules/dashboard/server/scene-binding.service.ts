import 'reflect-metadata'
import { In, type QueryRunner, type Repository } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardSceneBinding } from './entities/dashboard_scene_binding.entity'
import type { CardSubject } from './card-overlay'
import { DEVICE_ENTITY_TYPE, MAX_SUBJECT_VIEWS, bindingProblems, fieldDeviceProblems, nextFreeSlot, type SceneBindingBody, type SceneMapEntry } from './scene-binding'
import { resolveSceneBinding, type SceneResolution } from './scene-binding.resolve'
import { deriveViewOf, type SceneView, type SceneViewNote } from './scene-binding.view'
import type { SceneKeyRef } from './scene-binding.types'
import type { SubjectTopology } from './scene-binding.access'
import MSG from './dashboard.messages'

/** What a viewer reads of one binding. */
export interface SceneBindingView {
  bindingId: string
  subjectType: string
  subjectId: string
  slot: string
  kind: string
  documentId: string
  documentHash: string | null
  devices: Record<string, string>
  /** As stored (phase 45.2.4): an entry's `fields` reach the cards unchanged through the open, resolve and display answers. */
  map: Record<string, SceneMapEntry>
  hidden: string[] | null
  view: { level?: string; focus?: string } | null
  rules: Array<Record<string, unknown>> | null
  status: 'ok' | 'unresolved'
  revision: number
  updatedAt: string
}

export const toSceneBindingView = (b: DashboardSceneBinding): SceneBindingView => ({
  bindingId: b.bindingId,
  subjectType: b.subjectType,
  subjectId: b.subjectId,
  slot: b.slot,
  kind: b.kind,
  documentId: b.documentId,
  documentHash: b.documentHash ?? null,
  devices: b.devices ?? {},
  map: b.map ?? {},
  hidden: b.hidden ?? null,
  view: b.view ?? null,
  rules: b.rules ?? null,
  status: b.status,
  revision: b.revision,
  updatedAt: (b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt)).toISOString(),
})

/** "Who uses this document" never lists more than this many subjects. */
export const MAX_DOCUMENT_USERS = 500
/** The slot names a kind's bindings list at most this many of. */
export const MAX_LISTED_SLOTS = 100
/** "Used by" is counted for at most this many documents of one list (the kinds list at most 100). */
export const MAX_COUNTED_DOCUMENTS = 200
/** The (slot, document, subject type) groups the tenant-wide view list reads at most (47.3). */
export const MAX_SLOT_DOCUMENT_ROWS = 1000

/** An asset path is a handful of levels deep; a longer list from a caller is cut here. */
const MAX_ANCESTORS = 20

/** Whether a binding names a device (lower case): one of its roles, or the device it is the binding of. Pure. */
export function bindingNamesDevice(b: Pick<DashboardSceneBinding, 'subjectType' | 'subjectId' | 'devices'>, deviceId: string): boolean {
  const id = deviceId.toLowerCase()
  if (b.subjectType === DEVICE_ENTITY_TYPE && b.subjectId.toLowerCase() === id) return true
  return Object.values(b.devices ?? {}).some((d) => typeof d === 'string' && d.toLowerCase() === id)
}

/** What the service answers for one subject: the resolver's rung and row, and the view the card looks at (42.4.1). */
export type ResolvedScene = SceneResolution<DashboardSceneBinding> & {
  view?: SceneView
  /** Why a part of the view was left out (a code the document or the path holds twice): the answer exposes it, so a page can say so (42.4.1). */
  viewNote?: SceneViewNote
}

const key = (s: CardSubject, slot: string, kind: string) => `${s.type}:${s.id}:${slot}:${kind}`

/** The advisory lock of one binding: the tenant is in the key, so two tenants that use the same subject id never wait for each other. */
const lockKey = (tenantId: string, s: CardSubject, slot: string, kind: string) => `dashboard:scene_binding:${tenantId}:${key(s, slot, kind)}`
/**
 * The advisory lock of the slot allocation of one subject and kind (47.1): two creates of the same subject and kind run one after the other, so they
 * never pick the same free slot. Taken BEFORE a binding's own lock and never while holding one, so it never waits crosswise with a save.
 */
const allocationLockKey = (tenantId: string, s: CardSubject, kind: string) => `dashboard:scene_binding_alloc:${tenantId}:${s.type}:${s.id}:${kind}`

/** 409 unless `expected` (absent: no check; 0: no binding) is the stored revision. */
function assertRevision(expected: number | undefined, stored: { revision: number } | null): void {
  if (expected !== undefined && expected !== (stored?.revision ?? 0)) {
    throw new AppError(MSG.SCENE_BINDING_CONFLICT, 409, ErrorCode.CONFLICT, { details: { revision: stored?.revision ?? 0 } })
  }
}

/**
 * Scene bindings (docs/phases/07-dashboard/42). Who may read or write them, whether the subject, the document and the devices exist, is
 * the route's call (the kind's permissions, the subject type's read permission, the contributed kinds); this service keeps the rows,
 * the revision and the caps. Every read and write is tenant-scoped (RLS).
 */
export default class DashboardSceneBindingService {
  /** A subject's bindings, optionally of one slot and kind. */
  static async listForSubject(tenantId: string, subject: CardSubject, opts: { slot?: string; kind?: string } = {}): Promise<DashboardSceneBinding[]> {
    return withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.find({
      where: {
        tenantId, subjectType: subject.type, subjectId: subject.id,
        ...(opts.slot ? { slot: opts.slot } : {}), ...(opts.kind ? { kind: opts.kind } : {}),
      },
      order: { slot: 'ASC', kind: 'ASC' },
    }))
  }

  /**
   * Who uses a document (the subjects with a binding to it), at most `MAX_DOCUMENT_USERS`; `truncated` says there were more, so the
   * caller can tell a short list from a cut one (the caller's own filtering happens after the cut).
   */
  static async listForDocument(tenantId: string, kind: string, documentId: string): Promise<{ rows: DashboardSceneBinding[]; truncated: boolean }> {
    const found = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.find({
      where: { tenantId, kind, documentId },
      order: { subjectType: 'ASC', subjectId: 'ASC', slot: 'ASC' },
      take: MAX_DOCUMENT_USERS + 1,
    }))
    return { rows: found.slice(0, MAX_DOCUMENT_USERS), truncated: found.length > MAX_DOCUMENT_USERS }
  }

  /**
   * The ONE binding whose links a drawing carries to a card that draws it as a picture of its own (e2e run 1, E19: a board card that kept its own drawing
   * drew it grey, the drawing's links stayed on the site's or the device's Views). Among the `ok` bindings of the document, whatever their subject and slot:
   * with `deviceIds` (the devices the card shows) the one that names any of them, in its roles or as its subject; without them the document's only one.
   * Null when there is no such binding, when there are several (two plants on one drawing are never guessed between) and when the document has more than
   * `MAX_DOCUMENT_USERS` bindings (the choice could not be told). The candidates are read without their maps and rules; the chosen row is read whole.
   */
  static async forDocument(tenantId: string, kind: string, documentId: string, deviceIds: readonly string[] = []): Promise<DashboardSceneBinding | null> {
    const candidates = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.find({
      select: { bindingId: true, subjectType: true, subjectId: true, devices: true },
      where: { tenantId, kind, documentId, status: 'ok' },
      order: { subjectType: 'ASC', subjectId: 'ASC', slot: 'ASC' },
      take: MAX_DOCUMENT_USERS + 1,
    }))
    if (candidates.length > MAX_DOCUMENT_USERS) return null
    const devices = deviceIds.map((d) => d.toLowerCase())
    const fits = devices.length === 0 ? candidates : candidates.filter((b) => devices.some((d) => bindingNamesDevice(b, d)))
    if (fits.length !== 1) return null
    return withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.findOne({ where: { tenantId, bindingId: fits[0].bindingId, status: 'ok' } }))
  }

  /**
   * How many subjects use each of `documentIds` (one grouped query over the document index, tenant-scoped), per subject type so the
   * caller can count only the types it may read. At most `MAX_COUNTED_DOCUMENTS` ids are counted (the rest are not asked for), so
   * the answer is at most that many ids times the subject types in use, never a scan of every binding of the kind.
   */
  static async usedByCounts(tenantId: string, kind: string, documentIds: readonly string[]): Promise<Array<{ documentId: string; subjectType: string; n: number }>> {
    const ids = [...new Set(documentIds.map((id) => id.toLowerCase()))].slice(0, MAX_COUNTED_DOCUMENTS)
    if (ids.length === 0) return []
    const rows = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.createQueryBuilder('b')
      .select('b."documentId"', 'documentId')
      .addSelect('b."subjectType"', 'subjectType')
      .addSelect('COUNT(*)', 'n')
      .where('b."tenantId" = :tenantId AND b."kind" = :kind AND b."documentId" IN (:...ids)', { tenantId, kind, ids })
      .groupBy('b."documentId"')
      .addGroupBy('b."subjectType"')
      .getRawMany<{ documentId: string; subjectType: string; n: string }>())
    return rows.map((r) => ({ documentId: r.documentId.toLowerCase(), subjectType: r.subjectType, n: Number(r.n) }))
  }

  /**
   * The slot names a kind's bindings use in the tenant, sorted, at most `MAX_LISTED_SLOTS` (a slot is a short name, so a tenant has a handful):
   * what the design card's slot setting offers. Names only, no subject and no count, so it hints at nothing the caller could not read.
   */
  static async listSlots(tenantId: string, kind: string): Promise<string[]> {
    const rows = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.createQueryBuilder('b')
      .select('b."slot"', 'slot')
      .where('b."tenantId" = :tenantId AND b."kind" = :kind', { tenantId, kind })
      .groupBy('b."slot"')
      .orderBy('b."slot"', 'ASC')
      .limit(MAX_LISTED_SLOTS)
      .getRawMany<{ slot: string }>())
    return rows.map((r) => r.slot)
  }

  /**
   * Which documents the bindings of a kind use in each slot of the tenant, per subject type, with how many (one grouped query over the tenant's rows
   * of the kind, sorted by slot, at most `MAX_SLOT_DOCUMENT_ROWS` groups): what the tenant-wide view list names a slot by (47.3: "the views in use
   * across the tenant by name instead of codes"). The caller counts only the subject types it may read, as "used by" does.
   */
  static async slotDocuments(tenantId: string, kind: string): Promise<Array<{ slot: string; documentId: string; subjectType: string; n: number }>> {
    const rows = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.createQueryBuilder('b')
      .select('b."slot"', 'slot')
      .addSelect('b."documentId"', 'documentId')
      .addSelect('b."subjectType"', 'subjectType')
      .addSelect('COUNT(*)', 'n')
      .where('b."tenantId" = :tenantId AND b."kind" = :kind', { tenantId, kind })
      .groupBy('b."slot"')
      .addGroupBy('b."documentId"')
      .addGroupBy('b."subjectType"')
      .orderBy('b."slot"', 'ASC')
      .limit(MAX_SLOT_DOCUMENT_ROWS)
      .getRawMany<{ slot: string; documentId: string; subjectType: string; n: string }>())
    return rows.map((r) => ({ slot: r.slot, documentId: r.documentId.toLowerCase(), subjectType: r.subjectType, n: Number(r.n) }))
  }

  /** Which of `subjectIds` (of one type) already have a binding for (slot, kind), lower-cased: the bulk action's "bound" side. */
  static async boundAmong(tenantId: string, subjectType: string, subjectIds: readonly string[], slot: string, kind: string): Promise<Set<string>> {
    const ids = [...new Set(subjectIds.map((id) => id.toLowerCase()))]
    if (ids.length === 0) return new Set()
    const rows = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.find({ where: { tenantId, subjectType, subjectId: In(ids), slot, kind } }))
    return new Set(rows.map((r) => r.subjectId.toLowerCase()))
  }

  /**
   * The bulk action of D42-7: a binding (revision 1, created by `userId`) for every one of `deviceIds` that has none for (slot, kind), each
   * with the device in the main role and `mapOf(deviceId)` as its exceptions. Never overwrites a row (a person's setup stays whatever it
   * says), so a second call binds nothing that the first did. Written in chunks of `chunk`, each in one transaction that first takes the
   * advisory lock of every subject of the chunk (in id order, so two bulk calls never wait on each other crosswise) and then re-reads which
   * of them are bound, so a save that came in between is kept and the unique index is never hit.
   */
  static async bulkBindDevices(tenantId: string, input: {
    kind: string; slot: string; documentId: string; documentHash: string | null; deviceIds: readonly string[]
    mapOf: (deviceId: string) => SceneBindingBody['map']; userId: string; chunk?: number
    /** Called after each committed chunk with how many rows it wrote, so a caller can account for the chunks that committed before a later one failed. */
    onChunk?: (written: number) => void
  }): Promise<{ bound: number; skipped: number }> {
    const ids = [...new Set(input.deviceIds.map((id) => id.toLowerCase()))].sort()
    const size = Math.max(1, input.chunk ?? 100)
    let bound = 0
    for (let i = 0; i < ids.length; i += size) {
      const part = ids.slice(i, i + size)
      const before = bound
      bound += await withTenantTransactionFor(tenantId, async (qr) => {
        const repo = qr.manager.getRepository(DashboardSceneBinding)
        for (const id of part) await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey(tenantId, { type: 'iot_device', id }, input.slot, input.kind)])
        const have = new Set((await repo.find({ where: { tenantId, subjectType: 'iot_device', subjectId: In(part), slot: input.slot, kind: input.kind } })).map((r) => r.subjectId.toLowerCase()))
        const fresh = part.filter((id) => !have.has(id)).map((id) => {
          const body: SceneBindingBody = { devices: { '': id }, map: input.mapOf(id), hidden: null, view: null, rules: null }
          const problems = bindingProblems(body)
          if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 422, ErrorCode.VALIDATION_ERROR, { details: { problems } })
          return repo.create({
            tenantId, subjectType: 'iot_device', subjectId: id, slot: input.slot, kind: input.kind, documentId: input.documentId, documentHash: input.documentHash,
            ...body, status: 'ok' as const, revision: 1, createdByUserId: input.userId, updatedByUserId: input.userId,
          })
        })
        if (fresh.length) await repo.save(fresh)
        return fresh.length
      })
      input.onChunk?.(bound - before)
    }
    return { bound, skipped: ids.length - bound }
  }

  /** One row of one subject, slot and kind. */
  static async get(tenantId: string, subject: CardSubject, slot: string, kind: string): Promise<DashboardSceneBinding | null> {
    return withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) => repo.findOne({
      where: { tenantId, subjectType: subject.type, subjectId: subject.id, slot, kind },
    }))
  }

  /**
   * Sets a subject's binding for a slot and kind (an upsert). `expectedRevision` (absent: no check; 0: a binding that did not exist)
   * must match the stored one, else 409 naming the stored revision. The caps are judged again here, so no caller can store a row the
   * DTO would have refused. A write always makes the row `ok`: the route verified the document and the devices just before.
   */
  static async set(
    tenantId: string,
    subject: CardSubject,
    scene: { slot: string; kind: string; documentId: string; documentHash: string | null } & Partial<SceneBindingBody>,
    userId: string,
    expectedRevision?: number,
  ): Promise<{ binding: DashboardSceneBinding; created: boolean }> {
    const body: SceneBindingBody = {
      devices: scene.devices ?? {}, map: scene.map ?? {}, hidden: scene.hidden ?? null, view: scene.view ?? null, rules: scene.rules ?? null,
    }
    const problems = bindingProblems(body, scene.kind)
    if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 422, ErrorCode.VALIDATION_ERROR, { details: { problems } })
    // phase 45 (SM2-4): a field is read from the binding's own devices only; judged again here so no caller stores a field no card could feed
    const fieldDevices = fieldDeviceProblems(body)
    if (fieldDevices.length) throw new AppError(MSG.SCENE_FIELD_DEVICE_UNBOUND, 422, ErrorCode.VALIDATION_ERROR, { details: { problems: fieldDevices } })
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardSceneBinding)
      // one writer per subject, slot and kind at a time: the revision check and the insert of a first binding must not race
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey(tenantId, subject, scene.slot, scene.kind)])
      const stored = await repo.findOne({ where: { tenantId, subjectType: subject.type, subjectId: subject.id, slot: scene.slot, kind: scene.kind } })
      assertRevision(expectedRevision, stored)
      const fields = { documentId: scene.documentId, documentHash: scene.documentHash, ...body, status: 'ok' as const, updatedByUserId: userId }
      const next = stored
        ? Object.assign(stored, fields, { revision: stored.revision + 1 })
        : repo.create({ tenantId, subjectType: subject.type, subjectId: subject.id, slot: scene.slot, kind: scene.kind, ...fields, revision: 1, createdByUserId: userId })
      return { binding: await repo.save(next), created: !stored }
    })
  }

  /**
   * Creates a NEW view of a subject (47.1, D106): the binding is stored in the next free slot of that subject and kind (`nextFreeSlot`: `main` while it
   * is free, then `view_2`, `view_3` …; a slot a person typed before is skipped), revision 1. Under the subject and kind's allocation lock the subject's
   * slots are read; the slot picked is then locked as a save locks it and read again, so a save that stored that very slot meanwhile is never
   * overwritten (the next free one is taken instead). At most `MAX_SUBJECT_VIEWS` views of a kind per subject (422). The caps are judged here as
   * `set` judges them; the route has judged the subject, the kind's write permission, the document and the devices.
   */
  static async create(
    tenantId: string,
    subject: CardSubject,
    scene: { kind: string; documentId: string; documentHash: string | null } & Partial<SceneBindingBody>,
    userId: string,
  ): Promise<{ binding: DashboardSceneBinding; created: true }> {
    const { binding } = await DashboardSceneBindingService.createWithDocument(tenantId, subject, scene, userId, async () => ({ documentId: scene.documentId, documentHash: scene.documentHash }))
    return { binding, created: true }
  }

  /**
   * `create` for a view whose document is made in the SAME transaction (phase 50: "Make a 3D view of this drawing" makes the design and the view that shows
   * it at once): the slot is allocated and checked as `create` does, then `makeDocument(qr)` runs inside the transaction (it stores the document and answers
   * its id and fingerprint) and the binding is inserted. A failure of either rolls both back, so there is never a document nobody asked for. A subject that
   * already holds `MAX_SUBJECT_VIEWS` views of the kind is refused before anything is made. The caller has judged the subject, the kind's write permission
   * and the devices, as for `create`.
   *
   * `existing` (phase 50, review R50-3): asked under the allocation lock with the subject's views of the kind as they are now, before the cap and before
   * anything is made. A view it answers is returned as it is (`created` false, nothing made, nothing written), so a check such as "this subject already
   * has a 3D view made from this drawing" holds for two requests at once (two tabs, a retry after a timeout), not only for one after the other.
   */
  static async createWithDocument(
    tenantId: string,
    subject: CardSubject,
    scene: { kind: string } & Partial<SceneBindingBody>,
    userId: string,
    makeDocument: (qr: QueryRunner) => Promise<{ documentId: string; documentHash: string | null }>,
    opts: { existing?: (qr: QueryRunner, views: DashboardSceneBinding[]) => Promise<DashboardSceneBinding | null> } = {},
  ): Promise<{ binding: DashboardSceneBinding; created: boolean }> {
    const body: SceneBindingBody = {
      devices: scene.devices ?? {}, map: scene.map ?? {}, hidden: scene.hidden ?? null, view: scene.view ?? null, rules: scene.rules ?? null,
    }
    const problems = bindingProblems(body, scene.kind)
    if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 422, ErrorCode.VALIDATION_ERROR, { details: { problems } })
    const fieldDevices = fieldDeviceProblems(body)
    if (fieldDevices.length) throw new AppError(MSG.SCENE_FIELD_DEVICE_UNBOUND, 422, ErrorCode.VALIDATION_ERROR, { details: { problems: fieldDevices } })
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardSceneBinding)
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [allocationLockKey(tenantId, subject, scene.kind)])
      const views = await repo.find({ where: { tenantId, subjectType: subject.type, subjectId: subject.id, kind: scene.kind } })
      const found = opts.existing ? await opts.existing(qr, views) : null
      if (found) return { binding: found, created: false }
      const taken = new Set(views.map((r) => r.slot))
      if (taken.size >= MAX_SUBJECT_VIEWS) {
        throw new AppError(MSG.SCENE_VIEWS_FULL, 422, ErrorCode.VALIDATION_ERROR, { details: { max: MAX_SUBJECT_VIEWS } })
      }
      for (;;) {
        const slot = nextFreeSlot(taken)
        // a save of this very slot holds its lock: wait for it, then look again (a slot stored meanwhile is skipped, never overwritten)
        await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey(tenantId, subject, slot, scene.kind)])
        const stored = await repo.findOne({ where: { tenantId, subjectType: subject.type, subjectId: subject.id, slot, kind: scene.kind } })
        if (stored) { taken.add(slot); continue }
        const doc = await makeDocument(qr)
        const row = repo.create({
          tenantId, subjectType: subject.type, subjectId: subject.id, slot, kind: scene.kind, documentId: doc.documentId, documentHash: doc.documentHash,
          ...body, status: 'ok' as const, revision: 1, createdByUserId: userId, updatedByUserId: userId,
        })
        return { binding: await repo.save(row), created: true }
      }
    })
  }

  /**
   * Phase 45.7: binds a subject to a document that is made in the SAME transaction, unless the subject already has a binding for the slot and kind.
   * Under the binding's advisory lock (the one `set` takes) the stored row is read first: a row there is returned as it is (`created` false, nothing
   * made, nothing written: a second call, a double click and a second tab all land here); with none, `makeDocument(qr)` runs inside the transaction
   * (it creates the document and answers its id and fingerprint) and the binding is inserted at revision 1. A failure of either rolls both back, so
   * there is never a document nobody asked for or a binding to one that is not there. The caller has already judged the subject, the kind's write
   * permission and the devices (the route's checks, as a PUT's); the caps are judged again here, as `set` does.
   */
  static async bindIfAbsent(
    tenantId: string,
    subject: CardSubject,
    scene: { slot: string; kind: string } & Partial<SceneBindingBody>,
    userId: string,
    makeDocument: (qr: QueryRunner) => Promise<{ documentId: string; documentHash: string | null }>,
  ): Promise<{ binding: DashboardSceneBinding; created: boolean }> {
    const body: SceneBindingBody = {
      devices: scene.devices ?? {}, map: scene.map ?? {}, hidden: scene.hidden ?? null, view: scene.view ?? null, rules: scene.rules ?? null,
    }
    const problems = bindingProblems(body, scene.kind)
    if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 422, ErrorCode.VALIDATION_ERROR, { details: { problems } })
    const fieldDevices = fieldDeviceProblems(body)
    if (fieldDevices.length) throw new AppError(MSG.SCENE_FIELD_DEVICE_UNBOUND, 422, ErrorCode.VALIDATION_ERROR, { details: { problems: fieldDevices } })
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardSceneBinding)
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey(tenantId, subject, scene.slot, scene.kind)])
      const stored = await repo.findOne({ where: { tenantId, subjectType: subject.type, subjectId: subject.id, slot: scene.slot, kind: scene.kind } })
      if (stored) return { binding: stored, created: false }
      const doc = await makeDocument(qr)
      const row = repo.create({
        tenantId, subjectType: subject.type, subjectId: subject.id, slot: scene.slot, kind: scene.kind,
        documentId: doc.documentId, documentHash: doc.documentHash, ...body, status: 'ok' as const, revision: 1, createdByUserId: userId, updatedByUserId: userId,
      })
      return { binding: await repo.save(row), created: true }
    })
  }

  /**
   * Takes a subject's binding away (the subject falls back to the next rung). The removed row, or null when there was none.
   * `expectedRevision` (absent: no check; 0: a binding that did not exist) must match the stored one, else 409 as a save does; the
   * same lock as a save is held, so a save and a reset of one binding never interleave.
   */
  static async reset(tenantId: string, subject: CardSubject, slot: string, kind: string, expectedRevision?: number): Promise<DashboardSceneBinding | null> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardSceneBinding)
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey(tenantId, subject, slot, kind)])
      const where = { tenantId, subjectType: subject.type, subjectId: subject.id, slot, kind }
      const stored = await repo.findOne({ where })
      assertRevision(expectedRevision, stored)
      if (!stored) return null
      await repo.delete(where)
      return stored
    })
  }

  /**
   * A document is gone (a design was deleted): every binding that names it becomes `unresolved` and keeps everything else, so the drawer
   * can say what broke and a person can point it at another document. Each row that changes takes the next revision, so an editor
   * that opened it before is told it is stale. Returns how many rows changed. The owner of the document calls this on its own delete,
   * in the same request; with `qr` (the owner's tenant transaction) the marking and the owner's delete commit or roll back together.
   */
  static async markDocumentUnresolved(tenantId: string, kind: string, documentId: string, qr?: QueryRunner): Promise<number> {
    const mark = async (repo: Repository<DashboardSceneBinding>) => {
      const res = await repo.createQueryBuilder()
        .update()
        .set({ status: 'unresolved', revision: () => '"revision" + 1' })
        .where('"tenantId" = :tenantId AND "kind" = :kind AND "documentId" = :documentId AND "status" = :ok', { tenantId, kind, documentId, ok: 'ok' })
        .execute()
      return res.affected ?? 0
    }
    return qr ? mark(qr.manager.getRepository(DashboardSceneBinding)) : withTenantRepositoryFor(tenantId, DashboardSceneBinding, mark)
  }

  /**
   * A document's items were given keys (a 3D design made connectable, dashboard phase 45.8 K5): every binding that names the document and whose `map` or
   * `hidden` reaches an item by the name it had before (`rename`: the old name, an item id, to the key) is rewritten to the key, so nothing already matched
   * is lost when the card starts matching by key. A renamed name that lands on an entry the binding already holds under the key keeps that entry (the
   * person's) and drops the stale one; `<role>.<old>` moves with its role. With `documentHash` (the document's fingerprint after the keys), every `ok` binding
   * on the document takes it too (SK-26): the keys were added to the SAME drawing, so a setup made on it is still made on it, and the cards' "the drawing
   * changed" notice (TK-6) must not fire for it. Each changed row takes the next revision. Returns how many rows changed. Runs on the caller's transaction
   * (`qr`) so the keys and the re-keyed maps commit or roll back together.
   */
  static async rekeyDocumentBindings(
    tenantId: string, kind: string, documentId: string, rename: Readonly<Record<string, string>>, qr?: QueryRunner, documentHash?: string | null,
  ): Promise<number> {
    const moveHash = typeof documentHash === 'string' && documentHash !== ''
    if (Object.keys(rename).length === 0 && !moveHash) return 0
    const renamed = (name: string): string | null => {
      if (Object.hasOwn(rename, name)) return rename[name]!
      const dot = name.indexOf('.')
      if (dot < 0) return null
      const rest = name.slice(dot + 1)
      return Object.hasOwn(rename, rest) ? `${name.slice(0, dot)}.${rename[rest]!}` : null
    }
    const rekey = async (repo: Repository<DashboardSceneBinding>) => {
      const rows = await repo.find({ where: { tenantId, kind, documentId } })
      let changed = 0
      for (const row of rows) {
        let touched = false
        const map: Record<string, SceneMapEntry> = {}
        const moving: Array<[string, SceneMapEntry]> = []
        for (const [name, entry] of Object.entries(row.map ?? {})) {
          const next = renamed(name)
          if (next === null) map[name] = entry
          else moving.push([next, entry])
        }
        for (const [next, entry] of moving) {
          touched = true
          if (!Object.hasOwn(map, next)) map[next] = entry
        }
        let hidden = row.hidden ?? null
        if (hidden) {
          const next = hidden.map((h) => renamed(h) ?? h)
          if (next.some((x, i) => x !== hidden![i])) { hidden = [...new Set(next)]; touched = true }
        }
        // the same drawing with its keys: an `ok` setup on it follows to the new fingerprint (a broken binding keeps what it was set up on)
        const hash = moveHash && row.status === 'ok' && row.documentHash !== documentHash ? { documentHash } : {}
        if (Object.keys(hash).length > 0) touched = true
        if (!touched) continue
        await repo.update({ tenantId, bindingId: row.bindingId }, { map, hidden, ...hash, revision: row.revision + 1 } as never)
        changed++
      }
      return changed
    }
    return qr ? rekey(qr.manager.getRepository(DashboardSceneBinding)) : withTenantRepositoryFor(tenantId, DashboardSceneBinding, rekey)
  }

  /**
   * A document was rebuilt from its source keeping its keys (phase 50: "Update the 3D view" lays the view out again from its drawing): every `ok` binding
   * on it whose map and hidden keys all name a key the new document still has takes the new fingerprint, so its cards do not ask to review connections
   * that are all still there. A binding with a key the document lost keeps its old fingerprint, so the cards' "the drawing changed" notice and the Views'
   * count of connections that no longer match still lead a person to it. Each changed row takes the next revision. Runs on the caller's transaction.
   * Returns how many rows took the fingerprint.
   */
  static async followRebuiltDocument(tenantId: string, kind: string, documentId: string, keys: ReadonlySet<string>, documentHash: string, qr: QueryRunner): Promise<number> {
    const repo = qr.manager.getRepository(DashboardSceneBinding)
    const rows = await repo.find({ where: { tenantId, kind, documentId } })
    let changed = 0
    for (const row of rows) {
      if (row.status !== 'ok' || row.documentHash === documentHash) continue
      const names = [...Object.keys(row.map ?? {}), ...(row.hidden ?? [])]
      if (names.some((n) => !keys.has(n))) continue
      await repo.update({ tenantId, bindingId: row.bindingId }, { documentHash, revision: row.revision + 1 } as never)
      changed++
    }
    return changed
  }

  /**
   * The answer for one subject (D42-5): loads the subject's own row, the rows of `ancestorAssetIds` (nearest first; the walk up the
   * asset path is the caller's) and, for an asset that holds exactly one device, that device's row, then picks one rung.
   * `topology` is the caller's walk, run only when the subject has no row of its own (so a subject that answers for itself costs no
   * walk); what it returns is used for `ancestorAssetIds` and `deviceIds` when the input names none.
   *
   * `view` (42.4.1, D42-6): a subject's own row answers with the `view` it stores; a row found above the subject (rung `ancestor`) answers
   * with the view derived from the assets between that row and the subject (`deriveView`, over the keys of the row's document, which
   * `keysOf` reads; a document whose keys cannot be read gives no view, never an error for the board). A code the document or the path
   * holds twice is no view part; the answer then carries `viewNote` saying so. An ASSET answers at rung `ancestor` only when that nearest row
   * gives a view; otherwise the rung falls through (placeholder), as the resolver's header states.
   */
  static async resolve(tenantId: string, input: {
    subject: CardSubject; slot: string; kind: string; cardDefault: boolean
    ancestorAssetIds?: string[]; deviceIds?: string[]
    topology?: () => Promise<SubjectTopology>
    keysOf?: (documentId: string) => Promise<SceneKeyRef[]>
  }): Promise<ResolvedScene> {
    const { subject, slot, kind } = input
    const own = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, (repo) =>
      repo.findOne({ where: { tenantId, subjectType: subject.type, subjectId: subject.id, slot, kind } }))
    if (own) {
      const answer = resolveSceneBinding({ subject, slot, kind, cardDefault: input.cardDefault, own })
      return own.view && (own.view.level !== undefined || own.view.focus !== undefined) ? { ...answer, view: own.view } : answer
    }
    const walked: SubjectTopology = input.topology ? await input.topology() : {}
    const ancestorAssetIds = (input.ancestorAssetIds ?? walked.ancestorAssetIds ?? []).slice(0, MAX_ANCESTORS)
    const deviceIds = input.deviceIds ?? walked.deviceIds
    const single = subject.type === 'iot_asset' && deviceIds?.length === 1 ? deviceIds[0] : null
    const rows = await withTenantRepositoryFor(tenantId, DashboardSceneBinding, async (repo) => {
      const found = ancestorAssetIds.length
        ? await repo.find({ where: { tenantId, subjectType: 'iot_asset', subjectId: In(ancestorAssetIds), slot, kind } })
        : []
      // nearest first, as the caller listed them
      const ancestors = ancestorAssetIds.flatMap((id) => found.filter((r) => r.subjectId === id))
      const singleDeviceRow = single ? await repo.findOne({ where: { tenantId, subjectType: 'iot_device', subjectId: single, slot, kind } }) : null
      return { ancestors, singleDeviceRow }
    })
    // the view a row gives this subject: the codes of the assets between that row and the subject, root first (a device's path ends at the
    // asset that holds it), read against the keys of the row's document; a document whose keys cannot be read gives no view, never an error
    const viewFor = async (row: DashboardSceneBinding): Promise<{ view?: SceneView; note?: SceneViewNote }> => {
      if (!input.keysOf) return {}
      const above = ancestorAssetIds.indexOf(row.subjectId)
      if (above < 0) return {}
      const path = [...ancestorAssetIds.slice(0, above).reverse(), ...(subject.type === 'iot_asset' ? [subject.id.toLowerCase()] : [])]
        .flatMap((id) => (walked.assetCodes?.[id] ? [walked.assetCodes[id]] : []))
      if (path.length === 0) return {}
      try {
        return deriveViewOf(path, await input.keysOf(row.documentId))
      } catch {
        return {}
      }
    }
    // an ASSET answers at rung `ancestor` only when a view can be derived from the nearest ancestor row (D42-5): otherwise it stays a placeholder
    const nearest = subject.type === 'iot_asset' && !rows.singleDeviceRow ? rows.ancestors[0] : undefined
    const nearestView = nearest ? await viewFor(nearest) : undefined
    const answer = resolveSceneBinding({
      subject, slot, kind, cardDefault: input.cardDefault, deviceIds, own: null, ...rows,
      ...(subject.type === 'iot_asset' ? { ancestorHasView: nearestView?.view !== undefined } : {}),
    })
    if (answer.rung !== 'ancestor' || !answer.binding) {
      // an asset whose nearest row could not give a view says why, when something was left out for being ambiguous
      return nearestView?.note ? { ...answer, viewNote: nearestView.note } : answer
    }
    const derived = nearest && answer.binding === nearest ? nearestView! : await viewFor(answer.binding)
    return { ...answer, ...(derived.view ? { view: derived.view } : {}), ...(derived.note ? { viewNote: derived.note } : {}) }
  }
}
