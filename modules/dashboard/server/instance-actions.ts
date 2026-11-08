/**
 * Reading a placement's `actions` whichever shape it was stored in (phase 16.1).
 *
 * Two shapes live side by side: the v1 `{ onClick }` every existing board carries
 * and the v2 `{ v: 2, sources: { <source>: ActionEntry[] } }`. Everything that
 * reads actions goes through here, so the command gate, the run route and the UI
 * can never disagree about which actions a placement has. No data migration:
 * v1 is converted on read and replaced by v2 only when someone saves.
 *
 * Legacy mapping (16 "Legacy read shim"): `{ onClick: command }` on a control
 * placement is the control's own `click`; any other `{ onClick }` is the card's
 * click. Pure: no service, db or zod imports (the scene-rule compare it shares is pure too).
 */
import { compare, type RuleOp } from '@kuraykaraaslan-labs/common/server/widget-settings/views/scene-rules-logic'
import { commandParamReads } from './command.types'

export type AnyAction = { kind: string; commandKey?: string; params?: Record<string, unknown> }
/**
 * Where a condition reads (phase 35, E7): a board parameter, or (on a row source only) a column of the clicked row; since
 * 35.2 (E13) the card's own (transformed) data, `slot`: `key` = `<slot>` (a scalar's value, a table's row count) or
 * `<slot>.<column>` (holds when ANY row satisfies it, or every row with `quantifier: 'all'`; a record's field).
 */
export type ConditionSource = 'param' | 'row' | 'slot'
export type ConditionLiteral = string | number | boolean
/** One term of a condition: a reading, an operator of the scene-rule engine, a literal (`to`: the upper end of `between`). */
export interface ConditionTerm { source: ConditionSource; key: string; op: RuleOp; value?: ConditionLiteral; to?: ConditionLiteral; quantifier?: 'any' | 'all' }
/** An entry's condition (`when`, `pressedWhen`): one term, or two joined `all` (and) / `any` (or). */
export interface EntryCondition extends ConditionTerm { join?: 'all' | 'any'; second?: ConditionTerm }
/** The 16.6 shape every board carried before phase 35: one parameter, one of four operators. Still read, never written. */
export interface LegacyCondition { param: string; op: string; value?: ConditionLiteral }
/** A condition as a placement stores it, in either shape; `normalizeCondition` reads both. */
export type EntryWhen = EntryCondition | LegacyCondition
export type NormalizedEntry = { id: string; name: string; action: AnyAction; columnKey?: string; elementKey?: string; icon?: string; when?: EntryWhen; pressedWhen?: EntryWhen; confirm?: 'confirm' | 'typed' | 'none'; onLoad?: boolean }

/**
 * The source that fires when the card's data changes (phase 35.2, E13): no gesture and no person, so it runs only the kinds
 * that change the viewer's own view (`setParams`) or tell them something (`showNotification`), never a command, a
 * navigation or a URL; idempotent, at most once per 2 s per placement, never on a display screen or in the editor.
 */
export const DATA_CHANGED_SOURCE = 'dataChanged'
export const DATA_CHANGED_ACTION_KINDS: readonly string[] = ['setParams', 'showNotification']

/**
 * The gestures on one ELEMENT of a widget (a symbol of a process diagram, a link in a text), each entry bound to an element id
 * by `elementKey`. The only sources besides a control's own `click` that may hold a `command` (decision 49): such a command
 * runs behind a confirmation and the same gates as a control's, and the placement save asks the `dashboard:element_actions`
 * provider of the widget's kind whether the widget has that element (and whether it takes commands at all).
 */
export const ELEMENT_COMMAND_SOURCES = ['elementClick', 'elementDoubleClick', 'elementContextClick'] as const
export const isElementCommandSource = (sourceKey: string): boolean => (ELEMENT_COMMAND_SOURCES as readonly string[]).includes(sourceKey)

/**
 * An element entry's `elementKey` that binds every element of the widget with no entry of its own for that gesture (phase
 * 35.3, E6): one entry serves every symbol of a diagram, authored or placed from data. The server reads it like any other
 * key (the `dashboard:element_actions` provider says whether the widget takes it); the client falls back to it per element.
 */
export const ANY_ELEMENT_KEY = '*'

/** The gesture an element source stands for (what the audit record names), or null for any other source. */
export function elementGestureOf(sourceKey: string): 'click' | 'doubleClick' | 'contextMenu' | null {
  return sourceKey === 'elementClick' ? 'click' : sourceKey === 'elementDoubleClick' ? 'doubleClick' : sourceKey === 'elementContextClick' ? 'contextMenu' : null
}
export type NormalizedActions = { v: 2; sources: Record<string, NormalizedEntry[]> }

