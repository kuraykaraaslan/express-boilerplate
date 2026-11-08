import { z } from 'zod';

// ============================================================================
// Dispatcher contract
// ============================================================================

/**
 * How much the recipient's stated wishes may suppress this notification.
 *
 * `NORMAL` is everything a user is allowed to turn off. `CRITICAL` is the
 * narrow exemption: mail and codes a person needs in order to stay in control
 * of their account — OTP, password reset, a new-device warning, a security
 * alert. Suppressing those because "email notifications: off" would turn a
 * preference toggle into a way to lock yourself out, so the gate skips them and
 * the ledger records that it did.
 */
export const NotificationUrgencyEnum = z.enum(['NORMAL', 'CRITICAL']);
export type NotificationUrgency = z.infer<typeof NotificationUrgencyEnum>;

/**
 * The four channels that ship with the dispatcher. Their preference column,
 * address kind and quiet-hours behaviour are fixed in `notification.policy`
 * and must not change (a provider contributed under one of these ids cannot
 * redefine them).
 */
export const CORE_CHANNELS = ['inapp', 'mail', 'sms', 'push'] as const;

/**
 * A channel id is an OPEN slug (`telegram`, `whatsapp`, `slack_dm`), not a
 * closed enum: a fifth channel is contributed through `notification:channel`
 * without editing the dispatcher (the MIS-05/MIS-06 remedy). The set that is
 * actually live is computed from the contributions — see `listChannels` in
 * `notification.channels`.
 */
export const NOTIFICATION_CHANNEL_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
export const NotificationChannelSchema = z.string().regex(NOTIFICATION_CHANNEL_PATTERN);
/** @deprecated name kept for importers of the former enum; it is now the slug schema. */
export const NotificationChannelEnum = NotificationChannelSchema;
export type NotificationChannel = string;

/**
 * What kind of address a channel delivers to.
 *  - `EMAIL` / `SMS`: a mailbox / phone number an ADDRESS gate can judge.
 *  - `ACCOUNT`: a device or feed tied to the account (push, in-app).
 *  - `EXTERNAL`: an address the provider resolves itself through `canDeliver`
 *    (a linked Telegram chat); reports `no_address` when unlinked.
 */
export type ChannelAddressKind = 'EMAIL' | 'SMS' | 'ACCOUNT' | 'EXTERNAL';

/**
 * Static, code-free descriptor a provider declares in its `module.json`
 * contribution `metadata` (`label`, `addressKind`, `respectsQuietHours`), so
 * the policy can decide WITHOUT loading the provider's code.
 */
export interface ChannelDescriptor {
  channel: NotificationChannel;
  label: string;
  addressKind: ChannelAddressKind;
  respectsQuietHours: boolean;
}

/**
 * A resolved recipient.
 *
 * `userId` is what makes preference resolution possible at all — the
 * pre-dispatcher world addressed mail by bare email string, which is exactly
 * why no preference could be consulted. It stays the preferred handle and
 * every channel that needs an account (in-app, push) requires it.
 *
 * It is OPTIONAL rather than required, because some people the product must
 * write to do not have an account: a guest checkout has an order, a shipment
 * and a legal obligation to be told where the parcel is, and no `userId` at
 * all. Commerce plan 09 §3.4 raised this as a written request to this module
 * rather than letting the caller reach past the dispatcher to the mail queue —
 * which is how twenty-four modules used to send mail nobody could opt out of.
 *
 * The trade is explicit: an address-only recipient has **no preference layer**
 * (there are no preferences to read), so a caller addressing one is
 * responsible for the consent question itself — for commerce that is
 * `contact.SuppressionService`, which gates on the ADDRESS rather than the
 * account. Marketing to an address-only recipient without that gate is not
 * made legal by this schema.
 */
export const NotificationRecipientSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
}).refine((r) => Boolean(r.userId || r.email || r.phone), {
  message: 'A recipient needs at least one of userId, email or phone',
});
export type NotificationRecipient = z.infer<typeof NotificationRecipientSchema>;

/** Files on one notification: the mail channel's own cap (`notification_mail.attachments`), so a caller learns it first. */
export const MAX_NOTIFICATION_ATTACHMENTS = 10;
/** A Content-ID an HTML body references as `cid:<id>`: plain characters only (the mail channel checks the same). */
export const NOTIFICATION_CID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;

