import { Like } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { TenantDomainBaseDomain } from './entities/tenant_domain_base_domain.entity';
import { TenantDomain } from './entities/tenant_domain.entity';
import { BASE_DOMAIN_PURPOSES, CHALLENGE_MODES, invalidateBaseDomains, type BaseDomainStatus } from './tenant_domain.base-domains';
import { isValidDomainName } from './tenant_domain.dto';
import { isUnderWildcard, type BaseDomainPurpose } from './tenant_domain.serving';
import { dnsChallengeConfig, challengeNameOf, delegatedTargetOf } from './tenant_domain.acme.dns-config';
import { checkBaseDomainDns, platformAddresses, type BaseDomainDnsCheck } from './tenant_domain.base-domains.dns-check';
import { findBaseCertificate, invalidateBaseCertificateCache, summarizeBaseCertificate, type BaseCertificateSummary } from './tenant_domain.base-certificates.service';
import { acmeConfig } from './tenant_domain.acme.config';
import TenantDomainMessages from './tenant_domain.messages';
import { baseDomainScope, insideScope } from './tenant_domain.base-domain-scope';

/**
 * The root tenant's management of the managed base domains (phase 56, D350, D351): list them with what the page needs (the DNS records to
 * set, the wildcard's state, how many addresses sit under each), add one (PENDING_DNS until its DNS is proven and its wildcard held),
 * switch it (default, offered, challenge mode, off and on), delete it, check its DNS and order its wildcard now. Every write drops the
 * in-process base-domain list. Refusals keep the platform serving: the default is never removed or switched off, and a base that still
 * holds addresses is neither disabled nor deleted.
 */
export interface DnsRecordHint { type: string; name: string; value: string }

export interface BaseDomainView {
  baseDomainId: string;
  baseDomain: string;
  purpose: BaseDomainPurpose;
  isDefault: boolean;
  selectable: boolean;
  status: BaseDomainStatus;
  challengeMode: 'delegated' | 'zone';
  dnsCheckedAt: string | null;
  lastDnsError: string | null;
  createdAt: string;
  /** Addresses whose longest base is this one. */
  addresses: number;
  certificate: BaseCertificateSummary;
  /** What to set at the base domain's DNS host. */
  records: DnsRecordHint[];
}

async function rows(): Promise<TenantDomainBaseDomain[]> {
  return withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).find({ order: { baseDomain: 'ASC' } }));
}

/** Rows under `base` and under no longer base: `LIKE '%.b'` counts minus the counts of the longest bases nested directly in `b`. */
export function exactCounts(names: string[], raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of names) {
    const nested = names.filter((c) => c !== b && c.endsWith(`.${b}`));
    const maximal = nested.filter((c) => !nested.some((d) => d !== c && c.endsWith(`.${d}`)));
    out[b] = Math.max(0, (raw[b] ?? 0) - maximal.reduce((n, c) => n + (raw[c] ?? 0), 0));
  }
  return out;
}

async function addressCounts(names: string[]): Promise<Record<string, number>> {
  const raw: Record<string, number> = {};
  await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantDomain);
    for (const b of names) raw[b] = await repo.count({ where: { domain: Like(`%.${b}`) } });
  });
  return exactCounts(names, raw);
}

export function recordsFor(base: Pick<TenantDomainBaseDomain, 'baseDomain' | 'challengeMode' | 'purpose'>, addresses: string[]): DnsRecordHint[] {
  const dns = dnsChallengeConfig();
  const out: DnsRecordHint[] = [];
  if (base.challengeMode !== 'zone') {
    out.push({ type: 'CNAME', name: challengeNameOf(base.baseDomain), value: dns ? delegatedTargetOf(base.baseDomain, dns) : '(set ACME_DNS_ZONE on the platform first)' });
  }
  const target = addresses.length ? addresses.join(', ') : '(the platform\'s addresses)';
  for (const type of addresses.some((a) => a.includes(':')) ? ['A', 'AAAA'] : ['A']) {
    const values = addresses.filter((a) => (type === 'AAAA' ? a.includes(':') : !a.includes(':')));
    out.push({ type, name: `*.${base.baseDomain}`, value: values.length ? values.join(', ') : target });
  }
  return out;
}

