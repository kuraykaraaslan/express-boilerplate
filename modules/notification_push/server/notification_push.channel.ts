import { sendToUser } from './notification_push.send.service';
import type {
  ChannelDeliveryInput,
  NotificationChannelProvider,
} from '@kuraykaraaslan-labs/notification/server/notification.types';

/**
 * `notification:channel` contribution — web push.
 *
 * `respectQuietHours` is deliberately NOT passed: the dispatcher already applied
 * the single quiet-hours model in the recipient's own timezone before this runs.
 * Passing it too would re-apply this module's older, second model — the exact
 * duplication PLAT-01 removed.
 */
const provider: NotificationChannelProvider = {
  channel: 'push',

  // Web-push subscriptions are held per account; an address-only recipient has
  // none. Declared so the dispatcher records `no_address` rather than a
  // delivery that silently went nowhere.
  canDeliver: (input: ChannelDeliveryInput) => Boolean(input.recipient.userId),

  async deliver(input: ChannelDeliveryInput): Promise<void> {
    const { tenantId, recipient, event, idempotencyKey } = input;
    if (!recipient.userId) return;
    // `data.html` is the mail's body: a push shows the text form (`body`), and a rendered template would not fit a push payload
    const { html: _html, ...data } = event.data ?? {};
    await sendToUser(
      tenantId,
      recipient.userId,
      {
        title: event.title ?? event.event,
        body: event.body ?? '',
        ...data,
      },
      { category: event.category, idempotencyKey },
    );
  },
};

export default provider;