/**
 * The content types a file may carry: `type/subtype` with a leaf top-level type. `message/*` and `multipart/*` are
 * refused because nodemailer sends them without a transfer encoding, raw bytes in SMTP DATA (see
 * `notification_mail.attachments` `MAIL_CONTENT_TYPE_RE`, which checks the same).
 */
export const NOTIFICATION_CONTENT_TYPE_PATTERN = /^(?:application|image|text|audio|video|font)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;

/** One file of `NotificationEvent.attachments`: JSON-safe (base64), so an event can be queued as it is. */
export const NotificationAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'not base64'),
  /** A leaf type only: `message/*` and `multipart/*` would reach SMTP unencoded (the mail channel refuses them too). */
  contentType: z.string().regex(NOTIFICATION_CONTENT_TYPE_PATTERN, 'a content type of application, image, text, audio, video or font').optional(),
  /** Content-ID of an inline image (`<img src="cid:<cid>">`). */
  cid: z.string().regex(NOTIFICATION_CID_PATTERN).optional(),
});
export type NotificationAttachment = z.infer<typeof NotificationAttachmentSchema>;

/**
 * What is being sent. `category` drives per-category opt-outs (newsletter,
 * promotional, product updates…); `event` is the stable id a domain uses
 * (`invoice.issued`, `auth.new_login`) and what the ledger records.
 */
export const NotificationEventSchema = z.object({
  event: z.string().min(1),
  category: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  /** Channel-specific payload; a channel provider reads what it understands. */
  data: z.record(z.string(), z.unknown()).optional(),
  /**
   * Files that go with the notification, for a channel that can carry them (mail
   * today; the others ignore them). Beside `data` rather than in it because the
   * in-app and push channels copy `data` into their payloads, and megabytes of
   * base64 must not reach a feed row or a push message. A file with a `cid` is an
   * inline image. The channel checks names, types and sizes and refuses what it
   * cannot send.
   */
  attachments: z.array(NotificationAttachmentSchema).max(MAX_NOTIFICATION_ATTACHMENTS).optional(),
});
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

export interface NotifyOptions {
  /** Restrict the fan-out. Defaults to every channel the recipient allows. */
  channels?: NotificationChannel[];
  urgency?: NotificationUrgency;
  /**
   * Set by `notifyCritical` only: this is account-control traffic (OTP, reset,
   * new-device warning). It always bypasses recipient gates, regardless of the
   * tenant's `notificationCriticalBypassesPreferences` switch (OD-10), which
   * governs only other `CRITICAL` notifications (e.g. an alarm).
   */
  accountSecurity?: boolean;
  /**
   * Override the derived marketing/transactional purpose for the ADDRESS gate.
   *
   * Rarely needed: the policy derives it from urgency and category, which is
   * right for almost everything. Set it where the caller genuinely knows better
   * — the test is "did the customer perform the action that triggered this?".
   * They placed an order → TRANSACTIONAL. They abandoned a cart → MARKETING,
   * because abandoning is not a request.
   */
  purpose?: NotificationPurpose;
  /** Passed through to channels that support exactly-once delivery. */
  idempotencyKey?: string;
}

// ============================================================================
// Policy decision (what the gate concluded, and why)
// ============================================================================

/** Why a channel was suppressed. `null` reason = delivered. */
export type SuppressionReason =
  | 'channel_off'          // recipient turned this channel off
  | 'category_opt_out'     // recipient opted out of this category
  | 'quiet_hours'          // inside the recipient's quiet window
  | 'tenant_disabled'      // tenant disabled the channel platform-wide
  | 'not_requested'        // caller did not ask for this channel
  | 'no_address'           // no email/phone/subscription to deliver to
  | 'address_suppressed'   // the ADDRESS opted out, bounced or complained
  | 'address_unverifiable'; // a suppression provider failed and this purpose fails closed (marketing)

/**
 * Why a message is being sent, for address-level suppression.
 *
 * The distinction is the whole point: somebody who asked to stop receiving
 * offers still needs their invoice. An unsubscribe from marketing stops
 * `MARKETING`; only a full opt-out (or a hard bounce) stops `TRANSACTIONAL`.
 */
