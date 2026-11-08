import { AsyncLocalStorage } from 'node:async_hooks'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { MANAGED_BY_CODE } from './config.kinds'

/**
 * Who may edit a code-managed row (observability phase 21.3). A row applied from a repository is read-only everywhere else: the console shows
 * it with a badge, and the services refuse a write that does not come from an apply, so "the file says one thing and the console another"
 * cannot happen by accident. Detaching hands the row to the UI.
 *
 * The apply runs its writes inside `runAsConfigApply`, which the services' `assertEditable` recognises. The marker is an AsyncLocalStorage
 * flag, not a parameter, so no service signature had to grow and a caller outside an apply cannot pass it by mistake.
 */
const als = new AsyncLocalStorage<{ apply: true }>()

export function runAsConfigApply<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ apply: true }, fn)
}

export function isConfigApply(): boolean {
  return als.getStore()?.apply === true
}

export const isCodeManaged = (row: { managedBy?: string | null } | null | undefined): boolean => row?.managedBy === MANAGED_BY_CODE

/**
 * Refuse a write to a code-managed row that does not come from an apply. `operational` lists the fields an operator may still change by hand
 * because they are state, not definition (a component's MAINTENANCE status, a monitor's pause-until and maintenance window).
 */
export function assertEditable(
  row: { managedBy?: string | null } | null | undefined,
  what: string,
  patch?: Record<string, unknown>,
  operational: readonly string[] = [],
): void {
  if (!isCodeManaged(row) || isConfigApply()) return
  if (patch && Object.keys(patch).length > 0 && Object.keys(patch).every((k) => operational.includes(k))) return
  throw new AppError(
    `This ${what} is managed from code. Change the file and apply it again, or detach it to edit it here.`,
    409, ErrorCode.CONFLICT, { details: { managedBy: MANAGED_BY_CODE } },
  )
}

/** The mark an apply writes on a row it creates or adopts. */
export const codeMark = (key: string | null): { managedBy: string; sourceKey?: string } =>
  key === null ? { managedBy: MANAGED_BY_CODE } : { managedBy: MANAGED_BY_CODE, sourceKey: `code:${key}` }
