/**
 * tenant_invitation's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/02 §2.6): the invitation path of a
 * sign-up (tenant_invitation.firewall-emitters.ts). Both are emitted by this module, not audit rows. Only the contract from common is
 * imported (ADR-0008 §2).
 */
import { signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { TALLY_SIGNAL_ATTRS } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';

const SIGNALS: FirewallSignalContribution[] = [
  {
    kind: 'tenant_invitation.accepted', emitted: true, severity: 'low', defaultWeight: 0.1, outcomes: ['info'], lanes: ['unknown'], actorKinds: ['user'],
    attrs: {
      via: a.text('none', 'token (the e-mailed link), id (as the verified account) or auto (a verified account that registered)'),
      role: a.text('none', 'the role the invitation gave: USER, ADMIN, ...'),
    },
  },
  {
    kind: 'tenant_invitation.token_refused', emitted: true, severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'],
    lanes: ['human-web', 'human-native', 'public-anon', 'unknown'], actorKinds: ['user', 'ip', 'anon'],
    attrs: {
      ...TALLY_SIGNAL_ATTRS,
      method: a.text('none', 'GET (the public preview) or POST (the accept)'),
      // a signed-in caller is the actor; the address of an anonymous one is the actor id (network data in the actor, not an attribute)
    },
  },
];

export default SIGNALS;
