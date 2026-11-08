import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { DashboardWidgetFavorite } from './entities/dashboard_widget_favorite.entity'
import { DashboardWidgetVersion } from './entities/dashboard_widget_version.entity'
import { publishBuiltinWidgets } from './widget.builtin-catalog'

/**
 * Dashboard/widget-platform seed: boards + placed widget instances + favorites.
 *
 * The placed widgets are manifest widgets already declared by other modules'
 * `module.json` `widgets[]` arrays (`manifest:workspace-overview`,
 * `manifest:entity-counts`, `manifest:analytics-pulse` — see
 * `dashboard/ui/widget.types.ts`'s `widgetRef` contract).
 *
 * Tenant-authored widgets (the editor's "My widgets" library) are seeded too, so
 * the widget list and the version history are not empty: one template widget per
 * lifecycle status (PUBLISHED with two immutable versions, DRAFT with none,
 * ARCHIVED keeping its last version), one PRIVATE widget owned by the admin and
 * one with an abstract `dataSpec`. They are written through repositories, not
 * through the publishing service, so the `dashboard_widget_versions` snapshots
 * are built exactly as `DashboardWidgetPublishingService.publish` builds them
 * (`{ ...widget }`). Templates are inert opaque-origin HTML: no script, no
 * external URL. They are NOT placed on a seeded board.
 *
 * The one `DashboardWidget` write below is the opposite of tenant-authored: the
 * PLATFORM's builtin data widgets, written only when the seed target is the root
 * tenant, because every other tenant reads them through from there (D1).
 *
 * `DashboardBoard` has a natural key (`tenantId` + `slug`) → `ctx.foc`.
 * `DashboardWidgetInstance` has no DB `@Unique`, so — mirroring `audit_log`'s
 * approach — a stable composite (`tenantId`, `entityId`, `widgetRef`) is used
 * as `foc`'s natural key: one instance of a given widget per board.
 * `DashboardWidgetFavorite`'s three columns already form its primary key, so
 * `foc` on that triple is exact.
 */
