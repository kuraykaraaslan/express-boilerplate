import { z } from 'zod'

/**
 * The widget category registry — pure half (no I/O, safe for the client bundle).
 *
 * `dashboard_widgets.category` stays a plain varchar (stored value = the category
 * KEY, which for the core four is also their English label); the registry is what
 * gives the strings meaning: which ones exist, their label / icon / order, and
 * where an unknown one is shown. Two sources (docs/phases/07-dashboard/14, decision D1):
 *
 * 1. CORE categories, defined here. The dashboard knows no device or telemetry
 *    concept (master owner decision #5), so only generic ones live in this file.
 * 2. CONTRIBUTED categories, declared by the module that owns the widgets through
 *    the `dashboard:widget_category` extension point (`widget-category.registry.ts`).
 *
 * A legacy free-text value already stored on a row (`General`, a typo, a retired
 * name) is never rejected on READ: it resolves to its alias when one exists and
 * otherwise to the trailing "Other" bucket. Only a WRITE is validated.
 */

export interface WidgetCategory {
  /** The value stored in `dashboard_widgets.category`. */
  key: string
  label: string
  /** Font Awesome class, e.g. `fas fa-chart-line`. */
  icon: string
  /** Ascending. Core categories occupy 0-99; contributions start at 100. */
  order: number
  /** `core` for this file, otherwise the contributing module id. */
  source: string
}

export const CORE_WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  { key: 'Charts', label: 'Charts', icon: 'fas fa-chart-line', order: 10, source: 'core' },
  { key: 'Data', label: 'Data', icon: 'fas fa-table', order: 20, source: 'core' },
  { key: 'Content', label: 'Content', icon: 'fas fa-file-lines', order: 30, source: 'core' },
  { key: 'Controls', label: 'Controls', icon: 'fas fa-sliders', order: 40, source: 'core' },
  // Process symbols and diagrams: generic (a boiler, a pool, a coil line), no device concept, so they belong in core.
  { key: 'Process & SCADA', label: 'Process & SCADA', icon: 'fas fa-industry', order: 50, source: 'core' },
]

/** Bucket for a stored category the registry does not know. Never persisted. */
export const OTHER_CATEGORY: WidgetCategory = {
  key: '__other', label: 'Other', icon: 'fas fa-shapes', order: 1000, source: 'core',
}

/**
 * Retired free-text values mapped to the registry key they now mean. `General`
 * was the column default before the registry existed.
 */
export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  General: 'Content',
}

/**
 * A category a PLATFORM builtin may declare that a contributing module owns (e.g.
 * `Gauges & Levels` from `iot_telemetry`), mapped to the core category it shows
 * under while no module contributes it. Without this the generic gauge and map
 * would drop into "Other" on an install without the IoT modules. A real
 * contribution always wins over the fallback.
 */
export const CONTRIBUTABLE_FALLBACKS: Readonly<Record<string, string>> = {
  'Gauges & Levels': 'Data',
  'Maps & Location': 'Data',
  'Device Controls': 'Controls',
}

/** Default category of a newly authored widget. */
export const DEFAULT_WIDGET_CATEGORY = 'Content'

export const CategoryKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9 &_-]*$/, 'Invalid category key')

/** What a `dashboard:widget_category` contribution default-exports (one, or an array). */
export const ContributedCategorySchema = z
  .object({
    key: CategoryKeySchema,
    label: z.string().min(1).max(60),
    icon: z.string().regex(/^fa[srb]? fa-[a-z0-9-]+$/i, 'Invalid icon class').default('fas fa-shapes'),
    order: z.number().int().min(100).max(999).default(500),
  })
  .strict()

export type ParsedCategory = { ok: true; category: Omit<WidgetCategory, 'source'> } | { ok: false; error: string }

export function parseContributedCategory(raw: unknown): ParsedCategory {
  const r = ContributedCategorySchema.safeParse(raw)
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { ok: true, category: r.data }
}

/**
 * Core categories first, then contributions, with collisions resolved in favour of
 * the earlier entry (core wins, then lower `order`): a contributor cannot shadow a
 * core category or another module's.
 */
export function mergeCategories(
  contributed: ReadonlyArray<Omit<WidgetCategory, 'source'> & { source: string }>,
): WidgetCategory[] {
  const out: WidgetCategory[] = [...CORE_WIDGET_CATEGORIES]
  const taken = new Set(out.map((c) => c.key.toLowerCase()))
  for (const c of contributed) {
    if (taken.has(c.key.toLowerCase())) continue
    taken.add(c.key.toLowerCase())
    out.push(c)
  }
  return out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

/** The registry entry a stored value belongs to; unknown values land in "Other". */
export function resolveCategory(stored: string | null | undefined, registry: readonly WidgetCategory[]): WidgetCategory {
  if (!stored) return OTHER_CATEGORY
  const key = LEGACY_CATEGORY_ALIASES[stored] ?? stored
  const direct = registry.find((c) => c.key === key)
  if (direct) return direct
  const fallback = CONTRIBUTABLE_FALLBACKS[key]
  return (fallback && registry.find((c) => c.key === fallback)) || OTHER_CATEGORY
}

/** True when `value` may be WRITTEN: a registry key (aliases are legacy-read-only). */
export function isWritableCategory(value: string, registry: readonly WidgetCategory[]): boolean {
  return registry.some((c) => c.key === value)
}

/**
 * Picker tabs: the registry categories that have at least one widget, in registry
 * order, then "Other" if any widget fell outside it. An empty category is not a tab.
 */
export function categoryTabs(
  storedCategories: ReadonlyArray<string | null | undefined>,
  registry: readonly WidgetCategory[],
): WidgetCategory[] {
  const used = new Set<string>()
  for (const s of storedCategories) if (s) used.add(resolveCategory(s, registry).key)
  const tabs = registry.filter((c) => used.has(c.key))
  if (used.has(OTHER_CATEGORY.key)) tabs.push(OTHER_CATEGORY)
  return tabs
}
