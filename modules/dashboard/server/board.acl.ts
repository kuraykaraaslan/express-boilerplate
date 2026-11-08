import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

/**
 * K3 (docs/phases/07-dashboard 09): only `dashboard.boards.manage` may write a TENANT
 * board. This is the one place every write route calls, so the rule cannot
 * drift between "rename", "delete", "place a widget" and "save a layout".
 *
 * A PRIVATE board's ownership is NOT re-checked here — `board.crud.service.ts`'s
 * `get()` already turns someone else's private board into a 404 before a write
 * route ever reaches this call, the same way it always has. This function only
 * distinguishes TENANT from PRIVATE, which is the one thing that changed:
 * before Faz 9, any USER holding `dashboard.boards.write` could write ANY
 * shared board, up to and including the workspace home screens every tenant
 * member opens on `/admin`.
 *
 * Pure and deliberately free of service/db imports — `board.crud.service.ts`
 * imports `@kuraykaraaslan-labs/db`, which boots env at import time, so a unit test
 * for this predicate would otherwise need a full DATABASE_URL/token-secret
 * environment for logic that touches no row. Same reason
 * `dynamic_page.block.acl.ts` and `widget.transitions.ts` are kept separate
 * from their services.
 */
export function assertCanWrite(board: { scope: string }, hasManage: boolean): void {
  if (!canWrite(board, hasManage)) {
    throw new AppError(MSG.BOARD_MANAGE_REQUIRED, 403, ErrorCode.FORBIDDEN)
  }
}

/**
 * The non-throwing form, for a LIST of boards (Faz 9, dilim 9.1 — the hub
 * shows or hides a rename/delete affordance per row without a request per
 * row). Only meaningful for a board this caller can already SEE:
 * `DashboardBoardService.list`'s query only ever returns a PRIVATE board that
 * belongs to the caller, so by the time a board reaches this function a
 * PRIVATE one is always theirs to write — the ownership check that matters is
 * upstream, in the query, not here.
 */
export function canWrite(board: { scope: string }, hasManage: boolean): boolean {
  return board.scope !== 'TENANT' || hasManage
}

/**
 * Split a source board's placement refs into what a copy may carry and what
 * it must drop (Faz 9, dilim 9.1's `duplicate()`). `resolvable` is whatever
 * the CALLER already decided a copy may keep — resolved for the copying
 * caller, and, for a shared copy, already excluding anyone else's PRIVATE
 * widget (`dashboard-boards-board-id-duplicate.route.ts`). This function only
 * applies that decision to the actual list, so the partitioning itself is
 * testable without a DataSource; each name in `skipped` is reported once even
 * if the source board placed it more than once.
 */
export function partitionCopyableRefs(
  refs: string[],
  resolvable: Set<string>,
): { keep: string[]; skipped: string[] } {
  const keep = new Set<string>()
  const skipped = new Set<string>()
  for (const ref of refs) (resolvable.has(ref) ? keep : skipped).add(ref)
  return { keep: [...keep], skipped: [...skipped] }
}

/**
 * A module board route is unreachable for a module this tenant does not run
 * (Faz 9, K15) — its widgets never resolve either way, so a board there would
 * be a grid of gaps. `moduleRegistry.getModule` also catches a typo'd id: a
 * board keyed on a module that has never existed is not a 404 waiting to
 * happen later, it never exists at all. One function so the board route and
 * the widgets-resolve route cannot drift on what "reachable" means.
 */
export function assertModuleReachable(moduleId: string, enabledIds: Set<string>): void {
  if (!moduleRegistry.getModule(moduleId) || !enabledIds.has(moduleId)) {
    throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  }
}

/**
 * Whether THIS caller may edit a board they can open (15.2a): the entry
 * permission `dashboard.boards.write` AND, for a TENANT board, `manage`. The
 * single-board GET reports it so the viewer never sees edit actions that 403.
 */
export function canEditBoard(board: { scope: string }, granted: ReadonlySet<string>): boolean {
  return granted.has('dashboard.boards.write') && canWrite(board, granted.has('dashboard.boards.manage'))
}
