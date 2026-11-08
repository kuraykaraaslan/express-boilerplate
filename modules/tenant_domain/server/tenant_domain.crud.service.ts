import 'reflect-metadata';
import { Not, Like, IsNull, And } from 'typeorm';
import { env } from '@kuraykaraaslan-labs/env';
import { withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { TenantDomain as TenantDomainEntity } from './entities/tenant_domain.entity';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { SafeTenantDomain, SafeTenantDomainSchema } from './tenant_domain.types';
import { CreateTenantDomainInput, UpdateTenantDomainInput, GetTenantDomainsInput, normalizeDomainName, DOMAIN_SORTABLE } from './tenant_domain.dto';
import { compactWhere, inList, searchWhere, toOrder, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query';
import TenantDomainMessages from './tenant_domain.messages';
import { isReservedDomain } from './tenant_domain.blocklist';
import { resolveDomainEntitlement } from './tenant_domain.entitlement';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { DomainStatus } from './tenant_domain.enums';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { isProtectedSubdomain, isWildcardSubdomain, freeSubdomainNames, hostWithoutPort, currentBaseDomains } from './tenant_domain.wildcard';
import { baseDomainList, asBaseRefs, defaultBaseDomainOf, managedBases, type BaseDomainEntry } from './tenant_domain.base-domains';
import { tenantSlugIn } from './tenant_domain.free-subdomain';
import { isReservedWildcardName, isUnderWildcardOnlyBase, tenantBaseOf, type BaseDomains } from './tenant_domain.serving';
import { isReservedTenant, tenantLabelProblem } from '@kuraykaraaslan-labs/common/server/tenant-constants';

const DOMAIN_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);

// Unknown hosts are remembered briefly under the same key, so a stream of
// requests for a junk Host header costs one system-RLS lookup per minute, not
// one per request. create()/update()/delete() clear the key (clearCache), so a
// newly added domain is not hidden behind this.
const DOMAIN_MISS_SENTINEL = '__none__';
const DOMAIN_MISS_TTL = 60;

// Only a syntactically valid DNS name can be a tenant domain. Anything else (IP
// literals, IPv6 brackets, ports, spaces, over-long names) is answered "unknown"
// without a database read AND without a cache entry, so junk hosts cannot fill
// Redis with negative entries either. Case is left alone: stored domains are not
// normalised, and browsers already send lower-case hosts.
// Underscores are allowed: not hostname-legal, but valid DNS and accepted by browsers.
const DNS_LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/i;
export function isLookupableHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  const labels = host.split('.');
  if (!labels.every((l) => DNS_LABEL.test(l))) return false;
  // No TLD is all digits, so this rejects IPv4 literals (and 0x7f.0.0.1-style forms).
  return !/^\d+$/.test(labels[labels.length - 1]!);
}

/**
 * Whether a domain serves, and so may be (or stay) primary: a platform wildcard subdomain that is ACTIVE, or a custom
 * domain that proved DNS ownership (`verifiedAt`) and is VERIFIED or ACTIVE. SUSPENDED never serves.
 */
export function domainServes(d: { domain: string; domainStatus: string; verifiedAt?: Date | null }, bases: BaseDomains = currentBaseDomains()): boolean {
  if (isWildcardSubdomain(d.domain, bases)) return d.domainStatus === 'ACTIVE';
  return !!d.verifiedAt && (d.domainStatus === 'VERIFIED' || d.domainStatus === 'ACTIVE');
}

/**
 * Whether the host lookup (`getByDomain`, which the proxy turns into the tenant of the whole request) may answer with this row
 * (tenant_domain.01). A CUSTOM domain must have proven DNS ownership (`domainServes`): a PENDING, DNS_FAILED, INACTIVE or
 * SUSPENDED one used to be routed to whoever registered it. A platform wildcard subdomain needs no proof and serves unless it is
 * SUSPENDED, as before (the proxy and TLS ask apply `isServingDomain` on top).
 */
