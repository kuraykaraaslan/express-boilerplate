// Per-tenant configuration of a sandboxed plugin, whatever source installed it
// (the marketplace, or the operator's local store, plugin_local). Core since
// OD-139 so both sources share one storage scheme and one set of rules.
//
// A plugin declares its tunables once in its manifest `config` block:
//
//   "config": {
//     "settings": [{ "key": "region", "label": "Region", "help": "…" }],
//     "secrets":  [{ "key": "apiKey", "label": "API Key", "help": "…" }]
//   }
//
// Settings are stored plaintext under `plugin:<pluginId>:<key>` (the namespace the
// sandbox broker reads, broker.context SETTING_PREFIX); secrets are encrypted under
// `plugin_secret:<pluginId>:<key>` (SECRET_PREFIX) and are write-only: they are
// never returned, only reported as set or not. `pluginId` is the runtime plugin id
// (`SandboxConfig.pluginId`): a marketplace scoped name, or `local/<scopedName>`.

import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { encryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { SECRET_PREFIX, SETTING_PREFIX } from '../broker/broker.context';

export interface PluginFieldDecl {
  key: string;
  label?: string;
  help?: string;
  placeholder?: string;
}

export interface PluginConfigDecl {
  settings?: PluginFieldDecl[];
  secrets?: PluginFieldDecl[];
}

/** What the config reader/writer needs to know about one installed plugin. */
export interface PluginConfigSubject {
  /** Runtime plugin id: the namespace of its settings and secrets. */
  pluginId: string;
  config: PluginConfigDecl;
  /** Settings whose https URL value the resolver turns into an egress host (`httpAllowlistFromSettings`). */
  egressSettings: string[];
}

/** Setting key for a plugin's non-secret setting (mirrors the broker's SETTING_PREFIX). */
export const pluginSettingKey = (pluginId: string, key: string): string => `${SETTING_PREFIX(pluginId)}${key}`;
/** Setting key for a plugin's encrypted secret (mirrors the broker's SECRET_PREFIX). */
export const pluginSecretKey = (pluginId: string, key: string): string => `${SECRET_PREFIX(pluginId)}${key}`;

export interface PluginConfigValues {
  /**
   * Non-secret settings with their current values. `egress: true` marks an endpoint setting (one the broker turns into
   * an egress host): changing it clears every stored secret not entered again in the same write (`writePluginConfig`),
   * so an editor can warn before saving.
   */
  settings: Array<PluginFieldDecl & { value: string; egress?: true }>;
  /** Secrets with set-status only — values are never returned. */
  secrets: Array<PluginFieldDecl & { set: boolean }>;
  /** True when every declared secret is set. */
  configured: boolean;
}

/** Declared fields with their values (settings) or set-status (secrets) for one tenant. */
export async function readPluginConfig(tenantId: string, s: PluginConfigSubject): Promise<PluginConfigValues> {
  const settingDecls = s.config.settings ?? [];
  const secretDecls = s.config.secrets ?? [];
  const settingVals = settingDecls.length
    ? await SettingService.getByKeys(tenantId, settingDecls.map((d) => pluginSettingKey(s.pluginId, d.key)))
    : {};
  const secretVals = secretDecls.length
    ? await SettingService.getByKeys(tenantId, secretDecls.map((d) => pluginSecretKey(s.pluginId, d.key)))
    : {};
  const settings = settingDecls.map((d) => ({
    ...d,
    value: settingVals[pluginSettingKey(s.pluginId, d.key)] ?? '',
    ...(s.egressSettings.includes(d.key) ? { egress: true as const } : {}),
  }));
  const secrets = secretDecls.map((d) => {
    const v = secretVals[pluginSecretKey(s.pluginId, d.key)];
    return { ...d, set: typeof v === 'string' && v.length > 0 };
  });
  return { settings, secrets, configured: secrets.every((x) => x.set) };
}

/** True when every secret in `secretKeys` is set (non-empty) for the tenant. Never returns a value. */
export async function pluginSecretsConfigured(tenantId: string, pluginId: string, secretKeys: string[]): Promise<boolean> {
  if (!secretKeys.length) return true;
  const vals = await SettingService.getByKeys(tenantId, secretKeys.map((k) => pluginSecretKey(pluginId, k)));
  return secretKeys.every((k) => {
    const v = vals[pluginSecretKey(pluginId, k)];
    return typeof v === 'string' && v.length > 0;
  });
}

/**
 * An endpoint setting (one the broker turns into an egress host) must be empty or a bare https URL: no credentials, query or
 * fragment. Anything else would save and then fail every call, or widen the allowlist to a host nobody meant.
 */
function checkEndpointValue(key: string, value: string): void {
  if (value === '') return;
  let u: URL;
  try { u = new URL(value); } catch { throw new AppError(`"${key}" must be an https URL`, 400, ErrorCode.VALIDATION_ERROR); }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.search || u.hash) {
    throw new AppError(`"${key}" must be an https URL without credentials, query or fragment`, 400, ErrorCode.VALIDATION_ERROR);
  }
}

