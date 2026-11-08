/**
 * tenant_domain's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a custom domain added,
 * deleted, assigned to a site and its verification requested (the domain routes), its status changed and its DNS re-check failed (the
 * notifications service and the DNS sweep). The domain is the row's subject; the host name is an address (network), the site id and the
 * statuses are not people. The actor is the member, or the system (the sweep, a status transition). Domains decide where a workspace
 * answers and which certificates it is issued: medium throughout, an added domain the heaviest. Only the contract from common is
 * imported (ADR-0008 §2).
 *
 * Phase 56 adds the root tenant's managed base domains (base_domain.*, platform operators only) and an organization moving its free
 * subdomain to another base (domain.base_changed). A base domain carries every organization's address under it: adding one, switching
 * one off or changing the default is high; checking its DNS or ordering its certificate is routine bookkeeping, low.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const DOMAIN = { domain: a.untrusted('network', 'the host name') };
const BASE = { baseDomain: a.untrusted('network', 'the platform base domain') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'domain.created', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'], metadata: DOMAIN }),
  auditRowSignal({ kind: 'domain.deleted', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'] }),
  auditRowSignal({ kind: 'domain.site_assigned', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: { ...DOMAIN, siteId: a.untrusted('none', 'the site') } }),
  auditRowSignal({
    kind: 'domain.verification_requested', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'],
    metadata: { verified: a.flag('none', 'the DNS check passed') },
  }),
  auditRowSignal({
    kind: 'domain.status_changed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { ...DOMAIN, from: a.untrusted('none'), to: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'domain.dns_check_failed', severity: 'medium', defaultWeight: 0.2, outcomes: ['fail'], actorKinds: ['anon'], metadata: DOMAIN }),
  auditRowSignal({
    kind: 'domain.base_changed', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'],
    metadata: { from: a.untrusted('network', 'the address it left'), to: a.untrusted('network', 'the address it moved to') },
  }),
  auditRowSignal({
    kind: 'base_domain.created', severity: 'high', defaultWeight: 0.4, outcomes: ['info'], actorKinds: ['user'],
    metadata: { ...BASE, purpose: a.untrusted('none', 'tenants or wildcard_only'), challengeMode: a.untrusted('none', 'delegated or zone') },
  }),
  auditRowSignal({
    kind: 'base_domain.updated', severity: 'high', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'],
    metadata: {
      ...BASE, selectable: a.flag('none', 'offered to sign-ups'), isDefault: a.flag('none', 'made the default'),
      challengeMode: a.untrusted('none', 'delegated or zone'), status: a.untrusted('none', 'DISABLED or PENDING_DNS'),
    },
  }),
  auditRowSignal({ kind: 'base_domain.deleted', severity: 'high', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'] }),
  auditRowSignal({ kind: 'base_domain.dns_checked', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user'] }),
  auditRowSignal({ kind: 'base_domain.order_requested', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user'] }),
];

export default SIGNALS;
