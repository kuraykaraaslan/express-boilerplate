// Default-exported source for the `external:contributions` extension point (common/server/external-extensions):
// the Core counterpart of marketplace/server/community-extensions.source.ts. The bridge only asks this source while
// plugin_local is enabled for the tenant, and only for points that declare `external: true` (EXT-8); per contribution
// it hands back the manifest metadata, whether the declared secrets are set, and an `invoke` that runs the op in the
// isolate with the APPROVED grant (EXT-7 quarantine mapped like the marketplace's).

import type { ExternalContribution, ExternalContributionSource } from '@kuraykaraaslan-labs/common/server/external-extensions';
import { makeProviderInvoke } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/provider-invoke';
import { pluginSecretsConfigured } from '@kuraykaraaslan-labs/plugin_runtime/server/config/plugin-config.service';
import { listInstalledLocalProviders } from './plugin_local.resolve';

// Phase 53.4: with `servedTenantId` these are the root tenant's installs serving another tenant (its setting level is
// `platform`): listed and checked for credentials as the root tenant's, run in the served tenant's scope.
const source: ExternalContributionSource = async (tenantId, point, opts) => {
  const contribs = await listInstalledLocalProviders(tenantId, point);
  return Promise.all(
    contribs.map(async (c): Promise<ExternalContribution> => ({
      key: c.key,
      metadata: { ...c.metadata, label: typeof c.metadata.label === 'string' ? c.metadata.label : c.key, source: 'local' },
      configured: await pluginSecretsConfigured(tenantId, c.sandbox.pluginId, c.secrets.map((s) => s.key)),
      invoke: opts?.servedTenantId
        ? makeProviderInvoke(opts.servedTenantId, c, { configTenantId: tenantId })
        : makeProviderInvoke(tenantId, c),
      version: c.sandbox.pluginVersionId,
    })),
  );
};

export default source;
