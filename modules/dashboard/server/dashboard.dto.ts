import { z } from 'zod'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { ENTITY_TYPE_PATTERN } from '@kuraykaraaslan-labs/common/server/common.crm-contracts'
import { isInternalPath } from './internal-path'
import { tokenPlaceholder, tokensAfterOrigin, usesRowToken } from './action-tokens'
import { TimeWindowSchema, WindowOffsetSchema, TimeZoneSchema, BoardContextParamsSchema, isReservedParamKey } from './board-window'
import { BoardParamsInputSchema } from './board-params'
import { BoardAliasesSchema, AliasEntitiesSchema } from './board-aliases'
import { BoardFiltersSchema } from './board-filters'
import { GridColsSchema, MAX_GRID_COLS } from './grid-cols'
import { BoardPageKeySchema, BoardPagesSchema, MainPageSchema, PAGE_DISPLAYS, PAGE_SIZES } from './board-pages'
import { ANY_ELEMENT_KEY, ELEMENT_COMMAND_SOURCES as ELEMENT_COMMAND_SOURCE_KEYS, RETIRED_ACTION_SOURCES, CONFIRMABLE_ACTION_KINDS, DATA_CHANGED_ACTION_KINDS, DATA_CHANGED_SOURCE, commandReadsRow, normalizeCondition, type EntryCondition } from './instance-actions'
import { RULE_OPS } from '@kuraykaraaslan-labs/common/server/widget-settings/views/scene-rules-logic'
import { PlacementTransformSchema } from './transform.dto'
import { commandParamReads } from './command.types'

/** Board slug: stable across environments, safe in a URL. */
export const BoardSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Invalid dashboard slug')

/**
 * The surface a placement sits on. `entityType` is validated as a SLUG, not against
 * a closed list: the whole point of the seam is that a surface module we have not
 * written yet can host widgets (docs/phases/07-dashboard/00-master-plan.md §A.2).
 */
export const SurfaceRefSchema = z.object({
  entityType: z.string().regex(ENTITY_TYPE_PATTERN, 'Invalid surface type'),
  entityId: z.string().uuid(),
})

/**
 * `manifest:<id>` (module.json widget) | `db:<uuid>` (tenant-authored, phase 3) |
 * `ext:<contributionId>` (a `dashboard:widget` contribution, phase 6b).
 *
 * The `ext:` id is `${moduleId}:${point}:${key ?? exportPath}` (module-runtime.mjs),
 * so it may itself contain colons, dots and slashes — hence the wider character
 * class rather than a second closed-slug pattern. Was `manifest:`/`db:` only until
 * 2026-09-16: `resolveWorkspaceWidgets` has always returned `ext:` descriptors
 * (`widget-catalog.service.ts` `toExtDescriptor`), but no module had contributed to
 * `dashboard:widget` yet, so the first contribution would have made "Customise"
 * 400 here before ever reaching migration 094's matching CHECK widening.
 */
export const WidgetRefSchema = z
  .string()
  .regex(/^(manifest:[a-z0-9][a-z0-9_-]*|db:[0-9a-f-]{36}|ext:[a-z0-9][a-z0-9_.:/-]*)$/i, 'Invalid widget reference')

export const BoardScopeEnum = z.enum(['TENANT', 'PRIVATE'])

/**
 * Bounded by the widest grid (24, phase 21.10). Whether a card fits THIS board's columns
 * (`x + w <= gridCols`) is checked by the write against the board (`assertFitsBoard`).
 */
const geometry = {
  x: z.number().int().min(0).max(MAX_GRID_COLS - 1),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(MAX_GRID_COLS),
  h: z.number().int().min(1).max(48),
}

export const CreateBoardDTO = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    workspace: z.string().max(64).nullable().optional(),
    /** A module's own board (Faz 9, K2) — exclusive with `workspace`. */
    moduleId: z.string().max(64).nullable().optional(),
    scope: BoardScopeEnum.default('TENANT'),
    isDefault: z.boolean().default(false),
    /** 12 or 24 columns (owner decision 14); omitted means 12. Exactly the `UpdateBoardDTO` rule. */
    gridCols: GridColsSchema.optional(),
  })
  // `ownerUserId` is NOT accepted from the client: a PRIVATE board belongs to the
  // caller, full stop. Taking it from the body would let anyone mint a board owned
  // by someone else and, with `isDefault`, replace that person's admin home.
  //
  // `slug` is likewise not accepted (Faz 9, K6): `@Unique(['tenantId', 'slug'])`
  // is tenant-wide, so a client-chosen slug could 409 on a stranger's private
  // board and confirm it exists to someone who should see neither. The server
  // mints one from `title` (`board.crud.service.ts`'s `mintSlug`); only the
  // internal callers that need a deterministic slug (a workspace's implicit
  // board, a template) pass one through the service directly, never through
  // this DTO.
  .strict()
  .refine((v) => !(v.workspace && v.moduleId), {
    message: 'A board anchors to a workspace or a module, never both',
    path: ['moduleId'],
  })

export const UpdateBoardDTO = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    isDefault: z.boolean().optional(),
    /** The board's own settings (`core:board`, phase 21): validated, migrated and stamped by the server. `null` = defaults. */
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    /** 12 or 24 columns (21.10). A change rescales every placement's `x`/`w` in the same write. */
    gridCols: GridColsSchema.optional(),
    /** Board default time window (`null` clears it). Writers only — same gate as the rest of this DTO. */
    timeWindow: TimeWindowSchema.nullable().optional(),
    /**
     * The board's parameters, values and entities in one list (phase 41), at most 48 of which 16 values (`null` clears them).
     * Items of the phase 10 shape are read as the parameters they are (an entity `remote-select` as an entity parameter).
     * One a card still reads cannot be removed (409).
     */
    params: BoardParamsInputSchema.nullable().optional(),
    /**
     * Entity aliases (phase 36), the old shape: stored as entity parameters, replacing those the legacy editor shows as aliases
     * (`withLegacyAliases`); with `params`, the two are the legacy pair. At most 32 (`null` clears them).
     */
    aliases: BoardAliasesSchema.nullable().optional(),
    /** Key filters (phase 36.7), at most 16 (`null` clears them). One in use by a widget cannot be removed (409). */
    filters: BoardFiltersSchema.nullable().optional(),
    /** In-board pages (D-1 (a)); `null` clears them. A page that still holds cards cannot be removed (409). */
    pages: BoardPagesSchema.nullable().optional(),
    /** The main page's name and icon (phase 29); `null` = "Main". */
    mainPage: MainPageSchema.nullable().optional(),
    /**
     * Share a personal board with the workspace (phase 39, UX-1): `'TENANT'` only, one way. Needs `dashboard.boards.manage`
     * and a free shared slot, both checked by the server; a shared board is never made personal again (copy it instead).
     */
    scope: z.literal('TENANT').optional(),
    /** Optimistic lock: the revision the editor loaded. */
    expectedRevision: z.number().int().min(0).optional(),
  })
  .strict()

/**
 * One slot's binding: names a (source, query, params) triple and NOTHING else —
 * no URL exists in this model (phase 4b §3.3). Authority lives in the runner
 * route, which re-checks discoverability + the query's own permission on every
 * execution; this stored shape is a pointer, not a credential.
 */
