import { z } from 'zod';

// API_KEY: actions performed by a machine credential (programmatic access),
// e.g. failed key verification or usage anomalies.
// SERVICE: an act of the platform's own machinery on behalf of a verified instruction, such as a fleet command
// execution (carries commandJti and nodeId on sealed rows). SYSTEM stays "no actor at all".
export const AuditActorTypeEnum = z.enum(['USER', 'SYSTEM', 'API_KEY', 'SERVICE']);
export type AuditActorType = z.infer<typeof AuditActorTypeEnum>;

// Severity / risk classification for an audit action. Used to rank events for
// triage, drive the high-risk webhook (audit.high_risk), and allow severity
// filtering in getAll. Ordered low → critical.
export const AuditSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type AuditSeverity = z.infer<typeof AuditSeverityEnum>;

// Severities considered "high-risk" — these fire the real-time webhook.
export const HIGH_RISK_SEVERITIES: readonly AuditSeverity[] = ['high', 'critical'] as const;

// Predefined action constants — extend freely per domain
export const AuditActions = {
  // Auth
  AUTH_LOGIN:            'auth.login',
  AUTH_LOGIN_FAILED:     'auth.login_failed',
  AUTH_LOGOUT:           'auth.logout',
  AUTH_REGISTER:         'auth.register',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  AUTH_PASSWORD_RESET:   'auth.password_reset',
  AUTH_OTP_VERIFIED:     'auth.otp_verified',
  // Phase 55 00.4: `auth.totp_enabled` / `auth.totp_disabled` were defined and never written. They are removed, not emitted: a second
  // factor added or removed is ONE fact, written once as `security.mfa_enabled` / `security.mfa_disabled` (below) with the factor in
  // `metadata.method` (TOTP_APP, EMAIL, SMS), by user_security's emitMfaChanged, for every kind of factor.
  AUTH_ACCOUNT_LOCKED:   'auth.account_locked',
  AUTH_ACCOUNT_DISABLED: 'auth.account_disabled',
  AUTH_FORGOT_PASSWORD:  'auth.forgot_password',
  AUTH_EMAIL_VERIFIED:   'auth.email_verified',
  AUTH_DORMANT_DISABLED: 'auth.dormant_disabled',
  AUTH_ACCOUNT_UNLOCKED_ADMIN: 'auth.account_unlocked_by_admin',
  AUTH_2FA_RESET_ADMIN:  'auth.two_factor_reset_by_admin',
  // Phase 55 00.1: the security lock (an admin or the firewall), separate from the guessing lock above; it refuses every sign-in method.
  AUTH_ACCOUNT_SECURITY_LOCKED:   'auth.account_security_locked',
  AUTH_ACCOUNT_SECURITY_UNLOCKED: 'auth.account_security_unlocked',
  // Phase 55 00.6: the admin actuators (an administrator acts on another person's sessions, trusted devices or password).
  USER_SESSIONS_REVOKED_ADMIN:    'user_session.revoked_by_admin',
  USER_SESSION_STEP_UP_FORCED:    'user_session.step_up_forced',
  USER_SESSION_STEP_UP_CLEARED:   'user_session.step_up_cleared',
  TRUSTED_DEVICE_REVOKED_ADMIN:   'security.trusted_device_revoked_by_admin',
  TRUSTED_DEVICE_REMOVED:         'security.trusted_device_removed',
  AUTH_PASSWORD_CHANGE_FORCED:    'auth.password_change_forced',
  AUTH_PASSWORD_CHANGE_UNFORCED:  'auth.password_change_unforced',
  // Phase 55 00.5: wrong second-factor codes (one aggregated row per tenant, user and minute), the per-user block they earn, and its lift;
  // API keys refused again and again are throttled per credential (never per address, 38 L-4).
  AUTH_SECOND_FACTOR_FAILED:      'auth.second_factor_failed',
  AUTH_SECOND_FACTOR_BLOCKED:     'auth.second_factor_blocked',
  AUTH_SECOND_FACTOR_UNBLOCKED:   'auth.second_factor_unblocked',
  API_KEY_THROTTLED:              'api_key.throttled',
  API_KEY_THROTTLE_CLEARED:       'api_key.throttle_cleared',
  USER_ADMIN_GRANTED:    'user.platform_admin_granted',
  USER_ROLE_CHANGED:     'user.role_changed',
  GLOBAL_ADMIN_ACCESS:   'security.global_admin_access',
  // Phase 55 00.4: the ONE login-anomaly action (user_session reportLoginAnomaly). Its rows carry the severity their reasons earn
  // (low for a new address or device alone, medium for a new country / proxy / VPN, high for impossible travel, Tor or a deny); the
  // map entry below is the default for a row written without one.
  AUTH_LOGIN_ANOMALY:    'auth.login_anomaly',
  // Phase 55 00.4: the signals the inventory found missing. A second factor added or removed (also the webhooks of the same name), a
  // recovery code standing in for the second factor, and the account's e-mail address or phone number changed.
  SECURITY_MFA_ENABLED:  'security.mfa_enabled',
  SECURITY_MFA_DISABLED: 'security.mfa_disabled',
  AUTH_RECOVERY_CODE_USED: 'auth.recovery_code_used',
  USER_EMAIL_CHANGED:    'user.email_changed',
  USER_PHONE_CHANGED:    'user.phone_changed',
  // Phase 55 00.4: actions other modules write as literals, named here so their severity is reviewed in one place (they all defaulted
  // to `low`, so none reached audit.high_risk or an alert rule) and the alert rules can name them.
  SAML_LOGIN_FAILED:     'saml.login_failed',
  ACS_LOGIN_FAILED:      'acs.login_failed',
  API_KEY_VERIFY_FAILED: 'api_key.verify.failed',
  API_KEY_ANOMALY_DETECTED: 'api_key.anomaly.detected',
  TENANT_MEMBER_SUSPENDED: 'tenant_member.suspended',
  TENANT_SESSION_GEO_ANOMALY: 'tenant.session.geo_anomaly',
  SECURITY_IP_BANNED:    'security.ip_banned',
  SECURITY_IP_UNBANNED:  'security.ip_unbanned',
  // phase 55 00 §0.2: a repeat offender's automatic ban promoted to the longest one, with an end (limiter.ban-promotion.ts)
  SECURITY_IP_BAN_PROMOTED: 'security.ip_ban_promoted',
  // phase 55 00 §0.3 (P-3): the refusals that used to answer without a row. Each is reported through common/server/refusal-sink.ts and written
  // aggregated, one row per (action, tenant, address or credential, minute) with `metadata.count` (audit_log.refusals.ts).
  SECURITY_CSRF_REFUSED:        'security.csrf_refused',
  SECURITY_TENANT_IP_DENIED:    'security.tenant_ip_denied',
  SECURITY_AUTH_CIRCUIT_OPEN:   'security.auth_circuit_open',
  SECURITY_INBOUND_SIGNATURE_INVALID: 'security.inbound_signature_invalid',
  FLEET_AGENT_AUTH_FAILED:      'fleet.agent_auth_failed',
  PLUGIN_SANDBOX_VIOLATION:     'plugin.sandbox_violation',
  // phase 55 00 §0.7 (P-7): a local CrowdSec decision at the node's edge, read back by the edge ban sync (limiter.edge-sync.ts), aggregated
  // per address and minute like the refusals above. ROOT rows: the edge belongs to the installation, not to a tenant.
  EDGE_DECISION:                'edge.decision',

  // Tenant
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_DELETED: 'tenant.deleted',

  // Members
  MEMBER_ADDED:   'member.added',
  MEMBER_UPDATED: 'member.updated',
  MEMBER_REMOVED: 'member.removed',

  // Invitations
  INVITATION_SENT:     'invitation.sent',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_DECLINED: 'invitation.declined',
  INVITATION_REVOKED:  'invitation.revoked',

  // Domains
  DOMAIN_ADDED:           'domain.added',
  DOMAIN_VERIFIED:        'domain.verified',
  DOMAIN_DELETED:         'domain.deleted',
  DOMAIN_DNS_CHECK_FAILED: 'domain.dns_check_failed',

  // Subscription
  SUBSCRIPTION_ASSIGNED:  'subscription.assigned',
  SUBSCRIPTION_UPDATED:   'subscription.updated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',

  // Settings
  SETTINGS_UPDATED: 'settings.updated',

  // Users (system admin)
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',

  // Storage
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED:  'file.deleted',
  // phase 55 00 §0.3: the virus scanner found malware in an upload (refused in sync mode, quarantined or deleted in async mode)
  FILE_INFECTED: 'file.infected',

  // Impersonation
  IMPERSONATION_STARTED: 'impersonation.started',
  IMPERSONATION_ENDED:   'impersonation.ended',
  // Phase 55 00.6: an administrator ended every running impersonation at once (one row; each session also writes its own ended row).
  IMPERSONATION_ENDED_ALL: 'impersonation.ended_all',

  // Access control
  PERMISSION_DENIED:   'permission.denied',
  // Phase 55 00.4: `auth.session_invalidated` was defined and never written. Removed: every way a session ends is already written as
  // `user_session.revoked` (with its cause), `user_session.revoked_others`, `user_session.revoked_by_admin` or, for a sign-out,
  // `auth.logout`; a second name for the same end would split the counts.

  // Chain integrity
  CHAIN_BROKEN: 'audit.chain_broken',
  CHAIN_PURGED: 'audit.purged',
} as const;

