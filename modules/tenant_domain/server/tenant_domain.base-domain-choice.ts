import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID, isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { In } from 'typeorm';
import { TenantDomain } from './entities/tenant_domain.entity';
import { asBaseRefs, baseDomainList, defaultBaseDomainOf, isMintableBase, offeredBaseDomainsOf } from './tenant_domain.base-domains';
import { tenantBaseOf } from './tenant_domain.serving';
import { ensureFreeSubdomain } from './tenant_domain.free-subdomain';
import TenantDomainCrudService from './tenant_domain.crud.service';
import TenantDomainMessages from './tenant_domain.messages';
import { baseDomainScope, insideScope, type BaseDomainScope } from './tenant_domain.base-domain-scope';

/**
 * Who chooses a tenant's base domain (phase 56, D346, D347). The root tenant's `baseDomainChoice`: `platform` (the default) gives every new
 * organization the default base and no choice; `tenant` lets the sign-up pick one of the base domains marked selectable, and an
 * organization's owner move to another later. ROOT may move any organization to any ACTIVE tenants' base, whatever the switch says.
 */
export type BaseDomainChoice = 'platform' | 'tenant';

export async function baseDomainChoice(): Promise<BaseDomainChoice> {
  const raw = await SettingService.getValue(ROOT_TENANT_ID, 'baseDomainChoice').catch(() => null);
  return raw === 'tenant' ? 'tenant' : 'platform';
}

export interface BaseDomainOffer {
  choice: BaseDomainChoice;
  /** The base a new organization gets when it chooses none. */
  defaultBase: string | null;
  /** What the sign-up may pick: the selectable ACTIVE tenants' bases while the switch is `tenant`, else the default alone. */
  offered: string[];
  /** With `slug`: the offered bases under which `<slug>.<base>` is already held by a row (an organization's extra address). */
  takenUnder: string[];
}

/**
 * Fleet phase 6c (F43): on a fleet node only bases inside the region's zone domains are offered. A scope that cannot be read offers the
 * default alone (it was inside a zone when it was added; Z4's compliance check reports one that no longer is) rather than closing sign-up.
 */
function scopedOffer(offered: string[], defaultBase: string | null, scope: BaseDomainScope | 'unavailable'): string[] {
  if (scope === null) return offered;
  if (scope === 'unavailable') return defaultBase && offered.includes(defaultBase) ? [defaultBase] : offered.slice(0, 1);
  return offered.filter((b) => insideScope(b, scope));
}

export async function baseDomainOffer(slug?: string | null): Promise<BaseDomainOffer> {
  const [list, choice, scope] = await Promise.all([baseDomainList(), baseDomainChoice(), baseDomainScope().catch(() => 'unavailable' as const)]);
  const defaultBase = defaultBaseDomainOf(list);
  const offered = scopedOffer(choice === 'tenant'
    ? offeredBaseDomainsOf(list).map((b) => b.baseDomain)
    : (defaultBase ? [defaultBase] : []), defaultBase, scope);
  let takenUnder: string[] = [];
  const label = (slug ?? '').trim().toLowerCase();
  if (label && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && offered.length) {
    const names = offered.map((b) => `${label}.${b}`);
    const rows = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomain).find({ where: { domain: In(names) }, select: ['domain'] })).catch(() => []);
    const held = new Set(rows.map((r) => r.domain));
    takenUnder = offered.filter((b) => held.has(`${label}.${b}`));
  }
  return { choice, defaultBase, offered, takenUnder };
}

/** The base a new organization's sign-up asked for, if it may have it (the switch is `tenant` and the base is on offer); else null. */
export async function acceptedNewTenantBase(requested: string | null | undefined): Promise<string | null> {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want) return null;
  const offer = await baseDomainOffer();
  return offer.choice === 'tenant' && offer.offered.includes(want) ? want : null;
}

export interface BaseDomainChange { domain: string; previousDomain: string | null; changed: boolean }

/**
 * Moves an organization's free subdomain to `baseDomain` (a rename: the row keeps its id, primary flag and site; the old host redirects for
 * 30 days). `by: 'root'` may pick any ACTIVE tenants' base; `by: 'owner'` only while the switch is `tenant` and only an offered base.
 * Throws: 403 (owner, switch off or base not offered), 422 (not an ACTIVE tenants' base; a platform tenant), 409 (the name is held).
 */
export async function changeTenantBaseDomain(tenantId: string, baseDomain: string, by: 'root' | 'owner'): Promise<BaseDomainChange> {
  const want = baseDomain.trim().toLowerCase();
  if (isReservedTenant(tenantId)) throw new AppError(TenantDomainMessages.BASE_DOMAIN_NOT_AVAILABLE, 422, ErrorCode.VALIDATION_ERROR);
  const list = await baseDomainList();
  const entry = list.find((b) => b.baseDomain === want);
  if (!isMintableBase(entry)) throw new AppError(TenantDomainMessages.BASE_DOMAIN_NOT_AVAILABLE, 422, ErrorCode.VALIDATION_ERROR);
  // Phase 6c (F43): not even ROOT moves an organization under a base outside this node's zones (that would be an address in another region).
  const scope = await baseDomainScope();
  if (scope === 'unavailable') throw new AppError(TenantDomainMessages.BASE_DOMAIN_SCOPE_UNAVAILABLE, 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
  if (scope && !insideScope(want, scope)) throw new AppError(TenantDomainMessages.BASE_DOMAIN_OUTSIDE_ZONE, 422, ErrorCode.VALIDATION_ERROR);
  if (by === 'owner') {
    const offer = await baseDomainOffer();
    if (offer.choice !== 'tenant' || !offer.offered.includes(want)) throw new AppError(TenantDomainMessages.BASE_DOMAIN_CHOICE_CLOSED, 403, ErrorCode.FORBIDDEN);
  }
  const before = await TenantDomainCrudService.getFreeSubdomainByTenantId(tenantId).catch(() => null);
  if (before && tenantBaseOf(before.domain, asBaseRefs(list)) === want) return { domain: before.domain, previousDomain: null, changed: false };
  const result = await ensureFreeSubdomain(tenantId, { baseDomain: want });
  if (!result.domain || tenantBaseOf(result.domain, asBaseRefs(list)) !== want) {
    throw new AppError(TenantDomainMessages.BASE_DOMAIN_NAME_TAKEN, 409, ErrorCode.CONFLICT);
  }
  return { domain: result.domain, previousDomain: result.previousDomain ?? null, changed: result.action !== 'none' };
}
