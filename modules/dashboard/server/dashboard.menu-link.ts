import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import type { LinkTargetProvider } from '@kuraykaraaslan-labs/shell_menu/server/shell_menu.link-targets.types'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { BoardSlugSchema } from './dashboard.dto'

// The `board` kind of custom menu link (docs/phases/54-menu-editor, 09), contributed to `shell_menu:link_target`. The
// target is a board SLUG: boards are per tenant, but a board a solution or a template installs carries a fixed slug
// (`iot-water-site`) that is the same in every tenant that installed it, so one link of the installation's menu serves
// all of them. In each tenant the link opens that tenant's board with the slug, only when the viewer may open it (a
// shared board, or their own private one); a tenant without it shows no link. A board made by hand gets a slug with a
// random suffix (board-slug.ts), so a link to it works in its own tenant only.

const provider: LinkTargetProvider = {
  kind: 'board',
  label: 'Dashboard board',

  async suggest(q: string) {
    const needle = q.trim().toLowerCase()
    // The platform's own boards: where a sysadmin builds and names the boards a solution then installs.
    const rows = await withTenantRepositoryFor(ROOT_TENANT_ID, DashboardBoard, (repo) =>
      repo.createQueryBuilder('b')
        .select(['b.slug', 'b.title'])
        .where('b.tenantId = :tenantId', { tenantId: ROOT_TENANT_ID })
        .andWhere('b.scope = :shared', { shared: 'TENANT' })
        .orderBy('b.title', 'ASC')
        .limit(200)
        .getMany())
    return rows
      .filter((b) => !needle || b.slug.includes(needle) || b.title.toLowerCase().includes(needle))
      .slice(0, 50)
      .map((b) => ({ target: b.slug, label: b.title, hint: b.slug }))
  },

  validate(target: string) {
    return BoardSlugSchema.safeParse(target).success ? null : 'a board slug: lowercase letters, digits, - and _'
  },

  async resolve(viewer, targets) {
    const slugs = targets.filter((t) => BoardSlugSchema.safeParse(t).success)
    const out: Record<string, string | null> = Object.fromEntries(targets.map((t) => [t, null]))
    if (!slugs.length || !viewer.userId) return out
    const rows = await withTenantRepositoryFor(viewer.tenantId, DashboardBoard, (repo) =>
      repo.createQueryBuilder('b')
        .select(['b.boardId', 'b.slug'])
        .where('b.tenantId = :tenantId', { tenantId: viewer.tenantId })
        .andWhere('b.slug IN (:...slugs)', { slugs })
        .andWhere('(b.scope = :shared OR b.ownerUserId = :userId)', { shared: 'TENANT', userId: viewer.userId })
        .getMany())
    for (const b of rows) out[b.slug] = `/admin/dashboards/${b.boardId}`
    return out
  },
}

export default provider
