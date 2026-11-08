// Wire types + config shared by the three tiers. Two RPC hops:
//   web tier ──run──► plugin-host        (run a plugin handler)
//   plugin-host ──capability──► web tier broker  (do a scoped data/http/... op)
// Both hops are token-authenticated and meant for a private/loopback interface.
//
// Config is read straight from process.env (no env-schema coupling) so the
// plugin-host process stays self-contained and creds-less.

import type { Capability, Json } from '../../sdk/types';
import type { SandboxViolation } from './sandbox-violations';

export interface SandboxConfig {
  pluginVersionId: string;
  pluginId: string;
  capabilities: Capability[];
  httpAllowlist: string[];
  limits: { memoryMb: number; timeoutMs: number; httpTimeoutMs: number; httpMaxBytes: number };
  /**
   * The approved grant's `httpAllowlistFromSettings` keys. Their values widen the egress allowlist, so the plugin may
   * not write them itself (`settings.set` refuses them); only the tenant's config route, which checks the endpoint and
   * clears the secrets on a change, writes them.
   */
  protectedSettingKeys?: string[];
}

/** web → plugin-host: run a handler. `bundleCode` is sent only on a cache miss. */
export interface RunRequest {
  tenantId: string;
  /**
   * Phase 53.4: the tenant whose plugin secrets and plugin config (`plugin_secret:` / `plugin:` keys) the call reads, when it
   * is not `tenantId`: the root tenant's install serving a tenant at the `platform` setting level. Absent = `tenantId`.
   */
  configTenantId?: string;
  sandbox: SandboxConfig;
  kind: 'http' | 'event' | 'provider';
  /** http: route key "GET path"; event: event name; provider: "<point>#<op>". */
  target: string;
  /** http: serialized PluginRequest; event: serialized payload. */
  payloadJson: string;
  bundleCode?: string;
}

/** Phase 55 00 §0.3: the sandbox bounds a run hit (`sandbox-violations.ts`), named in the plugin-host's answer. */
export type { SandboxViolation } from './sandbox-violations';

export type RunResult =
  | { ok: true; resultJson: string; violations?: SandboxViolation[] }
  | { ok: false; needBundle: true }
  | { ok: false; error: string; busy?: true; violations?: SandboxViolation[] };

/** plugin-host → web broker: one capability call. */
export interface BrokerRequest {
  tenantId: string;
  /**
   * Phase 53.4: the tenant whose plugin secrets and plugin config (`plugin_secret:` / `plugin:` keys) the call reads, when it
   * is not `tenantId`: the root tenant's install serving a tenant at the `platform` setting level. Absent = `tenantId`.
   */
  configTenantId?: string;
  pluginId: string;
  capabilities: Capability[];
  httpAllowlist: string[];
  limits: { httpTimeoutMs: number; httpMaxBytes: number };
  /** See SandboxConfig.protectedSettingKeys. */
  protectedSettingKeys?: string[];
  capability: string;
  method: string;
  args: Json[];
}

export type BrokerResult = { value: Json } | { error: string };

export interface RuntimeConfig {
  hostPort: number;
  hostUrl: string;
  hostToken: string;
  brokerUrl: string;
  brokerToken: string;
  /** Plugin-host: how long a call waits for a free sandbox before a 503. */
  borrowTimeoutMs: number;
  /**
   * Web tier: how long one /run request may take before it is aborted. 0 (the
   * default) derives it per call from the sandbox limits; see host-client.
   */
  hostRequestTimeoutMs: number;
  defaultLimits: SandboxConfig['limits'];
}

export function loadRuntimeConfig(): RuntimeConfig {
  const e = process.env;
  return {
    hostPort: Number(e.PLUGIN_HOST_PORT ?? 4500),
    hostUrl: e.PLUGIN_HOST_URL ?? 'http://127.0.0.1:4500',
    // No default token (common.06 / common.34): an unset token is '' and `tokensMatch` never accepts '' - an unconfigured
    // hop refuses everyone instead of accepting a public literal. Set both tokens in every deployment, dev included.
    hostToken: e.PLUGIN_HOST_TOKEN ?? '',
    brokerUrl: e.PLUGIN_BROKER_URL ?? 'http://127.0.0.1:3000/internal/api/plugin-broker',
    brokerToken: e.PLUGIN_BROKER_TOKEN ?? '',
    borrowTimeoutMs: Number(e.PLUGIN_BORROW_TIMEOUT_MS ?? 10_000),
    hostRequestTimeoutMs: Number(e.PLUGIN_HOST_REQUEST_TIMEOUT_MS ?? 0),
    defaultLimits: {
      memoryMb: Number(e.PLUGIN_MEMORY_MB ?? 128),
      timeoutMs: Number(e.PLUGIN_TIMEOUT_MS ?? 5000),
      httpTimeoutMs: Number(e.PLUGIN_HTTP_TIMEOUT_MS ?? 5000),
      httpMaxBytes: Number(e.PLUGIN_HTTP_MAX_BYTES ?? 2_000_000),
    },
  };
}

/** Constant-time-ish token compare (avoids trivially short-circuiting on length). An empty expected token matches nothing. */
export function tokensMatch(a: string | null | undefined, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
