/**
 * audit_log's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the refusals common reports
 * through the refusal sink that audit_log installs and writes (phase 55 00.3: CSRF / Origin refusals, forged provider callbacks of every
 * module), the integrity of the audit trail itself (inventory §3), an owner's erasure and purge of its rows, and `settings.updated`, a
 * value of the shared AuditActions enum several modules write (D55-160). Only the contract from common is imported (ADR-0008 §2).
 *
 * The other refusal kinds of 00.3 are registered by the module that refuses (tenant_session, fleet, plugin_runtime, storage, iot_gateway):
 * the sink writes them, the refusing module owns the action.
 */
import {
  REFUSAL_ROW_METADATA,
  auditRowSignal,
  signalAttr as a,
  type FirewallSignalContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'security.csrf_refused', severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], actorKinds: ['ip', 'user', 'anon'],
    metadata: {
      ...REFUSAL_ROW_METADATA,
      reason: a.untrusted('none', 'missing_token, bad_token, foreign_origin, ...'), method: a.untrusted(),
      origin: a.untrusted('none', 'the Origin header of a foreign-origin refusal'), addressedTenantId: a.untrusted('none', 'the tenant the URL named, unchecked'),
    },
  }),
  auditRowSignal({
    kind: 'security.inbound_signature_invalid', severity: 'high', defaultWeight: 0.45, outcomes: ['deny'], lanes: ['provider-webhook', 'unknown'], actorKinds: ['ip', 'anon'],
    metadata: {
      ...REFUSAL_ROW_METADATA,
      module: a.untrusted('none', 'the module whose callback refused'), provider: a.untrusted(), providerRecognised: a.flag(),
      reason: a.untrusted('none', 'SIGNATURE_INVALID, TIMESTAMP_OUTSIDE_WINDOW, ...'),
    },
  }),
  auditRowSignal({ kind: 'audit.chain_broken', severity: 'critical', defaultWeight: 0.8, outcomes: ['fail'], actorKinds: ['anon', 'user'], metadata: { brokenAt: a.untrusted(), checked: a.number() } }),
  auditRowSignal({
    kind: 'audit.purged', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['anon', 'user'],
    metadata: { purged: a.number(), through: a.untrusted() },
  }),
  // an owner erased a person's attribution from the trail, or purged the rows past retention: erasures, weighed as such
  auditRowSignal({
    kind: 'audit_log.anonymized', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'],
    metadata: { anonymized: a.number('none', 'rows anonymized'), erasedActor: a.untrusted('identifier', 'a one-way pseudonym of the erased person') },
  }),
  auditRowSignal({
    kind: 'audit_log.purged', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user'],
    metadata: { purged: a.number('none', 'rows removed'), cutoff: a.untrusted('none', 'the retention cutoff'), archived: a.flag('none', 'archived before removal') },
  }),
  // AuditActions.SETTINGS_UPDATED, the shared enum's own value: written by tenant_branding (a branding change or reset) and by
  // commerce_return (a return approved, rejected or refunded), so it is registered here, once, with every writer's fields (D55-160)
  auditRowSignal({
    kind: 'settings.updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: {
      tenantId: a.untrusted('none'), reset: a.flag('none', 'the branding was reset'), status: a.untrusted('none', 'APPROVED, REJECTED or REFUNDED'),
      note: a.untrusted('content', 'the moderator\'s note'), refundAmountMinor: a.number(), restockingFeeMinor: a.number(), method: a.untrusted('none', 'the refund method'),
    },
  }),
];

export default SIGNALS;
