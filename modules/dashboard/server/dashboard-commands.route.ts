import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { dashboardContext } from './dashboard.route.helpers'
import { commandCatalogFor } from './command-catalog'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/commands — the commands THIS caller may run (key, label,
 * confirmation policy and, since phase 35.2, each command's `paramsSchema`). A control widget reads it once to know
 * whether to render live or read-only, and the editor draws a form per parameter from the schema. It grants nothing:
 * the list stays filtered by each command's own permission, a schema describes only a command the caller could run
 * anyway, and every run is re-authorised by `POST …/commands/[key]`. A caller without `dashboard.commands.execute`
 * (the run route's own permission) gets an EMPTY list: nothing on it would run for them. `elementAuthoring` says, per
 * widget type whose provider asks for an authoring permission, whether the caller holds it: the editor hides "Run a
 * command" on a false (the save re-checks). A board view gets the same answer with its board when it opens (phase 40,
 * D40-12): both come from `commandCatalogFor`.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read', alsoCheck: ['dashboard.commands.execute'] })
    return NextResponse.json(await commandCatalogFor(request, tenantId, ctx.session, ctx.granted))
  } catch (e) {
    return normalizeError(e)
  }
}
