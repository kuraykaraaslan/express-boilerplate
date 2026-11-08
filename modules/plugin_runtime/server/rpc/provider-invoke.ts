// The `invoke` an `external:contributions` source hands a host for a sandboxed
// provider: forward `<point>#<op>` into the plugin's isolate and parse the JSON
// result. Core since OD-139 so every bundle source (the marketplace, the operator's
// local store plugin_local) maps failures the same way.

import { ProviderUnavailableError } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { PluginVersionQuarantinedError } from '@kuraykaraaslan-labs/common/server/extensions/plugin-version-breaker';
import { runOnHost } from './host-client';
import type { SandboxConfig } from './protocol';

export interface SandboxedProvider {
  point: string;
  key: string;
  sandbox: SandboxConfig;
  getBundle: () => Promise<string>;
}

/**
 * `tenantId` is the tenant the call runs for (its data, its usage); `opts.configTenantId` the tenant whose plugin secrets and
 * config it reads, when that is another one (phase 53.4: the root tenant's install at the `platform` setting level).
 *
 * A version paused by its breaker (EXT-7) reaches the host as a provider in state `quarantined` — the same
 * ProviderUnavailableError (409) an in-tree provider that is not available gives, so hosts that already handle that
 * one need nothing new. Any other failure reaches the host as it was.
 */
export function makeProviderInvoke(tenantId: string, c: SandboxedProvider, opts: { configTenantId?: string } = {}) {
  return async (op: string, input: unknown): Promise<unknown> => {
    let resultJson: string;
    try {
      resultJson = await runOnHost({
        tenantId,
        // Phase 53.4: the root tenant's install serving `tenantId` reads the root tenant's secrets and plugin config.
        ...(opts.configTenantId ? { configTenantId: opts.configTenantId } : {}),
        sandbox: c.sandbox,
        kind: 'provider',
        target: `${c.point}#${op}`,
        payloadJson: JSON.stringify(input ?? {}),
        getBundle: c.getBundle,
      });
    } catch (error) {
      if (error instanceof PluginVersionQuarantinedError) throw new ProviderUnavailableError(c.point, c.key, 'quarantined', error.message);
      throw error;
    }
    return JSON.parse(resultJson);
  };
}
