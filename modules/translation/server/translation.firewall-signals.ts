/**
 * translation's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the platform's interface
 * texts saved, removed or imported. They are written in the root workspace and change what every workspace's people read (a text can
 * be made to ask for a password), so they are weighed as platform control: medium, a bulk import the most. The language and platform
 * are the row's subject; the actor is a platform administrator through the API or the command line. Lists (modules, keys) never travel,
 * so they are not declared. It contributes from its own folder and imports only the contract from common.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const VIA = { via: a.untrusted('none', 'api or cli') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'translation.texts.saved', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { ...VIA, count: a.number('none', 'texts sent'), changed: a.number('none', 'texts changed') } }),
  auditRowSignal({ kind: 'translation.texts.removed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { ...VIA, count: a.number('none', 'texts sent'), removed: a.number('none', 'texts removed') } }),
  auditRowSignal({
    kind: 'translation.texts.imported', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...VIA, total: a.number(), new: a.number(), changed: a.number(), unchanged: a.number(), invalid: a.number() },
  }),
];

export default SIGNALS;
