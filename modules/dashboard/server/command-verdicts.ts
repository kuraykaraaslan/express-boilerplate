import type { NextRequest } from 'next/server'
import { ProviderUnavailableError } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { assertCommandAuthoring } from './command.service'
import { allActionsOf, isElementCommandSource, normalizeInstanceActions, type NormalizedEntry } from './instance-actions'
import { commandUsesRow, isCommandRowSource, symbolCommandParamUnsupported } from './dashboard.dto'
import type { CommandStatus } from './board-package.import'

type CommandRef = { commandKey: string; params?: Record<string, unknown> }

export interface CommandVerdicts {
  /** Would this command action pass the authoring gate for this caller? With the source it is stored under, the source's own rules too (B5). */
  allowed: (action: CommandRef, sourceKey?: string) => boolean
  /** Why not: `missing` (no active contribution), `params` (undeclared param, or one a symbol cannot supply), `forbidden`. */
  status: (action: CommandRef, sourceKey?: string) => CommandStatus
}

const keyOf = (a: CommandRef) => JSON.stringify([a.commandKey, a.params ?? {}])

/**
 * A command stored on a symbol's gesture (B5): a symbol run carries no row, no form field and no value, so a param read
 * from one of them can never resolve; the write schema refuses it, and the copying paths drop it as a `params` refusal.
 */
const symbolParamsUnsupported = (a: CommandRef, sourceKey: string | undefined): boolean =>
  !!sourceKey && isElementCommandSource(sourceKey) && Object.values(a.params ?? {}).some(symbolCommandParamUnsupported)

/**
 * A command that reads the clicked row (`{ $row }`, phase 35.2, E14) stored on a source with no row (a control's click, a
 * header button): the write schema refuses it, and the copying paths drop it as a `params` refusal. Whether the param
 * is the command's `resourceId` one is the gate's own check (`assertCommandAuthoring`, a 422 = `params`).
 */
const rowParamsUnsupported = (a: CommandRef, sourceKey: string | undefined): boolean =>
  !!sourceKey && !isCommandRowSource(sourceKey) && commandUsesRow({ kind: 'command', params: a.params })

const unsupported = (a: CommandRef, sourceKey: string | undefined): boolean =>
  symbolParamsUnsupported(a, sourceKey) || rowParamsUnsupported(a, sourceKey)

/**
 * Ask the authoring gate once per distinct (command, params) found in these stored `actions` values.
 *
 * Every path that writes a placement's actions on the caller's behalf without going through the
 * placement create/PATCH routes (board import, duplicate, template apply) must hold commands to the same
 * rule those routes do: a placement may carry only a command its author could run themselves.
 */
export async function commandVerdictsFor(
  request: NextRequest, tenantId: string, actionsValues: Iterable<unknown>,
): Promise<CommandVerdicts> {
  const verdicts = new Map<string, CommandStatus>()
  for (const raw of actionsValues) {
    for (const a of allActionsOf(raw)) {
      if (a.kind !== 'command' || typeof a.commandKey !== 'string') continue
      const k = keyOf({ commandKey: a.commandKey, params: a.params })
      if (verdicts.has(k)) continue
      try {
        await assertCommandAuthoring(request, tenantId, { onClick: { kind: 'command', commandKey: a.commandKey, params: a.params ?? {} } })
        verdicts.set(k, 'ok')
      } catch (e) {
        // The gate's own refusals: 404 = no contribution with that key, 409 ProviderUnavailable = its module is not
        // active here (both `missing`), 422 = an undeclared param.
        const status = (e as { statusCode?: number }).statusCode
        const missing = status === 404 || e instanceof ProviderUnavailableError
        verdicts.set(k, missing ? 'missing' : status === 422 ? 'params' : 'forbidden')
      }
    }
  }
  return {
    allowed: (a, sourceKey) => !unsupported(a, sourceKey) && verdicts.get(keyOf(a)) === 'ok',
    status: (a, sourceKey) => (unsupported(a, sourceKey) ? 'params' : verdicts.get(keyOf(a)) ?? 'forbidden'),
  }
}

/**
 * Drop the command entries of a stored `actions` value that the caller may not author. Pure.
 * Untouched input comes back as the same value (a legacy `{ onClick }` is not rewritten for nothing);
 * otherwise the result is v2, or null when nothing is left.
 */
export function stripUnauthorisedCommands(
  raw: unknown, allowed: (action: CommandRef, sourceKey?: string) => boolean,
): { actions: unknown; dropped: number } {
  const n = normalizeInstanceActions(raw)
  if (!n) return { actions: raw ?? null, dropped: 0 }
  let dropped = 0
  const sources: Record<string, NormalizedEntry[]> = {}
  for (const [key, list] of Object.entries(n.sources)) {
    const kept = list.filter((e) => {
      const a = e.action
      if (a.kind !== 'command') return true
      if (typeof a.commandKey === 'string' && allowed({ commandKey: a.commandKey, params: a.params }, key)) return true
      dropped++
      return false
    })
    if (kept.length > 0) sources[key] = kept
  }
  if (dropped === 0) return { actions: raw, dropped: 0 }
  return { actions: Object.keys(sources).length > 0 ? { v: 2, sources } : null, dropped }
}
