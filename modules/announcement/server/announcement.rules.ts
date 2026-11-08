import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  LIVE_CHANNELS, PLATFORM_CHANNELS, TENANT_CHANNELS,
  type AnnouncementChannel, type AnnouncementKind,
} from './announcement.enums';
import type { AnnouncementText } from './entities/announcement.entity';
import AnnouncementMessages from './announcement.messages';

/**
 * The rules of an announcement that need no database: who may use which channel, the text in a language, and the rate
 * guards' limits. Pure, so the console (announcement UI) and the tests share them with the service.
 */

/** A sender: the platform operator (`tenantId` null) or a tenant admin to their own tenant. */
export type Sender = { tenantId: string | null };

export const isPlatform = (sender: Sender) => sender.tenantId === null;

/** The channels this sender may choose (D15). */
export function allowedChannels(sender: Sender): readonly AnnouncementChannel[] {
  return isPlatform(sender) ? PLATFORM_CHANNELS : TENANT_CHANNELS;
}

/**
 * Refuses a channel the sender may not use. `kept` are channels the row already had (a maintenance notice the window
 * made with a popup): a tenant admin who edits it may keep them, never add one.
 */
export function assertChannels(sender: Sender, channels: readonly string[], kept: readonly string[] = []): void {
  const allowed = new Set<string>([...allowedChannels(sender), ...kept]);
  const refused = channels.filter((c) => !allowed.has(c));
  if (refused.length) {
    throw new AppError(`${AnnouncementMessages.CHANNEL_NOT_ALLOWED}: ${refused.join(', ')}`, 403, ErrorCode.FORBIDDEN);
  }
}

/** The channels that leave through the notification dispatcher (everything but the shell's own). */
export function dispatcherChannels(channels: readonly string[]): string[] {
  return channels.filter((c) => !LIVE_CHANNELS.includes(c as AnnouncementChannel));
}

/** The shell channels of a list. */
export function liveChannels(channels: readonly string[]): AnnouncementChannel[] {
  return channels.filter((c): c is AnnouncementChannel => LIVE_CHANNELS.includes(c as AnnouncementChannel));
}

/**
 * The text for `language` (`pt-BR` → `pt-BR`, then `pt`), else the default language's (D19: written by hand per
 * language, falling back to the default). A language whose title is empty counts as missing.
 */
export function textFor(
  content: Record<string, AnnouncementText>,
  defaultLanguage: string,
  language: string | null | undefined,
): AnnouncementText & { language: string } {
  const candidates = [language, language?.split('-')[0], defaultLanguage].filter((l): l is string => Boolean(l));
  for (const l of candidates) {
    const t = content[l];
    if (t?.title) return { ...t, language: l };
  }
  const [first] = Object.entries(content).filter(([, t]) => t.title);
  return first ? { ...first[1], language: first[0] } : { title: '', body: '', language: defaultLanguage };
}

/** A critical popup at most once an hour per sender (plan D, rate guard). */
export const CRITICAL_POPUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Announcements with mail a sender may send per day, by kind. A maintenance window makes up to four notices and a
 * busy day has a few windows; a general announcement by mail is rarer and is the one users can switch off.
 */
export const MAIL_DAILY_CAP: Record<AnnouncementKind, number> = { GENERAL: 3, MAINTENANCE: 20 };

/**
 * A fan-out that gave up (its job failed all its attempts, or was lost) is queued again by the minutely tick at most this
 * many times in a row without progress, then marked FAILED (D23). A restart after which the fan-out got further (its
 * cursor moved) starts the count again: a large send that fails now and then is not given up while it advances.
 */
export const FANOUT_MAX_RESTARTS = 3;

/**
 * The reason a FAILED row shows its sender. The module's own refusals (a facet that cannot answer) are shown as they are;
 * anything else (a database error) is not: its text may carry internals, so it goes to the server log only.
 */
export function fanoutFailureReason(error: string | null | undefined): string {
  if (!error) return AnnouncementMessages.FANOUT_LOST;
  const own = Object.values(AnnouncementMessages).some((m) => error.startsWith(m));
  return own ? error.slice(0, 300) : AnnouncementMessages.FANOUT_ERROR;
}

/** Is a critical popup the row would send. */
export function isCriticalPopup(row: { severity: string; channels: readonly string[] }): boolean {
  return row.severity === 'critical' && row.channels.includes('popup');
}

/** Refuses a send time in the past (a minute of slack for the clock of the browser) and an expiry before the send. */
export function assertTimes(sendAt: Date | null | undefined, expiresAt: Date | null | undefined, now = new Date()): void {
  if (sendAt && sendAt.getTime() < now.getTime() - 60_000) {
    throw new AppError(AnnouncementMessages.SEND_AT_PAST, 400, ErrorCode.VALIDATION_ERROR);
  }
  const from = sendAt ?? now;
  if (expiresAt && expiresAt.getTime() <= from.getTime()) {
    throw new AppError(AnnouncementMessages.EXPIRES_BEFORE_SEND, 400, ErrorCode.VALIDATION_ERROR);
  }
}