/**
 * The navigation kinds an entry may ask about before it runs (`confirm: 'confirm'`, phase 35): a parameter write, a
 * page, another board, a step back. The host asks (`WidgetActionContext.confirm`) and the entry runs only on a yes; with
 * no host to ask (the editor's canvas) it does not run. `typed` stays a symbol command's alone.
 * D175: a `command` too, the other way round: it asks UNLESS its entry says `confirm: 'none'` (`commandEntryFloor`).
 */
export const CONFIRMABLE_ACTION_KINDS: readonly string[] = ['setParams', 'openPage', 'openBoard', 'back', 'command']
/** Does this navigation entry ask before it runs (a confirmable kind stored with `confirm: 'confirm'`)? A command asks by `commandEntryFloor`. */
export const entryAsksFirst = (e: { confirm?: string; action: { kind: string } }): boolean =>
  e.action.kind !== 'command' && e.confirm === 'confirm' && CONFIRMABLE_ACTION_KINDS.includes(e.action.kind)

/**
 * D175 (2026-11-01): a device command a board runs asks first, by default. The confirmation a command entry asks for on top of
 * the command's own policy: `typed` for a typed one (a symbol's choice), none only when the author turned it off for a low-risk
 * control (`confirm: 'none'`), a plain question otherwise, an entry stored before the field existed included. The run route
 * enforces it (`withConfirmationFloor`), as element gestures' (decision 49); a client-only dialog would be skipped by any other client.
 */
export function commandEntryFloor(e: { confirm?: string }): 'confirm' | 'typed' | null {
  if (e.confirm === 'none') return null
  return e.confirm === 'typed' ? 'typed' : 'confirm'
}

/**
 * Sources a stored placement may still name but nothing fires any more and no write accepts (phase 35, B7: `nodeSelected`,
 * accepted until then although no widget has nodes). Dropped on read, so a row carrying one neither crashes a reader
 * nor makes the next save of the card refuse the whole actions object as naming an unknown source.
 */
export const RETIRED_ACTION_SOURCES: readonly string[] = ['nodeSelected']

const isAction = (a: unknown): a is AnyAction =>
  !!a && typeof a === 'object' && typeof (a as { kind?: unknown }).kind === 'string'

export function normalizeInstanceActions(raw: unknown): NormalizedActions | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  if (obj.v === 2) {
    const sources: Record<string, NormalizedEntry[]> = {}
    for (const [key, list] of Object.entries((obj.sources ?? {}) as Record<string, unknown>)) {
      if (!Array.isArray(list) || RETIRED_ACTION_SOURCES.includes(key)) continue
      const entries = list.filter((e): e is NormalizedEntry =>
        !!e && typeof e === 'object' && isAction((e as { action?: unknown }).action))
      if (entries.length > 0) sources[key] = entries
    }
    return Object.keys(sources).length > 0 ? { v: 2, sources } : null
  }

  const sources: Record<string, NormalizedEntry[]> = {}
  if (isAction(obj.onClick)) {
    const source = obj.onClick.kind === 'command' ? 'click' : 'cardClick'
    sources[source] = [{ id: 'legacy-onClick', name: '', action: obj.onClick }]
  }
  // Any other top-level trigger in stored data (the write schema is strict, but a
  // row written by an older or foreign writer is still read): kept under `legacy.<key>`
  // so the authoring gate and the run route cover it, and no UI source ever fires it.
  for (const [key, value] of Object.entries(obj)) {
    if (key !== 'onClick' && isAction(value)) sources[`legacy.${key}`] = [{ id: `legacy-${key}`, name: '', action: value }]
  }
  return Object.keys(sources).length > 0 ? { v: 2, sources } : null
}

/** The entries of one source, in stored order. */
export function sourceEntries(raw: unknown, sourceKey: string): NormalizedEntry[] {
  return normalizeInstanceActions(raw)?.sources[sourceKey] ?? []
}

/** Every action of every source: what the authoring gate and the run route must cover. */
export function allActionsOf(raw: unknown): AnyAction[] {
  const n = normalizeInstanceActions(raw)
  return n ? Object.values(n.sources).flatMap((list) => list.map((e) => e.action)) : []
}

/**
 * The single click a card (or a control) fires today: the card's own, else the
 * control's. What `actions.onClick` used to be, for callers not yet on sources.
 */
export function primaryAction(raw: unknown): AnyAction | null {
  return sourceEntries(raw, 'cardClick')[0]?.action ?? sourceEntries(raw, 'click')[0]?.action ?? null
}

