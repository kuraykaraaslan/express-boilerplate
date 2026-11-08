import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { allEntriesOf, normalizeCondition, type NormalizedEntry } from './instance-actions'
import { paramTokenKeys } from './action-tokens'
import { isParamRef } from './board-window'

/**
 * Every board parameter a placement references (phase 35, E9), read off its stored actions and its settings, so a
 * direct write can be refused (422) when it names a parameter the board does not define, a board update can refuse
 * (409) to remove a parameter a placement still reads, and an import can repair what it cannot keep. Covered:
 *
 *  - the keys a `setParams` / `openPage` writes (an `openBoard.set` names the TARGET board's keys, not these);
 *  - every `{ "$param": key }` source wherever it sits (a set value, a command param, a `copyToClipboard` value), the
 *    tree walked generically so a nested source (`$map.from`, phase 35.2) is found without a change here;
 *  - the `{{param_<key>}}` tokens of a `navigate` path, an `openUrl` URL and a `showNotification` message;
 *  - the `param` terms of an entry's `when` / `pressedWhen` (both terms, either stored shape);
 *  - the `source: 'param'` readings of the widget's stored `rules` (the SCADA scene's; read generically off
 *    `settings.rules`, so any kind that stores such a list is covered);
 *  - the `param` terms of the card's visibility rule (`visibility.when`, phase 35).
 *
 * Pure: no service and no db; the only throw is the 422 of `assertPlacementParamRefsKnown`.
 */
export interface PlacementRefs { actions?: unknown; settings?: unknown; visibility?: unknown }

/** How deep a `{ $param }` may sit inside an action; a stored action is small, this only stops a cycle or a probe. */
const MAX_WALK_DEPTH = 8

/** Walk a value for `{ "$param": key }` references, however deep. */
function collectParamRefs(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > MAX_WALK_DEPTH || value === null || typeof value !== 'object') return
  if (isParamRef(value)) { out.add(value.$param); return }
  for (const v of Array.isArray(value) ? value : Object.values(value)) collectParamRefs(v, out, depth + 1)
}

/** The `param` readings of a condition, in either stored shape. */
function conditionParamKeys(raw: unknown, out: Set<string>): void {
  const c = normalizeCondition(raw)
  if (!c) return
  if (c.source === 'param') out.add(c.key)
  if (c.second?.source === 'param') out.add(c.second.key)
}

/** The board parameters one stored entry references (its set keys, its `$param` sources, its tokens, its conditions). */
export function entryParamKeys(entry: Pick<NormalizedEntry, 'action' | 'when' | 'pressedWhen'>): Set<string> {
  const out = new Set<string>()
  const a = entry.action as { kind: string; set?: unknown; to?: unknown; url?: unknown; message?: unknown }
  if ((a.kind === 'setParams' || a.kind === 'openPage') && a.set && typeof a.set === 'object' && !Array.isArray(a.set)) {
    for (const k of Object.keys(a.set)) out.add(k)
  }
  collectParamRefs(a, out)
  for (const s of [a.to, a.url, a.message]) if (typeof s === 'string') for (const k of paramTokenKeys(s)) out.add(k)
  conditionParamKeys(entry.when, out)
  conditionParamKeys(entry.pressedWhen, out)
  return out
}

/** The board parameters a widget's stored `rules` read (`source: 'param'` on either term). */
export function ruleParamKeys(settings: unknown): Set<string> {
  const out = new Set<string>()
  for (const rule of rulesOf(settings)) {
    if (rule.source === 'param' && typeof rule.key === 'string' && rule.key.trim()) out.add(rule.key.trim())
    if (rule.source2 === 'param' && typeof rule.key2 === 'string' && rule.key2.trim()) out.add(rule.key2.trim())
  }
  return out
}

function rulesOf(settings: unknown): Array<Record<string, unknown>> {
  const rules = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as { rules?: unknown }).rules : undefined
  return Array.isArray(rules) ? rules.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)) : []
}

/** The board parameters a card's visibility rule reads (`visibility.when`, either condition shape, both terms). */
export function visibilityParamKeys(visibility: unknown): Set<string> {
  const out = new Set<string>()
  const when = visibility && typeof visibility === 'object' && !Array.isArray(visibility) ? (visibility as { when?: unknown }).when : undefined
  conditionParamKeys(when, out)
  return out
}

