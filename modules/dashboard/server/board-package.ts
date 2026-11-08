import { z } from 'zod'
import { TimeWindowSchema } from './board-window'
import { BoardAliasesSchema } from './board-aliases'
import { BoardParamListSchema, BoardParamsInputSchema, entityParamRefIssues, normalizeBoardParams, normalizeParamRefs } from './board-params'
import { BoardFiltersSchema, filterParamKeys } from './board-filters'
import { DataBindingSchema, InstanceActionsSchema, InstanceActionsV2ShapeSchema, PlacementVisibilitySchema } from './dashboard.dto'
import { allActionsOf, allEntriesOf } from './instance-actions'
import { builtinTypeOfComponent } from './builtin-component-files'
import { migrateTenantSettings, tenantTemplate, type TenantMigrationStep } from './tenant-template'
import { GridColsSchema, MAX_GRID_COLS, normalizeGridCols } from './grid-cols'
import { BoardPageKeySchema, BoardPagesSchema, MainPageSchema, pageInputParamKeys } from './board-pages'
import { PackageTransformSchema } from './transform.dto'

/**
 * The board package (phase 19.1): one JSON document that carries a board and everything
 * needed to rebuild it in another tenant, and nothing that identifies where it came from.
 *
 * What is in it: the board's title, description, icon, window and parameters; each placement's
 * geometry, title, refresh interval, settings, bindings and actions; and, per placement, a
 * widget REFERENCE by kind and key. What is not: tenant ids, user ids, the board's id, scope,
 * anchor, revision, its display links (a credential, decision #10: a copy must not inherit a screen's
 * access), or any widget definition (a tenant-authored definition travels through the
 * widget transfer, not here). The format is product-neutral: it names source keys, widget keys
 * and parameters, never a device or any other domain concept.
 *
 * A package is untrusted input the moment it is read back (19.2), so every field is bounded and
 * strict, and import writes only through the normal services.
 */
export const BOARD_PACKAGE_FORMAT = 'dashboard-board-package'
/**
 * v2 (phase 21): the board's own settings and a `templates` manifest of every settings template version inside. v3 (phase 41):
 * the parameters in one list (entity parameters, `kind`); written only when the board has such a parameter, so a board of value
 * parameters stays readable by an app from before phase 41.
 */
export const BOARD_PACKAGE_VERSION = 3
/** Versions this code reads; a v1 package imports with no board settings and unstamped (v1) placement settings. */
export const SUPPORTED_PACKAGE_VERSIONS = [1, 2, 3] as const
export const MAX_PACKAGE_PLACEMENTS = 200

/**
 * How a placement's widget is found again on the importing side:
 * - `manifest`: a module-manifest widget, by its id;
 * - `ext`: a `dashboard:widget` contribution, by its contribution id;
 * - `builtin`: a platform data widget, by its `type`;
 * - `tenant`: a tenant-authored or marketplace widget, by its `type` (the importing tenant must
 *   already have a widget of that type; it is never created from a package).
 */
export const PackageWidgetSchema = z
  .object({
    kind: z.enum(['manifest', 'ext', 'builtin', 'tenant']),
    key: z.string().min(1).max(200),
  })
  .strict()
export type PackageWidget = z.infer<typeof PackageWidgetSchema>

export const PackagePlacementSchema = z
  .object({
    /** A local label (`p1`, `p2`...), unique in the package; never a database id. */
    key: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
    widget: PackageWidgetSchema,
    x: z.number().int().min(0).max(1000),
    y: z.number().int().min(0).max(100_000),
    /** Of the board's `gridCols` (12 when the package names none); fitted to it on import. */
    w: z.number().int().min(1).max(MAX_GRID_COLS),
    h: z.number().int().min(1).max(200),
    order: z.number().int().min(0).max(1_000_000),
    title: z.string().max(120).nullable().optional(),
    refreshSeconds: z.number().int().min(5).max(86_400).nullable().optional(),
    settings: z.record(z.string(), z.unknown()).default({}),
    dataBinding: DataBindingSchema.nullable().optional(),
    /**
     * Bounded and strict in SHAPE here; the rules of each source (what a symbol command may take, where a `{ $row }`
     * means something) are applied by the import planner entry by entry, so an entry they refuse is repaired and
     * reported (phase 35 review, F2) instead of refusing the whole file, like a page the board does not carry.
     */
    actions: z.union([InstanceActionsV2ShapeSchema, InstanceActionsSchema]).nullable().optional(),
    /** The in-board page (D-1 (a)); absent = the main page. Must be one of `board.pages`. */
    pageKey: BoardPageKeySchema.optional(),
    /** Shown only while this holds (phase 35); written only when set, like `pageKey`. Its parameter is repaired on import (E9). */
    visibility: PlacementVisibilitySchema.optional(),
    /** The card's compute script (35.5), as text; written only when set. Over the placement cap it is dropped on import, not repaired. */
    transform: PackageTransformSchema.optional(),
  })
  .strict()