export type AuditAction = typeof AuditActions[keyof typeof AuditActions];

// Per-action severity map. Actions not listed here default to `low` (see
// severityForAction). The map is intentionally explicit for security-relevant
// actions so triage and high-risk alerting stay deterministic.
export const ACTION_SEVERITY: Readonly<Record<string, AuditSeverity>> = {
  [AuditActions.AUTH_LOGIN]:            'low',
  [AuditActions.AUTH_LOGOUT]:           'low',
  [AuditActions.AUTH_REGISTER]:         'low',
  [AuditActions.AUTH_EMAIL_VERIFIED]:   'low',
  [AuditActions.AUTH_OTP_VERIFIED]:     'low',

  [AuditActions.AUTH_LOGIN_FAILED]:     'medium',
  [AuditActions.AUTH_PASSWORD_CHANGED]: 'medium',
  [AuditActions.AUTH_PASSWORD_RESET]:   'medium',
  [AuditActions.AUTH_FORGOT_PASSWORD]:  'medium',
  [AuditActions.SECURITY_MFA_ENABLED]:  'medium',
  [AuditActions.SETTINGS_UPDATED]:      'medium',
  [AuditActions.MEMBER_ADDED]:          'medium',
  [AuditActions.MEMBER_UPDATED]:        'medium',
  [AuditActions.MEMBER_REMOVED]:        'medium',
  [AuditActions.SUBSCRIPTION_UPDATED]:  'medium',
  [AuditActions.SUBSCRIPTION_CANCELLED]:'medium',

  [AuditActions.AUTH_ACCOUNT_LOCKED]:   'high',
  [AuditActions.AUTH_ACCOUNT_DISABLED]: 'high',
  [AuditActions.AUTH_DORMANT_DISABLED]: 'high',
  [AuditActions.AUTH_ACCOUNT_UNLOCKED_ADMIN]: 'high',
  [AuditActions.AUTH_2FA_RESET_ADMIN]:  'critical',
  [AuditActions.AUTH_ACCOUNT_SECURITY_LOCKED]:   'critical',
  [AuditActions.AUTH_ACCOUNT_SECURITY_UNLOCKED]: 'high',
  [AuditActions.USER_SESSIONS_REVOKED_ADMIN]:    'high',
  [AuditActions.USER_SESSION_STEP_UP_FORCED]:    'high',
  [AuditActions.USER_SESSION_STEP_UP_CLEARED]:   'medium',
  [AuditActions.TRUSTED_DEVICE_REVOKED_ADMIN]:   'high',
  [AuditActions.TRUSTED_DEVICE_REMOVED]:         'low',
  [AuditActions.AUTH_PASSWORD_CHANGE_FORCED]:    'high',
  [AuditActions.AUTH_PASSWORD_CHANGE_UNFORCED]:  'medium',
  [AuditActions.AUTH_SECOND_FACTOR_FAILED]:      'medium',
  [AuditActions.AUTH_SECOND_FACTOR_BLOCKED]:     'high',
  [AuditActions.AUTH_SECOND_FACTOR_UNBLOCKED]:   'medium',
  [AuditActions.API_KEY_THROTTLED]:              'high',
  [AuditActions.API_KEY_THROTTLE_CLEARED]:       'medium',
  [AuditActions.USER_ADMIN_GRANTED]:    'critical',
  [AuditActions.USER_ROLE_CHANGED]:     'high',
  [AuditActions.GLOBAL_ADMIN_ACCESS]:   'medium',
  [AuditActions.AUTH_LOGIN_ANOMALY]:    'high',
  // Phase 55 00.4, reviewed per row. A factor removed, a recovery code used and a changed e-mail address are the classic steps of an
  // account takeover (the address is where every reset goes), so high. A new phone number is medium: on its own it moves no reset.
  [AuditActions.SECURITY_MFA_DISABLED]: 'high',
  [AuditActions.AUTH_RECOVERY_CODE_USED]: 'high',
  [AuditActions.USER_EMAIL_CHANGED]:    'high',
  [AuditActions.USER_PHONE_CHANGED]:    'medium',
  // A failed SAML / national-ID sign-in is a failed sign-in, rated like auth.login_failed (medium: volume; the aggregate alert rule
  // carries the urgency). A refused API key is volume too (medium); its per-key throttle (`api_key.throttled`, high) is the urgent
  // row. A dormant key used from a new address is high (rare: once per key, address and hour). Suspending a member cuts a person's
  // access, rated like auth.account_disabled. A country change inside a live session was written high explicitly; now the map says so.
  [AuditActions.SAML_LOGIN_FAILED]:     'medium',
  [AuditActions.ACS_LOGIN_FAILED]:      'medium',
  [AuditActions.API_KEY_VERIFY_FAILED]: 'medium',
  [AuditActions.API_KEY_ANOMALY_DETECTED]: 'high',
  [AuditActions.TENANT_MEMBER_SUSPENDED]: 'high',
  [AuditActions.TENANT_SESSION_GEO_ANOMALY]: 'high',
  [AuditActions.SECURITY_IP_BANNED]:    'high',
  [AuditActions.SECURITY_IP_UNBANNED]:  'high',
  [AuditActions.SECURITY_IP_BAN_PROMOTED]: 'high',
  // phase 55 00 §0.3: a CSRF or tenant-list refusal is as often a stale tab or a travelling member as an attack (medium); a tripped breaker, a
  // forged provider call, a node that cannot prove itself and a plugin stopped at a bound are what an operator looks at first (high).
  [AuditActions.SECURITY_CSRF_REFUSED]:        'medium',
  [AuditActions.SECURITY_TENANT_IP_DENIED]:    'medium',
  [AuditActions.SECURITY_AUTH_CIRCUIT_OPEN]:   'high',
  [AuditActions.SECURITY_INBOUND_SIGNATURE_INVALID]: 'high',
  [AuditActions.FLEET_AGENT_AUTH_FAILED]:      'high',
  [AuditActions.PLUGIN_SANDBOX_VIOLATION]:     'high',
  // phase 55 00 §0.7: the edge already acted on its own scenarios; the row is evidence for the firewall and the operator, not an alarm
  [AuditActions.EDGE_DECISION]:                'medium',
  [AuditActions.FILE_INFECTED]:                'critical',
  [AuditActions.PERMISSION_DENIED]:     'high',
  [AuditActions.TENANT_DELETED]:        'high',
  [AuditActions.USER_DELETED]:          'high',
  [AuditActions.DOMAIN_DNS_CHECK_FAILED]: 'high',

  [AuditActions.CHAIN_BROKEN]:          'critical',
  [AuditActions.CHAIN_PURGED]:          'medium',
  [AuditActions.IMPERSONATION_STARTED]: 'critical',
  [AuditActions.IMPERSONATION_ENDED]:   'critical',
  [AuditActions.IMPERSONATION_ENDED_ALL]: 'critical',
} as const;

/**
 * Resolve the severity for an action string. Unknown / custom actions default
 * to `low` so an unmapped action never accidentally pages a security team.
 */
export function severityForAction(action: string): AuditSeverity {
  return ACTION_SEVERITY[action] ?? 'low';
}