export async function seedDashboard(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, refs } = ctx

  // ── The platform's builtin data widgets (phase 4b) ────────────────────────
  // Written ONCE, into the root tenant, because that is where every tenant reads
  // them from (D1, `widget.root-catalog.ts`). Seeding a copy per tenant is the
  // shape that decision refused: N rows, N versions, and a fix that reaches
  // nobody who already has one. Idempotent, so a re-seed republishes rather than
  // duplicating — and `npm run dashboard:publish-widgets` is the same write for
  // an installation that does not run seeds.
  if (isRootTenant(tenantId)) {
    const published = await publishBuiltinWidgets(ctx.repo<DashboardWidget>(DashboardWidget))
    ctx.log(`dashboard: builtin data widgets — ${published.created} created, ${published.updated} updated, ${published.unchanged} unchanged`)
  }
  const userId = (refs.userId as string) ?? SEED_USER_ID
  const adminUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID

  // ── Boards ───────────────────────────────────────────────────────────────
  const boardRepo = ctx.repo<DashboardBoard>(DashboardBoard)

  const tenantBoard = await foc(boardRepo,
    { tenantId, slug: 'genel-bakis' } as FindOptionsWhere<DashboardBoard>,
    {
      tenantId, slug: 'genel-bakis', title: 'Genel Bakış',
      description: 'Şirket geneli için varsayılan pano.', icon: 'fas fa-gauge',
      workspace: null, scope: 'TENANT', isDefault: true, gridCols: 12,
    },
  )

  const crmBoard = await foc(boardRepo,
    { tenantId, slug: 'crm-panosu' } as FindOptionsWhere<DashboardBoard>,
    {
      tenantId, slug: 'crm-panosu', title: 'CRM Panosu',
      description: 'Satış ekibinin günlük takip panosu.', icon: 'fas fa-users',
      workspace: 'crm', scope: 'TENANT', isDefault: false, gridCols: 12,
    },
  )

  const adminPrivateBoard = await foc(boardRepo,
    { tenantId, slug: 'kisisel-panom' } as FindOptionsWhere<DashboardBoard>,
    {
      tenantId, slug: 'kisisel-panom', title: 'Kişisel Panom',
      description: 'Yöneticinin kendi widget düzeni.', icon: 'fas fa-user',
      workspace: null, scope: 'PRIVATE', ownerUserId: adminUserId, isDefault: true, gridCols: 12,
    },
  )

  const userPrivateBoard = await foc(boardRepo,
    { tenantId, slug: 'benim-panom' } as FindOptionsWhere<DashboardBoard>,
    {
      tenantId, slug: 'benim-panom', title: 'Benim Panom',
      description: 'Kullanıcının kendi widget düzeni.', icon: 'fas fa-user',
      workspace: null, scope: 'PRIVATE', ownerUserId: userId, isDefault: true, gridCols: 12,
    },
  )

  // ── Widget instances (placements) ───────────────────────────────────────
  const instanceRepo = ctx.repo<DashboardWidgetInstance>(DashboardWidgetInstance)

  type InstanceDef = {
    boardId: string
    widgetRef: string
    x: number; y: number; w: number; h: number; order: number
    title?: string
    refreshSeconds?: number
  }

  const instanceDefs: InstanceDef[] = [
    { boardId: tenantBoard.boardId, widgetRef: 'manifest:workspace-overview', x: 0, y: 0, w: 12, h: 4, order: 1 },
    { boardId: tenantBoard.boardId, widgetRef: 'manifest:entity-counts', x: 0, y: 4, w: 12, h: 4, order: 2 },
    { boardId: crmBoard.boardId, widgetRef: 'manifest:entity-counts', x: 0, y: 0, w: 6, h: 4, order: 1, title: 'CRM Sayılar' },
    { boardId: adminPrivateBoard.boardId, widgetRef: 'manifest:analytics-pulse', x: 0, y: 0, w: 6, h: 4, order: 1, refreshSeconds: 60 },
    { boardId: adminPrivateBoard.boardId, widgetRef: 'manifest:entity-counts', x: 6, y: 0, w: 6, h: 4, order: 2 },
    { boardId: userPrivateBoard.boardId, widgetRef: 'manifest:workspace-overview', x: 0, y: 0, w: 12, h: 4, order: 1 },
  ]

  for (const def of instanceDefs) {
    await foc(instanceRepo,
      { tenantId, entityType: 'DASHBOARD', entityId: def.boardId, widgetRef: def.widgetRef } as FindOptionsWhere<DashboardWidgetInstance>,
      {
        tenantId, entityType: 'DASHBOARD', entityId: def.boardId, widgetRef: def.widgetRef,
        x: def.x, y: def.y, w: def.w, h: def.h, order: def.order,
        settings: {}, title: def.title ?? null, refreshSeconds: def.refreshSeconds ?? null,
      },
    )
  }

  // ── Favorites ────────────────────────────────────────────────────────────
  const favoriteRepo = ctx.repo<DashboardWidgetFavorite>(DashboardWidgetFavorite)
  const favoriteDefs = [
    { userId: adminUserId, widgetRef: 'manifest:entity-counts' },
    { userId: userId, widgetRef: 'manifest:workspace-overview' },
  ]
  for (const def of favoriteDefs) {
    await foc(favoriteRepo,
      { tenantId, userId: def.userId, widgetRef: def.widgetRef } as FindOptionsWhere<DashboardWidgetFavorite>,
      { tenantId, userId: def.userId, widgetRef: def.widgetRef },
    )
  }

  const widgetCount = await seedAuthoredWidgets(ctx, adminUserId)

  ctx.log(`dashboard: ${widgetCount} authored widgets, 4 boards, ${instanceDefs.length} widget instances, ${favoriteDefs.length} favorites for ${tenantId}`)
}

const WIDGET_ANCHOR = new Date('2026-01-15T09:00:00Z')

interface AuthoredWidgetDef {
  type: string
  label: string
  category: string
  description: string
  template: string
  schema: Record<string, Record<string, unknown>>
  defaultProps: Record<string, unknown>
  dataSpec?: Array<{ key: string; label: string; shape: 'scalar' | 'series' | 'table' | 'record'; required: boolean }> | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  visibility: 'TENANT' | 'PRIVATE'
  owner?: boolean
  icon: string
  tags: string[]
  defaultW: number
  defaultH: number
  /** One entry per immutable version, oldest first; `publishedVersion` is the last one. */
  versions: Array<{ template: string; changelog: string }>
}

