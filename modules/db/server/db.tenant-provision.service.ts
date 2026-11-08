import { getDataSource, clearTenantDsCache } from './db';
import { TenantDatabase } from './entities/tenant_database.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import { encryptTenantDatabaseUrl } from './db.tenant-database.url';

export interface TenantDbProvisionOptions {
  tenantId: string;
  databaseUrl: string;
  /** Fleet region id; stored as `regionId`. */
  region?: string;
}

const REGION_ID = /^[A-Za-z0-9._-]{1,64}$/;

export default class TenantDatabaseService {

  static async provision(opts: TenantDbProvisionOptions): Promise<TenantDatabase> {
    const ds = await getDataSource();
    const repo = ds.getRepository(TenantDatabase);

    const existing = await repo.findOne({ where: { tenantId: opts.tenantId } });
    if (existing) return existing;

    if (opts.region !== undefined && !REGION_ID.test(opts.region)) {
      throw new Error('TenantDatabaseService: region must be 1-64 characters of letters, digits, ".", "_" or "-"');
    }

    // db.02: the DSN is stored encrypted only, on every role; without SETTINGS_ENCRYPTION_KEY this throws (nothing is written).
    const databaseUrlEnc = encryptTenantDatabaseUrl(opts.databaseUrl);
    const row = repo.create({
      tenantId: opts.tenantId,
      databaseUrlEnc,
      regionId: opts.region ?? null,
      status: 'ACTIVE',
    });
    const saved = await repo.save(row);
    // This process may have remembered the tenant as living on the shared database (tenantDataSourceFor caches that
    // answer for a short TTL); forget it so the next request here routes to the new database straight away.
    clearTenantDsCache(opts.tenantId);
    Logger.info(`TenantDatabaseService: provisioned DB for tenant ${opts.tenantId} region=${opts.region ?? 'default'}`);
    return saved;
  }

  static async decommission(tenantId: string): Promise<void> {
    const ds = await getDataSource();
    await ds.getRepository(TenantDatabase).delete({ tenantId });
    // Clear cached DataSource so next request doesn't use stale connection.
    clearTenantDsCache(tenantId);
    Logger.info(`TenantDatabaseService: decommissioned DB for tenant ${tenantId}`);
  }

  static async listAll(): Promise<TenantDatabase[]> {
    const ds = await getDataSource();
    return ds.getRepository(TenantDatabase).find();
  }

  static async getForTenant(tenantId: string): Promise<TenantDatabase | null> {
    const ds = await getDataSource();
    return ds.getRepository(TenantDatabase).findOne({ where: { tenantId } }) ?? null;
  }
}