export const DataBindingSchema = z.record(
  // A slot key, or `<slot>#2` ... `<slot>#8` for the extra sources of a repeatable slot (18.3);
  // that the base slot exists and is repeatable is checked against the widget at write time.
  z.string().min(1).max(60).regex(/^[^#]+(#[2-8])?$/, 'Invalid slot key'),
  z
    .object({
      sourceKey: z.string().min(1).max(100),
      queryKey: z.string().min(1).max(200),
      params: z.record(z.string(), z.unknown()).default({}),
      /** `'board'` (default) follows the board window; an object pins this placement's own. */
      window: z.union([z.literal('board'), TimeWindowSchema]).optional(),
      /** Read the window just before the one this query follows (24.2b). Only a query that follows a window uses it. */
      windowOffset: WindowOffsetSchema.optional(),
    })
    .strict(),
)

/**
 * A widget action (phase 5 §4.3 `ACTIONS`) — a CLOSED set, because each member
 * is a handler the host implements, not a script the widget runs (the
 * `dynamic_page` `INTERACTION_ACTIONS` precedent).
 *
 * `navigate` carries an internal path only — leading `/`, and never `//` (a
 * protocol-relative URL) or a `scheme:` — so a configured action cannot become
 * an open redirect. `openUrl` is an explicit external `http(s)` URL and opens a
 * new tab. `refreshWidget` / `refreshBoard` carry nothing.
 *
 * Phase 16 added `setParams`, `openBoard`, `copyToClipboard`, `showNotification` and
 * `back` (below), and `{{param_<key>}}` / `{{row_<column>}}` tokens in a navigate path,
 * an openUrl URL and a message (`action-tokens.ts`). `setVariable` and `openDialog` from the spec's list are still deliberately
 * NOT here: a variable store and a dialog registry do not exist (`POSTURE.md` §8).
 */
/** A param value an action sets: a literal, or the current value of another board param. */
/**
 * The board a query, a live ticket or a command runs on, with the VIEWER's overrides (window, `p.*`); the server
 * merges the saved defaults itself. Strict, so the client must send exactly this shape: `ui/board-context.tsx`
 * `wireBoardContext` builds it, and `ui/tests/board-context.wire.test.ts` pins the two together (a client-only field
 * once made every live ticket and command a 400).
 */
const boardContextFields = {
  window: TimeWindowSchema.optional(),
  params: BoardContextParamsSchema.optional(),
  /** The viewer's current entity per single-resolve alias (phase 36, E36-6; `a.<key>` in the URL), checked against the resolved set. */
  aliasEntities: AliasEntitiesSchema.optional(),
  /** The viewer's browser zone: what a window with no zone of its own runs in (D-11). */
  viewerTimezone: TimeZoneSchema.optional(),
}
/** A stored board or a transient template render, exactly one of the two (query and live-ticket routes). */
/**
 * GET …/dashboard/boards?page=… : one page of the dashboards list (`/admin/dashboards`, the phase 43 list contract; owner 2026-10-26:
 * "paginate it, do not fetch every board at once"). `scope` is who sees a board, `workspace` the workspaces it is filed under
 * (`none` = standalone); with neither, every board the caller may open, of every workspace.
 */
export const BoardListQueryDTO = listQuerySchema({
  sortable: { title: 'title', updatedAt: 'updatedAt', scope: 'scope', workspace: 'workspace' },
  defaultSort: 'updatedAt:desc',
  filters: { scope: listFilter.oneOf(['TENANT', 'PRIVATE'] as const), workspace: listFilter.ids() },
})
export type BoardListQuery = z.infer<typeof BoardListQueryDTO>

/** PUT …/dashboard/home: the standalone board the caller lands on from now on (any board they can open; owner 2026-10-26). */
export const SetHomeDTO = z.object({ boardId: z.string().uuid() }).strict()

/** Discard in Customise: the copy taken when Customise started, and whether to overwrite someone else's change made since. */
export const RestoreBoardDTO = z.object({ snapshotId: z.string().uuid(), overwrite: z.boolean().optional() }).strict()

export const BoardContextDTO = z.object({
  boardId: z.string().uuid().optional(),
  templateKey: z.string().min(1).max(64).optional(),
  ...boardContextFields,
}).strict().refine((c) => !!c.boardId !== !!c.templateKey, { message: 'Exactly one of boardId / templateKey' })
/** A stored board only (the command route: a command runs from a stored placement). */
export const StoredBoardContextDTO = z.object({ boardId: z.string().uuid(), ...boardContextFields }).strict()

/** A slot reading, `<slot>` or `<slot>.<column>` (phase 35.2, E13): never a prototype member name on either side. */
export const SlotRefKeySchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_.-]+)?$/, 'A slot reading is <slot> or <slot>.<column>')
  .refine((k) => !k.split('.').some((part) => part.startsWith('__') || isReservedParamKey(part)), 'Reserved slot or column name')
/** What a `$map` case answers, and what a `$map` may start from besides a reference: a plain literal. */
const ParamLiteralSchema = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])
/** The references a parameter source may make: another parameter, the clicked row's column, the control's own value. */
const ParamRefSchema = z.union([
  z.object({ $param: z.string().min(1).max(60) }).strict(),
  // The clicked row's column (phase 16.3). Only meaningful, and only accepted, on a
  // source that carries a row (`ROW_ACTION_SOURCES`); see `InstanceActionsV2Schema`.
  z.object({ $row: z.string().min(1).max(100) }).strict(),
  // The control's own value (phase 35): what a switch, a slider or a set-point was set to. Only a control's `click`
  // carries one, and only `setParams` / `openPage` there may read it (`InstanceActionsV2Schema`); a button's press
  // carries no value, so such an entry leaves its target alone.
  z.object({ $value: z.literal(true) }).strict(),
  // The card's own data (phase 35.2, E13): `<slot>` (a scalar's value, a table's row count) or `<slot>.<column>` (the first
  // row's column, a record's field), read on the client from what the card draws (after its compute script). Any source
  // may read it: the data is the card's, whatever fired the entry.
  z.object({ $slot: SlotRefKeySchema }).strict(),
])
/** At most this many cases in a `$map`; a value map is a small lookup, not a table. */
export const MAX_MAP_CASES = 50
/**
 * A value mapped without an expression (phase 35): `from` resolved like any other source, then looked up in `cases`
 * by its text (`String(from)`), `else` when no case matches, and the target left alone when there is no `else`
 * either. `from` is a literal or one of the references above, never another `$map` (no nesting: one lookup is a
 * rule, two are a program), and the references in `from` are held to the same source rules as a bare one.
 */
const ParamMapSchema = z
  .object({
    $map: z
      .object({
        from: z.union([ParamLiteralSchema, ParamRefSchema]),
        // A case is the text a value is compared as; never a `$`-word, so no case can read as a reference to a walker.
        cases: z.record(z.string().max(120).refine((k) => !k.startsWith('$'), 'A case may not start with "$"'), ParamLiteralSchema)
          .refine((c) => Object.keys(c).length <= MAX_MAP_CASES, `At most ${MAX_MAP_CASES} cases`),
        else: ParamLiteralSchema.optional(),
      })
      .strict(),
  })
  .strict()

