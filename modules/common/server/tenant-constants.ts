/**
 * Root tenant — the single tenant that owns platform-level configuration
 * (global users, plans, coupons, subscription plans, system audit logs,
 * platform SAML, super-admin settings).
 *
 * Replaces the previous "system scope" pseudo-tenant. Every request now
 * resolves to a real tenant row; the root tenant is just the one with
 * this fixed UUID.
 *
 * The UUID is a deterministic RFC 4122 v4 value (version nibble = 4,
 * variant nibble = 8) so it is a syntactically valid UUID v4 — every
 * `z.string().uuid()` validator accepts it without special-casing.
 *
 * Super-admin = a TenantMember of the root tenant with memberRole='ADMIN'.
 *
 * Lives in `common` (a dependency-free leaf) rather than `tenant/server` so the
 * ~100 modules that only need the root-tenant id do not each create an import
 * edge INTO the tenant package — the single biggest source of module cycles.
 */
export const ROOT_TENANT_ID = '00000000-0000-4000-8000-000000000000';

export const ROOT_TENANT_NAME = 'Platform';

export function isRootTenant(tenantId: string | null | undefined): boolean {
  return tenantId === ROOT_TENANT_ID;
}

/**
 * Fleet tenant (docs/phases/02-fleet): a real `tenants` row beside ROOT on every
 * node and on the control plane. Fleet audit events chain under it
 * (`tenantId = actorTenantId = FLEET_TENANT_ID`), separate from customer chains.
 * Same v4-shaped fixed UUID scheme as ROOT_TENANT_ID. Never a customer tenant.
 */
export const FLEET_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export const FLEET_TENANT_NAME = 'Fleet';

export function isFleetTenant(tenantId: string | null | undefined): boolean {
  return tenantId === FLEET_TENANT_ID;
}

/** True for either reserved platform tenant (root or fleet): excluded from counts, export, deletion. */
export function isReservedTenant(tenantId: string | null | undefined): boolean {
  return tenantId === ROOT_TENANT_ID || tenantId === FLEET_TENANT_ID;
}

/**
 * The platform tenant range (docs/phases/46-module-placement, D46-5): `00000000-0000-4000-8000-0000000000xx` is kept for platform tenants
 * (ROOT is `…00`, FLEET `…01`). Until 2026-10-27 the bootstrap seed put its demo customer at `…01`, so on every non-production database the
 * demo customer WAS the fleet tenant; no tenant other than ROOT and FLEET is created, seeded or moved into this range any more.
 */
const PLATFORM_TENANT_RANGE_RE = /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/i;

/** Whether `tenantId` lies in the platform tenant range (ROOT and FLEET included). */
export function isPlatformTenantRange(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && PLATFORM_TENANT_RANGE_RE.test(tenantId);
}

/** Whether a new tenant may NOT take `tenantId`: an id of the platform range other than ROOT and FLEET themselves. */
export function isRefusedTenantId(tenantId: string | null | undefined): boolean {
  return isPlatformTenantRange(tenantId) && !isReservedTenant(tenantId!.toLowerCase());
}

/**
 * Throws when a seed would fill a tenant at an id of the platform range other than ROOT (whose platform data the seed writes). The fleet tenant
 * is never a seed target: a seed run with the pre-2026-10-27 `SEED_TENANT_ID=…8000-000000000001` would fill the fleet tenant with demo customer
 * data, the very collision phase 46 removes.
 */
export function assertTenantIdAllowed(tenantId: string | null | undefined, what = 'a seed'): void {
  if (isPlatformTenantRange(tenantId) && !isRootTenant(tenantId!.toLowerCase())) {
    throw new Error(`${what} cannot use ${tenantId}: 00000000-0000-4000-8000-0000000000xx is reserved for platform tenants (root, fleet), and only root is seeded there`);
  }
}

/**
 * The bootstrap seed's demo customer (Acme Corp) on every non-production database, and the default tenant of the seed and demo tools.
 * Outside the platform range on purpose (variant nibble `a`): it used to be `…8000-000000000001`, which is FLEET_TENANT_ID. A database
 * seeded before 2026-10-27 moves it with `npm run tenant:rekey` (modules/db/README.md, "Moving a tenant to another id").
 */
export const SEED_TENANT_ID = '00000000-0000-4000-a000-000000000001';

export const SEED_TENANT_NAME = 'Acme Corp';

/**
 * Names a customer tenant may not hold as its slug or as a `<label>.<TENANT_WILDCARD_DOMAIN>` subdomain: the platform's
 * own surfaces (admin, auth, api, the root subdomain) and the labels people expect to be the operator's (mail, www,
 * status, ...). Under a wildcard certificate and wildcard DNS a tenant that held `admin.` or `auth.` would serve its own
 * pages on a host users trust to be the platform. The reserved platform tenants (root, fleet) are exempt: they are the
 * operator. Pure, so the tenant slug validation, the domain create/free-subdomain paths and the proxy share one list.
 */
