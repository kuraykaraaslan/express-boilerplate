// Shared broker context + helpers used by every capability. Kept tiny and
// dependency-light so capability files import only what they need.

import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import type { Capability } from '../../sdk/types';

/** Per-call scope, bound host-side and re-validated by the broker. */
export interface BrokerCtx {
  tenantId: string;
  /**
   * Phase 53.4: the tenant whose plugin secrets and plugin config (`plugin_secret:` / `plugin:` keys) the call reads, when it
   * is not `tenantId`: the root tenant's install serving a tenant at the `platform` setting level. Absent = `tenantId`.
   */
  configTenantId?: string;
  pluginId: string;
  capabilities: Capability[];
  /** Approved outbound hosts (from the reviewed manifest), bound host-side. */
  httpAllowlist: string[];
  limits: { httpTimeoutMs: number; httpMaxBytes: number };
  /**
   * The approved grant's `httpAllowlistFromSettings` keys: their values widen the egress allowlist, so `settings.set`
   * refuses them (a plugin pointing its own endpoint at another host would carry `{{secret:…}}` there).
   */
  protectedSettingKeys?: string[];
}

const pctEncode = (c: string): string => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * The plugin id as it appears inside a namespaced name (common.11). The separator of that name and the escape itself are
 * percent-encoded, so plugin "a:b" with key "c" and plugin "a" with key "b:c" never meet in a setting key (`separator` ':'),
 * and plugin "a.b" event "c" and plugin "a" event "b.c" never meet in an audit action (`separator` '.'). An id without the
 * separator or `%` is unchanged, so no stored setting of an existing plugin moves (`@vendor/product` and `com.acme.x` keep
 * their keys).
 */
export const pluginNamespace = (pluginId: string, separator: ':' | '.' = ':'): string =>
  String(pluginId).replace(separator === ':' ? /[%:]/g : /[%.]/g, pctEncode);

/** Plugin-namespaced setting key (non-secret). */
export const SETTING_PREFIX = (pluginId: string): string => `plugin:${pluginNamespace(pluginId)}:`;
/** Plugin-namespaced encrypted-secret key. */
export const SECRET_PREFIX = (pluginId: string): string => `plugin_secret:${pluginNamespace(pluginId)}:`;

/** The tenant whose plugin secrets and plugin config this call reads (phase 53.4); its data and usage stay `ctx.tenantId`'s. */
export const configTenantOf = (ctx: BrokerCtx): string => ctx.configTenantId ?? ctx.tenantId;

export function requireCap(ctx: BrokerCtx, cap: Capability): void {
  if (!ctx.capabilities.includes(cap)) throw new Error(`capability not granted: ${cap}`);
}

// Signed egress: a plugin may put `{{secret:NAME}}` in an http header/body; the
// broker substitutes the plugin's decrypted secret HOST-SIDE so the isolate never
// sees raw credentials. Combined with the http allowlist, the secret can only ever
// reach the approved provider host.
//
// A bare `{{secret:NAME}}` is substituted raw. The isolate cannot encode a value it
// never sees, so a secret with `&`, `+`, `<` or `"` in it would break (or rewrite) the
// request it is placed in; `{{secret:NAME|MOD}}` asks the broker to encode it for its
// context (ENCODERS below). An unknown modifier is refused, never sent raw.
const SECRET_PLACEHOLDER = /\{\{secret:([A-Za-z0-9_]+)(?:\|([^{}|]*))?\}\}/g;

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export const SECRET_ENCODERS: Record<string, (v: string) => string> = {
  // application/x-www-form-urlencoded component (space is '+', as URLSearchParams writes it).
  form: (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+'),
  // A URL path segment or query value.
  url: (v) => encodeURIComponent(v),
  // XML text or attribute content.
  xml: (v) => v.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!),
  // The inside of a JSON string literal (the placeholder sits between the quotes).
  json: (v) => JSON.stringify(v).slice(1, -1),
};

export async function resolveSecret(ctx: BrokerCtx, name: string): Promise<string> {
  const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + name);
  const dec = decryptFieldOpt(raw);
  return typeof dec === 'string' ? dec : '';
}

export async function substituteSecrets(ctx: BrokerCtx, value: string): Promise<string> {
  const matches = [...value.matchAll(SECRET_PLACEHOLDER)];
  if (matches.length === 0) return value;
  // Refuse an unknown modifier before any secret is read. The message is fixed (the modifier is not quoted).
  for (const m of matches) {
    if (m[2] !== undefined && !Object.prototype.hasOwnProperty.call(SECRET_ENCODERS, m[2])) {
      throw new Error('secret placeholder: unknown encoding');
    }
  }
  const map = new Map<string, string>();
  for (const n of new Set(matches.map((m) => m[1]!))) map.set(n, await resolveSecret(ctx, n));
  return value.replace(SECRET_PLACEHOLDER, (_, n: string, mod?: string) => {
    const v = map.get(n) ?? '';
    return mod === undefined ? v : SECRET_ENCODERS[mod]!(v);
  });
}