/** Every board parameter a placement references, from its actions (either stored shape), its settings and its visibility rule. */
export function referencedPlacementParamKeys(p: PlacementRefs): Set<string> {
  const out = new Set<string>()
  for (const e of allEntriesOf(p.actions)) for (const k of entryParamKeys(e)) out.add(k)
  for (const k of ruleParamKeys(p.settings)) out.add(k)
  for (const k of visibilityParamKeys(p.visibility)) out.add(k)
  return out
}

/**
 * The board parameters a placement's fetch is keyed on (phase 35.2, selective refresh): the ones its binding passes as
 * `{ $param }` (however deep), its visibility rule reads and its action entries' conditions read. A card refetches and
 * re-registers its live topics when one of these or the window changes, not when any parameter of its frame does. Null
 * means every parameter: a card with an enabled compute script keeps them all, because a script reads the whole frame's
 * parameters (§14). The request itself still carries the viewer's whole board context, so a query is answered exactly
 * as before; only WHEN it is asked again changes.
 */
export function fetchParamKeys(p: { dataBinding?: unknown; actions?: unknown; visibility?: unknown; transform?: unknown }): string[] | null {
  const t = p.transform
  if (t && typeof t === 'object' && !Array.isArray(t) && (t as { enabled?: unknown }).enabled !== false) return null
  const out = new Set<string>()
  collectParamRefs(p.dataBinding, out)
  for (const k of visibilityParamKeys(p.visibility)) out.add(k)
  for (const e of allEntriesOf(p.actions)) {
    conditionParamKeys(e.when, out)
    conditionParamKeys(e.pressedWhen, out)
  }
  return [...out].sort()
}

/** The keys a board declares, read off its stored `params` (any shape: a row is untrusted until the DTO parsed it). */
export function declaredParamKeys(params: unknown): Set<string> {
  return new Set(Array.isArray(params) ? (params as Array<{ key?: unknown } | null>).map((d) => d?.key).filter((k): k is string => typeof k === 'string') : [])
}

/** The parameters a placement references that its board does not declare, sorted. */
export function unknownPlacementParamKeys(p: PlacementRefs, params: unknown): string[] {
  const known = declaredParamKeys(params)
  return [...referencedPlacementParamKeys(p)].filter((k) => !known.has(k)).sort()
}

/** 422 naming the keys when a placement write references a parameter its board does not declare (E9). */
export function assertPlacementParamRefsKnown(p: PlacementRefs, params: unknown): void {
  const unknown = unknownPlacementParamKeys(p, params)
  if (unknown.length > 0) {
    throw new AppError(`${MSG.ACTION_PARAM_UNKNOWN}: '${unknown.join("', '")}'`, 422, ErrorCode.VALIDATION_ERROR)
  }
}

/**
 * The settings with every stored rule that reads a parameter the board does not declare taken out (an import's
 * repair, E9), and the keys that were dropped. Settings without such a list come back as they are.
 */
export function withoutRulesReadingUnknownParams(settings: Record<string, unknown>, params: unknown): { settings: Record<string, unknown>; dropped: string[] } {
  const known = declaredParamKeys(params)
  const unknownOf = (rule: Record<string, unknown>) => [
    ...(rule.source === 'param' && typeof rule.key === 'string' && rule.key.trim() && !known.has(rule.key.trim()) ? [rule.key.trim()] : []),
    ...(rule.source2 === 'param' && typeof rule.key2 === 'string' && rule.key2.trim() && !known.has(rule.key2.trim()) ? [rule.key2.trim()] : []),
  ]
  const rules = rulesOf(settings)
  if (rules.length === 0 || !Array.isArray(settings.rules)) return { settings, dropped: [] }
  const dropped = new Set<string>()
  const kept = settings.rules.filter((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return true
    const unknown = unknownOf(r as Record<string, unknown>)
    for (const k of unknown) dropped.add(k)
    return unknown.length === 0
  })
  if (dropped.size === 0) return { settings, dropped: [] }
  return { settings: { ...settings, rules: kept }, dropped: [...dropped].sort() }
}
