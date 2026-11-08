import 'reflect-metadata';
import type { FindOptionsWhere, Repository } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { Tenant } from './entities/tenant.entity';
import { MaintenanceWindow } from './entities/maintenance_window.entity';
import { MaintenanceModeEnum, MaintenanceScopeEnum, MaintenanceStatusEnum } from './maintenance.enums';
import { SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';

/**
 * Tenant registry seed.
 *
 * The `tenants` table is the global registry of every tenant in the platform.
 * It lives in the SYSTEM DataSource: its `tenantId` column is its own primary
 * key (the tenant's identity), NOT a tenant-scope foreign key — so it is
 * system-scoped and we go through `ctx.systemRepo`, never setting a separate
 * scope id.
 *
 * Rules of the house (mirrors `store.seed.ts`):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where` so re-runs reuse rows. There is no `@Unique` constraint here, so
 *    the natural keys are the primary key (for the active seeded tenant) and
 *    `name` (for the extra demo rows).
 *  - Use *valid* enum values only. `tenantStatus` is one of
 *    ACTIVE / INACTIVE / PENDING / SUSPENDED / DELETED / ARCHIVED.
 *  - Timestamps are real `Date` objects.
 *  - Cover the module's lifecycle features with varied rows (a healthy active
 *    tenant, a pending one, and one in the soft-deletion grace window).
 *
 * `maintenance_windows` (also SYSTEM-scoped: a `tenantId = null` row freezes the
 * whole platform) is seeded with HISTORY ONLY in the default lane: COMPLETED and
 * CANCELLED windows for the platform, for the seeded tenant and for one route
 * pattern, in every scope and mode. The gate treats only SCHEDULED (inside its
 * start/end) and IN_PROGRESS windows as active, so none of these can block the
 * base tenants. The windows that CAN gate (SCHEDULED, IN_PROGRESS) are written
 * only with `ctx.fullLoad`, and only for synthetic tenants, see
 * `seedLiveMaintenanceWindows`. All dates hang off a FIXED anchor and rows are
 * keyed on `(scope, title)`, never on a clock value.
 */
export async function seedTenant(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;
  const tenantRepo = ctx.systemRepo<Tenant>(Tenant);

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  // ── The active seeded tenant (matched by its own primary key) ───────────────
  // This is the tenant every other module seeds against, so make sure the
  // registry row for it exists and is ACTIVE.
  await foc(tenantRepo,
    { tenantId } as FindOptionsWhere<Tenant>,
    {
      tenantId,
      name: 'Acme Demo Workspace',
      description: 'Primary seeded demo tenant used across all module seeds.',
      tenantStatus: 'ACTIVE',
      createdAt: daysAgo(120),
      updatedAt: daysAgo(2),
    },
  );

  // ── A freshly-signed-up tenant awaiting activation ──────────────────────────
  await foc(tenantRepo,
    { name: 'Globex Trial (Pending)' } as FindOptionsWhere<Tenant>,
    {
      name: 'Globex Trial (Pending)',
      description: 'Sign-up completed, onboarding not yet finished.',
      tenantStatus: 'PENDING',
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
  );

  // ── A tenant in the soft-deletion grace window ──────────────────────────────
  await foc(tenantRepo,
    { name: 'Initech Legacy (Closing)' } as FindOptionsWhere<Tenant>,
    {
      name: 'Initech Legacy (Closing)',
      description: 'Owner requested account closure; pending hard-delete sweep.',
      tenantStatus: 'SUSPENDED',
      createdAt: daysAgo(400),
      updatedAt: daysAgo(10),
      deletionRequestedAt: daysAgo(10),
      deleteAfter: daysFromNow(20),
    },
  );

  // ── Maintenance windows: history that can never gate a request ──────────────
  const windowRepo = ctx.systemRepo<MaintenanceWindow>(MaintenanceWindow);
  const historyDefs: WindowDef[] = [
    {
      title: 'Database upgrade (completed)', scope: 'SYSTEM', tenantId: null, status: 'COMPLETED', mode: 'FULL',
      message: 'Planned database upgrade. The platform was unavailable for about an hour.',
      startDay: -120, hours: 1, actual: true,
    },
    {
      title: 'Backup verification (completed, read-only)', scope: 'SYSTEM', tenantId: null, status: 'COMPLETED', mode: 'READ_ONLY',
      message: 'Reads stayed available while backups were verified.',
      startDay: -60, hours: 2, actual: true,
    },
    {
      title: 'Search reindex (completed, canary)', scope: 'TENANT', tenantId, status: 'COMPLETED', mode: 'READ_ONLY', percentage: 25,
      message: 'A quarter of visitors saw a read-only banner while search was reindexed.',
      startDay: -45, hours: 3, actual: true,
    },
    {
      title: 'Store module migration (completed)', scope: 'ROUTE', tenantId, status: 'COMPLETED', mode: 'FULL', routePatterns: ['/admin/store/*'],
      message: 'The store admin was paused during a data migration.',
      startDay: -30, hours: 1, actual: true,
    },
    {
      title: 'Network change (cancelled)', scope: 'SYSTEM', tenantId: null, status: 'CANCELLED', mode: 'FULL',
      message: 'Cancelled: the change was merged into the database upgrade.',
      startDay: -90, hours: 2, actual: false, allowRoles: ['OWNER'],
    },
    {
      title: 'Tenant data export window (cancelled)', scope: 'TENANT', tenantId, status: 'CANCELLED', mode: 'FULL',
      message: null, startDay: -15, hours: 4, actual: false,
    },
  ];
  for (const def of historyDefs) await seedWindow(ctx, windowRepo, def);

  ctx.log(`tenant: 3 registry rows (active/pending/suspended) incl. ${tenantId}, ${historyDefs.length} past maintenance windows`);

  if (ctx.fullLoad) await seedLiveMaintenanceWindows(ctx, windowRepo);
}

/** Fixed anchor (2026-09-01T00:00Z): nothing here is derived from the clock. */
const WINDOW_ANCHOR = Date.UTC(2026, 8, 1, 0, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface WindowDef {
  title: string;
  scope: 'SYSTEM' | 'TENANT' | 'ROUTE';
  tenantId: string | null;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  mode: 'FULL' | 'READ_ONLY';
  message: string | null;
  /** Days from the anchor to the scheduled start, and how long it lasts (null = open-ended). */
  startDay: number;
  hours: number | null;
  /** True when the window really ran (actualStart/actualEnd set). */
  actual: boolean;
  percentage?: number;
  routePatterns?: string[];
  allowRoles?: string[];
  /** True when the one advance notice is already marked as sent. */
  preNotified?: boolean;
}

async function seedWindow(ctx: SeedContext, repo: Repository<MaintenanceWindow>, def: WindowDef): Promise<void> {
  MaintenanceScopeEnum.parse(def.scope);
  MaintenanceStatusEnum.parse(def.status);
  MaintenanceModeEnum.parse(def.mode);
  const scheduledStart = new Date(WINDOW_ANCHOR + def.startDay * DAY);
  const scheduledEnd = def.hours === null ? null : new Date(scheduledStart.getTime() + def.hours * HOUR);
  await ctx.foc(repo,
    { scope: def.scope, title: def.title } as FindOptionsWhere<MaintenanceWindow>,
    {
      tenantId: def.tenantId, title: def.title, message: def.message, scope: def.scope,
      routePatterns: def.routePatterns ?? null, status: def.status, mode: def.mode,
      percentage: def.percentage ?? null,
      preNotifiedAt: def.preNotified ? new Date(scheduledStart.getTime() - 2 * DAY) : null,
      scheduledStart, scheduledEnd,
      actualStart: def.actual ? scheduledStart : null,
      actualEnd: def.actual && scheduledEnd ? scheduledEnd : def.status === 'CANCELLED' ? new Date(scheduledStart.getTime() - DAY) : null,
      allowRoles: def.allowRoles ?? ['OWNER', 'ADMIN'],
      createdByUserId: SEED_ADMIN_USER_ID,
      createdAt: new Date(scheduledStart.getTime() - 7 * DAY),
      updatedAt: new Date(scheduledStart.getTime() - DAY),
    },
  );
}

/** Synthetic tenant ids (`c0000000-...-NN`): in no `tenants` table, so no request or sweep ever resolves them. */
const syntheticTenant = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Full-load only: the windows that CAN gate a request (SCHEDULED, IN_PROGRESS).
 * Why they are not in the default lane: an IN_PROGRESS window serves a 503 page,
 * and a SCHEDULED one starts gating the moment its start passes. They target
 * synthetic tenants only (never PLATFORM, ACME or the whole platform), so the
 * base tenants are unaffected; the advance notice is marked as already sent so
 * the scheduler tries to mail no one.
 */
async function seedLiveMaintenanceWindows(ctx: SeedContext, repo: Repository<MaintenanceWindow>): Promise<void> {
  const defs: WindowDef[] = [
    {
      title: 'Planned storage move (scheduled)', scope: 'TENANT', tenantId: syntheticTenant(0x31), status: 'SCHEDULED', mode: 'FULL',
      message: 'Scheduled storage migration.', startDay: 200, hours: 3, actual: false, preNotified: true,
    },
    {
      title: 'Canary read-only trial (scheduled)', scope: 'TENANT', tenantId: syntheticTenant(0x32), status: 'SCHEDULED', mode: 'READ_ONLY', percentage: 10,
      message: 'Read-only canary for 10 percent of visitors.', startDay: 210, hours: 2, actual: false, preNotified: true,
    },
    {
      title: 'Billing module upgrade (scheduled route)', scope: 'ROUTE', tenantId: syntheticTenant(0x33), status: 'SCHEDULED', mode: 'FULL', routePatterns: ['/admin/billing/*'],
      message: 'The billing screens are unavailable during the upgrade.', startDay: 220, hours: 1, actual: false, preNotified: true,
    },
    {
      title: 'Emergency database repair (in progress)', scope: 'TENANT', tenantId: syntheticTenant(0x34), status: 'IN_PROGRESS', mode: 'FULL',
      message: 'We are repairing the database. Back soon.', startDay: 30, hours: null, actual: true, preNotified: true, allowRoles: ['OWNER', 'ADMIN', 'SUPPORT'],
    },
  ];
  for (const def of defs) await seedWindow(ctx, repo, def);
  ctx.log(`tenant (full-load): ${defs.length} live maintenance windows for synthetic tenants`);
}
