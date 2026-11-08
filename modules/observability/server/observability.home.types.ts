/**
 * `observability:tenant_home`: where a tenant lives, as a contribution (observability phase 16.6 and 16.4). `fleet_directory` is the intended contributor: its
 * routing record knows the tenant's home region and whether the tenant is under a legal hold. observability asks, never imports the fleet modules.
 */
export interface TenantHome {
  /** The tenant's home region id, or null when the contributor has no region for it. */
  region: string | null;
  /** Whether the contributor holds the tenant under a legal hold (nothing of the tenant's records may be removed). */
  legalHold: boolean;
}

export interface TenantHomeProvider {
  /** `null` = this contributor knows nothing about the tenant. */
  homeOf(tenantId: string): Promise<TenantHome | null> | TenantHome | null;
}