/** Tenant-authored widgets + their publish snapshots. Returns how many widgets exist for the tenant. */
async function seedAuthoredWidgets(ctx: SeedContext, adminUserId: string): Promise<number> {
  const { tenantId, foc } = ctx
  const widgetRepo = ctx.repo<DashboardWidget>(DashboardWidget)
  const versionRepo = ctx.repo<DashboardWidgetVersion>(DashboardWidgetVersion)

  const noticeV1 = '<div style="padding:12px;font-family:sans-serif"><strong>{{title}}</strong><p>{{message}}</p></div>'
  const noticeV2 = '<div style="padding:12px;font-family:sans-serif;border-left:4px solid {{accent}}"><strong>{{title}}</strong><p>{{message}}</p></div>'
  const defs: AuthoredWidgetDef[] = [
    {
      type: 'team-notice', label: 'Team notice', category: 'Content', description: 'A short announcement card for the team.',
      template: noticeV2,
      schema: { title: { label: 'Title', type: 'text' }, message: { label: 'Message', type: 'textarea' }, accent: { label: 'Accent colour', type: 'text' } },
      defaultProps: { title: 'Welcome', message: 'Standup moves to 09:30 this week.', accent: '#2563eb' },
      status: 'PUBLISHED', visibility: 'TENANT', icon: 'fas fa-bullhorn', tags: ['announcement', 'team'], defaultW: 6, defaultH: 3,
      versions: [
        { template: noticeV1, changelog: 'First release.' },
        { template: noticeV2, changelog: 'Added an accent colour.' },
      ],
    },
    {
      type: 'sales-target-card', label: 'Sales target card', category: 'Data', description: 'Draft: shows progress against a target; slots are bound per placement.',
      template: '<div style="padding:12px"><h3>{{label}}</h3><p>{{value}} / {{target}}</p></div>',
      schema: { label: { label: 'Label', type: 'text' }, target: { label: 'Target', type: 'number' } },
      defaultProps: { label: 'Monthly target', target: 100 },
      dataSpec: [
        { key: 'value', label: 'Current value', shape: 'scalar', required: true },
        { key: 'history', label: 'Trend', shape: 'series', required: false },
      ],
      status: 'DRAFT', visibility: 'TENANT', icon: 'fas fa-bullseye', tags: ['sales'], defaultW: 4, defaultH: 3,
      versions: [],
    },
    {
      type: 'legacy-banner', label: 'Legacy banner', category: 'Content', description: 'Archived: out of the library, kept for boards that still follow it.',
      template: '<div style="padding:8px;background:#f3f4f6">{{text}}</div>',
      schema: { text: { label: 'Text', type: 'text' } }, defaultProps: { text: 'Quarterly review' },
      status: 'ARCHIVED', visibility: 'TENANT', icon: 'fas fa-box-archive', tags: ['legacy'], defaultW: 12, defaultH: 1,
      versions: [{ template: '<div style="padding:8px;background:#f3f4f6">{{text}}</div>', changelog: 'Imported from the old dashboard.' }],
    },
    {
      type: 'my-quick-notes', label: 'My quick notes', category: 'Content', description: 'Private to its author.',
      template: '<pre style="padding:8px;white-space:pre-wrap">{{notes}}</pre>',
      schema: { notes: { label: 'Notes', type: 'textarea' } }, defaultProps: { notes: 'Call the supplier back.' },
      status: 'PUBLISHED', visibility: 'PRIVATE', owner: true, icon: 'fas fa-note-sticky', tags: [], defaultW: 4, defaultH: 4,
      versions: [{ template: '<pre style="padding:8px;white-space:pre-wrap">{{notes}}</pre>', changelog: 'Personal scratchpad.' }],
    },
  ]

  for (const def of defs) {
    const publishedVersion = def.versions.length > 0 ? def.versions.length : null
    const widget = await foc(widgetRepo, { tenantId, type: def.type } as FindOptionsWhere<DashboardWidget>, {
      tenantId, type: def.type, label: def.label, category: def.category, description: def.description,
      schema: def.schema, defaultProps: def.defaultProps, template: def.template,
      allowedRoles: null, isSystem: false, source: 'seed', renderTier: 'template', componentId: null, frameListingId: null,
      dataSpec: def.dataSpec ?? null, defaultW: def.defaultW, defaultH: def.defaultH,
      visibility: def.visibility, ownerUserId: def.owner ? adminUserId : null,
      status: def.status, revision: def.versions.length + 1, publishedVersion, icon: def.icon, tags: def.tags,
      baseWidgetRef: null, defaultDataBinding: null,
    })
    for (const [i, v] of def.versions.entries()) {
      // snapshot = the widget row as it stood at that publish (what the publishing service stores)
      const snapshot = JSON.parse(JSON.stringify({ ...widget, template: v.template, status: 'PUBLISHED', publishedVersion: i + 1, revision: i + 1 }))
      await foc(versionRepo, { tenantId, widgetId: widget.widgetId, version: i + 1 } as FindOptionsWhere<DashboardWidgetVersion>, {
        tenantId, widgetId: widget.widgetId, version: i + 1, snapshot, changelog: v.changelog, publishedByUserId: adminUserId,
        createdAt: new Date(WIDGET_ANCHOR.getTime() + i * 86_400_000),
      })
    }
  }
  return defs.length
}