export const ParamSourceSchema = z.union([ParamLiteralSchema, ParamRefSchema, ParamMapSchema])
export type ParamSource = z.infer<typeof ParamSourceSchema>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** The `from` of a `$map` source, or the source itself: where a reference may sit. */
function sourceHead(v: unknown): unknown {
  return isObj(v) && isObj(v.$map) ? v.$map.from : v
}
/** Does a parameter source read the clicked row (`{ $row }`, bare or as a `$map`'s `from`)? */
export const sourceUsesRow = (v: unknown): boolean => { const h = sourceHead(v); return isObj(h) && '$row' in h }
/** Does a parameter source read the control's value (`{ $value }`, bare or as a `$map`'s `from`)? */
export const sourceUsesValue = (v: unknown): boolean => { const h = sourceHead(v); return isObj(h) && '$value' in h }

/**
 * The references a stored COMMAND param may make (phase 12 §12.7, widened in 35.2): another board parameter, the
 * control's value, one field of a form's value, a column of the clicked row (E14: a `resourceId` param on a row source
 * only, see `InstanceActionsV2Schema` and `assertCommandAuthoring`), a value map and a linear scale. Resolved on the
 * server from the stored placement (`resolveCommandParams`); the client never sends one. No expression exists.
 */
const CommandBareRefSchema = z.union([
  // Another board parameter; an entity parameter optionally through a board filter (phase 41, what `{ $alias, filter }` was).
  z.object({ $param: z.string().min(1).max(60), filter: z.string().min(1).max(40).optional() }).strict(),
  z.object({ $value: z.literal(true) }).strict(),
  z.object({ $field: z.string().min(1).max(100) }).strict(),
  z.object({ $row: z.string().min(1).max(100) }).strict(),
  // A board alias of one entity (phase 36), on a parameter the command declares `entityTypes` for; resolved by the run route.
  // Read as the `{ $param }` of the entity parameter it became (phase 41); a write stores that.
  z.object({ $alias: z.string().min(1).max(40), filter: z.string().min(1).max(40).optional() }).strict(),
])
export const CommandParamRefSchema = z.union([
  CommandBareRefSchema,
  // `from` absent = the control's value; looked up by its text; an unmatched value with no `else` is a 422 at run time.
  z.object({
    $map: z.object({
      from: CommandBareRefSchema.optional(),
      cases: z.record(z.string().max(120).refine((k) => !k.startsWith('$'), 'A case may not start with "$"'), ParamLiteralSchema)
        .refine((c) => Object.keys(c).length >= 1 && Object.keys(c).length <= MAX_MAP_CASES, `1 to ${MAX_MAP_CASES} cases`),
      else: ParamLiteralSchema.optional(),
    }).strict(),
  }).strict(),
  // The control's value, `value * factor + offset`, rounded to `round` decimals (the linear scale of automation's range block).
  z.object({
    $scale: z.object({
      factor: z.number().finite(),
      offset: z.number().finite().optional(),
      round: z.number().int().min(0).max(6).optional(),
    }).strict(),
  }).strict(),
])
/**
 * One stored command param: a literal of any shape the command's own schema takes (checked at save against the
 * command's `FieldSchema`, `assertCommandAuthoring`, and again on every run), or one of the references above. An
 * object that names a `$`-key is a reference and must be a well-formed one: a misspelt or extended reference is
 * refused here instead of reaching `execute()` as a literal object.
 */
export const CommandParamValueSchema = z.unknown().superRefine((v, ctx) => {
  if (!isObj(v) || !Object.keys(v).some((k) => k.startsWith('$'))) return
  if (!CommandParamRefSchema.safeParse(v).success) {
    ctx.addIssue({ code: 'custom', message: 'A command parameter reference is { $param }, { $value }, { $field }, { $row }, { $alias }, { $map } or { $scale }' })
  }
})

/** An absolute http(s) URL: what an `openUrl` template must be once its tokens are placeholders. */
const HTTP_URL = z.string().url().refine((v) => /^https?:\/\//i.test(v))

export const WidgetActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('navigate'),
      // May carry `{{param_<key>}}` / `{{row_<column>}}` tokens (16.5): the template is checked with
      // each token as a placeholder, and the runner re-checks the expanded, URL-encoded path.
      to: z
        .string()
        .min(1)
        .max(2000)
        .refine((v) => isInternalPath(tokenPlaceholder(v)), 'navigate.to must be an internal path beginning with a single "/" (no scheme, backslash or control character)'),
      /** Open the target in a new tab (16.5). Absent means this tab, as before. */
      newTab: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('openUrl'),
      // Tokens (16.5) are allowed after the origin only, so a parameter can never choose the host.
      url: z
        .string()
        .max(2000)
        .refine((v) => HTTP_URL.safeParse(tokenPlaceholder(v)).success && tokensAfterOrigin(v), 'openUrl.url must be http(s); tokens may only follow the host'),
      newTab: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('command'),
      /** A `dashboard:command` contribution key — resolved and permission-checked server-side on every run. */
      commandKey: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/, 'Invalid command key'),
      /**
       * Literal values, `{ "$param": "<boardParam>" }` (phase 10), `{ "$value": true }` (the control widget's current
       * value), `{ "$field" }`, and since 35.2 `{ "$map" }`, `{ "$scale" }` and (E14) `{ "$row" }`
       * (`CommandParamValueSchema`). The CLIENT never sends these: the server reads them from the stored placement.
       */
      params: z.record(z.string(), CommandParamValueSchema).default({}),
    })
    .strict(),
  z.object({ kind: z.literal('refreshWidget') }).strict(),
  z.object({ kind: z.literal('refreshBoard') }).strict(),
  // Phase 16.2: merge values into the viewer's `p.*` in place (drill-down on the same
  // board). Values are a literal or `{ $param: key }` (another param's current value);
  // the host validates each one against the board's own definition before it lands.
  z
    .object({
      kind: z.literal('setParams'),
      set: z
        .record(
          z.string().min(1).max(60).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid param key'),
          ParamSourceSchema,
        )
        .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 16, 'setParams needs 1 to 16 params'),
    })
    .strict(),
  // Phase 16.5: open another stored board, optionally preselecting its params
  // (`p.<key>` in the URL). The source board cannot know the target's param defs, so
  // the target's own URL parser re-validates every value against ITS definitions and
  // drops what it would reject; nothing is sent to a server from here.
  z
    .object({
      kind: z.literal('openBoard'),
      boardId: z.string().uuid(),
      set: z
        .record(
          z.string().min(1).max(60).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid param key'),
          ParamSourceSchema,
        )
        .refine((r) => Object.keys(r).length <= 16, 'openBoard takes at most 16 params')
        .default({}),
      newTab: z.boolean().default(false),
      // Phase 35: the period travels: the viewer's window in effect goes into the target's URL, where the target's own
      // parser validates it like any link (an unreadable or over-long window is ignored there, never forwarded).
      keepWindow: z.boolean().optional(),
    })
    .strict(),
  // Phase 16.8: the declarative replacements for custom JS. `copyToClipboard` copies a literal, a
  // board parameter or (on a row source) a clicked row's column; `showNotification` shows a fixed
  // message in the host's toast. Neither reaches a server and neither takes markup or a URL.
  z
    .object({
      kind: z.literal('copyToClipboard'),
      value: ParamSourceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('showNotification'),
      /** Plain text; `{{param_<key>}}` / `{{row_<column>}}` tokens are filled in as text when it is shown. */
      message: z.string().min(1).max(300),
      variant: z.enum(['info', 'success', 'warning', 'error']).default('info'),
    })
    .strict(),
  // D-1 (a): show another in-board page of THIS board (`null` = the main page), optionally setting parameters first
  // (a list page drilling into a detail page). Phase 29: the page opens over the one the card is on (a new frame). The page must be one of the board's when the placement is written;
  // the host still ignores a page it does not have, so a stale action never blanks the board.
  z
    .object({
      kind: z.literal('openPage'),
      page: BoardPageKeySchema.nullable(),
      set: z
        .record(
          z.string().min(1).max(60).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid param key'),
          ParamSourceSchema,
        )
        .refine((r) => Object.keys(r).length <= 16, 'openPage takes at most 16 params')
        .default({}),
      /** Phase 29: how to show it (a page, a side panel, a dialog, a popover); absent = the page's own `opensAs`. */
      as: z.enum(PAGE_DISPLAYS).optional(),
      /** Panel / dialog / popover width; absent = the page's own `size`. */
      size: z.enum(PAGE_SIZES).optional(),
    })
    .strict(),
  // Phase 35: a widget gesture changes the board's time window (a chart brush, a "last 24 hours" button): a window
  // literal, the board's own default (`boardDefault`, which clears the viewer's choice), or the range the gesture
  // carried (`{ $range }`, only on the `rangeSelect` source, see `InstanceActionsV2Schema`). The host validates the
  // window it is about to set with `TimeWindowSchema` and the 366-day cap, whatever this stored shape says; it never
  // reaches the window from a template or plugin frame (their click runs without `setWindow`).
  z
    .object({
      kind: z.literal('setWindow'),
      window: z.union([TimeWindowSchema, z.literal('boardDefault'), z.object({ $range: z.literal(true) }).strict()]),
    })
    .strict(),
  // Phase 16.5: walk back up the drill-down trail (17.2a) `levels` boards, or to its first board.
  // Built from the trail the host already holds; with no board behind this one it does nothing.
  // Phase 29: pages opened inside this board (frames) are closed first; only then does it leave the board.
  z
    .object({
      kind: z.literal('back'),
      levels: z.number().int().min(1).max(8).optional(),
      toRoot: z.boolean().optional(),
    })
    .strict(),
])
export type WidgetAction = z.infer<typeof WidgetActionSchema>