/**
 * What a card click runs (decision 2026-10-17 #3): every `cardClick` entry, in order, like every other source.
 * Never a `command`: a command runs from a control, behind its confirmation, so one stored on the card click (the
 * write schema refuses it now) is skipped rather than fired without that UI.
 */
export function cardClickActions(raw: unknown): AnyAction[] {
  return sourceEntries(raw, 'cardClick').map((e) => e.action).filter((a) => a.kind !== 'command')
}

/** The card's first click action (never a control's `click`): decides whether the card itself is interactive. */
export function cardClickAction(raw: unknown): AnyAction | null {
  return cardClickActions(raw)[0] ?? null
}

/** Every entry with the source it hangs off: what a run is addressed by (`{ sourceKey, actionId }`). */
export function allEntriesOf(raw: unknown): Array<NormalizedEntry & { sourceKey: string }> {
  const n = normalizeInstanceActions(raw)
  return n ? Object.entries(n.sources).flatMap(([sourceKey, list]) => list.map((e) => ({ ...e, sourceKey }))) : []
}

/**
 * Is this a command whose params read the clicked row (`{ $row }`, bare or as a `$map`'s `from`; phase 35.2, E14)? The one
 * kind of command a row source runs: the host sends the row's id and the server re-reads the row. Pure (the write rule
 * itself is `commandUsesRow` in the DTO, on the same `commandParamReads`).
 */
export function commandReadsRow(action: AnyAction): boolean {
  return action.kind === 'command' && Object.values(action.params ?? {}).some((p) => commandParamReads(p) === 'row')
}

/** The command entries on the three element gestures, with their source: what the element-command write checks and the run route read. */
export function elementCommandEntries(raw: unknown): Array<Omit<NormalizedEntry, 'confirm'> & { sourceKey: string; confirm?: 'confirm' | 'typed' }> {
  return allEntriesOf(raw).filter((e) => isElementCommandSource(e.sourceKey) && e.action.kind === 'command')
    .map((e) => ({ ...e, confirm: symbolConfirmOf(e.confirm) }))
}

/**
 * A symbol's command never turns its question off (decision 49): a stored `none` (refused at write, D175) reads as the plain
 * question, like an entry stored without the field.
 */
export function symbolConfirmOf(confirm: NormalizedEntry['confirm']): 'confirm' | 'typed' | undefined {
  return confirm === 'none' ? undefined : confirm
}

/**
 * Rebuild a placement's `actions` with the card's (or the control's) own click replaced, keeping
 * every other source as stored, `rowClick` included: the drawer edits the row sources as entry lists
 * (16.7) and folds them in with `writeSourceEntries`. A placement with nothing but a card click stays
 * in the legacy `{ onClick }` shape (no churn for existing boards); anything richer is written as v2.
 *
 * By default a `command` is the control's `click` and anything else the card's `cardClick`, the
 * mapping the v1 shim reads back. `source: 'click'` stores a non-command action as a control's own
 * click (a `control.button` runs any kind, 16.7); `when` (the control's disabled getter) is kept only
 * on `click`, since the write schema refuses it on `cardClick`.
 *
 * Only the source written and `from` (where the edited action was read from, when that differs) are
 * replaced: a placement that stores both a `click` and a `cardClick` keeps the one the editor did not
 * show. Without `from`, both are replaced (the drawer's original single-click model).
 */
export function writeCardAction(
  existing: unknown,
  card: AnyAction | null,
  opts: { source?: 'cardClick' | 'click'; when?: EntryWhen; pressedWhen?: EntryWhen; from?: 'cardClick' | 'click'; confirm?: 'confirm' | 'none' } = {},
): unknown {
  const natural = card?.kind === 'command' ? 'click' : 'cardClick'
  const source = opts.source ?? natural
  const replaced = new Set<string>(opts.from ? [source, opts.from] : ['cardClick', 'click'])
  const sources: Record<string, NormalizedEntry[]> = {}
  for (const [key, list] of Object.entries(normalizeInstanceActions(existing)?.sources ?? {})) {
    if (!replaced.has(key)) sources[key] = list
  }
  const when = source === 'click' ? opts.when : undefined
  const pressedWhen = source === 'click' ? opts.pressedWhen : undefined
  // Phase 35: a navigation click may ask first (a button's openPage, a card's setParams); any other kind stores none.
  // D175: a control's command asks unless turned off, so only the turning off is stored (`'none'`); asking is the default.
  const confirm = !card ? undefined
    : card.kind === 'command' ? (opts.confirm === 'none' ? 'none' as const : undefined)
      : opts.confirm === 'confirm' && CONFIRMABLE_ACTION_KINDS.includes(card.kind) ? 'confirm' as const : undefined
  if (card) sources[source] = [{ id: 'card', name: '', ...(when ? { when } : {}), ...(pressedWhen ? { pressedWhen } : {}), ...(confirm ? { confirm } : {}), action: card }]
  const keys = Object.keys(sources)
  if (keys.length === 0) return null
  // The legacy shape only when it reads back the same: the natural source and no condition.
  if (keys.length === 1 && card && source === natural && !when && !pressedWhen && !confirm) return { onClick: card }
  return { v: 2, sources }
}

