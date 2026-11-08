/**
 * user's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the platform role and admin changes,
 * the e-mail and phone changes of phase 55 00.4, the support actions (unlock, second-factor reset) and the forced password change of 00.6;
 * accounts created, merged and erased, and a key shred that reached only the live data (coverage burn-down).
 * Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/** Who changed the address or the number: the person, an administrator, the system or a directory (scim). */
const BY = a.untrusted('none', 'self, admin, system or scim');

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({ kind: 'user.role_changed', severity: 'high', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { from: a.untrusted(), to: a.untrusted() } }),
  auditRowSignal({ kind: 'user.platform_admin_granted', severity: 'critical', defaultWeight: 0.5, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { email: a.untrusted('contact') } }),
  auditRowSignal({ kind: 'user.email_changed', severity: 'high', defaultWeight: 0.45, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { by: BY, verificationReset: a.flag() } }),
  auditRowSignal({ kind: 'user.phone_changed', severity: 'medium', defaultWeight: 0.25, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { by: BY, cleared: a.flag(), added: a.flag() } }),
  auditRowSignal({ kind: 'auth.account_unlocked_by_admin', severity: 'high', defaultWeight: 0.1, outcomes: ['info'], metadata: { wasLocked: a.flag(), failedAttempts: a.number() } }),
  auditRowSignal({
    kind: 'auth.two_factor_reset_by_admin', severity: 'critical', defaultWeight: 0.35, outcomes: ['info'],
    metadata: { emailReverificationRequired: a.flag(), passwordChangeRequired: a.flag() },
  }),
  // Phase 55 00.6: written by the platform's route and by the firewall's action (user_session.force_password_change, source firewall).
  auditRowSignal({
    kind: 'auth.password_change_forced', severity: 'high', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { source: a.untrusted('none', 'admin or firewall'), reason: a.untrusted('content', 'the operator\'s note'), sessionsFlagged: a.number() },
  }),
  auditRowSignal({
    kind: 'auth.password_change_unforced', severity: 'medium', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { source: a.untrusted(), reason: a.untrusted('content'), wasForced: a.flag() },
  }),
  // Coverage burn-down: accounts created, merged and erased, and a key shred that reached only the live data. A merge moves one
  // identity into another and an erasure is the end of a person's data: medium; a new account is routine (a platform admin has its own kind).
  auditRowSignal({ kind: 'user.created', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { userRole: a.untrusted('none', 'the platform role') } }),
  auditRowSignal({ kind: 'user.merged', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user', 'anon'] }),
  auditRowSignal({ kind: 'user.erased', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['user', 'anon'] }),
  // the backups still hold values under the old keys: the erasure is not yet complete (D55-183: this one stays user's)
  auditRowSignal({ kind: 'user.keys_destroyed_live_only', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: ['anon'] }),
];

export default SIGNALS;
