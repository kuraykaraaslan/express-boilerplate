/**
 * user_social_account's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): an outside identity
 * (Google, a SAML or national-identity account) linked to or unlinked from an account, and two accounts merged into one. A first link is a
 * takeover step (the owner gets a critical notice), so these are read like a changed e-mail address. Only the contract from common is
 * imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'social_account.linked', severity: 'medium', defaultWeight: 0.35, outcomes: ['info'], metadata: { provider: a.untrusted('none', 'the identity provider') } }),
  auditRowSignal({ kind: 'social_account.unlinked', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], metadata: { provider: a.untrusted() } }),
  auditRowSignal({
    kind: 'social_identity.merged', severity: 'low', defaultWeight: 0.35, outcomes: ['info'],
    metadata: { mergedFrom: a.untrusted('identifier', 'the account merged away'), mergedFromEmail: a.untrusted('contact') },
  }),
];

export default SIGNALS;
