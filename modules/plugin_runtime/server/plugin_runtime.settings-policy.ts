import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { PluginRuntimeSettingKey } from './plugin_runtime.setting.keys';

/**
 * The installation's caps on the plugin broker (2026-10-27), read from the ROOT tenant: a sandboxed plugin runs for one tenant but
 * these limits protect the installation, so they are the operator's (a value in any other tenant is never read). Each key can only
 * LOWER the built-in ceiling; unset (or a failed read) keeps it exactly.
 *
 * - `pluginPresignMaxSeconds`: the longest signed URL `storage.getUrl` hands out, was the constant 7 days (`PLUGIN_PRESIGN_MAX_SECONDS`,
 *   the S3 SigV4 ceiling). 60..604800; a call that asks for nothing still gets 900 seconds, or the cap when it is lower.
 * - `pluginUploadMaxMb`: the largest object `storage.put` writes, was the constant 10 MB (`PLUGIN_UPLOAD_MAX_BYTES`). 1..10.
 * - `pluginKvMaxValueKb`: the largest serialised value `data.put` stores, was the constant 256 KB (`PLUGIN_KV_MAX_VALUE_BYTES`). 1..256.
 *
 * A value above the ceiling reads as the ceiling, below the floor as the floor, anything unreadable as the ceiling (the old
 * behaviour). The sandbox's memory and time limits are not here: their ceiling is plugin_local's trust policy (`maxLimits`, ROOT,
 * /admin/platform/local-plugins) under the runtime defaults of the plugin-host's boot configuration.
 */

export const PRESIGN_CEILING_SECONDS = 7 * 24 * 3600;
export const PRESIGN_FLOOR_SECONDS = 60;
export const UPLOAD_CEILING_MB = 10;
export const KV_VALUE_CEILING_KB = 256;

const KEYS: PluginRuntimeSettingKey[] = ['pluginPresignMaxSeconds', 'pluginUploadMaxMb', 'pluginKvMaxValueKb'];

/** A whole number in [floor, ceiling]; empty or unreadable -> the ceiling (the built-in value). */
export function lowerOnly(raw: string | null | undefined, floor: number, ceiling: number): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,9}$/.test(v)) return ceiling;
  return Math.min(ceiling, Math.max(floor, Number(v)));
}

export interface PluginRuntimePolicy {
  presignMaxSeconds: number;
  uploadMaxBytes: number;
  kvMaxValueBytes: number;
}

export const DEFAULT_PLUGIN_RUNTIME_POLICY: PluginRuntimePolicy = {
  presignMaxSeconds: PRESIGN_CEILING_SECONDS,
  uploadMaxBytes: UPLOAD_CEILING_MB * 1024 * 1024,
  kvMaxValueBytes: KV_VALUE_CEILING_KB * 1024,
};

export async function getPluginRuntimePolicy(tenantId: string = ROOT_TENANT_ID): Promise<PluginRuntimePolicy> {
  let s: Record<string, string | null> = {};
  try {
    // Loaded on use, so a capability's import path stays as it was; any failure keeps the built-in ceilings.
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    s = (await SettingService.getByKeys(tenantId, KEYS)) ?? {};
  } catch { /* defaults */ }
  return {
    presignMaxSeconds: lowerOnly(s.pluginPresignMaxSeconds, PRESIGN_FLOOR_SECONDS, PRESIGN_CEILING_SECONDS),
    uploadMaxBytes: lowerOnly(s.pluginUploadMaxMb, 1, UPLOAD_CEILING_MB) * 1024 * 1024,
    kvMaxValueBytes: lowerOnly(s.pluginKvMaxValueKb, 1, KV_VALUE_CEILING_KB) * 1024,
  };
}
