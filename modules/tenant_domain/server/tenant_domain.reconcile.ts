import 'reflect-metadata';
import { Not } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { TenantDomain } from './entities/tenant_domain.entity';
import { SafeTenantDomainSchema } from './tenant_domain.types';
import { DomainStatusEnum, type DomainStatus } from './tenant_domain.enums';
import { resolveDomainEntitlement } from './tenant_domain.entitlement';
import { ensureFreeSubdomain, tenantSlugIn, type FreeSubdomainResult } from './tenant_domain.free-subdomain';
import { freeSubdomainNames, isWildcardSubdomain } from './tenant_domain.wildcard';
import { managedBases } from './tenant_domain.base-domains';
import { isReservedWildcardName } from './tenant_domain.serving';
import TenantDomainCrudService, { domainServes } from './tenant_domain.crud.service';

/**
 * Custom domains follow the plan; the free subdomain never goes away (owner direction 2026-10-17).
 *
 * For one tenant: make sure its free subdomain exists and serves (`ensureFreeSubdomain`), then hold its CUSTOM domains
 * to what the plan includes right now:
 *
 *   - the plan says no custom domains (`custom_domain` false)  → every custom domain is SUSPENDED;
 *   - the plan caps them (`max_domains` N)                     → all but N are SUSPENDED, keeping the primary, then the
 *                                                                ones that serve, then the oldest;
 *   - the plan includes them again / raises the cap            → suspended ones come back, in the same order, to the
 *                                                                status they had (an ACTIVE domain is ACTIVE again, so
 *                                                                the DNS and SSL sweeps re-check it as before).
 *
 * Suspended is not deleted: the row, its DNS proof and its certificate state stay, it just stops serving (the proxy
 * and the TLS ask refuse it) and stops being linked to. A primary that gets suspended hands the primary to the free
 * subdomain in the same transaction, so the tenant is never left without a domain that serves. The owner and admins
 * are told once per suspension (tenant_domain.notifications.service); every transition is audited and has a webhook.
 *
 * Triggered by `feature_gate:entitlement_changed` (a plan assigned, cancelled, lapsed; a catalogue entitlement granted,
 * revoked or expired) and swept for every active tenant with the DNS recheck job (6-hourly) as the safety net, which
 * is also what catches a sysadmin editing a plan's features (not announced per tenant).
 *
 * A platform subdomain whose name is reserved (admin., www., api., auth., app. ...) and that a customer tenant holds
 * (a slug taken before the reserved list existed) is SUSPENDED too, with the primary flag handed on: the least
 * destructive way to remove the hijack. The row stays (operator-visible as SUSPENDED, audited, webhook), it stops
 * serving and being linked to (tenant_domain.serving), the tenant stays reachable on the platform host, and a slug change
 * to a free name renames the row back to ACTIVE (`ensureFreeSubdomain`). The reserved platform tenants are exempt.
 *
 * The entitlement is read STRICTLY here: elsewhere it fails open, but failing open in a routine that reactivates would
 * bring every suspended domain back during a feature-gate outage. A tenant whose entitlement cannot be read is skipped
 * and retried on the next run.
 */

export interface DomainReconcileResult {
  tenantId: string;
  free: FreeSubdomainResult | null;
  suspended: string[];
  reactivated: string[];
  /** Reserved platform subdomains a customer tenant held, suspended by this run. */
  reserved: string[];
  /** Why the plan half did not run (entitlement unreadable); the free-subdomain half still did. */
  skipped?: string;
}

const LIVE = new Set<string>(['ACTIVE', 'VERIFIED']);

/** Keep-first order: the primary, then the ones that serve (or did before their suspension), then the rest; oldest first. */
function rank(d: TenantDomain): number {
  if (d.isPrimary && d.domainStatus !== 'SUSPENDED') return 0;
  if (LIVE.has(d.domainStatus)) return 1;
  if (d.domainStatus === 'SUSPENDED' && LIVE.has(d.statusBeforeSuspension ?? '')) return 2;
  if (d.domainStatus === 'INACTIVE' || (d.domainStatus === 'SUSPENDED' && d.statusBeforeSuspension === 'INACTIVE')) return 4;
  return 3;
}

