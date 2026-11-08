import 'reflect-metadata';
import type { TenantSeedHints } from './tenant.extension-points';
import { SafeTenant } from './tenant.types';
import { CreateTenantInput, UpdateTenantInput, GetTenantsInput } from './tenant.dto';
import { getAll, getById, getBySlug } from './tenant.read.service';
import { create, update, discardUnowned, provisionPersonal, remove, verifyIsolation, slugAvailability, type TenantHome, type SlugAvailability } from './tenant.write.service';

/**
 * Tenant service facade. The implementation is split across focused modules
 * (`tenant.read.service` queries + caching, `tenant.write.service`
 * create/update/provision/delete + isolation audit, `tenant.helpers` cache +
 * default seeding); this class preserves the single `TenantService.*` entry
 * point its callers depend on.
 */
export default class TenantService {
  static getAll(input: GetTenantsInput): Promise<{ tenants: SafeTenant[]; total: number }> {
    return getAll(input);
  }

  static getById(tenantId: string): Promise<SafeTenant> {
    return getById(tenantId);
  }

  static getBySlug(slug: string): Promise<SafeTenant> {
    return getBySlug(slug);
  }

  /**
   * `opts.tenantId`: an id issued by the fleet directory (internal callers only; refused when it was ever used). `opts.home`: where the directory
   * placed the tenant, written with the row.
   */
  static create(data: CreateTenantInput, actorId?: string, opts?: { tenantId?: string; home?: TenantHome; seedHints?: TenantSeedHints }): Promise<SafeTenant> {
    return create(data, actorId, opts);
  }

  /** Remove a just-created tenant whose OWNER membership could not be created (tenant.05). */
  static discardUnowned(tenantId: string, actorId?: string): Promise<void> {
    return discardUnowned(tenantId, actorId);
  }

  static update(tenantId: string, data: UpdateTenantInput, actorId?: string): Promise<SafeTenant> {
    return update(tenantId, data, actorId);
  }

  static slugAvailability(slug: string): Promise<SlugAvailability> {
    return slugAvailability(slug);
  }

  static provisionPersonal(userId: string, email: string): Promise<SafeTenant> {
    return provisionPersonal(userId, email);
  }

  static delete(tenantId: string, actorId?: string): Promise<void> {
    return remove(tenantId, actorId);
  }

  static verifyIsolation(tenantId: string, tableName: string): Promise<{ ok: boolean; leakedRows: number }> {
    return verifyIsolation(tenantId, tableName);
  }
}
