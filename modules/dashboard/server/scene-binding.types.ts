/**
 * The document seam of scene bindings (docs/phases/07-dashboard/42, D42-3). Dashboard owns the binding table and the routes; the
 * documents belong to their modules, which contribute `dashboard:scene_kind`, one per kind (`design` from dashboard_viewer, `diagram`
 * from dashboard_scada later). The dashboard never imports a document table: a document is reached only through the kind.
 *
 * Every call runs after the route asked the caller for the contribution's own permission (`readPermission` / `writePermission`); the
 * module still reads in the tenant's RLS transaction with an explicit tenant predicate, so another tenant's id is an unknown id.
 */

export const SCENE_KIND_POINT = 'dashboard:scene_kind'

/** What a module is told about the caller. No user id: a kind answers the same for everyone who may read it. */
export interface SceneKindCtx {
  tenantId: string
  locale: string
}

/** One document as a binding names it: its id, the name the drawer lists it by and the fingerprint of its content (null: none). */
export interface SceneDocumentRef {
  id: string
  name: string
  hash: string | null
  /** When the document last changed (ISO), for the drawer's list; absent when the kind does not say. */
  updatedAt?: string
}

/** One key a document offers a binding to match (the equipment of the scene): its key, what the drawer shows and what kind of item it is. */
export interface SceneKeyRef {
  key: string
  label: string
  kind: string
  /** The catalogue type of the item (a pump, a heater), when the kind knows one: the drawer's third matching step compares it. */
  catalogue?: string
  /**
   * The key is held by more than one entry of the document (a level or a room tag whose key is also an item's, or another level's or room's):
   * nothing can tell which one a code names, so a view is never derived from it (`deriveViewOf`) and the entry is listed, not dropped.
   */
  ambiguous?: boolean
  /** The document holds keys and this is one of them (a keyed design answers to keys): the key already is the element the item was built from, so the bulk `twin-index` map has nothing to add. */
  keyed?: boolean
}

/** `dashboard:scene_kind`. */
export interface DashboardSceneKind {
  /** The kind, `design`: the contribution `key`. */
  readonly key: string
  /** The documents of the kind in the tenant, sorted by name, at most `limit`, and how many match in all. */
  list(ctx: SceneKindCtx, q: { search?: string; limit: number }): Promise<{ rows: SceneDocumentRef[]; total: number }>
  /** The ones of `ids` that exist in the tenant (any order; unknown and deleted ids are left out). */
  byIds(ctx: SceneKindCtx, ids: string[]): Promise<SceneDocumentRef[]>
  /** The keys of one document, empty for a document that does not exist. */
  keysOf(ctx: SceneKindCtx, id: string): Promise<SceneKeyRef[]>
  /**
   * The document itself (phase 42.3.1, SA-6), for a display screen's payload: a screen has no session to read it with, so the display route carries the
   * documents its scenes draw (size-capped, `resolveSceneNeeds`' `content`). Null for a document that does not exist or has none. Optional: a kind
   * whose card is not drawn on a screen (the 3D design) offers none, and a screen then draws what the card holds.
   */
  content?(ctx: SceneKindCtx, id: string): Promise<Record<string, unknown> | null>
  /** Opens the kind's documents for reading ("who uses this document", the drawer's list). */
  readPermission: string
  /** A binding of the kind is written with this (D42-9). */
  writePermission: string
}

/** The two bodies a binding's status takes. */
export type SceneBindingStatus = 'ok' | 'unresolved'
