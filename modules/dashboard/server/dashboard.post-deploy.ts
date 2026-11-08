import 'reflect-metadata'
import type { PostDeployStep } from '@kuraykaraaslan-labs/db/server/db.post-deploy'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { publishBuiltinWidgets } from './widget.builtin-catalog'

/**
 * `db:post_deploy` step (owner decision 22, 2026-10-18): publish the builtin data widgets into the root tenant on
 * EVERY deploy, so no installation needs the manual `npm run dashboard:publish-widgets` (which stays for an operator
 * who cannot wait for a deploy).
 *
 * The same idempotent upsert as the script and the root seed (`publishBuiltinWidgets`): one root-scoped transaction
 * for the whole catalogue, keyed on `type`, `widgetId` kept, a row that already matches the code not written, no
 * version bumped, no tenant's row read. It reaches the database only through the deploy's own DataSource; the
 * platform catalogue cache (`dash:rootwidgets:v1`) is not busted from here (no Redis client in the deploy), so a
 * changed definition shows within that cache's 5-minute TTL.
 */
const step: PostDeployStep = {
  async run(ctx) {
    const r = await ctx.withTenantTransaction(ROOT_TENANT_ID, (manager) =>
      publishBuiltinWidgets(manager.getRepository(DashboardWidget)))
    return `builtin widgets: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`
  },
}

export default step
