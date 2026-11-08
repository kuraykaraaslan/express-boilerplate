import { z } from 'zod';

/** `ExponentPushToken[xxxx]` (current) or the older `ExpoPushToken[xxxx]`. */
export const EXPO_TOKEN_RE = /^(Exponent|Expo)PushToken\[[^\]\s]+\]$/;

/**
 * Categories the platform actually emits (`notify({ category })` call sites plus the
 * policy's opt-out map). Matching is exact (`wantsCategory`), so a typo would silently
 * mute every push for that token; unknown names are rejected instead.
 */
export const PUSH_NOTIFICATION_CATEGORIES = [
  'security', 'security_alert', 'workspace', 'commerce', 'bookings', 'billing', 'support',
  'messaging', 'payments', 'notifications', 'marketplace', 'gamification', 'compliance', 'account',
  'newsletter', 'marketing', 'promo', 'promotion', 'promotions', 'promotional', 'offers',
  'product', 'product_update', 'product_updates',
  'automation', 'ai_agent',
  'observability', 'on_call',
  'iot',
] as const;
export const PushNotificationCategoryEnum = z.enum(PUSH_NOTIFICATION_CATEGORIES);

/**
 * Register a native-app push token. `provider` is a closed list on purpose: each value
 * needs a sender behind it, and accepting a token nothing can deliver to would report
 * a successful registration that never produces a notification. Expo only for now;
 * raw FCM/APNs join this enum together with their sender.
 */
export const RegisterPushTokenDTO = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('expo'),
    token: z.string().max(512).regex(EXPO_TOKEN_RE, 'Not an Expo push token (expected ExponentPushToken[…])'),
    // The install id the app keeps: a rotated token for the same device replaces the old one.
    deviceId: z.string().min(1).max(128).optional(),
    platform: z.enum(['ios', 'android']),
    appVersion: z.string().max(40).optional(),
    // Empty/omitted = every category (same meaning as for Web Push).
    categories: z.array(PushNotificationCategoryEnum).max(50).optional(),
  }),
]);
export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenDTO>;

/** Unregister by install id or by token (one of them). */
export const UnregisterPushTokenQuery = z
  .object({
    deviceId: z.string().min(1).max(128).optional(),
    token: z.string().min(1).max(512).optional(),
  })
  .refine((q) => !!q.deviceId || !!q.token, { message: 'deviceId or token is required' });
export type UnregisterPushTokenInput = z.infer<typeof UnregisterPushTokenQuery>;


/** Change the categories of one of the caller's own tokens without re-registering. Empty array = every category. */
export const UpdatePushTokenCategoriesDTO = z
  .object({
    deviceId: z.string().min(1).max(128).optional(),
    token: z.string().min(1).max(512).optional(),
    categories: z.array(PushNotificationCategoryEnum).max(50),
  })
  .refine((q) => !!q.deviceId || !!q.token, { message: 'deviceId or token is required' });
export type UpdatePushTokenCategoriesInput = z.infer<typeof UpdatePushTokenCategoriesDTO>;