/**
 * The closed action kinds, read off the schema rather than hand-copied.
 *
 * `widget-editor.page.tsx`'s Actions tab used to keep its own seven-entry list
 * (the spec's full set, before `showNotification`/`setVariable`/`openDialog`
 * were deferred) while this schema had already narrowed to four — an editor
 * advertising three actions the API would reject, and a fourth under the wrong
 * name (`refreshSurface` instead of `refreshBoard`). Deriving from
 * `WidgetActionSchema.options` means the UI's list can never say more than the
 * DTO accepts.
 */
export const WIDGET_ACTION_KINDS = WidgetActionSchema.options.map(
  (option) => option.shape.kind.value,
) as Array<WidgetAction['kind']>

/** Per-placement action config. `onClick` is the only trigger v1 wires. */
export const InstanceActionsSchema = z
  .object({
    onClick: WidgetActionSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => !v.onClick || (!actionUsesRow(v.onClick) && !commandUsesRow(v.onClick)), '{ $row } needs a source that carries a row; use the v2 actions shape')
export type InstanceActions = z.infer<typeof InstanceActionsSchema>

/**
 * Action model v2 (phase 16.1): several triggers ("sources") per placement, a list
 * of entries per source. Stored in the same `instances.actions` jsonb, tagged
 * `v: 2`; the v1 `{ onClick }` shape keeps validating and is read through
 * `normalizeInstanceActions`, so no data migration is needed.
 */
export const ACTION_SOURCE_KEYS = [
  'cardClick', 'click', 'headerButton', 'rowClick', 'rowDoubleClick', 'actionCellButton', 'cellClick',
  // `sliceClick`: a slice of a pie chart, carrying the slice's datum as the row (phase 35, B7: until then accepted and fired by
  // nothing). `nodeSelected` was removed in the same phase: no widget has nodes; a stored entry under it is dropped on read
  // (`RETIRED_ACTION_SOURCES`, `instance-actions.ts`), and the write refuses it as an unknown source.
  'elementClick', 'markerClick', 'sliceClick',
  // Double click and right click on a card, and click / double click / right click on one symbol of a process diagram
  // (`elementKey` is the symbol's id). A card gesture never runs a command (the control widgets own those, OD-80); a symbol
  // gesture may (decision 49), behind a confirmation.
  'cardDoubleClick', 'cardContextClick', 'elementDoubleClick', 'elementContextClick',
  // Phase 35: a range brushed on a series chart (`ctx.range = { from, to }` ms): the one source a `{ $range }` window
  // may come from.
  'rangeSelect',
  // Phase 35.2 (E13): the card's data changed. No gesture and no person: `setParams` and `showNotification` only,
  // idempotent, at most once per 2 s per placement, never on a display screen or in the editor (`ui/data-changed.ts`).
  'dataChanged',
] as const
export type ActionSourceKey = (typeof ACTION_SOURCE_KEYS)[number] | `${string}.${string}`

/** A core source, or a widget-declared one written `<widgetType>.<name>`. */
export const ActionSourceKeySchema = z.string().max(80).refine(
  (k) => (ACTION_SOURCE_KEYS as readonly string[]).includes(k) || /^[a-z][a-zA-Z0-9_-]*\.[a-zA-Z0-9_.-]+$/.test(k),
  'Unknown action source',
)

/**
 * A declarative condition on one action entry (16.6; widened in phase 35, E7, to the scene-rule engine's vocabulary,
 * so a button condition and a symbol rule read the same): a reading (`source: 'param'`, a board parameter by key;
 * `source: 'row'`, a column of the clicked row, on a row source only), one of `RULE_OPS`, a literal `value` (and `to`,
 * the upper end of `between`), and optionally a second term joined `all` (and) / `any` (or). Evaluated by one pure
 * function on the host and on the server (`conditionHolds`), so there is no expression language and no script. The
 * 16.6 shape `{ param, op, value }` is still accepted and normalised to this one on write; a stored one is read
 * through the same normaliser.
 */
export const ENTRY_CONDITION_OPS = RULE_OPS
// A prototype member name is never a board parameter or a column worth reading (`BoardParamKeySchema` refuses it) and
// would only ever match the prototype of the host's object, so it is refused here too.
const ConditionKeySchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid condition key')
  .refine((k) => !k.startsWith('__') && !isReservedParamKey(k), 'Reserved condition key')
// A `param` term reads a board parameter, so its key keeps the 16.6 bound (60 characters): a longer one can never name a
// parameter and is a malformed condition (400), not an unknown reference. Only a `row` term may name a longer column.
const MAX_PARAM_CONDITION_KEY = 60
const ParamConditionKeySchema = z.string().min(1).max(MAX_PARAM_CONDITION_KEY).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid param key')
  .refine((k) => !k.startsWith('__') && !isReservedParamKey(k), 'Reserved param key')
const paramKeyTooLong = (source: unknown, key: unknown) =>
  source !== 'row' && source !== 'slot' && typeof key === 'string' && key.length > MAX_PARAM_CONDITION_KEY
/** A slot term (35.2, E13) reads `<slot>` or `<slot>.<column>`; only the latter, over a table's rows, takes `quantifier`. */
const CONDITION_SOURCES = ['param', 'row', 'slot'] as const
const QuantifierSchema = z.enum(['any', 'all'])
const badSlotTerm = (t: { source?: string; key?: string; quantifier?: string }): string | null => {
  if (t.quantifier !== undefined && (t.source !== 'slot' || !t.key?.includes('.'))) return 'A quantifier needs a slot term over a column (<slot>.<column>)'
  if (t.source === 'slot' && t.key !== undefined && !SlotRefKeySchema.safeParse(t.key).success) return 'A slot term reads <slot> or <slot>.<column>'
  return null
}
const ConditionLiteralSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()])
const ConditionTermSchema = z
  .object({
    source: z.enum(CONDITION_SOURCES).optional(),
    key: ConditionKeySchema,
    op: z.enum(ENTRY_CONDITION_OPS),
    value: ConditionLiteralSchema.optional(),
    /** The upper end of `between`. */
    to: ConditionLiteralSchema.optional(),
    /** A slot term over a column: `any` row (the default) or `all` rows (35.2, E13). */
    quantifier: QuantifierSchema.optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (paramKeyTooLong(t.source, t.key)) ctx.addIssue({ code: 'custom', message: 'Invalid param key', path: ['key'] })
    const slot = badSlotTerm(t)
    if (slot) ctx.addIssue({ code: 'custom', message: slot, path: ['key'] })
  })