export type NotificationPurpose = 'TRANSACTIONAL' | 'MARKETING';

/**
 * An ADDRESS-level gate, contributed through `notification:suppression`.
 *
 * Separate from preferences because it answers a different question about a
 * different subject. Preferences ask "does this PERSON want this?" and need an
 * account; suppression asks "may we write to this ADDRESS at all?" and works on
 * a guest, a bounced mailbox, or somebody who never had a login. A dispatcher
 * that consults only the first sends mail to addresses that unsubscribed.
 *
 * A provider MUST fail closed: an address it cannot evaluate is suppressed. The
 * failure mode is not "slightly less mail", it is "mail to somebody who opted
 * out" — and an address that cannot be normalised is one we could not reliably
 * deliver to anyway.
 */
export interface SuppressionProvider {
  /** `'EMAIL'` | `'SMS'` — which address kind this provider judges. */
  addressKind: 'EMAIL' | 'SMS';
  isSuppressed(
    tenantId: string,
    address: string,
    opts: { purpose: NotificationPurpose },
  ): Promise<boolean>;
}

export interface ChannelDecision {
  channel: NotificationChannel;
  allowed: boolean;
  reason: SuppressionReason | null;
}

export interface NotifyDecision {
  urgency: NotificationUrgency;
  decisions: ChannelDecision[];
  /** Channels that will actually be dispatched. */
  allowed: NotificationChannel[];
}

export interface NotifyResult {
  /** The account this went to, or `null` for an address-only recipient. */
  recipientId: string | null;
  decision: NotifyDecision;
  /** Channels whose provider ran without throwing. */
  delivered: NotificationChannel[];
  /** Channels whose provider threw (logged, never rethrown). */
  failed: NotificationChannel[];
}

// ============================================================================
// Channel provider contract (`notification:channel` extension point)
// ============================================================================

export interface ChannelDeliveryInput {
  tenantId: string;
  recipient: NotificationRecipient;
  event: NotificationEvent;
  urgency: NotificationUrgency;
  idempotencyKey?: string;
}

/**
 * A channel provider. `channel` names which decision gates it; `canDeliver`
 * reports whether this recipient is even addressable on it (no email → no mail),
 * so "suppressed by preference" and "nowhere to send it" stay distinguishable in
 * the ledger.
 */
export interface NotificationChannelProvider {
  channel: NotificationChannel;
  /** Mirrors the manifest metadata; the manifest is what the policy reads. */
  addressKind?: ChannelAddressKind;
  respectsQuietHours?: boolean;
  canDeliver?(input: ChannelDeliveryInput): Promise<boolean> | boolean;
  deliver(input: ChannelDeliveryInput): Promise<void>;
  /**
   * Read-only: is there room in the tenant's monthly quota for this channel? Counts nothing (the send counts). Lets a
   * caller that must report a quota refusal (automation's `action.notify`, G-137) ask before sending, since the channel
   * itself enforces the quota later, in its queue, where the caller never sees it. `key` is the plan feature key.
   */
  quota?(tenantId: string): Promise<ChannelQuota>;
  /**
   * Has the send under this (derived) idempotency key already completed? A completed send is answered from its record
   * before the channel's quota gate, so a redelivery is never refused for a quota spent since; `spentQuotas` asks this to
   * keep such a channel in a redelivered call.
   */
  completed?(tenantId: string, idempotencyKey: string): Promise<boolean>;
}

/** A channel's monthly quota answer (`NotificationChannelProvider.quota`). */
export interface ChannelQuota {
  allowed: boolean;
  /** The plan feature that answers, e.g. `feature_email_monthly_quota`. */
  key: string;
  /**
   * Why there is no room, when `allowed` is false: `spent` (the month's quota is used up) or `no_access` (the plan does
   * not grant the channel at all: the key is undeclared, there is no live plan, or the limit is 0). Absent reads as `spent`.
   */
  reason?: 'spent' | 'no_access';
}

/** A channel `NotificationService.spentQuotas` found without room. */
export interface SpentQuota {
  channel: NotificationChannel;
  key: string;
  reason: 'spent' | 'no_access';
}
