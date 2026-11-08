import 'reflect-metadata';
import { createHash } from 'crypto';
import { In } from 'typeorm';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import type { WebhookEvent } from '@kuraykaraaslan-labs/webhook/server/webhook.enums';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import type { DomainStatus } from './tenant_domain.enums';
import { absoluteTenantUrl } from './tenant_domain.url';

/**
 * Side-effect fan-out for tenant-domain lifecycle transitions: per-tenant audit
 * trail, outbound webhooks, and admin email. Kept in its own collaborator (and
 * always reached via a dynamic `import()` from the CRUD / DNS / SSL services) so
 * the BullMQ-backed mail queue is only loaded when a transition actually fires —
 * not at every import of the domain services.
 *
 * All methods are best-effort and never throw: a lifecycle notification must
 * never roll back or 500 the domain mutation that triggered it.
 */

/** Domain-status → outbound webhook event. New event names registered centrally. */
const WEBHOOK_EVENT_BY_STATUS: Partial<Record<DomainStatus, string>> = {
  VERIFIED: 'tenant_domain.verified',
  ACTIVE: 'tenant_domain.activated',
  DNS_FAILED: 'tenant_domain.dns_failed',
  SUSPENDED: 'tenant_domain.suspended',
};

export default class TenantDomainNotificationsService {

  /**
   * Active OWNER/ADMIN member emails for a tenant — the humans who can act on a
   * domain problem. Mirrors the payment-dunning recipient resolution: member
   * rows live in the tenant DB, the email lives on the system-DB user row.
   */
  private static async resolveRecipients(tenantId: string): Promise<Array<{ userId: string; email: string }>> {
    const members = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.find({
      where: { tenantId, memberStatus: 'ACTIVE', memberRole: In(['OWNER', 'ADMIN']) },
    }));
    if (members.length === 0) return [];

