import type { NextRequest } from 'next/server'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'
import { listPermittedCommands, type PermittedCommandInfo } from './command.service'
import { elementAuthoringMapFor } from './element-authoring'

/** What `GET …/dashboard/commands` answers, and the board-open answer carries (D40-12). */
export interface CommandCatalog {
  commands: PermittedCommandInfo[]
  elementAuthoring: Record<string, boolean>
}

/**
 * The commands THIS caller may run and, per widget type whose provider asks for an authoring permission, whether they hold
 * it. One implementation for the commands route and the board-open answer, so the two can never disagree: `granted` is the
 * caller's answer for `dashboard.commands.execute` (the run route's own permission), and a caller without it gets an EMPTY
 * list, since nothing on it would run for them.
 */
export async function commandCatalogFor(
  request: NextRequest,
  tenantId: string,
  session: SubjectSource,
  granted: ReadonlySet<string>,
): Promise<CommandCatalog> {
  const commands = !granted.has('dashboard.commands.execute') ? [] : await listPermittedCommands(request, tenantId, (permissionIds) =>
    grantedPermissions({ request, tenantId, session, permissionIds }))
  const elementAuthoring = await elementAuthoringMapFor(request, tenantId, session)
  return { commands, elementAuthoring }
}
