import { z } from "zod";

/** Call-to-action button rendered with the notification. */
export const NotificationActionSchema = z.object({
  label: z.string(),
  url: z.string(),
});
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

export const NotificationSchema = z.object({
  notificationId: z.string().uuid(),
  title: z.string(),
  message: z.string(),
  path: z.string().nullable().optional(),
  /** Category for filtering / per-user opt-out (e.g. 'billing', 'security'). */
  type: z.string().nullable().optional(),
  /** Structured CTA. */
  action: NotificationActionSchema.nullable().optional(),
  /** ISO timestamp after which the notification is hidden on read. */
  expiresAt: z.string().datetime().nullable().optional(),
  /**
   * The producer's own handle on the entry (`announcement:<id>`), so it can take back the copies nobody read yet
   * (`recall`): a withdrawn announcement. Never shown.
   */
  ref: z.string().max(200).nullable().optional(),
  isRead: z.boolean().default(false),
  createdAt: z.string().datetime(),
  /**
   * Small scalar facts the sender wants the open browser to have (a badge's name, the points it paid), so a client
   * can word the item in the reader's language instead of showing the sender's English. Optional and absent unless
   * the sender passes `meta`.
   */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export type NotificationPayload = Pick<Notification, "title" | "message" | "path" | "type" | "action" | "expiresAt" | "ref" | "meta"> & {
  /** Whether to also fan out to web-push (default true; quiet hours can suppress). */
  pushFanout?: boolean;
};
