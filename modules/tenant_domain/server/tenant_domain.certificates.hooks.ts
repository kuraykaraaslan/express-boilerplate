import Logger from '@kuraykaraaslan-labs/logger';
import { isCertEligibleDomain, type ServingCandidate } from './tenant_domain.serving';
import { managedBases } from './tenant_domain.base-domains';
import { isProbeableHost } from './ssl_provisioning.probe';
import { acmeConfig } from './tenant_domain.acme.config';

/**
 * "This domain just became servable" (phase 51.3): a free subdomain was minted, a custom domain was created or updated to ACTIVE, DNS was
 * proven. Asks the certificate queue for an order right away so a new host has its certificate within minutes instead of at the next sweep.
 * Best effort and fire-and-forget by contract: a Redis or queue failure never fails the domain operation (the sweep is the safety net), and
 * with the feature unconfigured nothing is loaded at all.
 */
export interface CertificateCandidate extends ServingCandidate { tenantId: string; tenantDomainId: string }

export async function requestCertificate(domain: CertificateCandidate): Promise<void> {
  try {
    if (!acmeConfig()) return;
    if (!isCertEligibleDomain(domain, await managedBases()) || !isProbeableHost(domain.domain)) return;
    // Phase 56 (D348): a host its base's held wildcard serves needs no certificate of its own.
    // A failed lookup is "not covered": the order decides again, and orders nothing for a covered host.
    const covered = await import('./tenant_domain.base-certificates.service')
      .then(async (m) => m.wildcardServing(domain.domain, await m.heldWildcards()) !== null)
      .catch(() => false);
    if (covered) return;
    const { enqueueIssue } = await import('./tenant_domain.certificates.job');
    await enqueueIssue({ tenantId: domain.tenantId, tenantDomainId: domain.tenantDomainId, domain: domain.domain.toLowerCase() });
  } catch (err) {
    Logger.warn(`[certificates] could not queue an order for ${JSON.stringify(domain.domain)}: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}
