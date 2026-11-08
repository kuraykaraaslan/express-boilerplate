/**
 * tenant_session's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the refusals of the tenant
 * guard (a missing role or permission, a tenant's IP list, the auth-failure breaker of phase 55 00.3), the country change inside a live
 * session (00.4), the global administrator's cross-tenant access (inventory §1) and the guard's success (`tenant.session.resolved`, coverage
 * batches). Only the contract from common is imported.
 */
import {
  REFUSAL_ROW_METADATA,
  auditRowSignal,
  signalAttr as a,
  type FirewallSignalContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'permission.denied', severity: 'high', defaultWeight: 0.3, outcomes: ['deny'],
    metadata: { requiredRole: a.untrusted(), userId: a.untrusted('identifier'), reason: a.untrusted('none', 'the guard\'s message') },
  }),
  // The success of the same guard (a member's session resolved to a workspace with a role): routine, the baseline the refusals stand out from.
  auditRowSignal({ kind: 'tenant.session.resolved', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], metadata: { role: a.untrusted('none', 'the member\'s role') } }),
  auditRowSignal({ kind: 'tenant.session.denied', severity: 'low', defaultWeight: 0.2, outcomes: ['deny'], metadata: { reason: a.untrusted(), requiredRole: a.untrusted() } }),
  auditRowSignal({
    kind: 'tenant.session.geo_anomaly', severity: 'high', defaultWeight: 0.45, outcomes: ['info'],
    metadata: { previousCountry: a.untrusted('location'), currentCountry: a.untrusted('location') },
  }),
  auditRowSignal({
    kind: 'security.global_admin_access', severity: 'medium', defaultWeight: 0.1, outcomes: ['info'],
    metadata: { userSessionId: a.untrusted('identifier'), method: a.untrusted(), path: a.untrusted() },
  }),
  // Phase 55 00.3: aggregated refusal rows (one per tenant, key and minute), keyed on the caller's address.
  auditRowSignal({
    kind: 'security.tenant_ip_denied', severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], actorKinds: ['ip', 'user', 'anon'],
    metadata: { ...REFUSAL_ROW_METADATA, verdict: a.untrusted('none', 'which list refused the address') },
  }),
  auditRowSignal({
    kind: 'security.auth_circuit_open', severity: 'high', defaultWeight: 0.5, outcomes: ['deny'], actorKinds: ['ip', 'user', 'anon'],
    metadata: { ...REFUSAL_ROW_METADATA, scope: a.untrusted('none', 'caller or tenant'), failures: a.number(), threshold: a.number() },
  }),
];

export default SIGNALS;
