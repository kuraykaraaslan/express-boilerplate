import 'reflect-metadata'
import type { FindOptionsWhere } from 'typeorm'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { TenantDatabase } from './entities/tenant_database.entity'
import { encryptTenantDatabaseUrlOrNull } from './db.tenant-database.url'

/**
 * Synthetic tenants. None of them is PLATFORM (`…0000`) or ACME (`…0001`), none exists in
 * the `tenants` table, and `tenantDataSourceFor` is only ever asked about a tenant id by
 * a request that already resolved a real tenant, so no base flow looks these ids up.
 */
export const SYNTHETIC_DB_TENANT_IDS = {
  dedicated: 'c0000000-0000-4000-8000-0000000000d1',
  schemaIsolated: 'c0000000-0000-4000-8000-0000000000d2',
  pooled: 'c0000000-0000-4000-8000-0000000000d3',
} as const

/**
 * `.invalid` is a reserved TLD (RFC 2606): the host can never resolve, so even a code path
 * that opened the URL would fail at DNS, instantly and without reaching any server.
 * The credentials are obvious placeholders, not a password for anything.
 */
const placeholderUrl = (db: string, schema?: string) =>
  `postgresql://seed_placeholder:seed-placeholder-not-a-password@seed-placeholder.invalid:5432/${db}${schema ? `?schema=${schema}` : ''}`

/**
 * Full-load seed for `db`: the tenant database registry (`tenant_databases`).
 *
 * Why this is NOT in the default seed (`db` is exempt as `infrastructure`): the registry
 * describes where tenants' data physically lives, and `tenantDataSourceFor(tenantId)`
 * switches a tenant to its own database as soon as a row exists. A demo row would point
 * demo data at a database that does not exist. The full-load lane (guarded test database
 * only) still needs the table filled, and does it safely:
 *
 *  - rows are keyed on SYNTHETIC tenant ids only, never PLATFORM or ACME, so the base
 *    tenants keep resolving to the primary DataSource (verify with
 *    `modules/seed/scripts/seed-one.ts tenant_branding` after running this);
 *  - the URLs point at a host in the reserved `.invalid` TLD, so they cannot connect;
 *  - the only readers of the whole table are the time-series retention sweep, which opens
 *    each URL in a try/catch, counts a failure and moves on, and the provisioning service.
 *
 * Coverage: a dedicated database, a schema-isolated tenant (`?schema=`, parsed by
 * `parseDbUrl`), and a second schema on the same database as the pooled case.
 *
 * Idempotent: keyed on the primary key (`tenantId`).
 */
export async function seedDbFull(ctx: SeedContext): Promise<void> {
  const { foc } = ctx
  const rows: Array<{ tenantId: string; databaseUrl: string }> = [
    { tenantId: SYNTHETIC_DB_TENANT_IDS.dedicated, databaseUrl: placeholderUrl('seed_placeholder_tenant_d1') },
    { tenantId: SYNTHETIC_DB_TENANT_IDS.schemaIsolated, databaseUrl: placeholderUrl('seed_placeholder_shared', 'tenant_d2') },
    { tenantId: SYNTHETIC_DB_TENANT_IDS.pooled, databaseUrl: placeholderUrl('seed_placeholder_shared', 'tenant_d3') },
  ]

  // db.02: a DSN is stored encrypted only. Without SETTINGS_ENCRYPTION_KEY the placeholder registry rows are not seeded.
  const enc = rows.map((r) => ({ tenantId: r.tenantId, databaseUrlEnc: encryptTenantDatabaseUrlOrNull(r.databaseUrl) }))
  if (enc.some((r) => r.databaseUrlEnc === null)) {
    ctx.log('db(full): SETTINGS_ENCRYPTION_KEY not configured, placeholder tenant databases not seeded (their URL is stored encrypted only)')
    return
  }
  const repo = ctx.systemRepo<TenantDatabase>(TenantDatabase)
  for (const row of enc) {
    await foc(repo, { tenantId: row.tenantId } as FindOptionsWhere<TenantDatabase>, row)
  }

  ctx.refs.syntheticTenantDatabaseIds = Object.values(SYNTHETIC_DB_TENANT_IDS)
  ctx.log(`db(full): ${rows.length} placeholder tenant databases for synthetic tenants (ACME/PLATFORM untouched)`)
}
