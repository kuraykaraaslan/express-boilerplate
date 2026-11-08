import { z } from 'zod';
import NotificationMailQueueService, { type MailSendExtras } from './notification_mail.queue.service';
import { decodeMailAttachments } from './notification_mail.attachments';
import type { MailAttachment } from './providers/base.provider';
import type {
  ChannelDeliveryInput,
  NotificationChannelProvider,
} from '@kuraykaraaslan-labs/notification/server/notification.types';

/**
 * `notification:channel` contribution — email.
 *
 * The dispatcher has already decided this recipient wants (or must receive)
 * mail; this only renders and enqueues. `event.data.html` lets a domain pass a
 * fully-rendered template through; otherwise the plain title/body is used, so a
 * caller that has no template still sends something readable rather than
 * nothing. `event.data.subject` replaces the title as the subject line and
 * `event.data.replyTo` becomes the Reply-To address: both are caller text, so
 * the subject is flattened to one line and a Reply-To that is not a single
 * plain address is dropped rather than sent.
 *
 * `event.attachments` (base64, beside `data` so the feed and push channels never
 * copy them) are checked and decoded here, so a bad or oversized file fails this
 * delivery (the dispatcher records `failed`) instead of a queued job nobody
 * watches. An inline image (`cid`) on a plain body is shown below the text, since
 * the escaped text cannot reference it; a rendered `html` places its own.
 */
const MAX_SUBJECT = 200;
const emailSchema = z.string().email();

/** The caller's subject as one line, or null when it is absent or blank. */
function subjectOf(data: Record<string, unknown> | undefined): string | null {
  const raw = data?.subject;
  if (typeof raw !== 'string') return null;
  const line = raw.replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, MAX_SUBJECT);
  return line === '' ? null : line;
}

/** One plain address, or undefined: a list, a display-name form or a header break never reaches the Reply-To header. */
function replyToOf(data: Record<string, unknown> | undefined): string | undefined {
  const raw = data?.replyTo;
  if (typeof raw !== 'string') return undefined;
  const addr = raw.trim();
  return emailSchema.safeParse(addr).success ? addr : undefined;
}

const provider: NotificationChannelProvider = {
  channel: 'mail',

  canDeliver: (input: ChannelDeliveryInput) => Boolean(input.recipient.email),

  quota: (tenantId: string) => NotificationMailQueueService.monthlyQuota(tenantId),

  completed: async (tenantId: string, idempotencyKey: string) =>
    Boolean(await NotificationMailQueueService.completedSend(tenantId, idempotencyKey)),

  async deliver(input: ChannelDeliveryInput): Promise<void> {
    const { tenantId, recipient, event, idempotencyKey } = input;
    if (!recipient.email) return;
    const subject = subjectOf(event.data) ?? event.title ?? event.event;
    const attachments = decodeMailAttachments(event.attachments);
    const html = typeof event.data?.html === 'string'
      ? event.data.html
      : `<p>${escapeHtml(event.body ?? subject)}</p>${inlineImages(attachments)}`;
    const replyTo = replyToOf(event.data);
    const extras: MailSendExtras | undefined = replyTo || attachments
      ? { ...(replyTo && { replyTo }), ...(attachments && { attachments }) }
      : undefined;
    await NotificationMailQueueService.sendMail(
      tenantId, recipient.email, subject, html, undefined, idempotencyKey, extras,
    );
  },
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** The inline images of a plain body, one per line; the cid is checked (`MAIL_CID_RE`) and the name escaped. */
function inlineImages(list: MailAttachment[] | undefined): string {
  return (list ?? [])
    .filter((a) => a.cid)
    .map((a) => `<p><img src="cid:${a.cid}" alt="${escapeHtml(a.filename)}" style="max-width:100%"></p>`)
    .join('');
}

export default provider;
