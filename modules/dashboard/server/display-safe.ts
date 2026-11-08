// Pure: what a display link may show, and the shape it is shown in (owner decision 2026-10-17 #10).
import { builtinTypeOfComponent } from './builtin-component-files'
import { conditionHolds } from './instance-actions'
import type { WidgetDescriptor } from './widget-catalog.service'
import { displayTransform, type Transform } from './transform.dto'

/**
 * The parameter values a screen runs on: the board's authored defaults, nothing else (a screen has no viewer to change
 * them). Read off the stored definitions as they are: an invalid default is the board write's to refuse, not this.
 */
export function displayParamValues(params: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of Array.isArray(params) ? params : []) {
    if (!def || typeof def !== 'object' || typeof (def as { key?: unknown }).key !== 'string') continue
    const d = def as { key: string; default?: unknown }
    if (d.default !== undefined && d.default !== null && d.default !== '') out[d.key] = d.default
  }
  return out
}

/**
 * Is a card shown on a screen (phase 35)? Its visibility rule judged against the board's defaults, on the server: the
 * screen's client never evaluates a rule (it is not even sent one). No rule = shown; a rule that is not a condition
 * never holds, as on the board.
 */
export function shownOnDisplay(visibility: unknown, params: Record<string, unknown>): boolean {
  const when = visibility && typeof visibility === 'object' && !Array.isArray(visibility) ? (visibility as { when?: unknown }).when : undefined
  if (when === undefined) return true
  return conditionHolds(when, { params })
}

/** A screen never polls faster than this; a card asking for less is raised to it. */
export const DISPLAY_MIN_REFRESH_SECONDS = 15
/** A card with no refresh period of its own refreshes this often on a screen. */
export const DISPLAY_DEFAULT_REFRESH_SECONDS = 60
/**
 * The only periods a screen uses. Snapping lets the 16 ms batcher merge cards that would otherwise each poll on their
 * own beat, which keeps one screen well inside the per-link rate limit.
 */
export const DISPLAY_REFRESH_STEPS = [15, 30, 60, 120, 300] as const

/**
 * Whether a resolved widget may render on a display. A screen has no session, so only widgets whose WHOLE data path
 * runs through the display batch qualify:
 *
 * - a `db:` builtin (its component reads data only through the host's batcher);
 * - a `db:` template widget (it gets its data posted into a sandboxed frame);
 * - an `ext:` contribution that binds data AND declares `metadata.displaySafe: true`. A contribution is code the host
 *   does not control: it can call the session API itself, and a 401 there would send the screen to the login page.
 *   The flag is its author's promise that it does not.
 *
 * Never a manifest widget (first-party components that fetch on their own), an iframe-tier plugin (its bridge needs a
 * session) or a PRIVATE widget (the issuer's own, which a shared screen must not show).
 */
export function displayRenderable(d: Pick<WidgetDescriptor, 'ref' | 'componentId' | 'renderTier' | 'template' | 'dataSpec' | 'visibility' | 'displaySafe'>): boolean {
  if (d.visibility === 'PRIVATE') return false
  if (d.ref.startsWith('db:')) {
    if (d.renderTier === 'iframe') return false
    if (d.renderTier === 'template') return !!d.template
    return !!builtinTypeOfComponent(d.componentId)
  }
  if (d.ref.startsWith('ext:')) return (d.dataSpec?.length ?? 0) > 0 && d.displaySafe === true
  return false
}

/** The smallest step at least `max(15, r ?? 60)`; anything above the last step is the last step. */
export function snapRefresh(r: number | null | undefined): number {
  const want = Math.max(DISPLAY_MIN_REFRESH_SECONDS, typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : DISPLAY_DEFAULT_REFRESH_SECONDS)
  return DISPLAY_REFRESH_STEPS.find((s) => s >= want) ?? DISPLAY_REFRESH_STEPS[DISPLAY_REFRESH_STEPS.length - 1]
}

/** The descriptor fields a screen renders with. Everything else stays on the server (see `toDisplayDescriptor`). */
const DISPLAY_DESCRIPTOR_FIELDS = [
  'ref', 'key', 'name', 'componentId', 'moduleId', 'renderTier', 'template', 'schema', 'defaultProps', 'dataSpec', 'category',
  'icon', 'origin', 'visibility', 'w', 'defaultH', 'order', 'settingsTemplate', 'settingsMigrations', 'displaySafe',
] as const satisfies ReadonlyArray<keyof WidgetDescriptor>

/** A widget as a screen gets it. */
export type DisplayDescriptor = Pick<WidgetDescriptor, (typeof DISPLAY_DESCRIPTOR_FIELDS)[number]>

/**
 * A resolved widget as a screen gets it: an allowlist of what the card renders with. `defaultDataBinding` never goes
 * out (a "Save as widget" preset copies a card's binding into it, saved parameters and pinned window included), and
 * neither do `actionSources` (a screen fires nothing), `frameListingId` (no iframe tier on a screen) or `isSystem`.
 * A field the descriptor does not carry stays absent.
 */
export function toDisplayDescriptor(d: WidgetDescriptor): DisplayDescriptor {
  const out: Record<string, unknown> = {}
  for (const k of DISPLAY_DESCRIPTOR_FIELDS) if (d[k] !== undefined) out[k] = d[k]
  return out as DisplayDescriptor
}

type StoredSlot = { sourceKey?: unknown; queryKey?: unknown }

export interface DisplayInstance {
  instanceId: string
  widgetRef: string
  x: number
  y: number
  w: number
  h: number
  order: number
  pageKey: string | null
  title: string | null
  settings: Record<string, unknown>
  dataBinding: Record<string, { sourceKey: string; queryKey: string; params: Record<string, never> }> | null
  refreshSeconds: number
  actions: null
  /** 7b: the published version this card pins (its definition is in the response's `pinned`), or null. */
  pinnedVersion: number | null
  /** 35.5: the card's compute script when the screen will run it (through the display compute frame), else null. */
  transform: Transform | null
}

/**
 * A placement as a screen gets it: geometry, title, settings, and which source and query each slot reads (the client
 * keys its cache by them). The saved parameter literals and a pinned window stay on the server, which runs them; the
 * actions are dropped, since a screen has nobody to press anything.
 */
export function toDisplayInstance(i: {
  instanceId: string; widgetRef: string; x: number; y: number; w: number; h: number; order?: number | null
  pageKey?: string | null; title?: string | null; settings?: unknown; dataBinding?: unknown; refreshSeconds?: number | null
  pinnedVersion?: number | null; transform?: unknown
}): DisplayInstance {
  let dataBinding: DisplayInstance['dataBinding'] = null
  if (i.dataBinding && typeof i.dataBinding === 'object') {
    dataBinding = {}
    for (const [slot, raw] of Object.entries(i.dataBinding as Record<string, StoredSlot>)) {
      if (raw && typeof raw.sourceKey === 'string' && typeof raw.queryKey === 'string') {
        dataBinding[slot] = { sourceKey: raw.sourceKey, queryKey: raw.queryKey, params: {} }
      }
    }
  }
  return {
    instanceId: i.instanceId,
    widgetRef: i.widgetRef,
    x: i.x, y: i.y, w: i.w, h: i.h,
    order: i.order ?? 0,
    pageKey: i.pageKey ?? null,
    title: i.title ?? null,
    settings: (i.settings && typeof i.settings === 'object' ? i.settings : {}) as Record<string, unknown>,
    dataBinding,
    refreshSeconds: snapRefresh(i.refreshSeconds),
    actions: null,
    pinnedVersion: i.pinnedVersion ?? null,
    transform: displayTransform(i.transform),
  }
}