/** The status a reactivated domain returns to: what it had, as long as its DNS proof still backs it. */
function restoredStatus(d: TenantDomain): DomainStatus {
  const before = DomainStatusEnum.safeParse(d.statusBeforeSuspension).data;
  if (!before || before === 'SUSPENDED') return d.verifiedAt ? 'VERIFIED' : 'PENDING';
  if (LIVE.has(before) && !d.verifiedAt) return 'PENDING';
  return before;
}

interface Transition { row: TenantDomain; from: DomainStatus; to: DomainStatus; reserved?: true }

export async function reconcileTenantDomains(tenantId: string): Promise<DomainReconcileResult> {
  let free: FreeSubdomainResult | null = null;
  try {
    free = await ensureFreeSubdomain(tenantId);
  } catch (err) {
    Logger.error(`[tenant_domain] free subdomain of ${tenantId} could not be ensured: ${err instanceof Error ? err.message : String(err)}`);
  }

  let ceiling: number;
  try {
    const entitlement = await resolveDomainEntitlement(tenantId, { strict: true, audit: false });
    ceiling = !entitlement.allowed ? 0 : (entitlement.maxDomains ?? Number.POSITIVE_INFINITY);
  } catch (err) {
    const skipped = `entitlement unavailable: ${err instanceof Error ? err.message : String(err)}`;
    Logger.warn(`[tenant_domain] reconcile of ${tenantId} skipped the plan check (${skipped})`);
    return { tenantId, free, suspended: [], reactivated: [], reserved: [], skipped };
  }

  const wildcard = await managedBases();
  const { transitions, promoted } = await withTenantTransactionFor(tenantId, async (qr) => {
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tenant_domain:set:${tenantId}`]);
    const repo = qr.manager.getRepository(TenantDomain);
    const rows = await repo.find({ where: { tenantId } });
    const custom = rows
      .filter((d) => !isWildcardSubdomain(d.domain, wildcard))
      .sort((a, b) => rank(a) - rank(b) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const transitions: Transition[] = [];
    const now = new Date();
    // Reserved names held by a customer tenant: suspended whatever the plan says (the free subdomain is exempt from
    // the plan, not from the reserved list). Already-suspended rows are left alone.
    for (const d of rows.filter((r) => r.domainStatus !== 'SUSPENDED' && isReservedWildcardName(r.domain, wildcard, tenantId))) {
      const res = await repo.update(
        { tenantDomainId: d.tenantDomainId, tenantId, domainStatus: Not('SUSPENDED') },
        { domainStatus: 'SUSPENDED', isPrimary: false, suspendedAt: now, statusBeforeSuspension: d.domainStatus },
      );
      if (res.affected) {
        transitions.push({ row: d, from: d.domainStatus as DomainStatus, to: 'SUSPENDED', reserved: true });
        Logger.warn(`[tenant_domain] ${d.domain} of ${tenantId} is a reserved subdomain; suspended`);
      }
    }
    for (const [i, d] of custom.entries()) {
      const keep = i < ceiling;
      if (!keep && d.domainStatus !== 'SUSPENDED') {
        const res = await repo.update(
          { tenantDomainId: d.tenantDomainId, tenantId, domainStatus: Not('SUSPENDED') },
          { domainStatus: 'SUSPENDED', isPrimary: false, suspendedAt: now, statusBeforeSuspension: d.domainStatus },
        );
        if (res.affected) transitions.push({ row: d, from: d.domainStatus as DomainStatus, to: 'SUSPENDED' });
      } else if (keep && d.domainStatus === 'SUSPENDED') {
        const to = restoredStatus(d);
        const res = await repo.update(
          { tenantDomainId: d.tenantDomainId, tenantId, domainStatus: 'SUSPENDED' },
          { domainStatus: to, suspendedAt: null, statusBeforeSuspension: null },
        );
        if (res.affected) transitions.push({ row: d, from: 'SUSPENDED', to });
      }
    }

    // A suspended primary leaves no primary: the free subdomain takes it (the one named after the slug, else any
    // ACTIVE wildcard subdomain). Without a wildcard domain the tenant links on the platform host until it picks one.
    let promoted: TenantDomain | null = null;
    const lostPrimary = transitions.some((t) => t.to === 'SUSPENDED' && t.row.isPrimary);
    const otherPrimary = rows.some((d) => d.isPrimary && !transitions.some((t) => t.row.tenantDomainId === d.tenantDomainId && t.to === 'SUSPENDED'));
    if (lostPrimary && !otherPrimary) {
      const named = freeSubdomainNames(await tenantSlugIn(qr, tenantId), wildcard);
      const candidates = rows.filter((d) => isWildcardSubdomain(d.domain, wildcard) && domainServes(d, wildcard) && !isReservedWildcardName(d.domain, wildcard, tenantId));
      promoted = candidates.find((d) => named.includes(d.domain)) ?? candidates[0] ?? null;
      if (promoted) await repo.update({ tenantDomainId: promoted.tenantDomainId, tenantId }, { isPrimary: true });
    }
    return { transitions, promoted };
  });

  if (transitions.length === 0 && !promoted) return { tenantId, free, suspended: [], reactivated: [], reserved: [] };

  // After the commit: caches, then the audit trail, webhooks and the owner's notice. Best-effort from here on.
  for (const t of transitions) {
    await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse({ ...t.row, domainStatus: t.to, statusBeforeSuspension: null })).catch(() => {});
  }
  if (promoted) await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse(promoted)).catch(() => {});

  const suspended = transitions.filter((t) => t.to === 'SUSPENDED' && !t.reserved);
  const reserved = transitions.filter((t) => t.reserved);
  const reactivated = transitions.filter((t) => t.from === 'SUSPENDED');
  try {
    const { default: Notifications } = await import('./tenant_domain.notifications.service');
    for (const t of transitions) {
      await Notifications.recordStatusTransition({
        tenantId, tenantDomainId: t.row.tenantDomainId, domain: t.row.domain, fromStatus: t.from, toStatus: t.to,
        ...(t.from === 'SUSPENDED' ? { webhookEvent: 'tenant_domain.reactivated' } : {}),
      });
    }
    if (suspended.length) {
      await Notifications.notifyDomainsSuspended({
        tenantId,
        domains: suspended.map((t) => ({ tenantDomainId: t.row.tenantDomainId, domain: t.row.domain })),
        reason: ceiling === 0 ? 'not_in_plan' : 'over_limit',
        fallbackDomain: promoted?.domain ?? free?.domain ?? null,
      });
    }
  } catch (err) {
    Logger.warn(`[tenant_domain] reconcile notices for ${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  Logger.info(`[tenant_domain] reconcile ${tenantId}: suspended=${suspended.length} reactivated=${reactivated.length} reserved=${reserved.length}${promoted ? ` primary→${promoted.domain}` : ''}`);
  return { tenantId, free, suspended: suspended.map((t) => t.row.domain), reactivated: reactivated.map((t) => t.row.domain), reserved: reserved.map((t) => t.row.domain) };
}

/** Every active tenant, one after another; a tenant that fails is logged and the sweep goes on. */
export async function reconcileAllTenantDomains(): Promise<{ tenants: number; suspended: number; reactivated: number; freeSubdomainFixed: number; reservedSuspended: number; failed: number }> {
  const tally = { tenants: 0, suspended: 0, reactivated: 0, freeSubdomainFixed: 0, reservedSuspended: 0, failed: 0 };
  for (const tenant of await listActiveTenants()) {
    tally.tenants += 1;
    try {
      const r = await reconcileTenantDomains(tenant.tenantId);
      tally.suspended += r.suspended.length;
      tally.reactivated += r.reactivated.length;
      tally.reservedSuspended += r.reserved.length;
      if (r.free && (r.free.action !== 'none' || r.free.madePrimary)) tally.freeSubdomainFixed += 1;
    } catch (err) {
      tally.failed += 1;
      Logger.error(`[tenant_domain] reconcile of ${tenant.tenantId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return tally;
}