/**
 * Replace one source's entries, keeping every other source as stored (16.7). The
 * result is v2; an empty source is removed and a placement left with nothing is null.
 * Callers that want to leave a source untouched should not call this (a legacy
 * `{ onClick }` placement is only converted when something actually changes).
 */
export function writeSourceEntries(existing: unknown, sourceKey: string, entries: NormalizedEntry[]): unknown {
  const sources: Record<string, NormalizedEntry[]> = { ...(normalizeInstanceActions(existing)?.sources ?? {}) }
  if (entries.length > 0) sources[sourceKey] = entries
  else delete sources[sourceKey]
  return Object.keys(sources).length > 0 ? { v: 2, sources } : null
}

/**
 * A `control.button`'s toggle state (decision 2026-10-17 #4): its own click's `pressedWhen` on the effective board
 * parameters. `undefined` when the button stores no such condition (an ordinary button, no `aria-pressed`).
 */
export function buttonPressed(raw: unknown, params: Record<string, unknown> | undefined): boolean | undefined {
  const pressedWhen = sourceEntries(raw, 'click')[0]?.pressedWhen
  return pressedWhen ? entryVisible(pressedWhen, params) : undefined
}

const isLiteral = (v: unknown): v is ConditionLiteral => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/** One term off a stored object: `key` (or the 16.6 `param`), `op`, and the literals it carries. */
function termOf(raw: Record<string, unknown>, key: unknown, source: unknown): ConditionTerm | undefined {
  if (typeof key !== 'string' || key === '' || typeof raw.op !== 'string') return undefined
  const out: ConditionTerm = { source: source === 'row' ? 'row' : source === 'slot' ? 'slot' : 'param', key, op: raw.op as RuleOp }
  if (isLiteral(raw.value)) out.value = raw.value
  if (isLiteral(raw.to)) out.to = raw.to
  // Only a slot term over a table's column takes a quantifier; `any` is the default and is not stored.
  if (out.source === 'slot' && raw.quantifier === 'all' && key.includes('.')) out.quantifier = 'all'
  return out
}

/**
 * A stored condition in the phase 35 shape, whichever way it was written: the 16.6 `{ param, op, value }` becomes a
 * `param` term, the E7 shape is taken as it is. `undefined` is no condition (it always holds); `null` is something
 * that is not a condition (the write schema refuses it; one stored by another writer never holds).
 */
export function normalizeCondition(raw: unknown): EntryCondition | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const first = typeof c.key === 'string' ? termOf(c, c.key, c.source) : termOf(c, c.param, 'param')
  if (!first) return null
  const out: EntryCondition = { ...first }
  if (c.second !== undefined && c.second !== null) {
    const s = typeof c.second === 'object' && !Array.isArray(c.second) ? (c.second as Record<string, unknown>) : undefined
    const second = s ? termOf(s, s.key, s.source) : undefined
    if (!second) return null
    out.join = c.join === 'any' ? 'any' : 'all'
    out.second = second
  }
  return out
}

/**
 * What a condition is judged against: the effective board parameters, (on a row source) the clicked row, and (35.2, E13)
 * the card's own data by slot key, as the card draws it (after its compute script). Without `slots` a slot term has no
 * reading (the server, a display screen): only `unset` matches it, like a missing parameter.
 */
export interface ConditionScope { params?: Record<string, unknown>; row?: Record<string, unknown>; slots?: Record<string, unknown> }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (bag: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined)
/** A cell as a term reads it: a list as its comma-joined text, a structure as nothing. */
const cellReading = (v: unknown): unknown => (Array.isArray(v) ? v.join(',') : isRecord(v) ? undefined : v)

/**
 * A slot reading (E13), split into the slot and the column: `<slot>` or `<slot>.<column>` (the first dot splits: a slot key
 * has no dot, a column may). The data is the card's own slot result (`{ shape, value | rows | record | series }`).
 */
export function slotKeyParts(key: string): { slot: string; column?: string } {
  const dot = key.indexOf('.')
  return dot < 0 ? { slot: key } : { slot: key.slice(0, dot), column: key.slice(dot + 1) }
}

