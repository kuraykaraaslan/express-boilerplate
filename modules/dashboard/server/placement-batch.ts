import type { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import type { TimeWindow, WindowOffset } from './board-window'
import type { PagingRequest } from './query-paging'
import { placementPageSize } from './placement-page-size'
import type { BoardContextInput, BoardState } from './query-gates'
import { runQuery, type RunQueryArgs } from './query-runner'
import { appLocaleOf } from './board-template.locale'
import { resolvePinnedDefinitions, type PinnedDefinition, type WidgetDescriptor } from './widget-catalog.service'
import MSG from './dashboard.messages'

/** How many slots one batch may carry (a 24-column board full of repeatable charts stays well under it). */
export const MAX_BATCH_ITEMS = 64
/** How many of a batch's queries run at once: a large board must not open a connection per card. */
export const BATCH_CONCURRENCY = 6

type StoredSlot = { sourceKey: string; queryKey: string; params?: Record<string, unknown>; window?: 'board' | TimeWindow; windowOffset?: WindowOffset }
export type BatchItemResult =
  | { instanceId: string; slot: string; ok: true; data: unknown }
  | { instanceId: string; slot: string; ok: false; status: number; error: Record<string, unknown> }

/** The placement fields a batch item reads. */
export interface BatchPlacement {
  instanceId: string
  widgetRef: string
  pinnedVersion?: number | null
  dataBinding?: unknown
  settings?: unknown
}

/**
 * The widget a stored placement runs as (7b): its resolved descriptor with the definition of the version it pins laid
 * over it, exactly as the board and a display screen render it (`ui/placement-descriptor.ts`). An unpinned placement,
 * or a pin with no entry (a version that is gone, a platform row), runs as the latest published definition.
 */
export function placementWidget(
  widgets: Map<string, WidgetDescriptor>,
  pinned: Record<string, PinnedDefinition>,
  instance: { widgetRef: string; pinnedVersion?: number | null },
): WidgetDescriptor | undefined {
  const base = widgets.get(instance.widgetRef)
  if (!base || instance.pinnedVersion == null) return base
  const pin = pinned[`${instance.widgetRef}@${instance.pinnedVersion}`]
  return pin ? { ...base, ...pin } : base
}

/**
 * The pinned definitions the given placements need (7b), keyed `<widgetRef>@<version>`. No query at all when none of
 * them is pinned (the common case: no API sets a pin yet); otherwise one tenant-scoped lookup.
 */
export async function placementPins(
  tenantId: string,
  instances: Array<{ widgetRef: string; pinnedVersion?: number | null }>,
  widgets: Map<string, WidgetDescriptor>,
): Promise<Record<string, PinnedDefinition>> {
  const pinned = instances.filter((i) => i.pinnedVersion != null && widgets.has(i.widgetRef))
  return pinned.length === 0 ? {} : resolvePinnedDefinitions(tenantId, pinned, widgets)
}

/**
 * Run a board view's batch: each item through the one query runner, at most `BATCH_CONCURRENCY` at once, answers in
 * request order. Shared by the session batch route and the display batch route (decision #10), so "what a stored
 * placement may run" has one implementation. An item fails ALONE, with the status and body its single route would
 * have answered: a placement of another board, a widget that did not resolve (or that `isServable` refuses), and an
 * unbound slot are that item's 404. A pinned placement runs as its pinned definition (`placementWidget`): its page
 * size reads that version, as the card renders, and `isServable` must pass for both the latest definition and that
 * version, as `display/board` decides which cards a screen shows.
 */
export async function runPlacementBatch(args: {
  request: NextRequest
  tenantId: string
  userId: string
  /** This board's placements by id: anything else is not this board's, whatever its id. */
  placed: Map<string, BatchPlacement>
  /** The widgets that resolved for the caller, by ref. */
  widgets: Map<string, WidgetDescriptor>
  /** `window`: the viewer's window for that card (D40-7), over the card's own and the board's. */
  items: Array<{ instanceId: string; slot: string; paging?: PagingRequest; window?: TimeWindow }>
  boardContext: BoardContextInput
  boardState: BoardState
  principal?: RunQueryArgs['principal']
  /** A further filter on resolved widgets (the display route serves display-safe ones only). */
  isServable?: (d: WidgetDescriptor) => boolean
}): Promise<BatchItemResult[]> {
  const { request, tenantId, userId, placed, widgets, items, boardContext, boardState } = args
  const asked = [...new Set(items.map((it) => placed.get(it.instanceId)).filter((i): i is BatchPlacement => !!i))]
  const pinned = await placementPins(tenantId, asked, widgets)
  // The app language, read once for the whole batch (every answer's words are in it).
  const locale = await appLocaleOf(request, tenantId)

  const runItem = async (item: (typeof items)[number]): Promise<BatchItemResult> => {
    try {
      const instance = placed.get(item.instanceId)
      if (!instance) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const latest = widgets.get(instance.widgetRef)
      const widget = placementWidget(widgets, pinned, instance)
      // Both the latest definition and the version the card runs as must pass, as `display/board` decides it.
      const servable = (d: WidgetDescriptor) => !args.isServable || args.isServable(d)
      if (!latest || !widget || !servable(latest) || !servable(widget)) throw new AppError(MSG.WIDGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const stored = ((instance.dataBinding ?? {}) as Record<string, unknown>)[item.slot] as StoredSlot | undefined
      if (!stored || typeof stored.sourceKey !== 'string' || typeof stored.queryKey !== 'string') {
        throw new AppError(MSG.BINDING_SLOT_UNKNOWN, 404, ErrorCode.NOT_FOUND)
      }
      const data = await runQuery({
        request, tenantId, userId, boardContext, boardState, locale,
        query: {
          sourceKey: stored.sourceKey, queryKey: stored.queryKey, params: stored.params ?? {}, window: stored.window, windowOffset: stored.windowOffset, paging: item.paging,
          ...(item.window ? { cardWindow: item.window } : {}),
          preferredPageSize: placementPageSize(widget, instance.settings),
        },
        ...(args.principal ? { principal: args.principal } : {}),
      })
      return { instanceId: item.instanceId, slot: item.slot, ok: true, data }
    } catch (e) {
      // Exactly what the single route would have answered for this item (and a 5xx is still reported as one).
      const res = normalizeError(e)
      return { instanceId: item.instanceId, slot: item.slot, ok: false, status: res.status, error: await res.json() }
    }
  }

  const results: BatchItemResult[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await runItem(items[i])
    }
  }))
  return results
}