export const EntryConditionSchema = z
  .object({
    /** The 16.6 shape: the board parameter read; exclusive with `key` / `source` / `to` / a second term. */
    param: ParamConditionKeySchema.optional(),
    source: z.enum(CONDITION_SOURCES).optional(),
    key: ConditionKeySchema.optional(),
    op: z.enum(ENTRY_CONDITION_OPS),
    value: ConditionLiteralSchema.optional(),
    to: ConditionLiteralSchema.optional(),
    quantifier: QuantifierSchema.optional(),
    join: z.enum(['all', 'any']).optional(),
    second: ConditionTermSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if ((c.param === undefined) === (c.key === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'A condition reads exactly one key (`key`, or the 16.6 `param`)', path: ['key'] })
    }
    const slot = badSlotTerm(c)
    if (slot) ctx.addIssue({ code: 'custom', message: slot, path: ['key'] })
    if (c.param !== undefined && (c.source !== undefined || c.to !== undefined || c.join !== undefined || c.second !== undefined || c.quantifier !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'The 16.6 condition shape takes a parameter, an operator and a value only', path: ['param'] })
    }
    if (c.join !== undefined && c.second === undefined) ctx.addIssue({ code: 'custom', message: 'join needs a second condition', path: ['join'] })
    if (paramKeyTooLong(c.source, c.key)) ctx.addIssue({ code: 'custom', message: 'Invalid param key', path: ['key'] })
  })
  // Stored in the one shape every reader expects; `normalizeCondition` cannot refuse what the checks above let through.
  .transform((c): EntryCondition => normalizeCondition(c) as EntryCondition)
export type { EntryCondition }

/** Does a condition read the clicked row (E7)? Only valid on a source that carries one, like `{ $row }`. */
export function conditionUsesRow(raw: unknown): boolean {
  const c = normalizeCondition(raw)
  return !!c && (c.source === 'row' || c.second?.source === 'row')
}

/**
 * Does a condition read the card's own data (35.2, E13)? Judged on the client against what the card draws; a reader that
 * has no data (the symbol command's run route, a card's visibility judged before its data and on a display's server)
 * refuses it at write instead of judging it as always failing.
 */
export function conditionUsesSlot(raw: unknown): boolean {
  const c = normalizeCondition(raw)
  return !!c && (c.source === 'slot' || c.second?.source === 'slot')
}

export const ActionEntrySchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid action id'),
    name: z.string().max(120).default(''),
    icon: z.string().max(60).optional(),
    /** Table sources: the column a cell-level entry hangs off. */
    columnKey: z.string().min(1).max(100).optional(),
    /** Markdown / HTML sources: the element id a click is bound to. */
    elementKey: z.string().min(1).max(100).optional(),
    /** Offer this entry only while its condition holds (every source except `cardClick`; on a control's `click` it disables the control, 16.7; judged in turn in a sequence, B4). */
    when: EntryConditionSchema.optional(),
    /**
     * A symbol's command only (decision 49): the confirmation the run asks for, on top of the command's own policy.
     * `confirm` (the default, filled in when the entry is written) asks "Are you sure?"; `typed` also needs the command's
     * confirmation text typed. There is no `none`: a command from a symbol is always confirmed.
     * Phase 35: `confirm` also on a `setParams`, `openPage`, `openBoard` or `back` entry on any source: the host asks
     * before it runs and skips it on a no (`entryAsksFirst`, `instance-actions.ts`). Client-asserted, like `when`.
     * D175: any other command entry asks first too, enforced by the run route (`commandEntryFloor`); `none` turns that off for a
     * low-risk control, an explicit choice of the author (a symbol's command never takes it).
     */
    confirm: z.enum(['confirm', 'typed', 'none']).optional(),
    /** A button's own `click` only: the button is drawn pressed (`aria-pressed`) while this holds (decision 2026-10-17 #4). */
    pressedWhen: EntryConditionSchema.optional(),
    /** A `dataChanged` entry only (35.2, E13): run on the card's first load too, not only when its data changes. */
    onLoad: z.boolean().optional(),
    action: WidgetActionSchema,
  })
  .strict()
export type ActionEntry = z.infer<typeof ActionEntrySchema>

/**
 * Sources whose trigger carries a row of data the host already holds: the only places `{ $row }` means something. A symbol's
 * gestures carry the clicked symbol's row (phase 35.3, E6): the host looks it up by id in the diagram's own rows (the `points`
 * row of an authored symbol, the `things` row of a thing), never takes it from a frame. A symbol's COMMAND still takes no row
 * (`commandParamUsesRowOrField`, POSTURE §9). Since 35.2 (E14) a command on any OTHER row source may read the row's
 * resource (`{ $row }` on its `resourceId` parameter, `isCommandRowSource`): the client sends the row's id and the run route
 * re-reads the row itself. A pie's `sliceClick` carries the clicked slice's row (phase 35.4).
 */
export const ROW_ACTION_SOURCES = [
  'rowClick', 'rowDoubleClick', 'cellClick', 'actionCellButton', 'markerClick', 'sliceClick', 'elementClick', 'elementDoubleClick', 'elementContextClick',
] as const


/**
 * Does this action read the clicked row? (a `setParams`, `openBoard` or `copyToClipboard` with a
 * `{ $row }` source, or a `{{row_<column>}}` token in a `navigate` path, an `openUrl` URL or a message)
 */
