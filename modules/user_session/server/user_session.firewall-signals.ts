/**
 * user_session's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): every sign-in, sign-out and
 * session end it audits, the one login-anomaly assessment (phase 55 00.4) and the admin actuators on another person's sessions (00.6).
 * Only the contract from common is imported (ADR-0008 §2). Phase 55 02 §2.3 adds `user_session.refresh_reused` (refresh-token reuse).
 *
 * `user_session.login` is written by createSession, which every sign-in method goes through (password, passkey, SSO, SAML, national ID,
 * e-signature, magic link, Fleet ID): it is the outcome kind of every sign-in route, whichever module owns the route.
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/** What every lifecycle row of a session carries (`auditLifecycle`: the session's owner in `metadata.userId`). */
const LIFECYCLE = { userId: a.untrusted('identifier', 'the session\'s owner') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'user_session.login', severity: 'low', defaultWeight: 0.05, outcomes: ['info'],
    metadata: { ...LIFECYCLE, ipAddress: a.untrusted('network'), userAgent: a.untrusted('device') },
  }),
  auditRowSignal({ kind: 'auth.logout', severity: 'low', defaultWeight: 0.02, outcomes: ['info'], metadata: LIFECYCLE }),
  auditRowSignal({
    kind: 'user_session.revoked', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { ...LIFECYCLE, cause: a.untrusted('none', 'why the session ended: cap, idle, password_changed, fleet_id_backchannel_logout, ...') },
  }),
  auditRowSignal({ kind: 'user_session.revoked_others', severity: 'low', defaultWeight: 0.15, outcomes: ['info'], metadata: { ...LIFECYCLE, keptSessionId: a.untrusted('identifier'), count: a.number() } }),
  auditRowSignal({ kind: 'user_session.revoked_all', severity: 'low', defaultWeight: 0.15, outcomes: ['info'], metadata: LIFECYCLE }),
  auditRowSignal({
    kind: 'auth.login_anomaly', severity: 'high', defaultWeight: 0.5, outcomes: ['info', 'deny'],
    metadata: {
      ...LIFECYCLE,
      severity: a.untrusted('none', 'low for a new address or device alone, medium for a new country or a proxy, high for impossible travel, Tor or a deny'),
      stepUp: a.flag(), stepUpMethod: a.untrusted(), stepUpWanted: a.flag(), denied: a.flag(), trustedDevice: a.flag(), audience: a.untrusted(),
      ipAddress: a.untrusted('network'), previousIp: a.untrusted('network'), device: a.untrusted('device', 'browser, OS and form factor, never the version'),
      country: a.untrusted('location'),
    },
  }),
  // Phase 55 00.6: an administrator (or, with source firewall, the firewall) acted on another person's sessions.
  auditRowSignal({
    kind: 'user_session.revoked_by_admin', severity: 'high', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { source: a.untrusted('none', 'admin or firewall'), reason: a.untrusted('content', 'the operator\'s note'), scope: a.untrusted('none', 'all, tenant or session'), count: a.number(), sessionTenantId: a.untrusted() },
  }),
  auditRowSignal({
    kind: 'user_session.step_up_forced', severity: 'high', defaultWeight: 0.1, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { source: a.untrusted(), reason: a.untrusted('content'), userSessionId: a.untrusted('identifier'), sessionTenantId: a.untrusted() },
  }),
  // Phase 55 02 §2.3: a refresh token presented again after its rotation (outside the grace window): every session of the person
  // was ended; emitted directly (emitSecuritySignal, not an audit row), ids only. The session-hijack detector's strongest evidence.
  {
    kind: 'user_session.refresh_reused', severity: 'high', defaultWeight: 0.6, outcomes: ['deny'], lanes: ['human-web', 'human-native'], actorKinds: ['user'],
    attrs: { revoked: a.number('none', 'sessions of the person ended with it') },
  },
  auditRowSignal({
    kind: 'user_session.step_up_cleared', severity: 'medium', defaultWeight: 0.02, outcomes: ['info'], actorKinds: ['user', 'anon'],
    metadata: { source: a.untrusted(), reason: a.untrusted('content'), userSessionId: a.untrusted('identifier'), cause: a.untrusted('none', 'admin or step_up'), sessionTenantId: a.untrusted() },
  }),
];

export default SIGNALS;
