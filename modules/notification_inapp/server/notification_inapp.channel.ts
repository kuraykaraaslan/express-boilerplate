import NotificationInAppService from './notification_inapp.service';
import { targetFromData } from './notification_inapp.target';
import type {
  ChannelDeliveryInput,
  NotificationChannelProvider,
} from '@kuraykaraaslan-labs/notification/server/notification.types';

/**
 * `notification:channel` contribution — the in-app feed.
 *
 * `pushRaw` is used rather than `push`, because `push` re-runs this module's own
 * preference/opt-out/quiet-hours checks and fans out to web push itself. Under
 * the dispatcher both of those are someone else's job: policy was resolved once
 * up front, and push is a sibling contribution. Calling `push` here would double
 * the policy and double the notification.
 *
 * The page the bell opens (docs/phases/07-dashboard/40, D40-15) is `data.path`, or
 * its aliases `data.link` and `data.url` (the deep link `notification_external`
 * reads), an internal app path only: an external or malformed one is dropped.
 */
const provider: NotificationChannelProvider = {
  channel: 'inapp',

  // The feed lives inside an account, so an address-only recipient (a guest
  // checkout) has nowhere to put one. Declared rather than assumed: without
  // this the dispatcher would report a delivery it could not make.
  canDeliver: (input: ChannelDeliveryInput) => Boolean(input.recipient.userId),

  async deliver(input: ChannelDeliveryInput): Promise<void> {
    const { tenantId, recipient, event } = input;
    if (!recipient.userId) return;
    // `data.html` is the mail's body (a rendered template or a flow's sanitised HTML): the feed shows the text form, `body`
    const { html: _html, ...data } = event.data ?? {};
    await NotificationInAppService.pushRaw(tenantId, recipient.userId, {
      title: event.title ?? event.event,
      message: event.body ?? '',
      type: event.category,
      ...data,
      path: targetFromData(data),
    });
  },
};

export default provider;
