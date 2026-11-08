/**
 * tenant_setting's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a setting created,
 * updated, written in bulk and deleted (`tenant_setting.write.service.ts`), and a parked setting change approved or rejected
 * (`tenant_setting.change-decision.ts`), all through `emitAuditLog`. The setting key is the row's subject (its resource id); the row
 * carries no metadata. The actor is the member or the reviewer, or the system. Tenant settings hold security policies, credentials and
 * the firewall's own switches: medium, like audit_log's `settings.updated`, a bulk write the heaviest; a rejected change is low. Only
 * the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'setting.created', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'setting.updated', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'setting.bulk_updated', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'setting.deleted', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'setting.approval_approved', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'setting.approval_rejected', severity: 'low', defaultWeight: 0.1, outcomes: ['deny'], actorKinds: [...ACTORS] }),
];

export default SIGNALS;
