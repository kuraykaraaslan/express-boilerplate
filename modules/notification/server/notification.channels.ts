import Logger from '@kuraykaraaslan-labs/logger';
import { ext, type ExtCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import {
  NOTIFICATION_CHANNEL_PATTERN,
  type ChannelAddressKind,
  type ChannelDescriptor,
  type NotificationChannel,
} from './notification.types';

/** Extension point id — declared in notification/module.json `extensionPoints`. */
export const NOTIFICATION_CHANNEL_POINT = 'notification:channel';

/**
 * The four channels the dispatcher shipped with. Their behaviour is fixed here,
 * byte-for-byte what `notification.policy` hard-coded before the channel set
 * was opened, and a contribution under one of these ids cannot redefine it.
 */
const CORE: Record<string, ChannelDescriptor> = {
  inapp: { channel: 'inapp', label: 'In-app', addressKind: 'ACCOUNT', respectsQuietHours: false },
  mail: { channel: 'mail', label: 'Email', addressKind: 'EMAIL', respectsQuietHours: false },
  sms: { channel: 'sms', label: 'SMS', addressKind: 'SMS', respectsQuietHours: true },
  push: { channel: 'push', label: 'Push', addressKind: 'ACCOUNT', respectsQuietHours: true },
};

const ADDRESS_KINDS: readonly ChannelAddressKind[] = ['EMAIL', 'SMS', 'ACCOUNT', 'EXTERNAL'];

/**
 * Every live channel, computed from the contributions to `notification:channel`
 * (plus the four core ones, which are always known so the dispatcher behaves
 * exactly as before with no channel module installed).
 *
 * `ctx` decides which contributions count: a tenant context gives the channels
 * whose module is active for that tenant (the policy, per notification); a
 * system context gives every channel in the build (a deployment-wide catalog,
 * e.g. the automation editor's choices).
 *
 * Read from the manifest `metadata` rather than by loading each provider: the
 * policy runs for every notification, and importing every channel's code (and
 * its queue/worker) to answer "does this channel honour quiet hours?" would
 * make the gate as heavy as the delivery it guards.
 *
 * A contribution that does not declare `respectsQuietHours` (required for new
 * channels) or whose id is not a valid slug is ignored with a warning — a
 * channel whose behaviour is unknown must not be guessed at.
 */
export async function listChannelDescriptors(ctx: ExtCtx): Promise<Map<NotificationChannel, ChannelDescriptor>> {
  const out = new Map<NotificationChannel, ChannelDescriptor>(Object.entries(CORE));
  for (const contribution of await ext.contributions(NOTIFICATION_CHANNEL_POINT, ctx)) {
    const channel = contribution.key;
    if (!channel || channel in CORE) continue;
    if (!NOTIFICATION_CHANNEL_PATTERN.test(channel)) {
      Logger.warn(`[notification.channels] ignoring '${contribution.id}': '${channel}' is not a valid channel slug`);
      continue;
    }
    const meta = (contribution.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.respectsQuietHours !== 'boolean') {
      Logger.warn(`[notification.channels] ignoring '${contribution.id}': metadata.respectsQuietHours is required`);
      continue;
    }
    const addressKind = ADDRESS_KINDS.includes(meta.addressKind as ChannelAddressKind)
      ? (meta.addressKind as ChannelAddressKind)
      : 'EXTERNAL';
    out.set(channel, {
      channel,
      label: typeof meta.label === 'string' ? meta.label : channel,
      addressKind,
      respectsQuietHours: meta.respectsQuietHours,
    });
  }
  return out;
}

/** The ids of every live channel for `ctx`, core first. */
export async function listChannels(ctx: ExtCtx): Promise<NotificationChannel[]> {
  return [...(await listChannelDescriptors(ctx)).keys()];
}
