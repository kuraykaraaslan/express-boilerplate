/**
 * user_security's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the guessing lock and its
 * lift (inventory §1), the security lock of phase 55 00.1, second factors added and removed (00.4) and trusted devices (00.6). Only the
 * contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'auth.account_locked', severity: 'high', defaultWeight: 0.45, outcomes: ['deny'],
    metadata: { failedAttempts: a.number(), lockedUntil: a.untrusted(), ip: a.untrusted('network'), reason: a.untrusted() },
  }),
  auditRowSignal({ kind: 'auth.account_unlocked', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], metadata: { via: a.untrusted('none', 'successful_login') } }),
  auditRowSignal({
    kind: 'auth.account_security_locked', severity: 'critical', defaultWeight: 0.2, outcomes: ['deny'], actorKinds: ['user', 'anon'],
    metadata: { reason: a.untrusted('content', 'the operator\'s note'), source: a.untrusted('none', 'admin or firewall'), until: a.untrusted(), sessionsEnded: a.flag(), relocked: a.flag() },
  }),
  auditRowSignal({
    kind: 'auth.account_security_unlocked', severity: 'high', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { wasLocked: a.flag(), source: a.untrusted(), reason: a.untrusted('content'), lockedAt: a.untrusted(), lockSource: a.untrusted(), lockedBy: a.untrusted('identifier') },
  }),
  auditRowSignal({
    kind: 'security.mfa_enabled', severity: 'medium', defaultWeight: 0.1, outcomes: ['info'],
    metadata: { enabled: a.flag(), method: a.untrusted('none', 'TOTP_APP, EMAIL, SMS'), by: a.untrusted('none', 'admin, when an administrator acted'), mfaLeft: a.flag() },
  }),
  auditRowSignal({
    kind: 'security.mfa_disabled', severity: 'high', defaultWeight: 0.45, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { enabled: a.flag(), method: a.untrusted('none', 'TOTP_APP, EMAIL, SMS or ALL'), by: a.untrusted(), mfaLeft: a.flag() },
  }),
  auditRowSignal({ kind: 'security.trusted_device_added', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { label: a.untrusted('device'), expiresAt: a.untrusted() } }),
  auditRowSignal({
    kind: 'security.trusted_device_removed', severity: 'low', defaultWeight: 0.05, outcomes: ['info'],
    metadata: { by: a.untrusted(), deviceId: a.untrusted('device'), count: a.number(), reason: a.untrusted('content') },
  }),
  auditRowSignal({
    kind: 'security.trusted_device_revoked_by_admin', severity: 'high', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { by: a.untrusted('none', 'admin or firewall'), deviceId: a.untrusted('device'), count: a.number(), reason: a.untrusted('content') },
  }),
];

export default SIGNALS;
