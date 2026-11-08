import { z } from 'zod';

/**
 * Every per-tenant key notification_inapp reads (2026-10-27), both in notification_inapp.helpers.ts:
 *
 * - `inAppRetentionDays`: how long a member's feed (and its read marks) is kept after the last new item. Settings →
 *   In-app Notifications (`/admin/settings/in-app-notifications`).
 * - `inAppQuietHours`: the legacy `"HH:MM-HH:MM"` server-time window that holds back the push fan-out of a direct
 *   `push()`. No field: quiet hours are the notification module's single model (notification.policy.ts reads this key
 *   only as a fallback and no longer writes it).
 */
export const NotificationInappSettingKeySchema = z.enum([
  'inAppRetentionDays',
  'inAppQuietHours',
]);
export type NotificationInappSettingKey = z.infer<typeof NotificationInappSettingKeySchema>;
export const NOTIFICATION_INAPP_KEYS = NotificationInappSettingKeySchema.options;
