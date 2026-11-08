/**
 * Default security alert rules (docs/phases/38-security/03 3.8): an `observability:alert-source` contribution that turns audit-log windows into
 * alerts, so a tenant is paged for a lockout storm or an impossible-travel login and not only for an error-ratio blip. State-based: it lists what is
 * firing NOW (a rolling window over the audit log); the alert pipeline raises what is listed and resolves what is no longer listed. Routing, grouping,
 * silences and on-call all come from the existing pipeline, so a tenant tunes these like any other alert (silence, route to a channel) instead of getting
 * a second notifier. `AUTH_LOGIN_FAILED` stays a medium-severity row (it is volume); it is the AGGREGATE rule that carries the urgency.
 *
 * Phase 55 00.4: a rule may count only rows of some severities (`severities`). `auth.login_anomaly` is now written for every unusual sign-in,
 * a new address alone included (low); its rule counts the high rows only (impossible travel, Tor, a deny), which is what its title says.
 * New rules: a burst of permission refusals, a country change inside a live session, and the security lock (phase 55 00.1).
 */
import 'reflect-metadata';
import { Between, In } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { AuditLog as AuditLogRow } from './entities/audit_log.entity';
import { AuditActions, type AuditSeverity } from './audit_log.enums';

/** The window every rule looks back over. */
export const SECURITY_ALERT_WINDOW_MINUTES = 15;

type Severity = 'INFO' | 'WARNING' | 'MINOR' | 'MAJOR' | 'CRITICAL';
export type SecurityAlertRule = {
  key: string; title: string; severity: Severity; actions: readonly string[]; threshold: number;
  /** Count only rows of these audit severities (all rows when absent). */
  severities?: readonly AuditSeverity[];
};

/** One line per rule: change a threshold here and the diff is the review. */
export const SECURITY_ALERT_RULES: readonly SecurityAlertRule[] = [
  { key: 'failed-login-spike', title: 'Failed sign-ins are spiking across accounts', severity: 'MAJOR', actions: [AuditActions.AUTH_LOGIN_FAILED], threshold: 30 },
  { key: 'lockout-burst', title: 'Several accounts were locked out', severity: 'MAJOR', actions: [AuditActions.AUTH_ACCOUNT_LOCKED], threshold: 5 },
  { key: 'login-anomaly', title: 'A sign-in looked impossible or came through Tor', severity: 'WARNING', actions: [AuditActions.AUTH_LOGIN_ANOMALY], threshold: 1, severities: ['high', 'critical'] },
  { key: 'session-geo-anomaly', title: 'A signed-in session changed country between two requests', severity: 'WARNING', actions: [AuditActions.TENANT_SESSION_GEO_ANOMALY], threshold: 1 },
  { key: 'permission-denied-burst', title: 'Many requests were refused for missing permissions', severity: 'MAJOR', actions: [AuditActions.PERMISSION_DENIED], threshold: 20 },
  { key: 'account-security-locked', title: 'An account was security-locked by an administrator or the firewall', severity: 'MAJOR', actions: [AuditActions.AUTH_ACCOUNT_SECURITY_LOCKED], threshold: 1 },
  { key: 'ip-banned', title: 'An address was banned for repeated authentication failures', severity: 'WARNING', actions: [AuditActions.SECURITY_IP_BANNED], threshold: 1 },
  { key: 'impersonation-started', title: 'An administrator started impersonating a user', severity: 'MAJOR', actions: [AuditActions.IMPERSONATION_STARTED], threshold: 1 },
  { key: 'platform-admin-granted', title: 'A new platform administrator was created', severity: 'CRITICAL', actions: [AuditActions.USER_ADMIN_GRANTED], threshold: 1 },
  { key: 'two-factor-reset', title: 'A support administrator reset a second factor', severity: 'MAJOR', actions: [AuditActions.AUTH_2FA_RESET_ADMIN], threshold: 1 },
  { key: 'audit-chain-broken', title: 'The audit log hash chain failed verification', severity: 'CRITICAL', actions: [AuditActions.CHAIN_BROKEN], threshold: 1 },
];

export interface AlertSourceSpecLike { key: string; title: string; severity?: Severity; labels?: Record<string, string>; annotations?: Record<string, string> }

/** The key a count is kept under: the action, or the action and the severities a rule narrows it to (`auth.login_anomaly@high,critical`). */
export function countKey(action: string, severities?: readonly AuditSeverity[]): string {
  return severities && severities.length > 0 ? `${action}@${[...severities].sort().join(',')}` : action;
}

/** The rules a window of per-action counts trips (keys from `countKey`). Pure. */
export function firingRules(counts: Readonly<Record<string, number>>, rules: readonly SecurityAlertRule[] = SECURITY_ALERT_RULES): AlertSourceSpecLike[] {
  const out: AlertSourceSpecLike[] = [];
  for (const rule of rules) {
    const n = rule.actions.reduce((a, action) => a + (counts[countKey(action, rule.severities)] ?? 0), 0);
    if (n >= rule.threshold) {
      out.push({
        key: rule.key, title: rule.title, severity: rule.severity,
        labels: { category: 'security', rule: rule.key },
        annotations: { count: String(n), threshold: String(rule.threshold), windowMinutes: String(SECURITY_ALERT_WINDOW_MINUTES) },
      });
    }
  }
  return out;
}

const provider = {
  async listFiring(tenantId: string, now: Date = new Date()): Promise<AlertSourceSpecLike[]> {
    const from = new Date(now.getTime() - SECURITY_ALERT_WINDOW_MINUTES * 60_000);
    const wanted = new Map<string, { action: string; severities?: readonly AuditSeverity[] }>();
    for (const r of SECURITY_ALERT_RULES) for (const action of r.actions) wanted.set(countKey(action, r.severities), { action, severities: r.severities });
    const counts: Record<string, number> = {};
    await withTenantRepositoryFor(tenantId, AuditLogRow, async (repo) => {
      // One count per action (and severity filter); each is an index range scan on tenant + createdAt, so a busy tenant never loads rows.
      for (const [key, { action, severities }] of wanted) {
        counts[key] = await repo.count({
          where: { tenantId, action: In([action]), createdAt: Between(from, now), ...(severities?.length ? { severity: In([...severities]) } : {}) },
        });
      }
    });
    return firingRules(counts);
  },
};

export default provider;
