import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { announcementMailCoverageLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/announcement.mail_coverage';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import NotificationService from '@kuraykaraaslan-labs/notification/server/notification.service';
import type { NotificationRecipient, NotifyOptions, NotifyResult } from '@kuraykaraaslan-labs/notification/server/notification.types';
import Logger from '@kuraykaraaslan-labs/logger';
import { markdownToHtml, markdownToText, escapeHtml } from './announcement.markdown';
import { dispatcherChannels, textFor } from './announcement.rules';
import { MAIL_COVERAGE_POINT, type MailCoverageProvider } from './announcement.types';
import type { AudienceMember } from './announcement.audience';
import type { Announcement } from './entities/announcement.entity';

/**
 * One batch of the fan-out through the notification dispatcher (PLAT-01, never a channel module): the bell and push in
 * each person's own workspace (push subscriptions are held per workspace: the root tenant has none of a customer's
 * users), and mail and SMS from the sender (the platform's root tenant for a platform announcement, so a platform notice
 * never spends a customer's mail quota).
 *
 * The idempotency key is `announcement:<id>`; the dispatcher derives `announcement:<id>:<recipient>:<channel>` from it,
 * so a retried batch never mails anybody twice.
 *
 * Mail of a MAINTENANCE notice is service mail (D16): sent CRITICAL, past the person's mail toggle (the tenant's
 * `notificationCriticalBypassesPreferences` still decides, as for every critical notice). A GENERAL announcement is the
 * category `announcement` users can switch off, and MARKETING for the address gate (an unsubscribed address gets none).
 */

export const ANNOUNCEMENT_EVENT = 'announcement.published';
export const ANNOUNCEMENT_CATEGORY = 'announcement';

export interface BatchOutcome {
  /** The dispatcher channels that delivered, per person. */
  channelsByUser: Map<string, Set<string>>;
  delivered: Record<string, number>;
  failed: Record<string, number>;
}

export interface BatchOptions {
  /** False when the day's mail cap of this kind is reached: the batch goes out without mail. */
  mail: boolean;
  /** The idempotency key, when not the announcement's own (a test send has its own, so the real send still arrives). */
  key?: string;
}

/** Is `link` an app path (the bell opens it inside the app). */
const isAppPath = (link: string | null) => !!link && link.startsWith('/') && !link.startsWith('//');

function tally(target: Record<string, number>, channel: string, n = 1): void {
  target[channel] = (target[channel] ?? 0) + n;
}

/**
 * The addresses another module already mails about this maintenance moment: the status page mails its subscribers when a
 * workspace's window starts. Asked only for the start notice of a workspace window: the status page mails nobody about a
 * system window or a cancellation, and the end notice carries mail only for a cancellation (or when a person added it),
 * so leaving anybody out there could leave them with no mail at all. Best-effort: a failed provider covers nobody, so
 * the notice mails as it would without it.
 */
async function coveredEmails(row: Announcement, tenantId: string, emails: string[]): Promise<Set<string>> {
  if (row.kind !== 'MAINTENANCE' || !row.windowId || !row.tenantId || row.stage !== 'start' || emails.length === 0) {
    return new Set();
  }
  try {
    const { results } = await ext.aggregate<MailCoverageProvider, string[]>(
      MAIL_COVERAGE_POINT, tenantCtx(tenantId), announcementMailCoverageLoaders,
      (provider) => provider.coveredAddresses({ tenantId, windowId: row.windowId!, stage: 'start', emails }),
    );
    return new Set(results.flatMap((r) => (Array.isArray(r.value) ? r.value : [])).map((e) => e.toLowerCase()));
  } catch (error) {
    Logger.warn(`[announcement] mail coverage of ${row.announcementId} unavailable: ${error}`);
    return new Set();
  }
}

/** The installation's address for a tenant, so an app-path link in a mail is absolute; '' when it cannot be told. */
async function linkBaseOf(tenantId: string): Promise<string> {
  try {
    const { absoluteTenantUrl } = await import('@kuraykaraaslan-labs/common/server/tenant-url');
    return await absoluteTenantUrl(tenantId, '');
  } catch {
    return '';
  }
}

/** The mail body: the Markdown as HTML, and the link as its own paragraph. */
export function mailHtml(body: string, link: string | null, linkBase: string): string {
  const html = markdownToHtml(body, linkBase || null);
  const href = link ? (isAppPath(link) ? (linkBase ? `${linkBase.replace(/\/+$/, '')}${link}` : null) : link) : null;
  return href ? `${html}<p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>` : html;
}

/** Delivers one batch on the dispatcher channels of `row`. Never throws for a channel: the dispatcher logs and counts. */
export async function deliverBatch(row: Announcement, members: AudienceMember[], opts: BatchOptions): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { channelsByUser: new Map(), delivered: {}, failed: {} };
  const channels = dispatcherChannels(row.channels).filter((c) => c !== 'mail' || opts.mail);
  if (channels.length === 0 || members.length === 0) return outcome;

  const maintenance = row.kind === 'MAINTENANCE';
  const senderTenant = row.tenantId ?? ROOT_TENANT_ID;
  const idempotencyKey = opts.key ?? `announcement:${row.announcementId}`;
  const data = {
    announcementId: row.announcementId,
    ref: idempotencyKey,
    ...(isAppPath(row.linkUrl) ? { path: row.linkUrl } : {}),
    ...(row.expiresAt ? { expiresAt: new Date(row.expiresAt).toISOString() } : {}),
  };

  // One group per (workspace, language): the bell entry goes to that workspace, the text is in that language.
  const groups = new Map<string, AudienceMember[]>();
  for (const m of members) {
    const lang = textFor(row.content, row.defaultLanguage, m.language).language;
    const key = `${m.tenantId}|${lang}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const record = (results: NotifyResult[]) => {
    for (const r of results) {
      if (!r.recipientId) continue;
      const set = outcome.channelsByUser.get(r.recipientId) ?? new Set<string>();
      for (const c of r.delivered) { set.add(c); tally(outcome.delivered, c); }
      for (const c of r.failed) tally(outcome.failed, c);
      outcome.channelsByUser.set(r.recipientId, set);
    }
  };
  const send = async (tenantId: string, recipients: NotificationRecipient[], event: Parameters<typeof NotificationService.notify>[2], o: NotifyOptions) => {
    if (recipients.length === 0) return;
    try {
      record(await NotificationService.notify(tenantId, recipients, event, { ...o, idempotencyKey }));
    } catch (error) {
      for (const c of o.channels ?? []) tally(outcome.failed, c, recipients.length);
      Logger.error(`[announcement] ${row.announcementId} batch on ${(o.channels ?? []).join(',')} failed: ${error}`);
    }
  };

  for (const [key, group] of groups) {
    const [memberTenant, lang] = key.split('|');
    const text = textFor(row.content, row.defaultLanguage, lang);
    const plain = markdownToText(text.body);
    const category = maintenance ? undefined : ANNOUNCEMENT_CATEGORY;

    if (channels.includes('inapp')) {
      // The bell is inside the product: no opt-out category, like every in-app entry.
      await send(memberTenant, group.map((m) => ({ userId: m.userId })),
        { event: ANNOUNCEMENT_EVENT, title: text.title, body: plain, data }, { channels: ['inapp'] });
    }

    if (channels.includes('mail')) {
      const withMail = group.filter((m) => m.email);
      const covered = await coveredEmails(row, memberTenant, withMail.map((m) => m.email!.toLowerCase()));
      const html = mailHtml(text.body, row.linkUrl, await linkBaseOf(memberTenant));
      await send(senderTenant, withMail.filter((m) => !covered.has(m.email!.toLowerCase())).map((m) => ({ userId: m.userId, email: m.email! })),
        { event: ANNOUNCEMENT_EVENT, category, title: text.title, body: plain, data: { ...data, subject: text.title, html } },
        maintenance
          ? { channels: ['mail'], urgency: 'CRITICAL', purpose: 'TRANSACTIONAL' }
          : { channels: ['mail'], purpose: 'MARKETING' });
    }

    const purpose = maintenance ? {} : { purpose: 'MARKETING' as const };
    if (channels.includes('push')) {
      await send(memberTenant, group.map((m) => ({ userId: m.userId })),
        { event: ANNOUNCEMENT_EVENT, category, title: text.title, body: plain, data }, { channels: ['push'], ...purpose });
    }
    if (channels.includes('sms')) {
      await send(senderTenant, group.map((m) => ({ userId: m.userId, ...(m.phone ? { phone: m.phone } : {}) })),
        { event: ANNOUNCEMENT_EVENT, category, title: text.title, body: plain, data }, { channels: ['sms'], ...purpose });
    }
  }
  return outcome;
}