/**
 * The value `<slot>` or `<slot>.<column>` reads for a parameter source (`{ "$slot": … }`, 35.2): a scalar's value, a table's
 * row count, the FIRST row's column, a record's field. `undefined` when the slot is absent, empty or of another shape.
 */
export function slotValue(slots: Record<string, unknown> | undefined, key: string): unknown {
  if (!slots) return undefined
  const { slot, column } = slotKeyParts(key)
  if (slot.startsWith('__') || (column !== undefined && column.startsWith('__'))) return undefined
  const data = own(slots, slot)
  if (!isRecord(data)) return undefined
  const rows = Array.isArray(data.rows) ? data.rows : undefined
  if (column === undefined) {
    if (data.shape === 'scalar' || ('value' in data && !rows)) return data.value ?? undefined
    if (rows) return rows.length
    return undefined
  }
  if (rows) return isRecord(rows[0]) ? cellReading(own(rows[0], column)) : undefined
  if (isRecord(data.record)) return cellReading(own(data.record, column))
  return undefined
}

/**
 * Does a slot term hold (E13)? `<slot>` compares the slot's value (a scalar's value, a table's row count); `<slot>.<column>`
 * compares every row's column and holds when ANY row satisfies it, or with `quantifier: 'all'` when there is at least one
 * row and EVERY row does; a record compares its field. With no data for the slot, the reading is missing.
 */
function slotTermHolds(term: ConditionTerm, slots: Record<string, unknown> | undefined): boolean {
  const { slot, column } = slotKeyParts(term.key)
  const data = slots && !slot.startsWith('__') ? own(slots, slot) : undefined
  const rows = isRecord(data) && Array.isArray(data.rows) ? data.rows : undefined
  if (column !== undefined && rows && !column.startsWith('__')) {
    const each = (r: unknown) => compare(term.op, isRecord(r) ? cellReading(own(r, column)) : undefined, term.value, term.to)
    return term.quantifier === 'all' ? rows.length > 0 && rows.every(each) : rows.some(each)
  }
  return compare(term.op, slotValue(slots, term.key), term.value, term.to)
}

/**
 * The reading a term looks at: an own property of the parameters or of the row (a condition on `constructor` or
 * `__proto__` must not read the prototype and count as set); a list (a multi-select parameter) as its comma-joined
 * text, the way a source receives it (`toVars`); an absent key is no reading, which only `unset` matches.
 */
function readingOf(term: ConditionTerm, scope: ConditionScope): unknown {
  if (term.source === 'slot') return slotValue(scope.slots, term.key)
  const bag = term.source === 'row' ? scope.row : scope.params
  if (!bag || !Object.prototype.hasOwnProperty.call(bag, term.key)) return undefined
  const v = bag[term.key]
  return Array.isArray(v) ? v.join(',') : v
}

/**
 * Does a condition hold (E7)? The one evaluation the client (an entry's `when`, a control's disabled getter, a toggle's
 * `pressedWhen`) and the server (a symbol command's run route) share, on the `compare` of the scene-rule engine, so a
 * button condition and a symbol rule read the same: numbers numerically, booleans through the controls' coercion,
 * text case-insensitively, a missing reading matching only `unset` (so "unset or not X" is two terms joined `any`).
 * Two terms are joined `all` (both hold) or `any` (either holds). With `rowUnknown` a row term is taken as holding:
 * the click that brings the row has not happened yet (offering a row button, a cell column, a clickable row); the
 * run judges it with the row.
 */
export function conditionHolds(raw: unknown, scope: ConditionScope, opts: { rowUnknown?: boolean } = {}): boolean {
  const c = normalizeCondition(raw)
  if (c === undefined) return true
  if (c === null) return false
  const holds = (term: ConditionTerm): boolean =>
    (term.source === 'row' && opts.rowUnknown && !scope.row ? true
      : term.source === 'slot' ? slotTermHolds(term, scope.slots)
        : compare(term.op, readingOf(term, scope), term.value, term.to))
  const first = holds(c)
  if (!c.second) return first
  const second = holds(c.second)
  return c.join === 'any' ? first || second : first && second
}

/**
 * Does an entry's show condition hold for these effective board parameter values (16.6) and, on a row source, this
 * row? No condition always holds; a row term with no row never does (`conditionHolds` with `rowUnknown` is the
 * offer-time reading).
 */
export function entryVisible(when: unknown, params: Record<string, unknown> | undefined, row?: Record<string, unknown>, slots?: Record<string, unknown>): boolean {
  return conditionHolds(when, { params, row, ...(slots ? { slots } : {}) })
}
