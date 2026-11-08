/**
 * shell_menu's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the platform menu's draft
 * discarded, the draft published as a revision, an earlier revision restored, a menu file imported into the draft or published. The
 * draft or revision is the row's subject; no person is in the metadata (counts, revision numbers, the target, ui or cli). The actor is
 * the platform operator in the editor, or the operator's command line with no user. The published menu is every tenant's navigation and
 * the permissions its items name: platform control, medium; discarding a draft changes nothing anyone sees. Arrays (the languages of an
 * import) never travel on a signal and are not declared. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const VIA = { via: a.untrusted('none', 'ui or cli') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'shell_menu.draft.discarded', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: [...ACTORS], metadata: VIA }),
  auditRowSignal({
    kind: 'shell_menu.published', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...VIA, written: a.number('none', 'label texts written'), removed: a.number('none', 'label texts removed'), warnings: a.number() },
  }),
  auditRowSignal({ kind: 'shell_menu.restored', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { ...VIA, from: a.number('none', 'the revision restored') } }),
  auditRowSignal({
    kind: 'shell_menu.imported', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...VIA, target: a.untrusted('none', 'draft or publish'), keys: a.number(), texts: a.number() },
  }),
];

export default SIGNALS;
