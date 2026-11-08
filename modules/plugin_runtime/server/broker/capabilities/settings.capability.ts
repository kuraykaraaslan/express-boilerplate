// settings: plugin-namespaced, non-secret key/value.
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import type { Json } from '../../../sdk/types';
import { SETTING_PREFIX, configTenantOf, type BrokerCtx } from '../broker.context';

export const settings = {
  async get(ctx: BrokerCtx, key: string): Promise<Json> {
    return (await SettingService.getValue(configTenantOf(ctx), SETTING_PREFIX(ctx.pluginId) + String(key))) ?? null;
  },
  async getMany(ctx: BrokerCtx, keys: string[]): Promise<Json> {
    const prefixed = (keys ?? []).map((k) => SETTING_PREFIX(ctx.pluginId) + String(k));
    const rec = await SettingService.getByKeys(configTenantOf(ctx), prefixed);
    const out: Record<string, string> = {};
    for (const k of keys ?? []) { const v = rec[SETTING_PREFIX(ctx.pluginId) + String(k)]; if (v != null) out[k] = v; }
    return out as Json;
  },
  async set(ctx: BrokerCtx, key: string, value: string): Promise<Json> {
    // Phase 53.4: serving another tenant with the root tenant's install, the plugin reads the root tenant's config but may not
    // change it: one tenant's call must not rewrite what every tenant on the platform level runs with.
    if (configTenantOf(ctx) !== ctx.tenantId) {
      throw new Error('the platform\'s plugin configuration cannot be written while serving a tenant');
    }
    // An egress endpoint setting widens the allowlist on the next call: only the tenant's config route (which checks the
    // endpoint and clears the plugin's secrets on a change) may write it, never the plugin.
    if ((ctx.protectedSettingKeys ?? []).includes(String(key))) {
      throw new Error(`setting '${String(key)}' is an egress endpoint setting and cannot be written by the plugin`);
    }
    await SettingService.updateMany(ctx.tenantId, { [SETTING_PREFIX(ctx.pluginId) + String(key)]: String(value) }, { actorId: `plugin:${ctx.pluginId}` });
    return null;
  },
};
