/**
 * organization's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): sites and teams created,
 * changed and deleted, and people added to or removed from a team. A team's members decide what a TEAM record scope lets a person see,
 * so a membership change is weighed like a permission change. The site or team is the row's subject; the actor is the administrator or
 * the system (seeds, jobs). Lists of changed keys never travel, so they are not declared. A Core module: it contributes from its own
 * folder and imports only the contract from common.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const RECORD = { code: a.untrusted('none', 'the site or team code'), name: a.untrusted('none', 'the site or team name') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'organization.site.created', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...RECORD, kind: a.untrusted('none'), isHeadquarters: a.flag() },
  }),
  auditRowSignal({ kind: 'organization.site.updated', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'organization.site.deleted', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: RECORD }),
  auditRowSignal({ kind: 'organization.team.created', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS], metadata: RECORD }),
  auditRowSignal({ kind: 'organization.team.updated', severity: 'low', defaultWeight: 0.03, outcomes: ['info'], actorKinds: [...ACTORS] }),
  auditRowSignal({ kind: 'organization.team.deleted', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { code: RECORD.code } }),
  // a membership widens or narrows what the person's TEAM scope shows
  auditRowSignal({
    kind: 'organization.team.member_added', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { userId: a.untrusted('identifier', 'the person added'), role: a.untrusted('none', 'the role in the team') },
  }),
  auditRowSignal({ kind: 'organization.team.member_removed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { userId: a.untrusted('identifier', 'the person removed') } }),
];

export default SIGNALS;
