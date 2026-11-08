import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { notificationChannelLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/notification.channel';
import { createHash } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';
import { decide } from './notification.policy';
import { NOTIFICATION_CHANNEL_POINT } from './notification.channels';
import {
  type ChannelDeliveryInput,
  type NotificationChannel,
  type NotificationChannelProvider,
  type NotificationEvent,
  type NotificationRecipient,
  type NotifyOptions,
  type NotifyResult,
  type SpentQuota,
} from './notification.types';

export { NOTIFICATION_CHANNEL_POINT };

/**
 * The recipient's part of a derived idempotency key: one caller key covers a whole recipient list, and the channel
 * queues dedupe on the key, so without this part only the first recipient of a call would be delivered. A hash, so an
 * address or number never becomes part of a job id or a log line.
 */
export function recipientKeyPart(r: NotificationRecipient): string {
  const identity = r.userId ? `u:${r.userId.toLowerCase()}` : r.email ? `e:${r.email.toLowerCase()}` : `p:${r.phone ?? ''}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

/**
 * The core notification dispatcher (PLAT-01).
 *
 * The platform had four channel modules, a delivery ledger, and no orchestrator.
 * Each domain picked a channel module and called it directly — 24 of them called
 * mail — which meant the recipient's preferences were consulted by whichever
 * channel happened to feel like it. The account settings page's notification
 * toggles gated nothing at all, including the new-login alerts it promises;
 * messaging's push went out under no policy whatsoever; and quiet hours existed
 * twice, in two incompatible models.
 *
 * `notify()` is the single entry point: it resolves policy once
 * (`notification.policy`) and fans out to channel providers contributed through
 * `notification:channel`. It never imports a channel module — that is what keeps
 * the dispatcher installable without any of them, and what lets a tenant have
 * only the channels it paid for.
 */
export default class NotificationService {

  /**
   * Send `event` to `recipients`, honouring what each recipient asked for.
   *
   * Best-effort by design: a channel provider that throws is logged and the
   * other channels still go out. A notification is a side effect of a domain
   * action, and failing the domain write because a push provider is down would
   * be the wrong trade.
   */
  static async notify(
    tenantId: string,
    recipients: NotificationRecipient | NotificationRecipient[],
    event: NotificationEvent,
    opts: NotifyOptions = {},
  ): Promise<NotifyResult[]> {
    const list = Array.isArray(recipients) ? recipients : [recipients];
    if (list.length === 0) return [];

    const providerFor = this.channelProviders(tenantId);
    return Promise.all(list.map((r) => this.notifyOne(tenantId, r, event, opts, providerFor)));
  }

  private static async notifyOne(
    tenantId: string,
    recipient: NotificationRecipient,
    event: NotificationEvent,
    opts: NotifyOptions,
    providerFor: (channel: NotificationChannel) => Promise<NotificationChannelProvider | null>,
  ): Promise<NotifyResult> {
    const decision = await decide(tenantId, recipient, event, opts);
    const delivered: NotificationChannel[] = [];
    const failed: NotificationChannel[] = [];

    await Promise.all(decision.allowed.map(async (channel) => {
      let provider: NotificationChannelProvider | null;
      try {
        provider = await providerFor(channel);
      } catch (error) {
        // Installed and active, but its code would not load: a failed delivery, not a missing channel.
        failed.push(channel);
        Logger.error(`[notification.notify][tenant:${tenantId}][${channel}][${event.event}] ${error}`);
        return;
      }
      if (!provider) return; // channel not installed for this tenant

      const input: ChannelDeliveryInput = {
        tenantId,
        recipient,
        event,
        urgency: decision.urgency,
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:${recipientKeyPart(recipient)}:${channel}` : undefined,
      };

      try {
        // "Nowhere to send it" is not the same as "suppressed by preference" —
        // keep them apart so the ledger stays diagnosable.
        if (provider.canDeliver && !(await provider.canDeliver(input))) {
          const d = decision.decisions.find((x) => x.channel === channel);
          if (d) { d.allowed = false; d.reason = 'no_address'; }
          return;
        }
        await provider.deliver(input);
        delivered.push(channel);
      } catch (error) {
        failed.push(channel);
        Logger.error(`[notification.notify][tenant:${tenantId}][${channel}][${event.event}] ${error}`);
      }
    }));

    return {
      recipientId: recipient.userId ?? null,
      decision: {
        urgency: decision.urgency,
        decisions: decision.decisions,
        allowed: decision.allowed.filter((c) => !failed.includes(c)),
      },
      delivered,
      failed,
    };
  }

  /**
   * Security- and account-control notifications: OTP codes, password resets,
   * new-device warnings. Exempt from every recipient-controlled gate, because a
   * preference toggle must not become a way to lock yourself out of your own
   * account. Still subject to the tenant's channel kill switch.
   */
  static async notifyCritical(
    tenantId: string,
    recipients: NotificationRecipient | NotificationRecipient[],
    event: NotificationEvent,
    opts: Omit<NotifyOptions, 'urgency' | 'accountSecurity'> = {},
  ): Promise<NotifyResult[]> {
    return this.notify(tenantId, recipients, event, { ...opts, urgency: 'CRITICAL', accountSecurity: true });
  }

  /**
   * Explain, without sending, what would happen. Backs the "why didn't I get
   * that email?" support question, which used to be unanswerable.
   */
  static async explain(
    tenantId: string,
    recipient: NotificationRecipient,
    event: NotificationEvent,
    opts: NotifyOptions = {},
  ) {
    const { prefs: _prefs, ...decision } = await decide(tenantId, recipient, event, opts);
    return decision;
  }

  /**
   * The asked `channels` that have no room in the tenant's monthly quota, in the order asked; empty when every one has
   * room. Read-only (each provider's `quota` counts nothing). A channel without a quota check, not installed, or whose
   * check fails is not listed: the channel's queue still enforces its quota on the send. `reason` tells a spent quota
   * from a plan that grants no access to the channel at all (the key undeclared, no live plan, or a limit of 0).
   *
   * With `replay` (the call's `idempotencyKey` and recipients), a channel without room is still not listed when a send of
   * this call to one of the recipients already completed on it (`provider.completed` on the derived key): the call is a
   * redelivery, and the channel answers its completed sends from their records before its quota gate.
   */
  static async spentQuotas(
    tenantId: string,
    channels: readonly string[],
    replay?: { idempotencyKey: string; recipients: readonly NotificationRecipient[] },
  ): Promise<SpentQuota[]> {
    if (channels.length === 0) return [];
    const providerFor = this.channelProviders(tenantId);
    const spent: SpentQuota[] = [];
    for (const channel of new Set(channels)) {
      try {
        // not installed or not active for the tenant (null): not listed; a provider that fails to load: logged, not listed
        const provider = await providerFor(channel as NotificationChannel);
        if (!provider?.quota) continue;
        const q = await provider.quota(tenantId);
        if (q.allowed) continue;
        if (replay && provider.completed && (await this.anyCompleted(tenantId, provider, channel, replay))) continue;
        spent.push({ channel: channel as NotificationChannel, key: q.key, reason: q.reason ?? 'spent' });
      } catch (error) {
        Logger.warn(`[notification.spentQuotas][tenant:${tenantId}][${channel}] ${error}`);
      }
    }
    return spent;
  }

  /** Whether a send of the call to any of its recipients already completed on `channel` (the keys `notifyOne` derives). */
  private static async anyCompleted(
    tenantId: string,
    provider: NotificationChannelProvider,
    channel: string,
    { idempotencyKey, recipients }: { idempotencyKey: string; recipients: readonly NotificationRecipient[] },
  ): Promise<boolean> {
    for (const r of recipients) {
      if (await provider.completed!(tenantId, `${idempotencyKey}:${recipientKeyPart(r)}:${channel}`)) return true;
    }
    return false;
  }

  /**
   * The provider of each channel for this tenant, selected on first use and shared by every recipient of one call.
   * `null` means the channel is not installed here: no module provides it, or its module is not active for the
   * tenant (a disabled channel module stops delivering). A provider that is installed but fails to load rejects,
   * and the caller records that channel as failed.
   */
  private static channelProviders(
    tenantId: string,
  ): (channel: NotificationChannel) => Promise<NotificationChannelProvider | null> {
    const ctx = tenantCtx(tenantId);
    const selected = new Map<NotificationChannel, Promise<NotificationChannelProvider | null>>();
    return (channel) => {
      let provider = selected.get(channel);
      if (!provider) {
        provider = ext.select<NotificationChannelProvider>(NOTIFICATION_CHANNEL_POINT, ctx, notificationChannelLoaders, { key: channel })
          .then((hit) => hit?.impl ?? null)
          .catch((error: unknown) => {
            if (error instanceof ProviderUnavailableError && error.state !== 'failed') return null;
            throw error;
          });
        selected.set(channel, provider);
      }
      return provider;
    };
  }
}