    const sysDs = await getDataSource();
    const userRepo = sysDs.getRepository(UserEntity);
    // The userId travels with the address: the dispatcher can only read a
    // person's preferences and reach their in-app inbox if it knows who they
    // are, and this resolution already held the id.
    const out = new Map<string, { userId: string; email: string }>();
    for (const member of members) {
      const user = await userRepo.findOne({ where: { userId: member.userId } });
      if (user?.email) out.set(user.email, { userId: member.userId, email: user.email });
    }
    return [...out.values()];
  }

  /**
   * One admin notice, through the dispatcher (PLAT-01).
   *
   * All of these are NORMAL. A domain failing verification or a certificate
   * nearing expiry is operational: it wants attention, but an admin who muted
   * their mail has a domains screen showing the same state, and CRITICAL is
   * reserved for notices a preference must never be able to silence.
   */
  private static async notifyAdmins(
    tenantId: string,
    recipients: Array<{ userId: string; email: string }>,
    event: string,
    subject: string,
    html: string,
    idempotencyKey: (email: string) => string,
  ): Promise<void> {
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    for (const to of recipients) {
      await NotificationService.notify(
        tenantId,
        { userId: to.userId, email: to.email },
        { event, category: 'workspace', title: subject, body: subject, data: { html } },
        { idempotencyKey: idempotencyKey(to.email) },
      );
    }
  }

  /** Fire a lifecycle webhook for a status (no-op when the status has no event), or the explicitly named event. */
  private static async dispatchDomainWebhook(
    tenantId: string,
    status: DomainStatus,
    payload: Record<string, unknown>,
    override?: string,
  ): Promise<void> {
    const event = override ?? WEBHOOK_EVENT_BY_STATUS[status];
    if (!event) return;
    await WebhookService.dispatchEvent(tenantId, event as WebhookEvent, payload).catch((e) =>
      Logger.warn(`[tenant_domain] webhook ${event} failed: ${e instanceof Error ? e.message : e}`),
    );
  }

  /**
   * Record a domain status transition to the per-tenant audit log and, when the
   * new status maps to one, emit the matching lifecycle webhook. Used by the
   * verify flow (→VERIFIED) and the generic update flow (→ACTIVE / INACTIVE …).
   */
  static async recordStatusTransition(input: {
    tenantId: string;
    tenantDomainId: string;
    domain: string;
    toStatus: DomainStatus;
    fromStatus?: DomainStatus;
    /** The webhook to emit instead of the status's own (a plan reactivation is `tenant_domain.reactivated`). */
    webhookEvent?: string;
  }): Promise<void> {
    const { tenantId, tenantDomainId, domain, toStatus, fromStatus, webhookEvent } = input;
    try {
      await AuditLogService.log({
        tenantId,
        actorType: 'SYSTEM',
        action: 'domain.status_changed',
        resourceType: 'tenant_domain',
        resourceId: tenantDomainId,
        metadata: { domain, from: fromStatus ?? null, to: toStatus },
      });
      await TenantDomainNotificationsService.dispatchDomainWebhook(tenantId, toStatus, {
        tenantDomainId,
        domain,
        from: fromStatus ?? null,
        to: toStatus,
        occurredAt: new Date().toISOString(),
      }, webhookEvent);
    } catch (e) {
      Logger.warn(`[tenant_domain] status-transition notify failed for ${domain}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * A previously-ACTIVE domain lost its DNS proof and was downgraded to
   * DNS_FAILED by the recheck cron. Emit the `tenant_domain.dns_failed` webhook
   * and email the tenant's admins a re-verification prompt. (The audit entry is
   * written inline at the downgrade site.)
   */
  static async notifyDnsFailure(input: {
    tenantId: string;
    tenantDomainId: string;
    domain: string;
  }): Promise<void> {
    const { tenantId, tenantDomainId, domain } = input;
    try {
      await TenantDomainNotificationsService.dispatchDomainWebhook(tenantId, 'DNS_FAILED', {
        tenantDomainId,
        domain,
        occurredAt: new Date().toISOString(),
      });

      const recipients = await TenantDomainNotificationsService.resolveRecipients(tenantId);
      if (recipients.length === 0) {
        Logger.warn(`[tenant_domain] DNS_FAILED for ${domain} — no active admin to notify (tenant ${tenantId})`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(tenantId, `/admin/domains/${tenantDomainId}`);
      const subject = `Action required: DNS verification failed for ${domain}`;
      // The stored name reaches an admin's mailbox: escaped, whatever the create path let through.
      const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
      const d = esc(domain);
      const html =
        `<p>The custom domain <strong>${d}</strong> can no longer be resolved and has been ` +
        `marked <strong>DNS&nbsp;FAILED</strong>. Traffic to this domain will not be served until it is ` +
        `re-verified.</p>` +
        `<p>Please confirm the DNS records still point at us, then re-run verification:</p>` +
        `<p><a href="${esc(manageUrl)}">Re-verify ${d}</a></p>`;
      const today = new Date().toISOString().slice(0, 10);
      await TenantDomainNotificationsService.notifyAdmins(
        tenantId, recipients, 'tenant_domain.dns_failed', subject, html,
        (email) => `tenant_domain:dns_failed:${tenantDomainId}:${email}:${today}`,
      );
    } catch (e) {
      Logger.warn(`[tenant_domain] DNS_FAILED notify failed for ${domain}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * The plan stopped including some of the tenant's custom domains and the reconcile suspended them
   * (tenant_domain.reconcile). Told ONCE: the reconcile calls this only for domains it just moved into SUSPENDED, and
   * the idempotency key names that exact set, so a retried or concurrent run sends nothing twice. The mail says the
   * domains are kept, where the site serves now (the free subdomain) and that they come back on their own.
   */
  static async notifyDomainsSuspended(input: {
    tenantId: string;
    domains: Array<{ tenantDomainId: string; domain: string }>;
    reason: 'not_in_plan' | 'over_limit';
    fallbackDomain: string | null;
  }): Promise<void> {
    const { tenantId, domains, reason, fallbackDomain } = input;
    if (domains.length === 0) return;
    try {
      const recipients = await TenantDomainNotificationsService.resolveRecipients(tenantId);
      if (recipients.length === 0) {
        Logger.warn(`[tenant_domain] ${domains.length} domain(s) suspended for ${tenantId} — no active admin to notify`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(tenantId, '/admin/domains');
      const names = domains.map((d) => d.domain);
      const why = reason === 'not_in_plan'
        ? 'Your current plan does not include custom domains.'
        : 'Your current plan includes fewer custom domains than this organization has.';
      const subject = names.length === 1
        ? `Custom domain ${names[0]} is paused`
        : `${names.length} custom domains are paused`;
      const list = names.map((n) => `<li><strong>${n}</strong></li>`).join('');
      const html =
        `<p>${why} These domains were paused, not removed:</p><ul>${list}</ul>` +
        (fallbackDomain ? `<p>Your site keeps working at <strong>${fallbackDomain}</strong>, the free address every organization keeps.</p>` : '') +
        `<p>They come back automatically, with their settings, when the plan includes them again.</p>` +
        `<p><a href="${manageUrl}">Review your domains</a></p>`;
      const set = createHash('sha256').update(domains.map((d) => d.tenantDomainId).sort().join(',')).digest('hex').slice(0, 16);
      await TenantDomainNotificationsService.notifyAdmins(
        tenantId, recipients, 'tenant_domain.suspended', subject, html,
        (email) => `tenant_domain:suspended:${tenantId}:${set}:${email}`,
      );
    } catch (e) {
      Logger.warn(`[tenant_domain] suspension notice failed for ${tenantId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * A certificate has entered the expiry window (the SSL-health cron just moved
   * it to EXPIRING). Email the tenant admins so they can confirm their reverse
   * proxy / ACME client is renewing it. Deduped per cert-expiry per recipient.
   */
  static async notifySslExpiring(input: {
    tenantId: string;
    tenantDomainId: string;
    domain: string;
    expiresAt: Date;
    daysRemaining: number;
    /** The platform orders this certificate itself and its renewal has failed (phase 51): the text says so instead of pointing at the reverse proxy. */
    renewalFailing?: boolean;
  }): Promise<void> {
    const { tenantId, tenantDomainId, domain, expiresAt, daysRemaining, renewalFailing } = input;
    try {
      const recipients = await TenantDomainNotificationsService.resolveRecipients(tenantId);
      if (recipients.length === 0) {
        Logger.warn(`[tenant_domain] SSL expiring for ${domain} — no active admin to notify (tenant ${tenantId})`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(tenantId, `/admin/domains/${tenantDomainId}`);
      const expiryDay = expiresAt.toISOString().slice(0, 10);
      const subject = `SSL certificate for ${domain} expires in ${daysRemaining} day(s)`;
      const html =
        `<p>The TLS certificate for <strong>${domain}</strong> expires on <strong>${expiryDay}</strong> ` +
        `(${daysRemaining} day(s) from now).</p>` +
        (renewalFailing
          ? `<p>The platform renews this certificate by itself and has retried, but the renewal keeps failing. ` +
            `Check that the domain's DNS still points at the platform and that the host is reachable on port 80; the platform keeps retrying until the certificate expires.</p>`
          : `<p>Certificates are renewed automatically by the reverse proxy (Caddy / Traefik / cert-manager). ` +
            `If renewal is healthy no action is needed; this is an early warning in case it is not.</p>`) +
        `<p><a href="${manageUrl}">Review ${domain}</a></p>`;
      await TenantDomainNotificationsService.notifyAdmins(
        tenantId, recipients, 'tenant_domain.ssl_expiring', subject, html,
        (email) => `tenant_domain:ssl_expiring:${tenantDomainId}:${email}:${expiryDay}`,
      );
    } catch (e) {
      Logger.warn(`[tenant_domain] SSL-expiry notify failed for ${domain}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * The wildcard certificate of a managed base domain (phase 56, D343) expires within a day and its renewal keeps failing: the ROOT
   * tenant's admins are told (the platform log line alone is not enough; every tenant under the base would lose its handshake).
   */
  static async notifyPlatformCertificateExpiring(input: { baseDomainId: string; baseDomain: string; expiresAt: Date; daysRemaining: number }): Promise<void> {
    const { baseDomainId, baseDomain, expiresAt, daysRemaining } = input;
    try {
      const { ROOT_TENANT_ID } = await import('@kuraykaraaslan-labs/common/server/tenant-constants');
      const recipients = await TenantDomainNotificationsService.resolveRecipients(ROOT_TENANT_ID);
      if (recipients.length === 0) {
        Logger.warn(`[tenant_domain] wildcard for ${baseDomain} expiring, no platform admin to notify`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(ROOT_TENANT_ID, `/admin/base-domains/${baseDomainId}`);
      const expiryDay = expiresAt.toISOString().slice(0, 10);
      const subject = `Wildcard certificate for *.${baseDomain} expires in ${daysRemaining} day(s)`;
      const html =
        `<p>The wildcard certificate for <strong>*.${baseDomain}</strong> expires on <strong>${expiryDay}</strong>. Every organization under ` +
        `${baseDomain} is served with it.</p>` +
        `<p>The platform renews it by itself through DNS and has retried, but the renewal keeps failing. Check that ` +
        `<code>_acme-challenge.${baseDomain}</code> still points at the challenge zone and that the DNS token is valid; the platform keeps retrying until the certificate expires.</p>` +
        `<p><a href="${manageUrl}">Review ${baseDomain}</a></p>`;
      await TenantDomainNotificationsService.notifyAdmins(
        ROOT_TENANT_ID, recipients, 'tenant_domain.ssl_expiring', subject, html,
        (email) => `tenant_domain:wildcard_expiring:${baseDomainId}:${email}:${expiryDay}`,
      );
    } catch (e) {
      Logger.warn(`[tenant_domain] wildcard-expiry notify failed for ${baseDomain}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
