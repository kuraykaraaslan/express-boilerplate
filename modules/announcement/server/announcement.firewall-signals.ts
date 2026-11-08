/**
 * announcement's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): an announcement drafted,
 * changed, sent or scheduled, test-sent to its sender, retried, withdrawn, and a fan-out that failed. The announcement is the row's
 * subject; the actor is the sender (a person) or, for a failed fan-out, the system. The text of an announcement is never in a row, only
 * where and to how many it went. Only the contract from common is imported.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SENT = {
  platform: a.flag('none', 'true: sent by the platform to every workspace it reaches'),
  severity: a.untrusted('none', 'the announcement\'s severity'),
  sendAt: a.untrusted('none', 'when it goes out, if scheduled'),
  recipients: a.number('none', 'how many people it reaches'),
};

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'announcement.drafted', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], metadata: SENT }),
  auditRowSignal({ kind: 'announcement.updated', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], metadata: { sendAt: SENT.sendAt } }),
  // sending reaches many people at once: weighed like a status change of the record
  auditRowSignal({ kind: 'announcement.sent', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: SENT }),
  auditRowSignal({ kind: 'announcement.scheduled', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: SENT }),
  auditRowSignal({ kind: 'announcement.test_sent', severity: 'low', defaultWeight: 0.02, outcomes: ['info'] }),
  auditRowSignal({ kind: 'announcement.retried', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { platform: SENT.platform, recipients: SENT.recipients } }),
  auditRowSignal({ kind: 'announcement.withdrawn', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { sentAt: a.untrusted('none', 'when it had gone out') } }),
  auditRowSignal({
    kind: 'announcement.failed', severity: 'low', defaultWeight: 0.05, outcomes: ['fail'], actorKinds: ['anon'],
    metadata: {
      platform: SENT.platform, kind: a.untrusted('none', 'the announcement\'s kind'), stage: a.untrusted('none', 'the fan-out stage that failed'),
      reason: a.untrusted('none', 'the job\'s error message'), restarts: a.number(), recipients: SENT.recipients,
    },
  }),
];

export default SIGNALS;
