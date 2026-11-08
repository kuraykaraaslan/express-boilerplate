/**
 * approval's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the four-eyes decisions on
 * guarded changes (inventory §1). A rush of approvals by one reviewer, or an item withdrawn after a rejection, is what the firewall reads
 * here; its own Suggest items (05) come back through the same queue. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const DECISION = {
  approvalItemId: a.untrusted('none'), decision: a.untrusted('none', 'APPROVE, REJECT or ESCALATE'), note: a.untrusted('content', 'the reviewer\'s note'),
  rowHash: a.untrusted('none'),
};

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'approval.approve', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: DECISION }),
  auditRowSignal({ kind: 'approval.reject', severity: 'low', defaultWeight: 0.1, outcomes: ['deny'], metadata: DECISION }),
  auditRowSignal({ kind: 'approval.escalate', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: DECISION }),
  auditRowSignal({ kind: 'approval.withdrawn', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { approvalItemId: a.untrusted(), reason: a.untrusted('content'), rowHash: a.untrusted() } }),
];

export default SIGNALS;