export function actionUsesRow(action: {
  kind: string; set?: Record<string, unknown>; value?: unknown; to?: unknown; url?: unknown; message?: unknown
}): boolean {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (action.kind === 'copyToClipboard') return sourceUsesRow(action.value)
  if (action.kind === 'navigate') return usesRowToken(str(action.to))
  if (action.kind === 'openUrl') return usesRowToken(str(action.url))
  if (action.kind === 'showNotification') return usesRowToken(str(action.message))
  return (action.kind === 'setParams' || action.kind === 'openBoard' || action.kind === 'openPage')
    && Object.values(action.set ?? {}).some(sourceUsesRow)
}

/**
 * Does this action read the control's value (`{ $value }` as a parameter source, bare or inside a `$map`)? Only a
 * `setParams` or an `openPage` on a control's own `click` may (phase 35): anywhere else nothing carries a value. A
 * command's params are not read here (they are the server's, and a symbol command's `{ $value }` is B5's rule).
 */
export function actionUsesValue(action: { kind: string; set?: Record<string, unknown>; value?: unknown }): boolean {
  if (action.kind === 'copyToClipboard') return sourceUsesValue(action.value)
  return (action.kind === 'setParams' || action.kind === 'openBoard' || action.kind === 'openPage')
    && Object.values(action.set ?? {}).some(sourceUsesValue)
}
/** The action kinds whose `set` may read the control's value on its click. */
const VALUE_ACTION_KINDS: ReadonlySet<string> = new Set(['setParams', 'openPage'])

/**
 * Does a stored command param read the clicked row (`{ $row }`) or a form field (`{ $field }`), bare or as a `$map`'s
 * `from`? A symbol carries neither.
 */
export function commandParamUsesRowOrField(value: unknown): boolean {
  const reads = commandParamReads(value)
  return reads === 'row' || reads === 'field'
}

/** Does a stored command param read the clicked row (`{ $row }`, bare or as a `$map`'s `from`; phase 35.2, E14)? */
export const commandParamUsesRow = (value: unknown): boolean => commandParamReads(value) === 'row'

/** Does a command action read the clicked row in any of its params (E14)? The client's reading is `commandReadsRow`, on the same rule. */
export function commandUsesRow(action: { kind: string; params?: Record<string, unknown> }): boolean {
  return commandReadsRow(action)
}

/**
 * The sources whose clicked row a COMMAND may read (phase 35.2, E14): the row sources (`ROW_ACTION_SOURCES`) and the
 * widget-declared ones, minus a symbol's gestures (a symbol command still takes no row: its run is addressed by the
 * element, and the run route judges it without one, POSTURE §9). The run route re-reads the row itself from the
 * placement's own stored binding, by the id the client sends (`command-row.ts`).
 */
export function isCommandRowSource(sourceKey: string): boolean {
  if ((ELEMENT_COMMAND_SOURCE_KEYS as readonly string[]).includes(sourceKey)) return false
  return (ROW_ACTION_SOURCES as readonly string[]).includes(sourceKey) || /^[a-z][a-zA-Z0-9_-]*\.[a-zA-Z0-9_.-]+$/.test(sourceKey)
}

/**
 * Does a stored command param read something a symbol's gesture never carries: the clicked row, a form field, or the
 * control's value (`{ $value }`, phase 35 B5: a symbol run sends no value, so such an entry always failed with a 422;
 * a `$scale` and a `$map` without a `from` read the value too, 35.2)? A symbol command takes literals, `{ $param }`
 * and a `$map` from a `{ $param }` only.
 */
export function symbolCommandParamUnsupported(value: unknown): boolean {
  const reads = commandParamReads(value)
  return reads === 'row' || reads === 'field' || reads === 'value'
}

export const MAX_ACTIONS_PER_SOURCE = 20
export const MAX_ACTION_SOURCES = 20

/**
 * The v2 SHAPE alone: every entry bounded and strict, no rule about which source may hold what. The board package
 * parses placement actions with this (phase 35 review, F2), so a package carrying one entry a source's rules refuse (a
 * symbol command written with `{ $value }` before B5) is not a 400 for the whole file: the import planner holds each
 * entry to the full schema on its own (`parseStoredEntry`) and repairs the one entry, like a page the board lacks.
 */
export const InstanceActionsV2ShapeSchema = z
  .object({
    v: z.literal(2),
    sources: z
      // A retired source (`nodeSelected`, phase 35 B7) is still a well-formed key here, so an older package parses; the
      // write rules below refuse it, and the import planner drops its entries and says so.
      .record(z.string().max(80).refine((k) => ActionSourceKeySchema.safeParse(k).success || RETIRED_ACTION_SOURCES.includes(k), 'Unknown action source'),
        z.array(ActionEntrySchema).max(MAX_ACTIONS_PER_SOURCE))
      .refine((r) => Object.keys(r).length <= MAX_ACTION_SOURCES, `At most ${MAX_ACTION_SOURCES} action sources`),
  })
  .strict()
export type InstanceActionsV2Shape = z.infer<typeof InstanceActionsV2ShapeSchema>

