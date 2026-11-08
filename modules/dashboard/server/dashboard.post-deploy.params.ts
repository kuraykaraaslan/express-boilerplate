import type { PostDeployStep } from '@kuraykaraaslan-labs/db/server/db.post-deploy'
import { systemBatchesOn, type BatchRunner } from '@kuraykaraaslan-labs/db/server/db.encrypted-columns'
import {
  isEntityParam, narrowedEntityList, normalizeBoardParams, normalizePlacementRefs, withNarrowedLists,
  type NarrowedEntityList, type ViewerWithin,
} from './board-params'

/**
 * `db:post_deploy` step (phase 41, D41-7): the stored boards in the one-list shape, once. A board's old `aliases` become entity
 * parameters of its `params` (a key one shares with a parameter is given a free one), an old `remote-select` of a known entity
 * list becomes the entity parameter it is, and its cards' `{ $alias }` references become the `{ $param }` of the parameter, in the
 * same transaction, its cards locked before the board is rewritten (so none is left behind). Then any card still holding a
 * `{ $alias }` (a board already in the new shape) is rewritten the same way.
 *
 * Phase 41.3 (INC-20): an old device list narrowed by a query (`/api/iot/devices?deviceProfileId=<id>`) becomes the viewer's pick
 * narrowed to that profile (the profile id checked against the board's tenant here, `narrowingsKnown`; one that names no profile
 * of the tenant stays as it is), a hidden one the page's entity; a board already in the new shape that still holds such a list
 * is selected again by its `remote-select` and rewritten on the next run.
 *
 * Idempotent: a row in the new shape is never selected again, and every UPDATE is guarded on the exact value read, so a row the
 * application rewrote in between (a save stores the new shape too) is left alone. Batched by key, RLS bypassed per batch
 * (`systemBatchesOn`), counts only in the log. Every read path also normalises a row it meets (`normalizeBoardRow`), so a board
 * this step has not reached yet still works.
 */

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[]
/** A jsonb parameter: SQL NULL for a missing value, never the JSON `null`. */
const jsonb = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v))
/** How many rows an `UPDATE … RETURNING` wrapped in a SELECT changed (a manager and a pg client answer differently). */
const UPDATED = (sql: string) => `WITH u AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM u`
const changedCount = (result: unknown): number => Number(rowsOf(result)[0]?.n ?? 0)

/**
 * Where the id a narrowing names is checked (phase 41.3): the table of the entity it names and that table's id column. A narrowing
 * of a list not named here is never resolved, and its parameter stays as it is.
 */
const NARROWING_SOURCES: Readonly<Record<string, { table: string; id: string }>> = {
  'iot_device:deviceProfileId': { table: 'iot_device_profiles', id: 'profileId' },
}

/** The narrowings of one batch that name an entity of their board's tenant, as `tenantId|entityType:query|value` (lower case). */
async function narrowingsKnown(q: Q, rows: Record<string, unknown>[]): Promise<Set<string>> {
  const wanted = new Map<string, { tenantId: string; source: { table: string; id: string }; values: Set<string> }>()
  for (const row of rows) {
    for (const p of Array.isArray(row.params) ? row.params as Record<string, unknown>[] : []) {
      const field = p && typeof p === 'object' && !isEntityParam(p) && p.field && typeof p.field === 'object' ? p.field as { endpoint?: unknown; valueKey?: unknown } : undefined
      const n = field && p.viewer !== 'hidden' ? narrowedEntityList(field, p.entityType) : null
      const source = n ? NARROWING_SOURCES[`${n.entityType}:${n.query}`] : undefined
      if (!n || !source) continue
      const at = `${String(row.tenantId)}|${n.entityType}:${n.query}`
      const entry = wanted.get(at) ?? { tenantId: String(row.tenantId), source, values: new Set<string>() }
      entry.values.add(n.value.toLowerCase())
      wanted.set(at, entry)
    }
  }
  const known = new Set<string>()
  for (const [at, { tenantId, source, values }] of wanted) {
    // A database without the table (the module is not installed there) resolves nothing: the parameters stay as they are.
    if (rowsOf(await q.query('SELECT to_regclass($1) IS NOT NULL AS ok', [source.table]))[0]?.ok !== true) continue
    const found = rowsOf(await q.query(
      `SELECT lower("${source.id}"::text) AS id FROM "${source.table}" WHERE "tenantId"::text = $1 AND lower("${source.id}"::text) = ANY($2::text[])`,
      [tenantId, [...values]],
    ))
    for (const r of found) known.add(`${at}|${String(r.id)}`)
  }
  return known
}

/** The narrowing a known list resolves to: the entity type's subtype it names. */
function withinOf(known: ReadonlySet<string>, tenantId: string, list: NarrowedEntityList): ViewerWithin | null {
  const value = list.value.toLowerCase()
  return known.has(`${tenantId}|${list.entityType}:${list.query}|${value}`) ? { type: 'subtype', subtypes: [value] } : null
}

export interface BoardParamsMigrationReport {
  boards: number
  placements: number
}

type Q = { query(sql: string, params?: unknown[]): Promise<unknown> }

/**
 * One board's cards, locked for the rest of the batch's transaction: read BEFORE the board is rewritten, so no card can change
 * between this read and its rewrite. A card left with an old `{ $alias }` on a board in the new shape would lose its alias key
 * map (a renamed key would bind the parameter that owns the original one).
 */
