import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import {
  NotificationLog,
  NotificationChannel,
  NotificationStatus,
} from './entities/notification_log.entity';

/**
 * Demo seed for the notification_log module.
 *
 * NotificationLog is the unified outbound delivery audit row (one per attempt
 * across mail / sms / push / inapp). It carries a `tenantId` column, so it is
 * tenant-scoped — we use `ctx.repo(...)` and stamp `ctx.tenantId`.
 *
 * The entity has no DB `@Unique` constraint, so for idempotent re-runs we use
 * the natural per-delivery identifier `providerMessageId` (every provider hands
 * back a unique message id) as the `where` key in `foc`.
 *
 * We exercise every channel and every status, with realistic providers,
 * subjects, recipients and a populated `error` on the failed row, and back-date
 * `sentAt` so the rows read like a recent history.
 */
export async function seedNotificationLog(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;
  const repo = ctx.repo<NotificationLog>(NotificationLog);

  // Recipient ids: prefer published refs, fall back to seed constants/literals.
  const userId = (ctx.refs.userId as string) ?? SEED_USER_ID;

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000);

  type LogDef = {
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    provider: string;
    status: NotificationStatus;
    providerMessageId: string;
    error?: string;
    sentAt: Date;
  };

  const defs: LogDef[] = [
    // mail — delivered via SES
    {
      channel: 'mail',
      recipient: 'demo.user@example.com',
      subject: 'Welcome to the platform 🎉',
      provider: 'ses',
      status: 'sent',
      providerMessageId: 'seed-mail-0100000000000000@email.amazonses.com',
      sentAt: minutesAgo(120),
    },
    // mail — bounced / failed via SMTP, with a captured error
    {
      channel: 'mail',
      recipient: 'bounce@invalid.example',
      subject: 'Your monthly invoice is ready',
      provider: 'smtp',
      status: 'failed',
      providerMessageId: 'seed-mail-0200000000000000@smtp.local',
      error: 'SMTP 550 5.1.1 Recipient address rejected: user unknown',
      sentAt: minutesAgo(90),
    },
    // sms — delivered via Twilio
    {
      channel: 'sms',
      recipient: '+15551234567',
      subject: 'Your verification code is 482913',
      provider: 'twilio',
      status: 'sent',
      providerMessageId: 'SMseed0000000000000000000000000003',
      sentAt: minutesAgo(45),
    },
    // sms — still in flight / pending via Vonage
    {
      channel: 'sms',
      recipient: '+447700900123',
      subject: 'Order shipped: tracking 1Z999',
      provider: 'vonage',
      status: 'pending',
      providerMessageId: 'seed-sms-vonage-0000000000000004',
      sentAt: minutesAgo(8),
    },
    // push — delivered via Firebase Cloud Messaging (recipient is a userId)
    {
      channel: 'push',
      recipient: userId,
      subject: 'You have 3 new notifications',
      provider: 'fcm',
      status: 'sent',
      providerMessageId: 'projects/seed/messages/0000000000000005',
      sentAt: minutesAgo(20),
    },
    // push — token expired / failed via FCM
    {
      channel: 'push',
      recipient: userId,
      subject: 'Flash sale ends tonight',
      provider: 'fcm',
      status: 'failed',
      providerMessageId: 'seed-push-fcm-0000000000000006',
      error: 'messaging/registration-token-not-registered: token is no longer valid',
      sentAt: minutesAgo(15),
    },
    // inapp — delivered to the in-app inbox (recipient is a userId)
    {
      channel: 'inapp',
      recipient: userId,
      subject: 'Your password was changed',
      provider: 'inapp',
      status: 'sent',
      providerMessageId: 'seed-inapp-0000000000000007',
      sentAt: minutesAgo(5),
    },
  ];

  for (const def of defs) {
    await foc(
      repo,
      { tenantId, providerMessageId: def.providerMessageId } as FindOptionsWhere<NotificationLog>,
      { tenantId, ...def },
    );
  }

  ctx.log(
    `notification_log: ${defs.length} delivery rows (mail/sms/push/inapp; sent/failed/pending) for ${tenantId}`,
  );
}

/**
 * Filler for `notification_log`: a few hundred delivery rows (demo: 200) to the `user_filler` users over the last
 * months, across every channel and provider, mostly sent with some failures. Registered as its own seeder
 * (`notification_log_filler`, own faker stream).
 *
 * Demo-safe: audit rows only, nothing is sent; no row is `pending`, so no delivery-status poll asks a provider
 * about one; recipients are example.com addresses, fictional numbers or user ids.
 * Idempotent: keyed on (tenant, providerMessageId), built from the index and the tenant tail.
 */
export async function seedNotificationLogFiller(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, faker } = ctx;
  const tail = tenantId.replace(/-/g, '').slice(-8);
  const users = (await ctx.systemDs.query(`SELECT "userId", email FROM users WHERE email LIKE $1 ORDER BY email`, [`%.seed-${tail}@example.com`])) as Array<{ userId: string; email: string }>;
  const fallback = [{ userId: (ctx.refs.userId as string) ?? SEED_USER_ID, email: 'demo.user@example.com' }];
  const pool = users.length ? users : fallback;
  const channels: Array<{ channel: NotificationChannel; provider: string }> = [
    { channel: 'mail', provider: 'ses' }, { channel: 'mail', provider: 'smtp' }, { channel: 'inapp', provider: 'inapp' },
    { channel: 'push', provider: 'fcm' }, { channel: 'sms', provider: 'twilio' }, { channel: 'inapp', provider: 'inapp' }, { channel: 'mail', provider: 'ses' },
  ];
  const subjects = ['Your order has shipped', 'New message from your team', 'Invoice available', 'Password changed', 'Weekly summary', 'Task assigned to you', 'Ticket updated', 'Quote accepted'];
  const errors: Record<string, string> = { mail: 'SMTP 550 5.1.1 Recipient address rejected', sms: 'Carrier rejected the message', push: 'messaging/registration-token-not-registered', inapp: 'Inbox write timed out' };
  const repo = ctx.repo<NotificationLog>(NotificationLog);
  const n = Math.min(ctx.count(40), 2000);
  for (let i = 0; i < n; i++) {
    const u = pool[i % pool.length];
    const { channel, provider } = channels[i % channels.length];
    const status: NotificationStatus = i % 9 === 4 ? 'failed' : 'sent';
    const providerMessageId = `seedf-${tail}-${channel}-${String(i + 1).padStart(5, '0')}`;
    const recipient = channel === 'mail' ? u.email : channel === 'sms' ? `+1555${String(1000000 + i).slice(-7)}` : u.userId;
    await foc(repo, { tenantId, providerMessageId } as FindOptionsWhere<NotificationLog>, {
      tenantId, channel, recipient, subject: subjects[i % subjects.length], provider, status, providerMessageId,
      error: status === 'failed' ? errors[channel as string] : undefined, sentAt: faker.pastDate(120),
    });
  }
  ctx.log(`notification_log(filler): ${n} delivery rows for ${tenantId}`);
}