export type PackagePlacement = z.infer<typeof PackagePlacementSchema>

export const BoardPackageSchema = z
  .object({
    format: z.literal(BOARD_PACKAGE_FORMAT),
    packageVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    exportedAt: z.string().datetime(),
    board: z
      .object({
        title: z.string().min(1).max(120),
        description: z.string().max(2000).nullable().optional(),
        icon: z.string().max(120).nullable().optional(),
        timeWindow: TimeWindowSchema.nullable().optional(),
        /** Value and entity parameters (phase 41); a v1 / v2 package's are read as the parameters they are. */
        params: BoardParamsInputSchema.nullable().optional(),
        /** Entity aliases (phase 36), a v2 package's: read as entity parameters (the transform below); never written. */
        aliases: BoardAliasesSchema.optional(),
        /** Key filters (phase 36.7); written only when the board has any. */
        filters: BoardFiltersSchema.optional(),
        /** The board's own look (`core:board`, stamped `$v`); revalidated on import. */
        settings: z.record(z.string(), z.unknown()).nullable().optional(),
        /**
         * 12 or 24 columns (21.10); absent = 12. Written only for a 24-column board, so a 12-column
         * package stays readable by an app from before 21.10 (whose strict parse rejects the key).
         */
        gridCols: GridColsSchema.optional(),
        /** In-board pages (D-1 (a)); written only when the board has any, like `gridCols`. */
        pages: BoardPagesSchema.optional(),
        /** The main page's name and icon (phase 29); written only when set. */
        mainPage: MainPageSchema.optional(),
      })
      .strict(),
    /**
     * The newest version of every settings template used inside (`core:card`, `builtin:gauge`, …), so an
     * importer can tell at a glance whether it can read the file. Each part also carries its own `$v`.
     */
    templates: z.record(z.string().max(120), z.number().int().min(1).max(100_000)).optional(),
    placements: z.array(PackagePlacementSchema).max(MAX_PACKAGE_PLACEMENTS),
    /**
     * What the package points at that it cannot carry, so a dry run can name the gaps
     * without walking every placement: boards an `openBoard` opens (ids from the exporting
     * tenant, never valid elsewhere), command keys, and data source keys.
     */
    references: z
      .object({
        boards: z.array(z.string().uuid()).max(500),
        commands: z.array(z.string().max(100)).max(500),
        sources: z.array(z.string().max(100)).max(500),
      })
      .strict(),
  })
  .strict()
  .refine((p) => new Set(p.placements.map((x) => x.key)).size === p.placements.length, {
    message: 'Placement keys must be unique',
    path: ['placements'],
  })
  .refine((p) => { const keys = new Set((p.board.pages ?? []).map((pg) => pg.key)); return p.placements.every((x) => !x.pageKey || keys.has(x.pageKey)) }, {
    message: 'A placement names a page the board does not have',
    path: ['placements'],
  })
  .refine((p) => { const keys = new Set((p.board.params ?? []).map((d) => d.key)); return [...pageInputParamKeys(p.board.pages ?? [])].every((k) => keys.has(k)) }, {
    message: 'A page takes an input the board has no parameter for',
    path: ['board', 'pages'],
  })
  .refine((p) => { const keys = new Set((p.board.params ?? []).map((d) => d.key)); return [...filterParamKeys(p.board.filters ?? [])].every((k) => keys.has(k)) }, {
    message: 'A key filter reads a parameter the board does not have',
    path: ['board', 'filters'],
  })
  // Phase 41 (D41-7): one parameter list. A v2 package's aliases become entity parameters (a key one shares with a parameter
  // is given a free one) and its cards' `{ $alias }` references the `{ $param }` of the parameter; then the list's own rules.
  .transform((p, ctx) => {
    const { aliases, ...board } = p.board
    const n = normalizeBoardParams({ params: board.params ?? [], aliases: aliases ?? [] })
    const listed = BoardParamListSchema.safeParse(n.params)
    if (!listed.success) {
      for (const issue of listed.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['board', 'params', ...issue.path] })
      return z.NEVER
    }
    const refs = entityParamRefIssues(listed.data)
    if (refs.length > 0) {
      ctx.addIssue({ code: 'custom', message: `An entity parameter reads a parameter the board does not have: ${refs[0].message}`, path: ['board', 'params', refs[0].index] })
      return z.NEVER
    }
    return {
      ...p,
      board: { ...board, ...(n.params.length > 0 ? { params: listed.data } : board.params === undefined ? {} : { params: board.params }) },
      placements: p.placements.map((pl) => ({
        ...pl,
        ...(pl.dataBinding ? { dataBinding: normalizeParamRefs(pl.dataBinding, n.aliasKeys).value } : {}),
        ...(pl.actions ? { actions: normalizeParamRefs(pl.actions, n.aliasKeys).value } : {}),
      })),
    }
  })
