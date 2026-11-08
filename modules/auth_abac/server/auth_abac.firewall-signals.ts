/**
 * auth_abac's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the policy decisions it logs
 * (deny-only unless a permit sample is configured, inventory §1) and the edits of the access policies themselves, which change who may
 * do what, and the install configuration's own permission grants. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const POLICY_EDIT = { policyId: a.untrusted('none'), name: a.untrusted('none', 'the policy\'s name') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'abac.decision', severity: 'low', defaultWeight: 0.2, outcomes: ['deny', 'info'], actorKinds: ['user', 'anon'],
    metadata: {
      action: a.untrusted('none', 'the permission asked for'), resourceType: a.untrusted(), effect: a.untrusted('none', 'permit or deny'),
      reason: a.untrusted(), enforced: a.flag(), subjectId: a.untrusted('identifier'), sampleRate: a.number(),
    },
  }),
  auditRowSignal({ kind: 'abac.policy.created', severity: 'low', defaultWeight: 0.15, outcomes: ['info'], metadata: POLICY_EDIT }),
  auditRowSignal({ kind: 'abac.policy.updated', severity: 'low', defaultWeight: 0.15, outcomes: ['info'], metadata: POLICY_EDIT }),
  auditRowSignal({ kind: 'abac.policy.deleted', severity: 'low', defaultWeight: 0.2, outcomes: ['info'], metadata: POLICY_EDIT }),
  // the install's config/access.ts grants permissions beyond the manifests, announced at boot by the system (the grants and removals
  // are lists, which never travel): a permission grant, weighed as one
  auditRowSignal({ kind: 'install_config.access.grants', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['anon'] }),
];

export default SIGNALS;