async function lockCards(q: Q, boardId: string): Promise<Record<string, unknown>[]> {
  return rowsOf(await q.query(
    `SELECT "instanceId"::text AS id, "dataBinding" AS binding, "actions" AS actions FROM "dashboard_widget_instances"
      WHERE "entityType" = 'DASHBOARD' AND "entityId"::text = $1 FOR UPDATE`,
    [boardId],
  ))
}

/** Rewrite one board's locked cards with its alias keys; the number of cards changed. */
async function rewriteCards(q: Q, cards: Record<string, unknown>[], aliasKeys: Record<string, string>): Promise<number> {
  let n = 0
  for (const card of cards) {
    const next = normalizePlacementRefs({ dataBinding: card.binding ?? null, actions: card.actions ?? null }, aliasKeys)
    if (!next.changed) continue
    n += changedCount(await q.query(UPDATED(
      `UPDATE "dashboard_widget_instances" SET "dataBinding" = $2::jsonb, "actions" = $3::jsonb
        WHERE "instanceId"::text = $1 AND "dataBinding" IS NOT DISTINCT FROM $4::jsonb AND "actions" IS NOT DISTINCT FROM $5::jsonb`,
    ), [card.id, jsonb(next.placement.dataBinding), jsonb(next.placement.actions), jsonb(card.binding), jsonb(card.actions)]))
  }
  return n
}

export async function migrateBoardParams(batch: BatchRunner, opts: { batchSize?: number } = {}): Promise<BoardParamsMigrationReport> {
  const size = Math.max(1, Math.floor(opts.batchSize ?? 200))
  const report: BoardParamsMigrationReport = { boards: 0, placements: 0 }

  // 1. Boards in an old shape: a stored alias list, or a `remote-select` that may be an entity list.
  let after: string | null = null
  for (;;) {
    const done: boolean = await batch(async (q) => {
      const rows = rowsOf(await q.query(
        `SELECT "boardId"::text AS id, "tenantId"::text AS "tenantId", "params" AS params, "aliases" AS aliases FROM "dashboard_boards"
          WHERE ("aliases" IS NOT NULL OR "params"::text LIKE '%remote-select%') AND ($1::text IS NULL OR "boardId"::text > $1)
          ORDER BY "boardId"::text LIMIT ${size}`,
        [after],
      ))
      const known = await narrowingsKnown(q, rows)
      for (const row of rows) {
        const id = String(row.id)
        const n = normalizeBoardParams({ params: row.params, aliases: row.aliases })
        const narrowed = withNarrowedLists(n.params, (list) => withinOf(known, String(row.tenantId), list))
        if (!n.changed && !narrowed.changed && row.aliases === null) continue
        const params = narrowed.params.length > 0 ? narrowed.params : null
        const cards = await lockCards(q, id)
        const updated = changedCount(await q.query(UPDATED(
          `UPDATE "dashboard_boards" SET "params" = $2::jsonb, "aliases" = NULL
            WHERE "boardId"::text = $1 AND "params" IS NOT DISTINCT FROM $3::jsonb AND "aliases" IS NOT DISTINCT FROM $4::jsonb`,
        ), [id, jsonb(params), jsonb(row.params), jsonb(row.aliases)]))
        if (updated === 0) continue
        report.boards += 1
        report.placements += await rewriteCards(q, cards, n.aliasKeys)
      }
      if (rows.length > 0) after = String(rows[rows.length - 1].id)
      return rows.length < size
    })
    if (done) break
  }

  // 2. Cards that still name an alias on a board already in the new shape: the alias key is the parameter's.
  let afterCard: string | null = null
  for (;;) {
    const done: boolean = await batch(async (q) => {
      const rows = rowsOf(await q.query(
        `SELECT "instanceId"::text AS id, "dataBinding" AS binding, "actions" AS actions FROM "dashboard_widget_instances"
          WHERE ("dataBinding"::text LIKE '%"$alias"%' OR "actions"::text LIKE '%"$alias"%') AND ($1::text IS NULL OR "instanceId"::text > $1)
          ORDER BY "instanceId"::text LIMIT ${size}`,
        [afterCard],
      ))
      for (const card of rows) {
        const next = normalizePlacementRefs({ dataBinding: card.binding ?? null, actions: card.actions ?? null })
        if (!next.changed) continue
        report.placements += changedCount(await q.query(UPDATED(
          `UPDATE "dashboard_widget_instances" SET "dataBinding" = $2::jsonb, "actions" = $3::jsonb
            WHERE "instanceId"::text = $1 AND "dataBinding" IS NOT DISTINCT FROM $4::jsonb AND "actions" IS NOT DISTINCT FROM $5::jsonb`,
        ), [card.id, jsonb(next.placement.dataBinding), jsonb(next.placement.actions), jsonb(card.binding), jsonb(card.actions)]))
      }
      if (rows.length > 0) afterCard = String(rows[rows.length - 1].id)
      return rows.length < size
    })
    if (done) break
  }
  return report
}

const step: PostDeployStep = {
  async run(ctx) {
    const r = await migrateBoardParams(systemBatchesOn(ctx.dataSource))
    return `board parameters (phase 41): ${r.boards} board(s), ${r.placements} card(s) rewritten`
  },
}

export default step