function lookupServes(d: { domain: string; domainStatus: string; verifiedAt?: Date | string | null }, bases: BaseDomains): boolean {
  if (d.domainStatus === 'SUSPENDED') return false;
  if (isWildcardSubdomain(d.domain, bases)) return true;
  return domainServes({ ...d, verifiedAt: d.verifiedAt ? new Date(d.verifiedAt) : null }, bases);
}

/** Serialises a tenant's domain-set writes: limit counts, the single primary flag. */
const domainSetLock = (tenantId: string) => `tenant_domain:set:${tenantId}`;

/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

export default class TenantDomainCrudService {

  static async clearCache(tenantDomain: SafeTenantDomain | string): Promise<void> {
    if (typeof tenantDomain === 'string') {
      await redis.del(`tenant:domain:id:${tenantDomain}`);
      return;
    }
    await Promise.all([
      redis.del(`tenant:domain:name:${tenantDomain.domain}`),
      redis.del(`tenant:domain:id:${tenantDomain.tenantDomainId}`),
      redis.del(`tenant:domain:primary:${tenantDomain.tenantId}`),
      redis.del(`tenant:domain:free:${tenantDomain.tenantId}`),
      // notification_mail's cached brand carries this tenant's verified origin
      // (key owned by notification_mail.brand.service; not imported — see there).
      redis.del(`notification_mail:brand:${tenantDomain.tenantId}`),
    ]);
  }

