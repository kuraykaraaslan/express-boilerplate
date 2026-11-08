/**
 * Where a tenant's observability data may live (docs/phases/09-observability/16.6).
 *
 * The truth about where a tenant lives is the FLEET DIRECTORY (`fleet_tenant_directory.homeRegionId`, the routing record of docs/phases/02-fleet/05), so
 * when that module is installed and answers (through the `observability:tenant_home` extension point: observability never imports the fleet modules), its
 * region is the tenant's home region. When it is not installed, is not active for the tenant, has no row
 * for it or cannot be read, the workspace setting `observabilityDataRegion` is the fallback. Nothing here copies data anywhere: the answer is only ever
 * used to REFUSE telemetry that reaches a deployment in another region (`telemetry.plan-guard.ts`).
 *
 * Optional and fail open, like every governance read: the directory is reached through that point, and a failure is "no
 * answer from the directory", never a refusal of a customer's telemetry.
 */
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys';
import { tenantHome } from './observability.home';

export type RegionSource = 'fleet_directory' | 'setting' | 'none';
export interface RegionAnswer { region: string | null; source: RegionSource }

export interface RegionReaders {
  directory(tenantId: string): Promise<string | null>;
  setting(tenantId: string): Promise<string | null>;
}

const defaultReaders: RegionReaders = {
  async directory(tenantId) {
    // The contributors of `observability:tenant_home` (fleet_directory's routing record): optional, first answer wins.
    return (await tenantHome(tenantId))?.region ?? null;
  },
  async setting(tenantId) {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    return (await SettingService.getValue(tenantId, OBSERVABILITY_SETTING_KEYS.DATA_REGION)) || null;
  },
};

let readers: RegionReaders = defaultReaders;
/** Test seam. */
export function setRegionReaders(r?: Partial<RegionReaders>): void { readers = r ? { ...defaultReaders, ...r } : defaultReaders; }

const clean = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);

export async function dataRegionOf(tenantId: string): Promise<RegionAnswer> {
  try {
    const fromDirectory = clean(await readers.directory(tenantId));
    if (fromDirectory) return { region: fromDirectory, source: 'fleet_directory' };
  } catch { /* the directory cannot answer: fall back to the setting */ }
  try {
    const fromSetting = clean(await readers.setting(tenantId));
    if (fromSetting) return { region: fromSetting, source: 'setting' };
  } catch { /* settings unavailable: no constraint */ }
  return { region: null, source: 'none' };
}
