import { z } from 'zod';

/**
 * Every per-tenant key notification_push reads (2026-10-27). The VAPID key pair (`vapidPublicKey`, `vapidPrivateKey`) and
 * its contact e-mail (`vapidContactEmail`) are notification_mail's (Settings → Notifications) and are not declared here.
 *
 * - `pushEnabled`: tenant-wide on/off (notification_push.config isPushEnabled, default on). Page field (MS-12: the
 *   switch on Settings → Notifications wrote notification_mail's `pushNotificationsEnabled`, which nothing read; it is
 *   gone, so this page has the only switch).
 * - `pushProvider`: the push plugin used when several are installed (send.service resolvePushProvider). Page field.
 * - `pushMaxSubscriptionsPerUser`: devices per member (subscription.service). Page field.
 * - `pushQuietHoursStart`, `pushQuietHoursEnd`: the legacy whole-hour quiet window (metrics.service isWithinQuietHours,
 *   and notification's fallback for its own `notificationQuietHours*`). No field: quiet hours are the notification
 *   module's single model.
 */
export const NotificationPushSettingKeySchema = z.enum([
  'pushEnabled',
  'pushProvider',
  'pushMaxSubscriptionsPerUser',
  'pushQuietHoursStart',
  'pushQuietHoursEnd',
]);
export type NotificationPushSettingKey = z.infer<typeof NotificationPushSettingKeySchema>;
export const NOTIFICATION_PUSH_KEYS = NotificationPushSettingKeySchema.options;