  static async getByTenantId({ tenantId, page, pageSize, domainStatus, sslStatus, isPrimary, search, sort }: GetTenantDomainsInput): Promise<{ domains: SafeTenantDomain[]; total: number }> {
    // phase 43 list contract: states, the primary flag, a search over the host name, a whitelisted sort
    const where = compactWhere({
      tenantId,
      domainStatus: inList(domainStatus),
      sslStatus: inList(sslStatus),
      isPrimary,
    });
    const [domains, total] = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findAndCount({
        where: searchWhere(where, search, ['domain']) as never,
        skip: Math.max(0, (page - 1) * pageSize), take: pageSize,
        order: toOrder((sort as ListSort | undefined) ?? [{ field: 'isPrimary', dir: 'desc' }, { field: 'createdAt', dir: 'desc' }], DOMAIN_SORTABLE, { tenantDomainId: 'ASC' }, TenantDomainEntity) as never,
      }));
    return { domains: domains.map((d) => SafeTenantDomainSchema.parse(d)), total };
  }

  static async getById(tenantDomainId: string, tenantId: string): Promise<SafeTenantDomain> {
    const cacheKey = `tenant:domain:id:${tenantDomainId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = SafeTenantDomainSchema.parse(JSON.parse(cached));
        if (parsed.tenantId !== tenantId) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
        return parsed;
      } catch (e) {
        if (e instanceof AppError) throw e;
        await redis.del(cacheKey);
      }
    }
    const domain = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findOne({ where: { tenantDomainId, tenantId } }));
    if (!domain) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    const parsed = SafeTenantDomainSchema.parse(domain);
    await redis.setex(cacheKey, DOMAIN_CACHE_TTL, JSON.stringify(parsed));
    return parsed;
  }

  static async getByDomain(domain: string): Promise<SafeTenantDomain | null> {
    // The same normalisation the proxy applies to the Host header (tenant_domain.11): no port, lower case.
    domain = hostWithoutPort(domain);
    if (!isLookupableHost(domain)) return null;
    const cacheKey = `tenant:domain:name:${domain}`;
    const cached = await redis.get(cacheKey);
    if (cached === DOMAIN_MISS_SENTINEL) return null;
    if (cached) {
      try {
        const parsed = SafeTenantDomainSchema.parse(JSON.parse(cached));
        return lookupServes(parsed, await managedBases()) ? parsed : null;
      }
      catch { await redis.del(cacheKey); }
    }
    // Host → tenant: the tenant is what we are looking up, so a deliberate cross-tenant read.
    // tenant_domain.02: one name may have several unproven claims (one per tenant); the row that serves is the proven one,
    // or the only row there is (a platform subdomain has no DNS proof).
    // (An unproven custom-domain row never serves anyway, tenant_domain.01.)
    const found = await withSystemRLS(async (qr) => {
      const repo = qr.manager.getRepository(TenantDomainEntity);
      return (await repo.findOne({ where: { domain, verifiedAt: Not(IsNull()) } })) ?? repo.findOne({ where: { domain } });
    });
    // A SUSPENDED domain (the plan no longer includes it), and a custom domain that has not proven ownership (tenant_domain.01),
    // does not serve: the proxy treats it as an unknown host. It is remembered as a miss; the verification and the reconcile that
    // make it serve clear this key (clearCache).
    if (!found || !lookupServes(found, await managedBases())) {
      Logger.debug(`TenantDomainCrudService.getByDomain: Domain not found: ${domain}`);
      await redis.setex(cacheKey, DOMAIN_MISS_TTL, DOMAIN_MISS_SENTINEL).catch(() => {});
      return null;
    }
    Logger.debug(`TenantDomainCrudService.getByDomain: Found domain: ${domain} → tenantId: ${found.tenantId}`);
    const parsed = SafeTenantDomainSchema.parse(found);
    await redis.setex(cacheKey, DOMAIN_CACHE_TTL, JSON.stringify(parsed));
    return parsed;
  }

  static async getPrimaryByTenantId(tenantId: string): Promise<SafeTenantDomain | null> {
    const cacheKey = `tenant:domain:primary:${tenantId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try { return SafeTenantDomainSchema.parse(JSON.parse(cached)); }
      catch { await redis.del(cacheKey); }
    }
    const domain = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findOne({ where: { tenantId, isPrimary: true } }));
    if (!domain) return null;
    const parsed = SafeTenantDomainSchema.parse(domain);
    await redis.setex(cacheKey, DOMAIN_CACHE_TTL, JSON.stringify(parsed));
    return parsed;
  }

  /**
   * The tenant's free subdomain: an ACTIVE subdomain of a managed tenants' base domain (phase 56: any of them), the one named after the
   * slug when there are several, else the oldest. Null without a base domain or when the tenant has none yet (the reconcile mints it).
   * Cached like the primary; every domain write of the tenant clears it.
   */
  static async getFreeSubdomainByTenantId(tenantId: string): Promise<SafeTenantDomain | null> {
    const bases = await managedBases();
    const tenantBases = bases.filter((b) => b.purpose === 'tenants');
    if (!tenantBases.length) return null;
    const cacheKey = `tenant:domain:free:${tenantId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try { return SafeTenantDomainSchema.parse(JSON.parse(cached)); }
      catch { await redis.del(cacheKey); }
    }
    const rows = (await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.find({ where: tenantBases.map((b) => ({ tenantId, domainStatus: 'ACTIVE', domain: Like(`%.${b.name}`) })), order: { createdAt: 'ASC' } })))
      // `%.roltek.xyz` also matches a name under the `lns.roltek.xyz` service base: the serving rule has the last word.
      .filter((d) => isWildcardSubdomain(d.domain, bases));
    let found = rows[0] ?? null;
    if (rows.length > 1) {
      const tenant = await withTenantRepositoryFor(tenantId, Tenant, (repo) => repo.findOne({ where: { tenantId } })).catch(() => null);
      const named = freeSubdomainNames(tenant?.slug, bases);
      found = rows.find((d) => named.includes(d.domain)) ?? found;
    }
    if (!found) return null;
    const parsed = SafeTenantDomainSchema.parse(found);
    await redis.setex(cacheKey, DOMAIN_CACHE_TTL, JSON.stringify(parsed));
    return parsed;
  }

  /**
   * What the domains page shows above the list: the free subdomain the tenant always keeps, and whether (and how many)
   * custom domains its plan includes, so the page can explain a refusal before the tenant runs into it. The entitlement
   * read fails open here, like the create path it describes.
   */
  static async getOverview(tenantId: string): Promise<{
    freeSubdomain: string | null;
    wildcardDomain: string | null;
    customDomains: { allowed: boolean; maxDomains: number | null };
  }> {
    const [free, entitlement] = await Promise.all([
      TenantDomainCrudService.getFreeSubdomainByTenantId(tenantId).catch(() => null),
      resolveDomainEntitlement(tenantId, { audit: false }),
    ]);
    // `wildcardDomain` is the base the tenant's own subdomains go under: its free subdomain's base, else the installation's default.
    const list = await baseDomainList();
    const base = (free ? tenantBaseOf(free.domain, asBaseRefs(list)) : null) ?? defaultBaseDomainOf(list);
    return { freeSubdomain: free?.domain ?? null, wildcardDomain: base, customDomains: entitlement };
  }

  static async create(input: CreateTenantDomainInput): Promise<SafeTenantDomain> {
    // One spelling per host: DNS names are case-insensitive and `acme.io.` is `acme.io` (the unique index is exact).
    const data = { ...input, domain: normalizeDomainName(input.domain) };
    // phase 56: a name under any managed base domain is a platform subdomain (the longest base decides), never a custom domain.
    // Without any base domain (no TENANT_WILDCARD_DOMAIN, no row) create keeps its fallback from before this phase: `example.com`.
    const listed = await baseDomainList();
    const baseList: BaseDomainEntry[] = listed.length ? listed
      : [{ baseDomainId: null, baseDomain: 'example.com', purpose: 'tenants', isDefault: true, selectable: true, status: 'ACTIVE', challengeMode: 'delegated' }];
    const bases = asBaseRefs(baseList);
    // A name under a `wildcard_only` base (the LoRaWAN server's `lns.` tree) is the platform's own service: never a tenant's.
    if (isUnderWildcardOnlyBase(data.domain, bases)) {
      throw new AppError(TenantDomainMessages.DOMAIN_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
    }
    const subdomainBase = tenantBaseOf(data.domain, bases);
    const isSubdomain = subdomainBase !== null;
    // A base domain that has not proven its DNS (PENDING_DNS) or was switched off holds no new names; the platform tenants are exempt.
    if (isSubdomain && !isReservedTenant(data.tenantId) && baseList.find((b) => b.baseDomain === subdomainBase)?.status !== 'ACTIVE') {
      throw new AppError(TenantDomainMessages.DOMAIN_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
    }
    // Reserved/blocklist check — but never block a legitimate self-service
    // subdomain of the platform wildcard.
    if (!isSubdomain && (await isReservedDomain(data.domain))) {
      throw new AppError(TenantDomainMessages.DOMAIN_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
    }
    // A reserved name (admin., www., api., auth., app. ...) is never a customer's subdomain: under the wildcard
    // certificate it would serve a tenant's pages on a host users trust to be the platform. The reserved platform
    // tenants (root, fleet) are exempt.
    if (isSubdomain && isReservedWildcardName(data.domain, bases, data.tenantId)) {
      throw new AppError(TenantDomainMessages.DOMAIN_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
    }
    // A subdomain of the wildcard is ONE label of 5 to 63 characters (owner 2026-11-04): no dot (`a.b.<wildcard>` is not
    // under the wildcard certificate and reads like the operator's tree), nothing shorter. The platform tenants are exempt.
    if (isSubdomain && !isReservedTenant(data.tenantId) && tenantLabelProblem(data.domain.slice(0, -(`.${subdomainBase}`.length)))) {
      throw new AppError(TenantDomainMessages.SUBDOMAIN_LABEL_INVALID, 422, ErrorCode.VALIDATION_ERROR);
    }
    // Plan entitlement, resolved BEFORE the transaction: a refusal is about the
    // tenant's subscription, not about the row, and holding a DB transaction
    // open across a feature-gate read would be a lock for no reason.
    // Subdomains of the platform wildcard are the free self-service path and are
    // never gated — see `tenant_domain.entitlement`.
    const entitlement = isSubdomain
      ? { allowed: true, maxDomains: null as number | null }
      : await resolveDomainEntitlement(data.tenantId);
    if (!entitlement.allowed) {
      throw new AppError(TenantDomainMessages.CUSTOM_DOMAIN_NOT_IN_PLAN, 403, ErrorCode.FEATURE_NOT_AVAILABLE);
    }

    // Settings are another module's reads — resolved before the transaction.
    const [maxDomainsSetting, maxSubdomainsSetting] = await Promise.all([
      SettingService.getByKey(data.tenantId, 'maxDomains'),
      SettingService.getByKey(data.tenantId, 'maxSubdomains'),
    ]);
    // The PLAN wins when it says anything: the setting is editable by the
    // tenant admin, so letting it override a paid ceiling would make the
    // ceiling advisory. With no plan (self-hosted, free mode, root) the
    // setting is the only answer there is.
    // tenant_domain.07: a setting that is not a non-negative integer falls back to the default (NaN never
    // compares, so `count >= NaN` used to switch the ceiling off).
    const ceiling = (raw: string | null | undefined, fallback: number): number => {
      const n = /^\s*\d+\s*$/.test(raw ?? '') ? Number.parseInt(String(raw), 10) : NaN;
      return Number.isSafeInteger(n) ? n : fallback;
    };
    const maxDomains = entitlement.maxDomains ?? ceiling(maxDomainsSetting?.value, 3);
    const maxSubdomains = ceiling(maxSubdomainsSetting?.value, 1);

    // tenant_domain.02: the name is held globally only by a PROVEN row (any tenant), or, for a platform subdomain (no DNS
    // proof exists for it), by any row. An unverified claim of another tenant no longer blocks the real owner: both may be
    // PENDING, and the first to prove DNS takes the name (the partial unique index refuses the second proof).
    const holder = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainEntity).findOne({
      where: isSubdomain ? { domain: data.domain } : { domain: data.domain, verifiedAt: Not(IsNull()) },
    }));
    if (holder && holder.tenantId !== data.tenantId) throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);

    let saved: TenantDomainEntity;
    try {
      // Count and insert under the tenant's domain-set lock: two concurrent
      // creates at `limit - 1` would otherwise both pass the ceiling (and two
      // `isPrimary` creates would both end up primary).
      saved = await withTenantTransactionFor(data.tenantId, async (qr) => {
        await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [domainSetLock(data.tenantId)]);
        const repo = qr.manager.getRepository(TenantDomainEntity);
        const existing = await repo.findOne({ where: { tenantId: data.tenantId, domain: data.domain } });
        if (existing) throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
        // Platform subdomains under ANY managed tenants' base domain count against `maxSubdomains`, everything else against `maxDomains`.
        const names = bases.filter((b) => b.purpose === 'tenants').map((b) => b.name);
        if (isSubdomain) {
          const underAny = names.length === 1
            ? { tenantId: data.tenantId, domain: Like(`%.${names[0]}`) }
            : names.map((n) => ({ tenantId: data.tenantId, domain: Like(`%.${n}`) }));
          const subdomainCount = await repo.count({ where: underAny });
          if (subdomainCount >= maxSubdomains) throw new AppError(TenantDomainMessages.SUBDOMAIN_LIMIT_EXCEEDED, 409, ErrorCode.QUOTA_EXCEEDED);
        } else {
          const outsideAll = names.length === 0 ? { tenantId: data.tenantId }
            : { tenantId: data.tenantId, domain: names.length === 1 ? Not(Like(`%.${names[0]}`)) : And(...names.map((n) => Not(Like(`%.${n}`)))) };
          const domainCount = await repo.count({ where: outsideAll });
          if (domainCount >= maxDomains) throw new AppError(TenantDomainMessages.DOMAIN_LIMIT_EXCEEDED, 409, ErrorCode.QUOTA_EXCEEDED);
        }
        // A new domain is PENDING and serves nothing yet: it never demotes a working primary. It becomes the primary at
        // once only when the tenant has none; otherwise it is promoted later through update(), which requires it to serve.
        const isPrimary = data.isPrimary
          ? !(await repo.findOne({ where: { tenantId: data.tenantId, isPrimary: true } }))
          : false;
        return repo.save(repo.create({ ...data, isPrimary, domainStatus: 'PENDING' }));
      });
    } catch (err) {
      // The domain is unique across ALL tenants; another tenant's row is not
      // visible from this tenant's block, so the index is what settles it.
      if (isUniqueViolation(err)) throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
      throw err;
    }
    const parsed = SafeTenantDomainSchema.parse(saved);
    await TenantDomainCrudService.clearCache(parsed);
    // phase 51: a platform subdomain is servable from the moment it exists; a custom domain is not until DNS is proven (no-op then).
    void import('./tenant_domain.certificates.hooks').then((m) => m.requestCertificate({ ...parsed, tenantId: parsed.tenantId, tenantDomainId: parsed.tenantDomainId })).catch(() => undefined);
    return parsed;
  }

  static async update(tenantDomainId: string, tenantId: string, data: UpdateTenantDomainInput): Promise<SafeTenantDomain> {
    const { domain, updated } = await withTenantTransactionFor(tenantId, async (qr) => {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [domainSetLock(tenantId)]);
      const repo = qr.manager.getRepository(TenantDomainEntity);
      const domain = await repo.findOne({ where: { tenantDomainId, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!domain) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      // VERIFIED / ACTIVE are claims about DNS ownership: only a domain whose
      // DNS verification succeeded (`verifiedAt`) may be moved into them —
      // otherwise a status write would be a way around the proof.
      const bases = await managedBases();
      const isWildcard = isWildcardSubdomain(domain.domain, bases);
      if ((data.domainStatus === 'VERIFIED' || data.domainStatus === 'ACTIVE') && !domain.verifiedAt) {
        throw new AppError(TenantDomainMessages.DOMAIN_NOT_VERIFIED, 409, ErrorCode.CONFLICT);
      }
      // SUSPENDED is the plan's verdict (tenant_domain.reconcile): no status write puts a domain into it or takes it out.
      if ((data.domainStatus as string | undefined) === 'SUSPENDED'
        || (domain.domainStatus === 'SUSPENDED' && (data.domainStatus !== undefined || data.isPrimary))) {
        throw new AppError(TenantDomainMessages.DOMAIN_SUSPENDED, 409, ErrorCode.CONFLICT);
      }
      // The free subdomain stays ACTIVE: switching it off would leave the tenant without the address it always keeps.
      if (isWildcard && data.domainStatus !== undefined && data.domainStatus !== 'ACTIVE') {
        const [rows, slug] = await Promise.all([repo.find({ where: { tenantId } }), tenantSlugIn(qr, tenantId)]);
        if (isProtectedSubdomain(domain, rows, slug, bases)) {
          throw new AppError(TenantDomainMessages.FREE_SUBDOMAIN_PERMANENT, 409, ErrorCode.CONFLICT);
        }
      }
      // A tenant always has a primary that serves: it changes by promoting another domain, never by clearing the flag,
      // and only a domain that serves can take it.
      if (data.isPrimary === false && domain.isPrimary) {
        throw new AppError(TenantDomainMessages.PRIMARY_REQUIRED, 409, ErrorCode.CONFLICT);
      }
      if (data.isPrimary && !domain.isPrimary && !domainServes({ ...domain, domainStatus: data.domainStatus ?? domain.domainStatus }, bases)) {
        throw new AppError(TenantDomainMessages.PRIMARY_MUST_SERVE, 409, ErrorCode.CONFLICT);
      }
      if (data.isPrimary) await repo.update({ tenantId, isPrimary: true }, { isPrimary: false });
      await repo.update({ tenantDomainId, tenantId }, data as Partial<TenantDomainEntity>);
      const updated = await repo.findOne({ where: { tenantDomainId, tenantId } });
      if (!updated) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      return { domain, updated };
    });
    const parsed = SafeTenantDomainSchema.parse(updated);
    await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse(domain));
    await TenantDomainCrudService.clearCache(parsed);
    // phase 51: an update that makes the domain servable (→ ACTIVE) asks for its certificate; for any other update this is a no-op.
    if (data.domainStatus === 'ACTIVE' && domain.domainStatus !== 'ACTIVE') {
      void import('./tenant_domain.certificates.hooks').then((m) => m.requestCertificate({ ...parsed, tenantId: parsed.tenantId, tenantDomainId: parsed.tenantDomainId })).catch(() => undefined);
    }

    // Audit + lifecycle webhook on an actual status transition (e.g. →ACTIVE
    // emits `tenant_domain.activated`). Best-effort; never fails the update.
    if (data.domainStatus && data.domainStatus !== domain.domainStatus) {
      try {
        const { default: TenantDomainNotificationsService } = await import('./tenant_domain.notifications.service');
        await TenantDomainNotificationsService.recordStatusTransition({
          tenantId,
          tenantDomainId,
          domain: parsed.domain,
          fromStatus: domain.domainStatus as DomainStatus,
          toStatus: data.domainStatus,
        });
      } catch (e) {
        Logger.warn(`[tenant_domain] update notify failed for ${parsed.domain}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return parsed;
  }

  static async delete(tenantDomainId: string, tenantId: string): Promise<void> {
    // On the locked row: a concurrent "make primary" cannot land between the
    // primary check and the delete and leave the tenant without a primary.
    const { domain, promoted } = await withTenantTransactionFor(tenantId, async (qr) => {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [domainSetLock(tenantId)]);
      const repo = qr.manager.getRepository(TenantDomainEntity);
      const row = await repo.findOne({ where: { tenantDomainId, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      // The free subdomain is permanent and the primary always has a successor, so the tenant's other domains decide.
      const bases = await managedBases();
      const anyBase = bases.some((b) => b.purpose === 'tenants');
      const rows = anyBase ? await repo.find({ where: { tenantId } }) : [];
      const slug = anyBase ? await tenantSlugIn(qr, tenantId) : null;
      if (isProtectedSubdomain(row, rows, slug, bases)) {
        throw new AppError(TenantDomainMessages.FREE_SUBDOMAIN_PERMANENT, 409, ErrorCode.CONFLICT);
      }
      let promoted: TenantDomainEntity | null = null;
      if (row.isPrimary) {
        // Removing the primary custom domain hands the primary back to the free subdomain; without one (no wildcard
        // domain configured) there is nothing to fall back to, and the old refusal stands.
        const named = freeSubdomainNames(slug, bases);
        const fallbacks = rows.filter((d) => d.tenantDomainId !== row.tenantDomainId && isWildcardSubdomain(d.domain, bases) && d.domainStatus === 'ACTIVE');
        promoted = fallbacks.find((d) => named.includes(d.domain)) ?? fallbacks[0] ?? null;
        if (!promoted) throw new AppError(TenantDomainMessages.CANNOT_DELETE_PRIMARY, 409, ErrorCode.CONFLICT);
      }
      // phase 51: the platform-held certificate (and its sealed private key) goes with the domain, in the same transaction.
      await qr.query('DELETE FROM "tenant_domain_certificates" WHERE "tenantDomainId" = $1 AND "tenantId" = $2', [tenantDomainId, tenantId]);
      await repo.delete({ tenantDomainId, tenantId });
      if (promoted) await repo.update({ tenantDomainId: promoted.tenantDomainId, tenantId }, { isPrimary: true });
      return { domain: row, promoted };
    });
    const DNSVerificationService = (await import('./dns_verification.service')).default;
    await DNSVerificationService.deleteStoredToken(tenantDomainId);
    (await import('./tenant_domain.certificates.service')).invalidateCertificateCache(domain.domain);
    await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse(domain));
    if (promoted) await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse({ ...promoted, isPrimary: true }));
  }
}