export type BoardPackage = z.output<typeof BoardPackageSchema>

/** A placement that could not be exported, and why. Returned next to the package, never inside it. */
export interface SkippedPlacement { widgetRef: string; reason: 'widget_not_visible' }

interface ExportBoard {
  title: string
  description?: string | null
  icon?: string | null
  timeWindow?: unknown
  /** Normalised (phase 41): the board's one parameter list. */
  params?: unknown
  filters?: unknown
  settings?: unknown
  gridCols?: number | null
  pages?: unknown
  mainPage?: unknown
}
interface ExportInstance {
  widgetRef: string
  x: number; y: number; w: number; h: number; order: number
  title?: string | null
  refreshSeconds?: number | null
  settings?: unknown
  dataBinding?: unknown
  actions?: unknown
  pageKey?: string | null
  /** Phase 35: the card's visibility rule, if any. */
  visibility?: unknown
  /** 7b: the published version this placement pins, if any. */
  pinnedVersion?: number | null
  /** 35.5: the stored compute script, carried as text. */
  transform?: unknown
}
/** The part of a resolved descriptor the package needs (`resolvePlacedWidgets`). */
export interface ExportDescriptor {
  key: string
  isSystem?: boolean
  /** 21.8: a tenant-authored widget's published template, so its cards export migrated and stamped. */
  componentId?: string | null
  schema?: object | null
  settingsTemplate?: { id: string; version: number } | null
  settingsMigrations?: TenantMigrationStep[] | null
}

/**
 * A tenant-authored card's settings as they travel (21.8): migrated to the widget's published
 * `tenant:<type>` version and stamped, so the importer can tell which version wrote them. A builtin,
 * a preset of one (its own template is code's) and anything newer than the template go as stored.
 */
function exportSettings(settings: Record<string, unknown>, widget: PackageWidget, d: ExportDescriptor | undefined): Record<string, unknown> {
  if (widget.kind !== 'tenant' || !d || builtinTypeOfComponent(d.componentId)) return settings
  const res = migrateTenantSettings(tenantTemplate({ type: d.key, schema: d.schema, settingsTemplate: d.settingsTemplate, settingsMigrations: d.settingsMigrations }), settings)
  return res.newer ? settings : res.settings
}

