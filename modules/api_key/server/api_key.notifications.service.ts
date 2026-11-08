import 'reflect-metadata';
import { In } from 'typeorm';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import NotificationService from '@kuraykaraaslan-labs/notification/server/notification.service';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url';

/**
 * Best-effort admin email for API-key lifecycle events: a security notice when a
 * key is minted, and a rotation reminder when a key nears expiry. Kept in its own
 * collaborator and only ever reached via a dynamic `import()` from the CRUD /
 * rotation services so the BullMQ-backed mail queue is loaded lazily — and so
 * `notification_mail` / `tenant_member` never sit on api_key's static import
 * graph (both transitively require `tenant`, which requires `api_key`). The
 * manage link is built by common's `absoluteTenantUrl`: the tenant's own domain
 * through the `common:tenant_origin` point, so api_key never imports
 * tenant_domain (docs/phases/37-extensions/10).
 *
 * Every method is best-effort and never throws: a notification must never roll
 * back or 500 the key mutation that triggered it.
 */

export default class ApiKeyNotificationsService {

  /**
   * Active OWNER/ADMIN member emails for a tenant — the humans responsible for
   * the tenant's credentials. Mirrors the tenant-domain recipient resolution:
   * member rows live in the tenant DB, the email lives on the system-DB user row.
   */
  private static async resolveRecipients(tenantId: string): Promise<Array<{ userId: string; email: string }>> {
    const members = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.find({
      where: { tenantId, memberStatus: 'ACTIVE', memberRole: In(['OWNER', 'ADMIN']) },
    }));
    if (members.length === 0) return [];

    const sysDs = await getDataSource();
    const userRepo = sysDs.getRepository(UserEntity);
    // The userId travels with the address now: the dispatcher can only resolve
    // a person's preferences and reach their in-app inbox if it knows who they
    // are, and this resolution already had the id in hand.
    const out = new Map<string, { userId: string; email: string }>();
    for (const member of members) {
      const user = await userRepo.findOne({ where: { userId: member.userId } });
      if (user?.email) out.set(user.email, { userId: member.userId, email: user.email });
    }
    return [...out.values()];
  }

  /**
   * A new API key was just minted. Email the tenant's admins/owner a security
   * notice so an unexpected key issuance is noticed quickly. Deduped per key per
   * recipient (a key is created once, so the marker is effectively permanent).
   */
  static async notifyKeyCreated(input: {
    tenantId: string;
    apiKeyId: string;
    name: string;
    scopes: string[];
    environment: string;
    createdByUserId: string;
  }): Promise<void> {
    const { tenantId, apiKeyId, name, scopes, environment, createdByUserId } = input;
    try {
      const recipients = await ApiKeyNotificationsService.resolveRecipients(tenantId);
      if (recipients.length === 0) {
        Logger.warn(`[api_key] key ${apiKeyId} created — no active admin to notify (tenant ${tenantId})`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(tenantId, `/admin/api-keys/${apiKeyId}`);
      const subject = `New API key created: ${name}`;
      const html =
        `<p>A new API key <strong>${name}</strong> was just created for your workspace.</p>` +
        `<ul>` +
        `<li>Environment: <strong>${environment}</strong></li>` +
        `<li>Scopes: <strong>${scopes.join(', ') || 'none'}</strong></li>` +
        `<li>Created by user: <strong>${createdByUserId}</strong></li>` +
        `</ul>` +
        `<p>If you did not expect this key to be issued, revoke it immediately:</p>` +
        `<p><a href="${manageUrl}">Review this API key</a></p>`;
      // CRITICAL: a credential was just minted against this workspace. That is
      // the notice an admin most needs to see when they did NOT expect it, so
      // it must not be silenceable by a preference toggle.
      for (const to of recipients) {
        await NotificationService.notifyCritical(
          tenantId,
          { userId: to.userId, email: to.email },
          { event: 'api_key.created', category: 'security', title: subject, body: subject, data: { html } },
          { idempotencyKey: `api_key:created:${apiKeyId}:${to.email}` },
        );
      }
    } catch (e) {
      Logger.warn(`[api_key] key-created notify failed for ${apiKeyId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * A key is inside its expiry window (the expiring-soon sweep just flagged it).
   * Email the tenant admins a rotation reminder. Deduped per key per recipient
   * per day so a daily cron does not spam them.
   */
  static async notifyKeyExpiring(input: {
    tenantId: string;
    apiKeyId: string;
    name: string;
    expiresAt: Date;
    daysLeft: number;
  }): Promise<void> {
    const { tenantId, apiKeyId, name, expiresAt, daysLeft } = input;
    try {
      const recipients = await ApiKeyNotificationsService.resolveRecipients(tenantId);
      if (recipients.length === 0) {
        Logger.warn(`[api_key] key ${apiKeyId} expiring — no active admin to notify (tenant ${tenantId})`);
        return;
      }
      const manageUrl = await absoluteTenantUrl(tenantId, `/admin/api-keys/${apiKeyId}`);
      const expiryDay = expiresAt.toISOString().slice(0, 10);
      const subject = `API key "${name}" expires in ${daysLeft} day(s)`;
      const html =
        `<p>The API key <strong>${name}</strong> expires on <strong>${expiryDay}</strong> ` +
        `(${daysLeft} day(s) from now). Once it expires, requests using it will be rejected.</p>` +
        `<p>Rotate it now to issue a replacement without downtime:</p>` +
        `<p><a href="${manageUrl}">Rotate this API key</a></p>`;
      // NORMAL, unlike the creation notice above — and the difference is the
      // point. A key being MINTED is a security event nobody may silence; a key
      // approaching expiry is an operational reminder, and somebody who muted
      // their mail can live without it. Marking everything CRITICAL would make
      // the flag mean nothing.
      for (const to of recipients) {
        await NotificationService.notify(
          tenantId,
          { userId: to.userId, email: to.email },
          { event: 'api_key.expiring', category: 'security', title: subject, body: subject, data: { html } },
          { idempotencyKey: `api_key:expiring:${apiKeyId}:${to.email}:${expiryDay}` },
        );
      }
    } catch (e) {
      Logger.warn(`[api_key] key-expiring notify failed for ${apiKeyId}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
