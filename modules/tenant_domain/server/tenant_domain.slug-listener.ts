import type { TenantSlugChangeListener } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { ensureFreeSubdomain } from './tenant_domain.free-subdomain';

/**
 * `tenant:slug_changed` contribution: the free subdomain is named after the slug, so a rename renames it
 * (`<previous>.<wildcard>` becomes `<slug>.<wildcard>`, same row, same primary flag), and the tenant keeps exactly one.
 * A failure is logged by `tenant` and the reconcile sweep renames it later (it renames a tenant's only wildcard
 * subdomain when that is not named after the current slug).
 */
const listener: TenantSlugChangeListener = {
  async slugChanged({ tenantId, previousSlug }) {
    await ensureFreeSubdomain(tenantId, { previousSlug });
  },
};

export default listener;
