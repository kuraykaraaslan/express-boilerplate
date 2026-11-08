/**
 * notification_log's signal kind for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the retention sweep that
 * anonymised and deleted a tenant's old notification rows (`notification_log.retention.pruned`, one row per run that changed anything,
 * counts only). The tenant's ledger is the row's subject; the actor is the system. A purge of records: medium, at the bottom of its
 * weight range because it is the scheduled retention the tenant set, not a person's erasure. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'notification_log.retention.pruned', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { anonymized: a.number(), deleted: a.number(), anonymizeAfterDays: a.number(), deleteAfterDays: a.number() },
  }),
];

export default SIGNALS;