/** `manifest:x` / `ext:x` / `db:<uuid>` → a package widget, or null when the caller could not resolve it. */
export function packageWidgetFor(widgetRef: string, descriptor: ExportDescriptor | undefined): PackageWidget | null {
  if (widgetRef.startsWith('manifest:')) return descriptor ? { kind: 'manifest', key: widgetRef.slice('manifest:'.length) } : null
  if (widgetRef.startsWith('ext:')) return descriptor ? { kind: 'ext', key: widgetRef.slice('ext:'.length) } : null
  if (widgetRef.startsWith('db:')) return descriptor ? { kind: descriptor.isSystem ? 'builtin' : 'tenant', key: descriptor.key } : null
  return null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort()

/**
 * Build the package from a board, its placements and the widgets the exporting caller could
 * resolve. A placement whose widget the caller cannot see is left out and reported, because a
 * package must never reveal a widget its exporter may not open (the same rule a duplicate follows).
 */
export function buildBoardPackage(args: {
  board: ExportBoard
  instances: ExportInstance[]
  descriptors: Map<string, ExportDescriptor>
  /** 7b: pinned definitions keyed `<ref>@<version>` (`resolvePinnedDefinitions`); a pinned card exports at its version. */
  pinned?: Record<string, Partial<ExportDescriptor>>
  now?: Date
}): { package: BoardPackage; skipped: SkippedPlacement[] } {
  const { board, instances, descriptors } = args
  const placements: PackagePlacement[] = []
  const skipped: SkippedPlacement[] = []

  for (const inst of instances) {
    const base = descriptors.get(inst.widgetRef)
    const pin = base && inst.pinnedVersion != null ? args.pinned?.[`${inst.widgetRef}@${inst.pinnedVersion}`] : undefined
    const descriptor = base && pin ? { ...base, ...pin } : base
    const widget = packageWidgetFor(inst.widgetRef, descriptor)
    if (!widget) { skipped.push({ widgetRef: inst.widgetRef, reason: 'widget_not_visible' }); continue }
    placements.push({
      key: `p${placements.length + 1}`,
      widget,
      x: inst.x, y: inst.y, w: inst.w, h: inst.h, order: inst.order,
      ...(inst.title ? { title: inst.title } : {}),
      ...(inst.refreshSeconds ? { refreshSeconds: inst.refreshSeconds } : {}),
      settings: exportSettings(isPlainObject(inst.settings) ? inst.settings : {}, widget, descriptor),
      ...(inst.dataBinding ? { dataBinding: inst.dataBinding as PackagePlacement['dataBinding'] } : {}),
      ...(inst.actions ? { actions: inst.actions as PackagePlacement['actions'] } : {}),
      ...(inst.pageKey ? { pageKey: inst.pageKey } : {}),
      ...(inst.visibility ? { visibility: inst.visibility as PackagePlacement['visibility'] } : {}),
      ...(inst.transform ? { transform: inst.transform as PackagePlacement['transform'] } : {}),
    })
  }

  const pkg: BoardPackage = {
    format: BOARD_PACKAGE_FORMAT,
    // A board of value parameters only stays a v2 file (the shape an app from before phase 41 reads).
    packageVersion: Array.isArray(board.params) && board.params.some((d) => typeof d === 'object' && d !== null && 'kind' in d) ? BOARD_PACKAGE_VERSION : 2,
    exportedAt: (args.now ?? new Date()).toISOString(),
    board: {
      title: board.title,
      ...(board.description ? { description: board.description } : {}),
      ...(board.icon ? { icon: board.icon } : {}),
      ...(board.timeWindow ? { timeWindow: board.timeWindow as BoardPackage['board']['timeWindow'] } : {}),
      ...(Array.isArray(board.params) && board.params.length > 0 ? { params: board.params as BoardPackage['board']['params'] } : {}),
      ...(Array.isArray(board.filters) && board.filters.length > 0 ? { filters: board.filters as NonNullable<BoardPackage['board']['filters']> } : {}),
      ...(isPlainObject(board.settings) && Object.keys(board.settings).some((k) => k !== '$v') ? { settings: board.settings } : {}),
      ...(normalizeGridCols(board.gridCols) !== 12 ? { gridCols: normalizeGridCols(board.gridCols) } : {}),
      ...(Array.isArray(board.pages) && board.pages.length > 0 ? { pages: board.pages as NonNullable<BoardPackage['board']['pages']> } : {}),
      ...(isPlainObject(board.mainPage) && Object.keys(board.mainPage).length > 0 ? { mainPage: board.mainPage as NonNullable<BoardPackage['board']['mainPage']> } : {}),
    },
    templates: templatesManifest([board.settings, ...placements.map((p) => p.settings)]),
    placements,
    references: collectReferences(placements),
  }
  return { package: pkg, skipped }
}

/**
 * What a set of placements points at that a package cannot carry: the boards an `openBoard` opens
 * (lowercased), the command keys and the data source keys. Read off the placements themselves, so
 * the export writes it and the import (19.6) recomputes it instead of believing the file.
 */
export function collectReferences(placements: Array<{ actions?: unknown; dataBinding?: unknown }>): BoardPackage['references'] {
  const boards: string[] = []
  const commands: string[] = []
  const sources: string[] = []
  for (const p of placements) {
    for (const e of allEntriesOf(p.actions)) {
      const a = e.action as { kind: string; boardId?: unknown }
      if (a.kind === 'openBoard' && typeof a.boardId === 'string') boards.push(a.boardId.toLowerCase())
    }
    for (const a of allActionsOf(p.actions)) {
      if (a.kind === 'command' && typeof a.commandKey === 'string' && a.commandKey) commands.push(a.commandKey)
    }
    for (const q of Object.values((p.dataBinding ?? {}) as Record<string, { sourceKey?: unknown }>)) {
      if (q && typeof q.sourceKey === 'string') sources.push(q.sourceKey)
    }
  }
  return { boards: uniqueSorted(boards), commands: uniqueSorted(commands), sources: uniqueSorted(sources) }
}

/**
 * The same actions with every `openBoard` target passed through `map` (19.6), in whichever shape
 * they are stored (v1 `{ onClick }` or v2 `sources`). The bundle export uses it to turn a board id
 * into a bundle-local ref, the bundle import to turn that ref into the new board's id. Returns the
 * input itself when nothing changed; never mutates it.
 */
export function mapOpenBoardTargets<T>(actions: T, map: (boardId: string) => string): T {
  if (!isPlainObject(actions)) return actions
  const swap = (a: unknown): unknown => {
    if (!isPlainObject(a) || a.kind !== 'openBoard' || typeof a.boardId !== 'string') return a
    const next = map(a.boardId.toLowerCase())
    return next === a.boardId.toLowerCase() ? a : { ...a, boardId: next }
  }
  let changed = false
  if (actions.v === 2 && isPlainObject(actions.sources)) {
    const sources: Record<string, unknown> = {}
    for (const [key, list] of Object.entries(actions.sources)) {
      sources[key] = Array.isArray(list)
        ? list.map((e) => {
          if (!isPlainObject(e)) return e
          const action = swap(e.action)
          if (action === e.action) return e
          changed = true
          return { ...e, action }
        })
        : list
    }
    return (changed ? { ...actions, sources } : actions) as T
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(actions)) {
    const next = swap(value)
    if (next !== value) changed = true
    out[key] = next
  }
  return (changed ? out : actions) as T
}

/** A file name for the download: the title reduced to `[a-z0-9-]`, never empty, never a path. */
export function packageFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || 'dashboard'}.board.json`
}

/** The highest version of each settings template stamped (`$v`) anywhere in these settings objects. */
export function templatesManifest(settings: unknown[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of settings) {
    const stamp = isPlainObject(s) && isPlainObject(s.$v) ? s.$v : {}
    for (const [id, v] of Object.entries(stamp)) {
      if (Number.isInteger(v) && (v as number) >= 1 && (out[id] === undefined || (v as number) > out[id])) out[id] = v as number
    }
  }
  return out
}

/**
 * Before the strict parse: a file from a NEWER package format gets a clear message instead of a dump
 * of schema errors (`null` = readable, go on and parse). `newer` tells a file from a newer version of this
 * app (updating fixes it) from one in a format that is simply not supported.
 */
export interface PackageVersionProblem { newer: boolean; message: string }

export function packageVersionProblem(raw: unknown): PackageVersionProblem | null {
  if (!isPlainObject(raw) || raw.format !== BOARD_PACKAGE_FORMAT) return null
  const v = raw.packageVersion
  if (typeof v === 'number' && Number.isInteger(v) && !(SUPPORTED_PACKAGE_VERSIONS as readonly number[]).includes(v)) {
    return v > BOARD_PACKAGE_VERSION
      ? { newer: true, message: `This dashboard was exported by a newer version (package format ${v}); update this app to import it.` }
      : { newer: false, message: `This package format (${v}) is not supported.` }
  }
  return null
}
