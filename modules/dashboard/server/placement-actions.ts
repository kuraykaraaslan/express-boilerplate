/**
 * Every action a placement carries, whatever trigger it hangs off (phase 15.4c).
 *
 * The command gate and the run route read every source through
 * `instance-actions.ts`, so a command stored under any trigger (phase 16.1) is
 * both authoring-checked and runnable, and one stored under no known trigger is
 * neither. Pure: no service or db imports.
 */
import { allActionsOf, allEntriesOf, commandEntryFloor, commandReadsRow, isElementCommandSource, type AnyAction, type NormalizedEntry } from './instance-actions'

/** Every action of every source, from either stored shape (v1 `{ onClick }` or v2 `sources`). */
export function allPlacementActions(actions: unknown): AnyAction[] {
  return allActionsOf(actions)
}

export type CommandAction = AnyAction & { kind: 'command'; commandKey: string }

/** Every `command` action on the placement (with a key), in slot order. */
export function commandActionsOf(actions: unknown): CommandAction[] {
  return allPlacementActions(actions).filter(
    (a): a is CommandAction => a.kind === 'command' && typeof a.commandKey === 'string' && a.commandKey !== '',
  )
}

/** Which stored entry a run addresses (phase 16.1): its source and its id. */
export type CommandRef = { sourceKey: string; actionId: string }

/** A stored command entry found by `findCommandEntry`: the entry, its source and its (checked) command action. */
export type FoundCommandEntry = NormalizedEntry & { sourceKey: string; action: CommandAction }

/**
 * The command entry this placement runs for `commandKey`, or null: only a configured command is runnable.
 *
 * With a `ref` the exact entry is looked up and must carry that key. Without one the key alone must be
 * unambiguous: two entries with the same key but different params would otherwise run whichever came first, so such
 * a placement is refused until the caller says which entry it means. A symbol gesture's entry (decision 49) is
 * never found without its address: it runs only from the source it is stored under, for the symbol it hangs off.
 */
export function findCommandEntry(actions: unknown, commandKey: string, ref?: CommandRef): FoundCommandEntry | null {
  const entries = allEntriesOf(actions).filter(
    (e): e is FoundCommandEntry =>
      e.action.kind === 'command' && typeof e.action.commandKey === 'string' && e.action.commandKey === commandKey,
  )
  if (ref) return entries.find((e) => e.sourceKey === ref.sourceKey && e.id === ref.actionId) ?? null
  const own = entries.filter((e) => !isElementCommandSource(e.sourceKey))
  const distinct = new Set(own.map((e) => JSON.stringify(e.action.params ?? {})))
  return distinct.size <= 1 ? (own[0] ?? null) : null
}

/** The command action of {@link findCommandEntry}. */
export function findCommandAction(actions: unknown, commandKey: string, ref?: CommandRef): CommandAction | null {
  return findCommandEntry(actions, commandKey, ref)?.action ?? null
}

/**
 * The first command on the placement with its address, or null. What a control widget drives: a command on a
 * symbol gesture belongs to its symbol, never to the placement as a whole, and one that reads the clicked row
 * (35.2, E14) belongs to its row source (a control has no row, and the run route refuses a value on a row source).
 */
export function placementCommandRef(actions: unknown): (CommandRef & { commandKey: string }) | null {
  const e = allEntriesOf(actions).find(
    (x) => x.action.kind === 'command' && typeof x.action.commandKey === 'string' && x.action.commandKey !== ''
      && !isElementCommandSource(x.sourceKey) && !commandReadsRow(x.action),
  )
  return e ? { sourceKey: e.sourceKey, actionId: e.id, commandKey: e.action.commandKey as string } : null
}

/**
 * Whether the control's command asks first (D175): its entry's floor (`commandEntryFloor`), or null when the placement drives no command. The
 * host shows the question the run route will demand.
 */
export function placementCommandFloor(actions: unknown): 'confirm' | 'typed' | null {
  const ref = placementCommandRef(actions)
  const entry = ref ? findCommandEntry(actions, ref.commandKey, ref) : null
  return entry ? commandEntryFloor(entry) : null
}

/** The first command key the placement's control drives (a symbol's command is not one), or null. */
export function placementCommandKey(actions: unknown): string | null {
  return placementCommandRef(actions)?.commandKey ?? null
}
