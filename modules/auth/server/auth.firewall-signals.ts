/**
 * auth's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the audit actions auth writes
 * (inventory 2026-11-02 §1, phase 55 00.4 and 00.5), each with the metadata its rows carry and a personal-data class per attribute.
 * Only the contract from common is imported (ADR-0008 §2): ai_firewall reads this through its registry, auth never imports ai_firewall.
 *
 * The kind is the audit action, as the audit intake makes it (`auditRecordToSignal`); a kind is registered once, by the module that owns
 * the action, even when another module writes the same action (auth_sso writes `auth.login` for an SSO sign-in, with the method).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { TALLY_SIGNAL_ATTRS } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';

/** Phase 55 02.6: the lanes a person's auth routes are asked on. */
const PERSON_LANES = ['human-web', 'human-native', 'public-anon', 'unknown'] as const;

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'auth.login', severity: 'low', defaultWeight: 0.05, outcomes: ['info'],
    metadata: { mustChangePassword: a.flag(), passwordExpiresInDays: a.number(), method: a.untrusted('none', 'the sign-in method when another module wrote the row (sso, saml)'), provider: a.untrusted() },
  }),
  auditRowSignal({
    kind: 'auth.login_failed', severity: 'medium', defaultWeight: 0.3, outcomes: ['fail'], actorKinds: ['user', 'ip', 'anon'],
    metadata: {
      reason: a.untrusted('none', 'BAD_PASSWORD, USER_NOT_FOUND, EMAIL_VERIFICATION_REQUIRED, ACCOUNT_SECURITY_LOCKED, ...'),
      email: a.untrusted('contact', 'the address typed for an unknown account (an outsider can type anyone\'s)'),
      method: a.untrusted('none', 'the sign-in method of a refusal outside the password path'),
      provider: a.untrusted(),
    },
  }),
  auditRowSignal({ kind: 'auth.account_disabled', severity: 'high', defaultWeight: 0.4, outcomes: ['deny'], metadata: { reason: a.untrusted('none', 'the account status that refused the sign-in') } }),
  auditRowSignal({ kind: 'auth.register', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { method: a.untrusted(), consent: a.flag(), provider: a.untrusted() } }),
  auditRowSignal({ kind: 'auth.password_changed', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], metadata: { userId: a.untrusted('identifier') } }),
  auditRowSignal({ kind: 'auth.password_reset', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], metadata: { email: a.untrusted('contact') } }),
  auditRowSignal({ kind: 'auth.forgot_password', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user', 'ip', 'anon'], metadata: { email: a.untrusted('contact') } }),
  auditRowSignal({ kind: 'auth.email_verified', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], metadata: { userId: a.untrusted('identifier') } }),
  auditRowSignal({ kind: 'auth.otp_verified', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], metadata: { method: a.untrusted(), action: a.untrusted(), flow: a.untrusted() } }),
  auditRowSignal({
    kind: 'auth.dormant_disabled', severity: 'high', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['anon'],
    metadata: { disabled: a.number(), scanned: a.number(), thresholdDays: a.number(), reason: a.untrusted(), userId: a.untrusted('identifier') },
  }),
  // Phase 55 00.5: wrong second-factor codes (one row per tenant, user and minute), the block they earn and its lift.
  auditRowSignal({
    kind: 'auth.second_factor_failed', severity: 'medium', defaultWeight: 0.35, outcomes: ['fail'],
    metadata: { count: a.number('none', 'wrong codes in the minute'), flow: a.untrusted('none', 'sign_in, step_up, totp_disable, ...'), windowStart: a.untrusted(), windowEnd: a.untrusted() },
  }),
  auditRowSignal({
    kind: 'auth.second_factor_blocked', severity: 'high', defaultWeight: 0.6, outcomes: ['deny'],
    metadata: {
      scope: a.untrusted('none', 'account or session'), userId: a.untrusted('identifier', 'the person, on a session block'), failures: a.number(), offense: a.number(),
      seconds: a.number(), until: a.untrusted(), sessionEnded: a.flag(), lastKind: a.untrusted('none', 'email_otp, sms_otp, totp or recovery_code'), flow: a.untrusted(),
    },
  }),
  auditRowSignal({ kind: 'auth.second_factor_unblocked', severity: 'medium', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['user', 'anon'], metadata: { source: a.untrusted('none', 'admin or firewall') } }),
  auditRowSignal({ kind: 'auth.recovery_code_used', severity: 'high', defaultWeight: 0.5, outcomes: ['info'], metadata: { codesLeft: a.number(), flow: a.untrusted() } }),
  auditRowSignal({
    kind: 'auth.magic_link.requested', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'ip', 'anon'],
    metadata: { ipAddress: a.untrusted('network'), userAgent: a.untrusted('device') },
  }),
  auditRowSignal({ kind: 'auth.magic_link.consumed', severity: 'low', defaultWeight: 0.1, outcomes: ['info'] }),
  // Written by auth's session routes under user_session's name (one session handed to another host, or exchanged for a cookie there).
  auditRowSignal({ kind: 'user_session.exchange', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], metadata: { userId: a.untrusted('identifier'), via: a.untrusted() } }),
  auditRowSignal({ kind: 'user_session.handoff', severity: 'low', defaultWeight: 0.15, outcomes: ['info'], metadata: { userId: a.untrusted('identifier'), targetHost: a.untrusted('none', 'the host the session was handed to') } }),
  auditRowSignal({ kind: 'tenant.self_service_created', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], metadata: { slug: a.untrusted('none', 'the new organization\'s address') } }),
  // Phase 55 02.6: the six routes that wrote no row (auth.firewall-emitters.ts), emitted by auth itself and TALLIED (one signal per tenant,
  // lane, actor and reason every few seconds, with the count). Codes only.
  {
    kind: 'auth.callback_refused', emitted: true, severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], lanes: PERSON_LANES, actorKinds: ['ip', 'anon'],
    attrs: { ...TALLY_SIGNAL_ATTRS, reason: a.text('none', 'invalid_token: an access token that does not verify was offered to be set as a cookie') },
  },
  {
    kind: 'auth.refresh_refused', emitted: true, severity: 'low', defaultWeight: 0.2, outcomes: ['deny'], lanes: PERSON_LANES, actorKinds: ['ip', 'user', 'anon'],
    attrs: {
      ...TALLY_SIGNAL_ATTRS,
      reason: a.text('none', 'reused (a rotated token presented again: every session ended; high, about the person), revoked, expired, not_found, otp_required, invalid'),
      audience: a.text('none', 'web (the cookie refresh) or device (the native app\'s)'),
    },
  },
  {
    kind: 'auth.otp_sent', emitted: true, severity: 'low', defaultWeight: 0.1, outcomes: ['info'], lanes: PERSON_LANES, actorKinds: ['user'],
    attrs: { ...TALLY_SIGNAL_ATTRS, method: a.text('none', 'email or sms'), action: a.text('none', 'authenticate, enable or disable') },
  },
  {
    kind: 'auth.verify_email_sent', emitted: true, severity: 'low', defaultWeight: 0.05, outcomes: ['info'], lanes: PERSON_LANES, actorKinds: ['user'],
    attrs: { ...TALLY_SIGNAL_ATTRS },
  },
  {
    kind: 'auth.totp_setup_started', emitted: true, severity: 'low', defaultWeight: 0.15, outcomes: ['info'], lanes: PERSON_LANES, actorKinds: ['user'],
    attrs: { ...TALLY_SIGNAL_ATTRS },
  },
  // Phase 55 02.6 sign-up protection: a sign-up the hard block refused (auth.signup_block, only where the tenant opted in), tallied.
  {
    kind: 'auth.signup_blocked', emitted: true, severity: 'medium', defaultWeight: 0.3, outcomes: ['deny'], lanes: PERSON_LANES, actorKinds: ['ip', 'anon'],
    attrs: { ...TALLY_SIGNAL_ATTRS, reason: a.text('none', 'hard_block') },
  },
];

export default SIGNALS;
