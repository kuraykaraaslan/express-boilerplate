import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import UserPreferencesService from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.service';
import type { UserPreferences } from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.types';
import Logger from '@kuraykaraaslan-labs/logger';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { notificationSuppressionLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/notification.suppression';
import {
  type ChannelDescriptor,
  type ChannelDecision,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationRecipient,
  type NotifyDecision,
  type NotifyOptions,
  type NotificationUrgency,
  type NotificationPurpose,
  type SuppressionProvider,
} from './notification.types';
import { listChannelDescriptors } from './notification.channels';

/** Extension point id for address-level suppression gates. */
export const NOTIFICATION_SUPPRESSION_POINT = 'notification:suppression';

/**
 * The ONE place a "should this notification reach this person right now?"
 * question is answered.
 *
 * Before this module every channel answered it differently, or not at all:
 * `notification_inapp` consulted preferences, `notification_push` consulted a
 * *second* quiet-hours model, 24 modules called the mail service directly with a
 * bare email address and consulted nothing — so the account settings page's
 * "Email notifications" toggle gated exactly nothing, including the new-login
 * alerts it explicitly promises.
 */

/**
 * Which recipient address a channel would use, derived from its descriptor.
 * Only `EMAIL` and `SMS` channels have an address an ADDRESS gate can judge:
 * `ACCOUNT` (push, in-app) delivers to a device or a feed, and `EXTERNAL`
 * resolves its own address inside the provider's `canDeliver`.
 */
function addressOf(d: ChannelDescriptor): { kind: 'EMAIL' | 'SMS'; field: 'email' | 'phone' } | null {
  if (d.addressKind === 'EMAIL') return { kind: 'EMAIL', field: 'email' };
  if (d.addressKind === 'SMS') return { kind: 'SMS', field: 'phone' };
  return null;
}

/**
 * Marketing or transactional?
 *
 * DERIVED by default, not passed. A caller REQUIRED to declare it will
 * eventually declare it wrong, and the wrong direction here is the unlawful one
 * — marketing sent to somebody who opted out of exactly that, invisibly. The
 * two signals we already have are enough for almost everything: `CRITICAL` is
 * by definition account-control traffic, and the marketing CATEGORIES are the
 * ones that already carry a per-category opt-out.
 *
 * `opts.purpose` overrides it for the caller that genuinely knows better — an
 * abandoned-cart reminder is marketing however operational its category looks,
 * because abandoning a cart is not a request.
 */
const MARKETING_CATEGORIES = new Set(['newsletter', 'marketing', 'promotion', 'promotional', 'promotional_offers']);

function purposeOf(urgency: NotificationUrgency, event: NotificationEvent): NotificationPurpose {
  if (urgency === 'CRITICAL') return 'TRANSACTIONAL';
  const category = event.category?.toLowerCase();
  return category && MARKETING_CATEGORIES.has(category) ? 'MARKETING' : 'TRANSACTIONAL';
}

/**
 * Whether the address gate may fail OPEN for this purpose.
 *
 * `notification:suppression` declares `failOpen` for transactional and critical
 * traffic only (EXT-3). Every `CRITICAL` notification derives `TRANSACTIONAL`
 * (`purposeOf`), so this one test covers both; a caller that explicitly marks a
 * message `MARKETING` gets the closed gate whatever its urgency, because a
 * consent boundary is exactly what failing open would cross.
 */
function failsOpen(purpose: NotificationPurpose): boolean {
  return purpose === 'TRANSACTIONAL';
}

/** The channels the address gate refused, and the ones it could not answer for (a provider failed, purpose fails closed). */
interface AddressVerdict {
  suppressed: Set<NotificationChannel>;
  unverifiable: Set<NotificationChannel>;
}

/**
 * Ask every registered address gate about this recipient's addresses.
 *
 * Contributed through `notification:suppression` rather than imported: the gate
 * that exists today is `contact`'s, and `notification` is platform core —
 * importing a CRM domain from it would invert the dependency (and cycle, since
 * `contact` already sends through the dispatcher).
 *
 * A provider that throws, times out or fails to load knows nothing about any
 * address, and what that means depends on the purpose (the point's declared
 * `failOpen`, EXT-3):
 * - TRANSACTIONAL (and so every CRITICAL) fails OPEN. A provider that cannot
 *   judge ONE address knows something specific and refuses it, while a broken
 *   provider tells us nothing about anybody — and silencing password resets and
 *   security alerts platform-wide because a CRM module failed to load would be
 *   a far larger outage than the one it prevents.
 * - MARKETING fails CLOSED: every address of the kind the failed provider judges
 *   (both kinds when it failed before saying) is held back as `unverifiable`.
 *   Mailing somebody who unsubscribed is the unlawful direction, and a missed
 *   newsletter is only a retry.
 */
async function suppressedAddresses(
  tenantId: string,
  recipient: NotificationRecipient,
  purpose: NotificationPurpose,
  descriptors: Map<NotificationChannel, ChannelDescriptor>,
): Promise<AddressVerdict> {
  const verdict: AddressVerdict = { suppressed: new Set(), unverifiable: new Set() };
  const ctx = tenantCtx(tenantId);
  // Nothing to ask is the common case: skip the guard (and its contract check) outright.
  if ((await ext.contributions(NOTIFICATION_SUPPRESSION_POINT, ctx)).length === 0) return verdict;

  // Which address kind each provider judges, once it has loaded and said so.
  const kinds = new Map<string, SuppressionProvider['addressKind']>();
  const { results, unverifiable, blocked } = await ext.guard<SuppressionProvider, NotificationChannel[]>(
    NOTIFICATION_SUPPRESSION_POINT, ctx, notificationSuppressionLoaders,
    async (provider, _signal, contribution) => {
      if (!provider?.addressKind) return [];
      kinds.set(contribution.id, provider.addressKind);
      const hits: NotificationChannel[] = [];
      for (const d of descriptors.values()) {
        const addr = addressOf(d);
        if (!addr || addr.kind !== provider.addressKind) continue;
        const value = recipient[addr.field];
        if (!value) continue;
        if (await provider.isSuppressed(tenantId, value, { purpose })) hits.push(d.channel);
      }
      return hits;
    },
    { failOpen: failsOpen(purpose) },
  );

  for (const r of results) for (const channel of r.value) verdict.suppressed.add(channel);
  if (!blocked) return verdict;

  for (const d of descriptors.values()) {
    const addr = addressOf(d);
    if (!addr || !recipient[addr.field] || verdict.suppressed.has(d.channel)) continue;
    if (unverifiable.some((f) => (kinds.get(f.contributionId) ?? addr.kind) === addr.kind)) verdict.unverifiable.add(d.channel);
  }
  if (verdict.unverifiable.size) {
    Logger.warn(
      `[notification.policy][suppression] could not verify ${[...new Set(unverifiable.map((f) => f.moduleId))].join(', ')}; `
      + `${purpose} held back on ${[...verdict.unverifiable].join(', ')}`,
    );
  }
  return verdict;
}

// ── Channel ↔ preference field ───────────────────────────────────────────────
/**
 * The four core channels keep their dedicated columns. A channel WITHOUT a
 * column reads `prefs.channelPrefs[channel]` (jsonb, default `{}` → allowed).
 */
const CHANNEL_PREFERENCE_FIELD: Record<string, keyof UserPreferences | null> = {
  mail: 'emailNotifications',
  sms: 'smsNotifications',
  push: 'pushNotifications',
  // In-app has no opt-out toggle: it is the feed inside the product, and a user
  // who does not want it simply does not open it.
  inapp: null,
};

/**
 * Category → the per-category opt-in that governs it. Only marketing/consent
 * categories are user-toggleable (GDPR Recital 32 — specific, separate
 * consents); operational categories are not modelled and fall through.
 *
 * Kept identical to the map `notification_inapp` already used, so folding that
 * module's behaviour into the dispatcher changes nothing for existing callers.
 */
const CATEGORY_PREFERENCE_FIELD: Record<string, keyof UserPreferences> = {
  newsletter: 'newsletter',
  product: 'productUpdates',
  product_update: 'productUpdates',
  product_updates: 'productUpdates',
  promo: 'promotionalOffers',
  promotion: 'promotionalOffers',
  promotions: 'promotionalOffers',
  promotional: 'promotionalOffers',
  marketing: 'promotionalOffers',
  offers: 'promotionalOffers',
};

/**
 * Categories a person receives until they switch them OFF (the reverse of the consent map above): only `false` holds one
 * back, and unreadable preferences let it through like an operational category. General announcements (docs/phases/47,
 * D16): the platform's and the workspace's news, which users may turn off; maintenance notices carry no category.
 */
const OPT_OUT_CATEGORY_FIELD: Record<string, keyof UserPreferences> = {
  announcement: 'announcements',
};

// Which channels quiet hours may defer is a per-channel descriptor flag
// (`respectsQuietHours`): push and sms yes; mail no — a deferred email is just
// a late email, and holding it back only makes the inbox lie about ordering.

// ── The single quiet-hours model ─────────────────────────────────────────────

/**
 * Quiet hours, resolved in the RECIPIENT's timezone.
 *
 * There used to be two incompatible models: `inAppQuietHours` as an
 * `"HH:MM-HH:MM"` string evaluated in *server* time (so a tenant in Istanbul and
 * a user in Berlin got the same window), and `pushQuietHoursStart`/`End` as
 * whole-hour numbers evaluated in the *user's* timezone. This keeps the correct
 * one — a quiet window is about when the recipient is asleep, not the server —
 * and accepts the legacy string form so a tenant that configured the old key
 * keeps working.
 */
export async function isWithinQuietHours(tenantId: string, prefs: UserPreferences | null): Promise<boolean> {
  try {
    const s = await SettingService.getByKeys(tenantId, [
      'notificationQuietHoursStart', 'notificationQuietHoursEnd',
      'pushQuietHoursStart', 'pushQuietHoursEnd', 'inAppQuietHours',
    ]);

    const window = parseWindow(s) ?? parseLegacyStringWindow(s.inAppQuietHours);
    if (!window) return false;

    const tz = prefs?.timezone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: 'numeric', hour12: false, timeZone: tz,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const now = hour * 60 + minute;

    // The window may wrap midnight (22:00 → 07:00).
    return window.start < window.end
      ? now >= window.start && now < window.end
      : now >= window.start || now < window.end;
  } catch {
    // Fail open: an unreadable setting must not silence notifications.
    return false;
  }
}

type Window = { start: number; end: number };

function parseWindow(s: Record<string, string | null>): Window | null {
  const start = Number(s.notificationQuietHoursStart ?? s.pushQuietHoursStart);
  const end = Number(s.notificationQuietHoursEnd ?? s.pushQuietHoursEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return { start: start * 60, end: end * 60 };
}

/** Legacy `inAppQuietHours` = `"HH:MM-HH:MM"`. Kept readable, no longer written. */
function parseLegacyStringWindow(raw: string | null | undefined): Window | null {
  const m = raw?.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return null;
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  return start === end ? null : { start, end };
}

// ── Tenant-wide channel kill switch ──────────────────────────────────────────

async function disabledChannels(tenantId: string): Promise<Set<string>> {
  try {
    const s = await SettingService.getByKeys(tenantId, ['disabledNotificationChannels']);
    return new Set(
      (s.disabledNotificationChannels ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

// ── CRITICAL bypass switch (OD-10) ───────────────────────────────────────────

/**
 * Whether a `CRITICAL` notification skips the recipient's own gates. Default
 * `true` (owner decision OD-10); a tenant turns it off with the setting
 * `notificationCriticalBypassesPreferences = 'false'`. An unreadable setting
 * keeps the default — the switch exists to LOOSEN an exemption on request, and
 * a failed read must not silently start suppressing urgent messages.
 */
async function criticalBypassesPreferences(tenantId: string): Promise<boolean> {
  try {
    const s = await SettingService.getByKeys(tenantId, ['notificationCriticalBypassesPreferences']);
    return String(s.notificationCriticalBypassesPreferences ?? 'true').trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}

// ── The recipient's preferences ──────────────────────────────────────────────

/**
 * The preferences a send applies to an account recipient (06-user 1.3). A user without a row has the DEFAULTS (the tenant's,
 * every marketing consent off), not "no opt-out": the preferences screen shows those defaults, so delivery must honour them.
 * An unreadable read stays `null` with `unreadable` set: channels fail open (an outage must not silence delivery), consent
 * categories fail closed (see `decide`).
 */
async function recipientPreferences(
  tenantId: string,
  userId: string,
): Promise<{ prefs: UserPreferences | null; unreadable: boolean }> {
  try {
    const stored = await UserPreferencesService.getByUserId(userId);
    return { prefs: stored ?? await UserPreferencesService.getDefaults(tenantId), unreadable: false };
  } catch (e) {
    Logger.warn(`[notification.policy] preferences unreadable for ${userId}: ${e}`);
    return { prefs: null, unreadable: true };
  }
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * Resolve, once, which channels this notification may use for this recipient.
 *
 * `CRITICAL` skips every recipient-controlled gate — channel toggle, category
 * opt-out, quiet hours — but NOT the tenant-wide kill switch: a tenant with no
 * SMS provider configured cannot deliver an SMS however urgent it is.
 *
 * OD-10: that bypass is the DEFAULT, and a tenant may turn it off
 * (`notificationCriticalBypassesPreferences`), after which a `CRITICAL`
 * notification is gated like any other. Account-security traffic
 * (`notifyCritical` → `opts.accountSecurity`) is never affected by the switch.
 */
export async function decide(
  tenantId: string,
  recipient: NotificationRecipient,
  event: NotificationEvent,
  opts: NotifyOptions = {},
): Promise<NotifyDecision & { prefs: UserPreferences | null }> {
  const urgency: NotificationUrgency = opts.urgency ?? 'NORMAL';
  // Only the channels whose module is active for this tenant (the four core ones are always known).
  const descriptors = await listChannelDescriptors(tenantCtx(tenantId));
  const requested = opts.channels ?? [...descriptors.keys()];

  // An address-only recipient has no preferences to read — not "unreadable",
  // ABSENT. The lookup is skipped rather than allowed to fail, so a guest
  // notification does not log a warning on every send about a user that was
  // never supposed to exist. The consent question for such a recipient is the
  // caller's (address-level suppression); see NotificationRecipientSchema.
  const { prefs, unreadable } = recipient.userId
    ? await recipientPreferences(tenantId, recipient.userId)
    : { prefs: null, unreadable: false };
  const disabled = await disabledChannels(tenantId);
  const bypass = urgency === 'CRITICAL'
    && (opts.accountSecurity === true || await criticalBypassesPreferences(tenantId));
  const quiet = bypass ? false : await isWithinQuietHours(tenantId, prefs);
  const address = await suppressedAddresses(tenantId, recipient, opts.purpose ?? purposeOf(urgency, event), descriptors);

  const decisions: ChannelDecision[] = [...descriptors.keys()].map((channel) => {
    const deny = (reason: ChannelDecision['reason']): ChannelDecision => ({ channel, allowed: false, reason });

    if (!requested.includes(channel)) return deny('not_requested');
    if (disabled.has(channel)) return deny('tenant_disabled');

    // BEFORE the CRITICAL exemption, and that placement is the decision:
    // `CRITICAL` waives what the RECIPIENT chose (their toggles, their quiet
    // hours) because those must never lock somebody out of their own account.
    // It does not waive what the ADDRESS is — a hard bounce is a fact about a
    // mailbox, and a full opt-out is a legal boundary, neither of which the
    // urgency of our message changes. What CRITICAL does buy is the purpose:
    // a security notice is TRANSACTIONAL, so a marketing unsubscribe never
    // touches it.
    if (address.suppressed.has(channel)) return deny('address_suppressed');
    if (address.unverifiable.has(channel)) return deny('address_unverifiable');

    if (bypass) return { channel, allowed: true, reason: null };

    const field = CHANNEL_PREFERENCE_FIELD[channel];
    if (field) {
      if (prefs && prefs[field] === false) return deny('channel_off');
    } else if (prefs?.channelPrefs?.[channel] === false) {
      return deny('channel_off');
    }

    // A consent category needs a granted consent (06-user 1.3): opt-in, so anything but `true` (off, or preferences that could
    // not be read) holds it back. An address-only recipient has no preference layer; its consent is the address gate's.
    const category = event.category?.toLowerCase();
    // Own keys only: `__proto__` / `constructor` must not resolve to an Object.prototype member and read as a consent field.
    const categoryField = category && Object.hasOwn(CATEGORY_PREFERENCE_FIELD, category) ? CATEGORY_PREFERENCE_FIELD[category] : undefined;
    if (categoryField && (prefs ? prefs[categoryField] !== true : unreadable)) return deny('category_opt_out');
    const optOutField = category && Object.hasOwn(OPT_OUT_CATEGORY_FIELD, category) ? OPT_OUT_CATEGORY_FIELD[category] : undefined;
    if (optOutField && prefs?.[optOutField] === false) return deny('category_opt_out');

    if (quiet && descriptors.get(channel)?.respectsQuietHours) return deny('quiet_hours');

    return { channel, allowed: true, reason: null };
  });

  return {
    urgency,
    decisions,
    allowed: decisions.filter((d) => d.allowed).map((d) => d.channel),
    prefs,
  };
}
