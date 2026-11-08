import NotificationSmsQueueService from './notification_sms.queue.service';
import type {
  ChannelDeliveryInput,
  NotificationChannelProvider,
} from '@kuraykaraaslan-labs/notification/server/notification.types';

/**
 * `notification:channel` contribution — SMS.
 *
 * SMS is the most expensive and most intrusive channel, so it is also the one
 * quiet hours defer. That decision belongs to the dispatcher's policy, not here;
 * by the time `deliver` runs it has already been made.
 */
const provider: NotificationChannelProvider = {
  channel: 'sms',

  canDeliver: (input: ChannelDeliveryInput) => Boolean(input.recipient.phone),

  quota: (tenantId: string) => NotificationSmsQueueService.monthlyQuota(tenantId),

  completed: async (tenantId: string, idempotencyKey: string) =>
    Boolean(await NotificationSmsQueueService.completedSend(tenantId, idempotencyKey)),

  async deliver(input: ChannelDeliveryInput): Promise<void> {
    const { tenantId, recipient, event, idempotencyKey } = input;
    if (!recipient.phone) return;
    await NotificationSmsQueueService.sendShortMessage(tenantId, {
      to: recipient.phone,
      body: event.body ?? event.title ?? event.event,
      idempotencyKey,
    });
  },
};

export default provider;