export async function listBaseDomainViews(): Promise<BaseDomainView[]> {
  const list = await rows();
  const [counts, addresses] = await Promise.all([addressCounts(list.map((b) => b.baseDomain)), platformAddresses().catch(() => [] as string[])]);
  const directory = acmeConfig()?.directoryUrl ?? null;
  return Promise.all(list.map(async (b) => ({
    baseDomainId: b.baseDomainId,
    baseDomain: b.baseDomain,
    purpose: b.purpose === 'wildcard_only' ? 'wildcard_only' : 'tenants',
    isDefault: b.isDefault,
    selectable: b.selectable,
    status: b.status as BaseDomainStatus,
    challengeMode: b.challengeMode === 'zone' ? 'zone' : 'delegated',
    dnsCheckedAt: b.dnsCheckedAt ? new Date(b.dnsCheckedAt).toISOString() : null,
    lastDnsError: b.lastDnsError ?? null,
    createdAt: new Date(b.createdAt).toISOString(),
    addresses: counts[b.baseDomain] ?? 0,
    certificate: summarizeBaseCertificate(await findBaseCertificate(b.baseDomainId).catch(() => null), b.baseDomain, directory),
    records: recordsFor(b, addresses),
  } satisfies BaseDomainView)));
}

async function byId(baseDomainId: string): Promise<TenantDomainBaseDomain> {
  const row = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).findOne({ where: { baseDomainId } }));
  if (!row) throw new AppError(TenantDomainMessages.BASE_DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return row;
}

async function addressesUnder(baseDomain: string, others: string[]): Promise<number> {
  const names = [...new Set([...others, baseDomain])];
  return (await addressCounts(names))[baseDomain] ?? 0;
}

export interface CreateBaseDomainInput { baseDomain: string; purpose?: BaseDomainPurpose; challengeMode?: 'delegated' | 'zone'; selectable?: boolean }

export async function createBaseDomain(input: CreateBaseDomainInput): Promise<TenantDomainBaseDomain> {
  const name = input.baseDomain.trim().toLowerCase().replace(/\.$/, '');
  if (!isValidDomainName(name) || !name.includes('.') || /^\d+(\.\d+)*$/.test(name)) {
    throw new AppError(TenantDomainMessages.BASE_DOMAIN_INVALID, 422, ErrorCode.VALIDATION_ERROR);
  }
  // Fleet phase 6c (F43): on a fleet node an address under a zone must mean data in that zone's region, so a base domain sits inside one of
  // the region's zone domains; when they cannot be read, none is added (fail closed).
  const scope = await baseDomainScope();
  if (scope === 'unavailable') throw new AppError(TenantDomainMessages.BASE_DOMAIN_SCOPE_UNAVAILABLE, 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
  if (scope && !insideScope(name, scope)) {
    throw new AppError(TenantDomainMessages.BASE_DOMAIN_OUTSIDE_ZONE, 422, ErrorCode.VALIDATION_ERROR, { details: { reason: 'BASE_DOMAIN_OUTSIDE_ZONE', zones: scope.zones } });
  }
  const purpose: BaseDomainPurpose = input.purpose && BASE_DOMAIN_PURPOSES.includes(input.purpose) ? input.purpose : 'tenants';
  const challengeMode = input.challengeMode && (CHALLENGE_MODES as readonly string[]).includes(input.challengeMode) ? input.challengeMode : 'delegated';
  const existing = await rows();
  if (existing.some((b) => b.baseDomain === name)) throw new AppError(TenantDomainMessages.BASE_DOMAIN_EXISTS, 409, ErrorCode.CONFLICT);
  // A custom domain some organization proved under this name would turn into a platform subdomain (no DNS proof) the moment the base
  // exists: refused, with the names, until those domains are gone. Names already under a shorter managed base are platform names anyway.
  const custom = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomain).find({ where: { domain: Like(`%.${name}`) }, select: ['domain'], take: 20 }));
  const shorter = existing.map((b) => ({ name: b.baseDomain, purpose: (b.purpose === 'wildcard_only' ? 'wildcard_only' : 'tenants') as BaseDomainPurpose }));
  const conflicting = custom.map((d) => d.domain).filter((d) => !isUnderWildcard(d, shorter));
  if (conflicting.length) {
    throw new AppError(`${TenantDomainMessages.BASE_DOMAIN_HAS_CUSTOM_DOMAINS}: ${conflicting.slice(0, 5).join(', ')}`, 409, ErrorCode.CONFLICT);
  }
  const saved = await withSystemRLS((qr) => {
    const repo = qr.manager.getRepository(TenantDomainBaseDomain);
    return repo.save(repo.create({ baseDomain: name, purpose, challengeMode, selectable: input.selectable ?? purpose === 'tenants', isDefault: false, status: 'PENDING_DNS' }));
  });
  invalidateBaseDomains();
  Logger.info(`[tenant_domain] base domain ${JSON.stringify(name)} added (${purpose}, ${challengeMode}), waiting for its DNS`);
  return saved;
}

export interface UpdateBaseDomainInput { selectable?: boolean; isDefault?: true; challengeMode?: 'delegated' | 'zone'; status?: 'DISABLED' | 'PENDING_DNS' }

