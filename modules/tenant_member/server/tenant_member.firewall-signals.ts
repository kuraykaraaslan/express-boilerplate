/**
 * tenant_member's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): a membership suspended or
 * lifted (inventory §1, severity reviewed in phase 55 00.4), removed, the workspace's ownership moved, its canary record asked for (02.5), or a
 * new membership held for review and released (02.6); memberships added and changed, custom groups created, changed and deleted, and
 * the permission matrix saved (coverage burn-down).
 * Only the contract from common is
 * imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const MEMBER = { userId: a.untrusted('identifier', 'the member\'s person') };
const TENANT = { tenantId: a.untrusted('none', 'the workspace') };
const STATE = { ...TENANT, memberRole: a.untrusted(), memberStatus: a.untrusted() };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'tenant_member.suspended', severity: 'high', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { ...MEMBER, reason: a.untrusted('content', 'the reason the suspending administrator gave'), until: a.untrusted() },
  }),
  auditRowSignal({ kind: 'tenant_member.reactivated', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: MEMBER }),
  auditRowSignal({ kind: 'tenant_member.deleted', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...MEMBER, memberRole: a.untrusted() } }),
  auditRowSignal({
    kind: 'tenant_member.ownership_transferred', severity: 'low', defaultWeight: 0.3, outcomes: ['info'],
    metadata: { toUserId: a.untrusted('identifier', 'the new owner'), demotedTo: a.untrusted('none', 'the role the previous owners got') },
  }),
  // Phase 55 02.6 sign-up protection: a new membership held for an administrator's review (tenant_member.signup_review) and released.
  auditRowSignal({ kind: 'tenant_member.review_held', severity: 'medium', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['anon'], metadata: { ...MEMBER, source: a.untrusted('none', 'firewall') } }),
  auditRowSignal({ kind: 'tenant_member.review_released', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['anon'], metadata: { ...MEMBER, source: a.untrusted('none', 'firewall') } }),
  // Coverage burn-down: memberships added and changed, and the workspace's custom groups and permission matrix. Memberships, roles and
  // permissions are access itself: medium; the matrix, which can widen every group at once, the most.
  auditRowSignal({ kind: 'tenant_member.created', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...MEMBER, ...STATE } }),
  auditRowSignal({ kind: 'tenant_member.updated', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...MEMBER, ...STATE } }),
  auditRowSignal({ kind: 'tenant_role.matrix_saved', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...TENANT, changeCount: a.number('none', 'grants changed') } }),
  auditRowSignal({ kind: 'tenant_role.created', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...TENANT, label: a.untrusted('none', 'the group\'s name') } }),
  auditRowSignal({ kind: 'tenant_role.updated', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: TENANT }),
  auditRowSignal({ kind: 'tenant_role.deleted', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { ...TENANT, unassignedMembers: a.number('none', 'members the group was taken off') } }),
  // Phase 55 02.5: the canary member record was asked for (tenant_member.decoy.ts). Emitted by this module, not an audit row; never a
  // page's doing, so critical and a high-precision label for 03.
  {
    kind: 'tenant_member.decoy_record_touched', emitted: true, severity: 'critical', defaultWeight: 1, outcomes: ['deny'],
    lanes: ['human-web', 'human-native', 'machine-apikey', 'unknown'], actorKinds: ['user', 'apiKey', 'anon'],
    attrs: { method: a.text('none', 'GET, PUT or DELETE') },
  },
];

export default SIGNALS;