export const InstanceActionsV2Schema = InstanceActionsV2ShapeSchema
  .superRefine((v, ctx) => {
    // A retired source fires nothing (phase 35 B7: no widget has nodes); a write naming one is refused like any unknown source.
    for (const source of Object.keys(v.sources)) {
      if (RETIRED_ACTION_SOURCES.includes(source)) ctx.addIssue({ code: 'custom', message: `Unknown action source "${source}"`, path: ['sources', source] });
    }
    // An element entry is bound to one element id (`[text](action:<id>)`, or a process diagram's symbol or thing); without one
    // it could never fire. `*` binds every element that has no entry of its own for that gesture (35.3, E6).
    for (const source of ['elementClick', 'elementDoubleClick', 'elementContextClick'] as const) {
      for (const e of v.sources[source] ?? []) {
        if (!e.elementKey || (e.elementKey !== ANY_ELEMENT_KEY && !/^[A-Za-z0-9_.-]{1,64}$/.test(e.elementKey))) {
          ctx.addIssue({ code: 'custom', message: `A ${source} entry needs an element id (letters, digits, _ . and -) or * for every element`, path: ['sources', source] });
        }
      }
    }
    // The card's double-click and right-click gestures never run a command, like the card click: a command runs from a
    // control, behind its confirmation and its own gates. A symbol's gestures may (decision 49), under the rules below.
    for (const source of ['cardDoubleClick', 'cardContextClick'] as const) {
      if ((v.sources[source] ?? []).some((e) => e.action.kind === 'command')) {
        ctx.addIssue({ code: 'custom', message: `A command cannot run from "${source}"; use a control widget`, path: ['sources', source] });
      }
    }
    // A symbol's command (decision 49): its params come from the closed set a control's do minus the ones that read a row,
    // a form field or the control's value (a symbol carries none of them, B5), and a confirmation level is only
    // meaningful on one.
    for (const [source, list] of Object.entries(v.sources)) {
      const symbol = (ELEMENT_COMMAND_SOURCE_KEYS as readonly string[]).includes(source);
      for (const e of list) {
        // Phase 35: a plain confirmation may also guard a navigation entry (a parameter write, a page, a board, a step
        // back) on any source; the host asks before it runs. A typed one stays a symbol command's.
        const navConfirm = e.confirm === 'confirm' && CONFIRMABLE_ACTION_KINDS.includes(e.action.kind);
        // D175: a command entry that is not a symbol's may turn its default question off (`none`); a symbol's never does
        const commandOff = e.confirm === 'none' && e.action.kind === 'command' && !symbol;
        if (e.confirm && !(symbol && e.action.kind === 'command' && e.confirm !== 'none') && !navConfirm && !commandOff) {
          ctx.addIssue({ code: 'custom', message: `A confirmation is only supported on a symbol's command, ('confirm') on a setParams, openPage, openBoard, back or command entry, or ('none') on a control's command; not '${e.confirm}' on a ${e.action.kind} on "${source}"`, path: ['sources', source] });
        }
        if (symbol && e.action.kind === 'command') {
          const bad = Object.entries(e.action.params).find(([, p]) => symbolCommandParamUnsupported(p));
          if (bad) ctx.addIssue({ code: 'custom', message: `A symbol command cannot take "${bad[0]}" from a row, a form field or the widget value; use a literal or { "$param" }`, path: ['sources', source] });
          // A symbol's gesture carries its row since 35.3, but its command still takes none (POSTURE §9): the run route judges
          // the entry's condition on the board's parameters alone, so a term on the clicked row would never hold there and the
          // command could never run. Refused at write time instead of failing silently.
          if (conditionUsesRow(e.when)) ctx.addIssue({ code: 'custom', message: 'A symbol command cannot be conditioned on the clicked row; use a board parameter', path: ['sources', source] });
          // The same for the card's data (35.2): the run route has none to judge it with.
          if (conditionUsesSlot(e.when)) ctx.addIssue({ code: 'custom', message: 'A symbol command cannot be conditioned on the card\'s data; use a board parameter', path: ['sources', source] });
        }
      }
    }
    // The card's own click is one action that makes the card interactive; a show condition there would be
    // read by nothing (the card stays clickable), so it is refused instead of silently ignored. A control's
    // `click` does read it: the control is disabled while it does not hold (16.7).
    if ((v.sources.cardClick ?? []).some((e) => e.when)) {
      ctx.addIssue({ code: 'custom', message: 'A show condition is not supported on "cardClick"', path: ['sources', 'cardClick'] });
    }
    // A pressed state belongs to a control's own click (the toggle button); anywhere else nothing would draw it.
    for (const [source, list] of Object.entries(v.sources)) {
      if (source !== 'click' && list.some((e) => e.pressedWhen)) {
        ctx.addIssue({ code: 'custom', message: `A pressed condition is only supported on a control's "click", not "${source}"`, path: ['sources', source] });
      }
    }
    // A card click runs every entry in order but never a command (decision 2026-10-17 #3): a command runs from a
    // control, behind its confirmation, and a card click would bypass that UI.
    if ((v.sources.cardClick ?? []).some((e) => e.action.kind === 'command')) {
      ctx.addIssue({ code: 'custom', message: 'A command cannot run from "cardClick"; use a control widget', path: ['sources', 'cardClick'] });
    }
    // The control's value (`{ $value }`) is carried by a control's own `click` alone, and read there only by a
    // `setParams` / `openPage` (phase 35): anywhere else nothing carries it, so an entry reading it would set nothing
    // (or, on another kind, be a value smuggled into a board link or the clipboard without the control's own gates).
    for (const [source, list] of Object.entries(v.sources)) {
      for (const e of list) {
        if (actionUsesValue(e.action) && !(source === 'click' && VALUE_ACTION_KINDS.has(e.action.kind))) {
          ctx.addIssue({ code: 'custom', message: `{ $value } is only valid in a setParams or openPage on a control's "click", not in a ${e.action.kind} on "${source}"`, path: ['sources', source] });
        }
      }
    }
    // The brushed range (`{ $range }`) comes with the `rangeSelect` gesture alone: anywhere else a setWindow reading it
    // would set nothing, so it is refused at write time (phase 35).
    for (const [source, list] of Object.entries(v.sources)) {
      if (source !== 'rangeSelect' && list.some((e) => e.action.kind === 'setWindow' && isObj(e.action.window) && '$range' in e.action.window)) {
        ctx.addIssue({ code: 'custom', message: `A window from the selected range is only valid on "rangeSelect", not "${source}"`, path: ['sources', source] });
      }
    }
    // E14 (35.2): a command reads the clicked row only on a row source (not a symbol's gesture: refused above), and only
    // for a parameter the command marks `resourceId` (checked against the command's schema by `assertCommandAuthoring`).
    for (const [source, list] of Object.entries(v.sources)) {
      if (isCommandRowSource(source) || (ELEMENT_COMMAND_SOURCE_KEYS as readonly string[]).includes(source)) continue;
      if (list.some((e) => commandUsesRow(e.action))) {
        ctx.addIssue({ code: 'custom', message: `A command reads { $row } only on a source that carries a row (a table's rows, cells and buttons, a marker, a slice, a widget's declared row source), not "${source}"`, path: ['sources', source] });
      }
    }
    // A row source's command has its condition judged on the server (the row it re-reads and the board's parameters), which
    // has no copy of the card's data as the browser draws it (a compute script may have derived it): a term on the card's
    // data could never hold there and the command could never run. Refused at write time, as for a symbol's command.
    for (const [source, list] of Object.entries(v.sources)) {
      if (!isCommandRowSource(source)) continue;
      if (list.some((e) => e.action.kind === 'command' && conditionUsesSlot(e.when))) {
        ctx.addIssue({ code: 'custom', message: 'A row command cannot be conditioned on the card\'s data; use a board parameter or the clicked row', path: ['sources', source] });
      }
    }
    // E13 (35.2): the card's data changing runs only what changes the viewer's own view or tells them something; never a
    // command, a navigation or a URL (no gesture, no person), and nothing that would ask them first. `onLoad` belongs to it alone.
    for (const [source, list] of Object.entries(v.sources)) {
      for (const e of list) {
        if (source === DATA_CHANGED_SOURCE && !DATA_CHANGED_ACTION_KINDS.includes(e.action.kind)) {
          ctx.addIssue({ code: 'custom', message: `"${DATA_CHANGED_SOURCE}" runs setParams and showNotification only, not ${e.action.kind}`, path: ['sources', source] });
        }
        if (source === DATA_CHANGED_SOURCE && e.confirm) {
          ctx.addIssue({ code: 'custom', message: `"${DATA_CHANGED_SOURCE}" has nobody to ask: no confirmation`, path: ['sources', source] });
        }
        if (source !== DATA_CHANGED_SOURCE && e.onLoad !== undefined) {
          ctx.addIssue({ code: 'custom', message: `onLoad is only valid on "${DATA_CHANGED_SOURCE}", not "${source}"`, path: ['sources', source] });
        }
      }
    }
    // A `{ $row }` on a source with no row would silently set nothing; refuse it at write time. A condition on the
    // clicked row (E7) would never hold there: refused the same way.
    for (const [source, list] of Object.entries(v.sources)) {
      const rowless = !(ROW_ACTION_SOURCES as readonly string[]).includes(source) && !source.includes('.');
      if (!rowless) continue;
      if (list.some((e) => actionUsesRow(e.action))) {
        ctx.addIssue({ code: 'custom', message: `{ $row } is only valid on a source that carries a row (${ROW_ACTION_SOURCES.join(', ')}), not "${source}"`, path: ['sources', source] });
      }
      if (list.some((e) => conditionUsesRow(e.when) || conditionUsesRow(e.pressedWhen))) {
        ctx.addIssue({ code: 'custom', message: `A condition on the clicked row is only valid on a source that carries a row (${ROW_ACTION_SOURCES.join(', ')}), not "${source}"`, path: ['sources', source] });
      }
    }
  })
  // A symbol's command is always confirmed (decision 49): an entry written without a level gets the plain confirmation.
  .transform((v) => {
    if (!ELEMENT_COMMAND_SOURCE_KEYS.some((source) => (v.sources[source] ?? []).some((e) => e.action.kind === 'command' && !e.confirm))) return v;
    const sources = { ...v.sources };
    for (const source of ELEMENT_COMMAND_SOURCE_KEYS) {
      if (sources[source]) sources[source] = sources[source].map((e) => (e.action.kind === 'command' && !e.confirm ? { ...e, confirm: 'confirm' as const } : e));
    }
    return { ...v, sources };
  })
