/**
 * The entity seams of board aliases (docs/phases/07-dashboard/36, E36-2). Dashboard owns the generic filter types and
 * the resolver; the entities belong to their modules, which contribute:
 *
 *  - `dashboard:entity_type` (one per entity kind, contribution `key` = the entity type): find entities by ids, by
 *    subtypes and a name prefix, or all of them, sorted by name, inside the caller's tenant;
 *  - `dashboard:entity_relations` (a module that owns a relation graph): walk it from a root.
 *
 * Dashboard never reads a domain table. Every call runs after the resolver asked the viewer for the contribution's
 * `requiredPermission` (E36-5); the module still reads in the tenant's RLS transaction with an explicit tenant predicate,
 * so an id of another tenant is answered as one that does not exist.
 */

import type { EntityKeyInfo, KeyFilter, KeyFilterKeyType } from './board-filters'

export const ENTITY_TYPE_POINT = 'dashboard:entity_type'
export const ENTITY_RELATIONS_POINT = 'dashboard:entity_relations'

/** What a module is told about the caller. No user id: an entity type answers the same for every member who may read it. */
export interface EntityCtx {
  tenantId: string
  locale: string
}

/** One entity as aliases carry it: its type, id, the name it sorts by, and optional label and subtype. */
export interface EntityRef {
  type: string
  id: string
  name: string
  label?: string | null
  subtype?: string | null
}

export interface EntityTypeLabels {
  one: string
  many: string
  /** What the subtype is called ("Device profile"); absent = the type has no subtypes. */
  subtype?: string
}

/** `dashboard:entity_type`. */
export interface DashboardEntityType {
  readonly key: string
  labels(locale: string): EntityTypeLabels
  /** The read permission of the module's own list; asked for the viewer before any call below. */
  requiredPermission: string
  /** The subtypes the entity-subtype filter offers (device profiles, asset kinds). Absent = no subtypes. */
  subtypes?(ctx: EntityCtx, q: { search?: string; limit: number }): Promise<Array<{ value: string; label: string }>>
  /** The ones of `ids` that exist in the tenant (any order; unknown ids are left out). */
  byIds(ctx: EntityCtx, ids: string[]): Promise<EntityRef[]>
  /**
   * Entities sorted by name, at most `limit`, and how many match in all. `subtypes` and `namePrefix` narrow; `search` is
   * the picker's free text (a contains match the module defines). None of them = every entity of the type.
   * `offset` (optional, additive) skips that many entities of the same ordering, so a caller can page past `limit`; a type that does not
   * implement it answers the first page again, which a paging caller must treat as the end (it checks that a page brought new ids).
   */
  find(ctx: EntityCtx, q: { subtypes?: string[]; namePrefix?: string; search?: string; limit: number; offset?: number }): Promise<{ rows: EntityRef[]; total: number }>
  /**
   * Key filters (36.7). The permission each key type is read behind, asked for the viewer before `readKeys`: filtering on
   * a value must never reveal more than reading it would. A type absent here is not readable by a filter.
   */
  keyPermissions?: Partial<Record<KeyFilterKeyType, string>>
  /** The keys the filter editor suggests (fields, attribute keys, telemetry keys), matching `search`. */
  /**
   * `subtypes` (optional, additive, phase 49a): only the keys of entities of these subtypes (a device profile), so a picker of the keys a
   * profile's devices send lists those, not a sample of every kind. A type that does not implement it answers its whole list.
   */
  keys?(ctx: EntityCtx, q: { search?: string; limit: number; subtypes?: string[] }): Promise<EntityKeyInfo[]>
  /** Per entity id, the values of `keys` (aligned, `undefined` for none). Ids that do not exist are left out. */
  readKeys?(ctx: EntityCtx, ids: string[], keys: Array<KeyFilter['key']>): Promise<Map<string, unknown[]>>
}

export interface RelationQuery {
  root: { type: string; id: string }
  /** Legacy's sense: `from` = relations that start at the root (root → entity), `to` = relations that end at it. */
  direction: 'from' | 'to'
  /** 1…10 (E36-8). */
  maxLevel: number
  lastLevelOnly: boolean
  /** An entity is kept when it matches any filter; a `negate` filter keeps what it does not match. Empty = every relation. */
  filters: Array<{ relationType?: string; entityTypes?: string[]; negate?: boolean }>
  limit: number
}

/** `dashboard:entity_relations`. */
export interface DashboardEntityRelations {
  readonly key: string
  label(locale: string): string
  requiredPermission: string
  relationTypes(ctx: EntityCtx): Promise<Array<{ value: string; label: string }>>
  /** The related entities, de-duplicated, root excluded, at most `limit`. */
  query(ctx: EntityCtx, q: RelationQuery): Promise<Array<{ type: string; id: string }>>
  /**
   * What an entity of each type holds through `CONTAINS` in this graph (optional, additive, phase 49b, W2-M4): entity type key -> the entity
   * types it can hold (a site its child assets and its devices). A slot handed an entity of another kind (D112) walks only the graphs that
   * say that kind holds one of the slot's types, and the card's picker offers such a parameter only then. Absent: the graph may hold anything.
   */
  readonly holds?: Readonly<Record<string, readonly string[]>>
}

/**
 * Whether a graph's declared holdings (`DashboardEntityRelations.holds`) let an entity of `type` hand a slot of `slotTypes` what it holds: an
 * undeclared graph may hold anything (the rule before phase 49b); a declared one only what it lists for `type`. Pure.
 */
export function graphCanHold(holds: Readonly<Record<string, readonly string[]>> | undefined | null, type: string | null, slotTypes: readonly string[]): boolean {
  if (!holds || type === null) return true
  return (holds[type] ?? []).some((t) => slotTypes.includes(t))
}
