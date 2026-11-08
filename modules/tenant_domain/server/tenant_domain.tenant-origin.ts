import type { TenantOriginSource } from '@kuraykaraaslan-labs/common/server/tenant-url';
import { tenantOrigin } from './tenant_domain.url';

/**
 * `common:tenant_origin` contribution: the origin links to this tenant should use (common/server/tenant-url), the same
 * answer as the `notification_mail:brand_source` contribution's `baseUrl`. Its primary domain while that serves (a
 * custom domain only while the plan includes custom domains), otherwise its free `<slug>.<wildcard>` subdomain; `null`
 * in path mode or when the platform has no wildcard domain and no custom domain serves, and common then links on the
 * platform host. The point is platform-gated (2026-10-17): the free subdomain is the platform's routing of the tenant,
 * so this answers for every tenant, whatever it switched on.
 */
const source: TenantOriginSource = {
  origin: (tenantId) => tenantOrigin(tenantId),
};

export default source;
