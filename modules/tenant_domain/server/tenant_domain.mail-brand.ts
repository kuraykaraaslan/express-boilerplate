import { tenantOrigin } from './tenant_domain.url';

/**
 * `notification_mail:brand_source` contribution — the tenant's own origin.
 *
 * `tenantOrigin` returns the domain links should use: the primary domain while it serves (a custom domain only while
 * the plan includes it), otherwise the free `<slug>.<wildcard>` subdomain; `null` in path mode or with no wildcard
 * domain and no serving custom domain. Mailing a link to a host that does not resolve is strictly worse than the
 * platform-host link, and `null` is also what makes `notification_mail` add the sentence saying who really sent a
 * security mail.
 */
const source = {
  async load(tenantId: string) {
    return { baseUrl: await tenantOrigin(tenantId) };
  },
};

export default source;