const PLATFORM_LABELS: readonly string[] = [
  'admin', 'administrator', 'root', 'system', 'platform', 'fleet', 'internal', 'localhost',
  'www', 'www1', 'www2', 'api', 'auth', 'sso', 'oauth', 'login', 'signin', 'signup', 'app', 'apps',
  'account', 'accounts', 'billing', 'payments', 'dashboard', 'console', 'portal',
  'mail', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'ns', 'ns1', 'ns2', 'ftp', 'cdn', 'static', 'assets',
  'status', 'support', 'help', 'docs',
];

/**
 * Owner 2026-11-04: the common words of environments and infrastructure, so no customer holds a label that reads like one
 * of the operator's (dev., e2e., staging., grafana. ...). Judged on the tenant's own label (a slug, the leftmost label of a
 * subdomain) only: the operator groups tenant hosts under such a word itself (the demo's e2e tenants live at
 * `<slug>.dev.<wildcard>`), so a deeper label is the operator's zone, not a tenant's claim.
 */
const ENVIRONMENT_LABELS: readonly string[] = [
  'dev', 'devel', 'develop', 'development', 'test', 'tests', 'testing', 'e2e', 'qa', 'uat', 'sit', 'ci', 'cd', 'build',
  'stage', 'staging', 'stg', 'preprod', 'prod', 'production', 'preview', 'sandbox', 'demo', 'beta', 'alpha',
  'canary', 'local', 'debug', 'tmp', 'temp',
  'git', 'gitlab', 'github', 'jenkins', 'grafana', 'prometheus', 'metrics', 'monitor', 'monitoring', 'logs', 'kibana',
  'vault', 'minio', 's3', 'storage', 'files', 'upload', 'uploads', 'download', 'downloads', 'media', 'img', 'images',
  'registry', 'npm', 'packages', 'k8s', 'kube', 'cluster', 'node', 'nodes', 'edge', 'proxy', 'gateway', 'relay', 'vpn',
  'ws', 'wss', 'mqtt', 'coap', 'lns', 'iot', 'ota', 'firmware', 'turn', 'stun', 'sip', 'voip', 'pbx',
  'webmail', 'postmaster', 'hostmaster', 'webmaster', 'abuse', 'noreply', 'no-reply', 'security', 'cpanel', 'whm',
  // Business words (shop, store, blog, news ...) are a customer's to take: they do not read like the operator's machinery.
];

const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORM_LABELS);
export const RESERVED_SUBDOMAIN_LABELS: ReadonlySet<string> = new Set([...PLATFORM_LABELS, ...ENVIRONMENT_LABELS]);

/**
 * Environment words that stay reserved with a number after them (`dev1`, `dev-2`, `staging01`, `e2e-3`): the forms a
 * numbered environment takes. A word that merely starts with one (`devon`, `testa`) is not caught.
 */
const RESERVED_NUMBERED = /^(dev|test|e2e|qa|uat|stage|staging|stg|preprod|prod|preview|sandbox|demo|beta|alpha|canary|ci|node|edge|ns|mx|www|api|app)-?\d+$/;

/** Whether `label` may not be a TENANT'S OWN label (a slug, the leftmost label of a subdomain; any case): every reserved word. */
export function isReservedSubdomainLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const l = label.trim().toLowerCase();
  return RESERVED_SUBDOMAIN_LABELS.has(l) || RESERVED_NUMBERED.test(l);
}

/** Whether `label` is one of the platform's own surfaces (admin, auth, api, www ...): refused at ANY depth of a subdomain. */
export function isReservedPlatformLabel(label: string | null | undefined): boolean {
  return !!label && PLATFORM_SET.has(label.trim().toLowerCase());
}

/** A tenant's label (its slug, the free `<label>.<wildcard>` subdomain, a subdomain it adds): 5 to 63 characters. */
export const TENANT_LABEL_MIN = 5;
export const TENANT_LABEL_MAX = 63;
/** One DNS label in lower case: letters, digits and hyphens, no hyphen at either end, and so never a dot. */
export const TENANT_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type TenantLabelProblem = 'format' | 'too_short' | 'too_long' | 'reserved';

/**
 * Why `label` may not be a NEW tenant label, or null when it may (owner 2026-11-04: no dot, at least 5 characters, not a
 * reserved word). Judged when a slug is chosen or changed and when a subdomain is added; a tenant that already holds a
 * shorter label keeps it (serving judges only the reserved words).
 */
export function tenantLabelProblem(label: string): TenantLabelProblem | null {
  if (!TENANT_LABEL_PATTERN.test(label)) return 'format';
  // the reserved word first: "www is reserved" tells more than "www is too short"
  if (isReservedSubdomainLabel(label)) return 'reserved';
  if (label.length < TENANT_LABEL_MIN) return 'too_short';
  if (label.length > TENANT_LABEL_MAX) return 'too_long';
  return null;
}