export async function updateBaseDomain(baseDomainId: string, patch: UpdateBaseDomainInput): Promise<TenantDomainBaseDomain> {
  const row = await byId(baseDomainId);
  const all = await rows();
  if (patch.isDefault) {
    if (row.purpose !== 'tenants' || row.status !== 'ACTIVE') throw new AppError(TenantDomainMessages.BASE_DOMAIN_DEFAULT_NEEDS_ACTIVE, 409, ErrorCode.CONFLICT);
  }
  if (patch.status === 'DISABLED') {
    if (row.isDefault) throw new AppError(TenantDomainMessages.BASE_DOMAIN_IS_DEFAULT, 409, ErrorCode.CONFLICT);
    if (await addressesUnder(row.baseDomain, all.map((b) => b.baseDomain))) throw new AppError(TenantDomainMessages.BASE_DOMAIN_IN_USE, 409, ErrorCode.CONFLICT);
  }
  if (patch.status === 'PENDING_DNS' && row.status !== 'DISABLED') throw new AppError(TenantDomainMessages.BASE_DOMAIN_NOT_DISABLED, 409, ErrorCode.CONFLICT);
  await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantDomainBaseDomain);
    // One default: the partial unique index allows no second one, so the old default is cleared first, in the same transaction.
    if (patch.isDefault && !row.isDefault) await repo.update({ isDefault: true }, { isDefault: false });
    const fields: Partial<TenantDomainBaseDomain> = {};
    if (patch.selectable !== undefined) fields.selectable = patch.selectable;
    if (patch.isDefault) fields.isDefault = true;
    if (patch.challengeMode) fields.challengeMode = patch.challengeMode;
    if (patch.status) fields.status = patch.status;
    if (Object.keys(fields).length) await repo.update({ baseDomainId }, fields);
  });
  invalidateBaseDomains();
  invalidateBaseCertificateCache(row.baseDomain);
  return byId(baseDomainId);
}

export async function deleteBaseDomain(baseDomainId: string): Promise<void> {
  const row = await byId(baseDomainId);
  if (row.isDefault) throw new AppError(TenantDomainMessages.BASE_DOMAIN_IS_DEFAULT, 409, ErrorCode.CONFLICT);
  if (await addressesUnder(row.baseDomain, (await rows()).map((b) => b.baseDomain))) throw new AppError(TenantDomainMessages.BASE_DOMAIN_IN_USE, 409, ErrorCode.CONFLICT);
  // The wildcard certificate and its sealed key go with it (ON DELETE CASCADE).
  await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).delete({ baseDomainId }));
  invalidateBaseDomains();
  invalidateBaseCertificateCache(row.baseDomain);
  Logger.info(`[tenant_domain] base domain ${JSON.stringify(row.baseDomain)} deleted`);
}

/** Checks the base's DNS now, writes the verdict on the row, and queues its wildcard order when a PENDING_DNS base passes. */
export async function checkBaseDomain(baseDomainId: string): Promise<BaseDomainDnsCheck & { queued: boolean }> {
  const row = await byId(baseDomainId);
  const check = await checkBaseDomainDns({ baseDomain: row.baseDomain, challengeMode: row.challengeMode === 'zone' ? 'zone' : 'delegated' }, dnsChallengeConfig());
  await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).update({ baseDomainId }, { dnsCheckedAt: new Date(), lastDnsError: check.ok ? null : (check.problem ?? 'DNS is not ready').slice(0, 500) }));
  invalidateBaseDomains();
  let queued = false;
  if (check.ok && row.status !== 'DISABLED' && acmeConfig() && dnsChallengeConfig()) {
    const { enqueueBaseIssue } = await import('./tenant_domain.certificates.job');
    await enqueueBaseIssue(baseDomainId);
    queued = true;
  }
  return { ...check, queued };
}

/** Orders the base's wildcard now, past a back-off (a person asked). 409 while the platform has no ACME directory or DNS provider. */
export async function orderBaseCertificateNow(baseDomainId: string): Promise<{ queued: true }> {
  const row = await byId(baseDomainId);
  if (row.status === 'DISABLED') throw new AppError(TenantDomainMessages.BASE_DOMAIN_DISABLED, 409, ErrorCode.CONFLICT);
  if (!acmeConfig() || !dnsChallengeConfig()) throw new AppError(TenantDomainMessages.BASE_DOMAIN_NO_DNS_PROVIDER, 409, ErrorCode.CONFLICT);
  const { enqueueBaseIssue } = await import('./tenant_domain.certificates.job');
  await enqueueBaseIssue(baseDomainId, { force: true });
  return { queued: true };
}