export type InstanceActionsV2 = z.infer<typeof InstanceActionsV2Schema>

/** What a write accepts: the v2 shape or the legacy `{ onClick }`. */
export const InstanceActionsInputSchema = z.union([InstanceActionsV2Schema, InstanceActionsSchema])

/**
 * One stored entry under one source, held to the write rules on its own: what the write schema would store for it
 * (a symbol command's default confirmation filled in, a 16.6 condition normalised), or null when it refuses the
 * entry. The rules of `InstanceActionsV2Schema` are all per entry, so parsing a one-entry object asks exactly them.
 */
export function parseStoredEntry(sourceKey: string, entry: unknown): ActionEntry | null {
  const parsed = InstanceActionsV2Schema.safeParse({ v: 2, sources: { [sourceKey]: [entry] } })
  return parsed.success ? parsed.data.sources[sourceKey]?.[0] ?? null : null
}

/**
 * A placement's stored actions as a READER takes them (phase 35 review, F1): the v1 `{ onClick }` is one entry and
 * parses whole; a v2 object keeps every entry the write schema accepts and drops the rest. The whole-object parse the
 * run route used to do let one stale entry (a symbol command written with `{ $value }` before B5, when the editor
 * hint still offered it) take every neighbour down with it: no command on the placement ran until the author
 * hand-fixed the JSON. Now that entry alone is dead (not found, 404), and the write-time refusal stands as it is.
 */
export function readStoredActions(raw: unknown): InstanceActionsV2 | InstanceActions | null {
  if (!raw || typeof raw !== 'object') return null
  if ((raw as { v?: unknown }).v !== 2) {
    const v1 = InstanceActionsSchema.safeParse(raw)
    return v1.success ? v1.data : null
  }
  const stored = (raw as { sources?: unknown }).sources
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const sources: Record<string, ActionEntry[]> = {}
  for (const [sourceKey, list] of Object.entries(stored as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const kept = list.map((e) => parseStoredEntry(sourceKey, e)).filter((e): e is ActionEntry => e !== null)
    if (kept.length > 0) sources[sourceKey] = kept
  }
  return Object.keys(sources).length > 0 ? { v: 2, sources } : null
}

/**
 * A card shown only while a condition on the board's parameters holds (phase 35): the `when` of an action entry, on
 * the `param` source alone (a card has no clicked row). The view judges it per frame with the frame's effective
 * values; customise mode shows the card with a badge; a display screen's server drops the card against the board's
 * defaults (`display-safe.ts`), so the screen's client never evaluates it. Stored in its own column (migration 010),
 * beside `actions`, so the reference check (E9) and the package carry it like an entry's condition.
 */
export const PlacementVisibilitySchema = z
  .object({ when: EntryConditionSchema })
  .strict()
  .refine((v) => !conditionUsesRow(v.when), 'A card is shown by the board\'s parameters; it has no clicked row')
  // A card's visibility is judged before its data loads, and on a display's server without it (35.2): no slot term.
  .refine((v) => !conditionUsesSlot(v.when), 'A card is shown by the board\'s parameters, not by its own data')
export type PlacementVisibility = z.infer<typeof PlacementVisibilitySchema>

export const CreateInstanceDTO = z
  .object({
    widgetRef: WidgetRefSchema,
    ...geometry,
    order: z.number().int().min(0).max(10_000).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    dataBinding: DataBindingSchema.nullable().optional(),
    actions: InstanceActionsInputSchema.nullable().optional(),
    title: z.string().max(120).nullable().optional(),
    refreshSeconds: z.number().int().min(5).max(86_400).nullable().optional(),
    /** The in-board page (D-1 (a)); absent / null = the main page. Must be a page of the board (422). */
    pageKey: BoardPageKeySchema.nullable().optional(),
    /** Shown only while this holds (phase 35); absent / null = always. Its parameter must be the board's (422, E9). */
    visibility: PlacementVisibilitySchema.nullable().optional(),
    /** The placement's compute script (35.5, `transform.dto.ts`); `null` = none. Stored as text, never evaluated here. */
    transform: PlacementTransformSchema.optional(),
  })
  .strict()

export const UpdateInstanceDTO = z
  .object({
    ...geometry,
    order: z.number().int().min(0).max(10_000).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    dataBinding: DataBindingSchema.nullable().optional(),
    actions: InstanceActionsInputSchema.nullable().optional(),
    title: z.string().max(120).nullable().optional(),
    refreshSeconds: z.number().int().min(5).max(86_400).nullable().optional(),
    /** Move the card to another in-board page (`null` = the main page). */
    pageKey: BoardPageKeySchema.nullable().optional(),
    /** Shown only while this holds (phase 35); `null` clears it. */
    visibility: PlacementVisibilitySchema.nullable().optional(),
    /** Replace or clear (`null`) the placement's compute script (35.5). */
    transform: PlacementTransformSchema.optional(),
    /**
     * Optimistic lock (15.3c): the placement revision the editor loaded. Stale = 409 carrying
     * `details.revision`; absent = no check (older clients and module code keep working).
     */
    expectedRevision: z.number().int().min(0).optional(),
  })
  .partial()
  .strict()

/**
 * A whole-board geometry save. Dragging one card reflows its neighbours, so the
 * editor commits the resulting layout in ONE request — per-card PATCHes would be
 * both chatty and non-atomic, leaving a half-applied board if one failed.
 */
export const SaveLayoutDTO = z
  .object({
    expectedRevision: z.number().int().min(0).optional(),
    items: z
      .array(z.object({ instanceId: z.string().uuid(), ...geometry, order: z.number().int().min(0).max(10_000) }))
      .max(200),
  })
  .strict()

export type CreateBoardInput = z.infer<typeof CreateBoardDTO>
export type UpdateBoardInput = z.infer<typeof UpdateBoardDTO>
export type CreateInstanceInput = z.infer<typeof CreateInstanceDTO>
export type UpdateInstanceInput = z.infer<typeof UpdateInstanceDTO>
export type SaveLayoutInput = z.infer<typeof SaveLayoutDTO>
export type SurfaceRef = z.infer<typeof SurfaceRefSchema>