export interface PluginConfigWrite {
  /** Whether anything was written. */
  changed: boolean;
  /** Declared setting keys present in the input. */
  settings: string[];
  secretsSet: string[];
  /** Secrets cleared because an endpoint setting changed (see `writePluginConfig`). */
  secretsCleared: string[];
}

/**
 * Persist a plugin's config for one tenant. Only declared keys are accepted; empty secret values are ignored
 * (blank = keep existing). The caller audits with its own action name.
 *
 * A secret is bound to the endpoint it was entered for. When a setting that decides where the plugin may send requests
 * (`httpAllowlistFromSettings`) changes, every secret not re-entered in the same request is cleared: otherwise anyone allowed to
 * edit settings could point the endpoint at a host they control and receive a key someone else entered (or the platform seeded).
 */
export async function writePluginConfig(
  tenantId: string,
  s: PluginConfigSubject,
  input: { settings?: Record<string, unknown>; secrets?: Record<string, unknown> },
  actorId?: string,
): Promise<PluginConfigWrite> {
  const allowedSettings = new Set((s.config.settings ?? []).map((d) => d.key));
  const allowedSecrets = new Set((s.config.secrets ?? []).map((d) => d.key));

  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.settings ?? {})) {
    if (!allowedSettings.has(k)) continue;
    const value = v == null ? '' : String(v);
    if (s.egressSettings.includes(k)) checkEndpointValue(k, value.trim());
    patch[pluginSettingKey(s.pluginId, k)] = s.egressSettings.includes(k) ? value.trim() : value;
  }
  const endpointKeys = s.egressSettings.filter((k) => allowedSettings.has(k) && pluginSettingKey(s.pluginId, k) in patch);
  const current = endpointKeys.length ? await SettingService.getByKeys(tenantId, endpointKeys.map((k) => pluginSettingKey(s.pluginId, k))) : {};
  const endpointChanged = endpointKeys.some((k) => (current[pluginSettingKey(s.pluginId, k)] ?? '') !== patch[pluginSettingKey(s.pluginId, k)]);
  const secretsSet: string[] = [];
  for (const [k, v] of Object.entries(input.secrets ?? {})) {
    if (!allowedSecrets.has(k)) continue;
    if (typeof v !== 'string' || v.length === 0) continue; // blank keeps existing
    // encryptFieldOpt: encrypts when SETTINGS_ENCRYPTION_KEY is set, stores
    // plaintext in dev when it isn't — same policy as other sensitive settings.
    patch[pluginSecretKey(s.pluginId, k)] = encryptFieldOpt(v);
    secretsSet.push(k);
  }
  const secretsCleared: string[] = [];
  if (endpointChanged) {
    for (const k of allowedSecrets) {
      if (secretsSet.includes(k)) continue;
      patch[pluginSecretKey(s.pluginId, k)] = '';
      secretsCleared.push(k);
    }
  }

  const changed = Object.keys(patch).length > 0;
  if (changed) {
    await SettingService.updateMany(tenantId, patch, actorId ? { actorId } : undefined);
    await SettingService.clearCache(tenantId);
  }
  return {
    changed,
    settings: Object.keys(input.settings ?? {}).filter((k) => allowedSettings.has(k)),
    secretsSet,
    secretsCleared,
  };
}

/**
 * Per-tenant egress: some plugins call a tenant-configured endpoint whose host is not known when the plugin is
 * published (e-invoicing gateways, access points). The grant may name `httpAllowlistFromSettings: [<settingKey>…]`;
 * this reads those plugin settings for THIS tenant and returns each value's host. Egress stays SSRF-guarded (the http
 * capability re-checks the final host), so a plugin can only reach the tenant's own configured endpoint.
 */
export async function egressHostsFromSettings(tenantId: string, pluginId: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const vals = await SettingService.getByKeys(tenantId, keys.map((k) => pluginSettingKey(pluginId, k)));
  const hosts: string[] = [];
  for (const k of keys) {
    const v = vals[pluginSettingKey(pluginId, k)];
    if (!v) continue;
    try {
      const host = new URL(v).host;
      if (host && !hosts.includes(host)) hosts.push(host);
    } catch { /* not a URL → ignore */ }
  }
  return hosts;
}
