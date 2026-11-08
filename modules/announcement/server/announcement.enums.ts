import { z } from 'zod';

/** What an announcement is about: anything the sender writes, or a maintenance window's notice (made by the window itself). */
export const AnnouncementKindEnum = z.enum(['GENERAL', 'MAINTENANCE']);
export type AnnouncementKind = z.infer<typeof AnnouncementKindEnum>;

/**
 * draft → scheduled → sending → sent → expired, or withdrawn from any of them. A SCHEDULED row without `sendAt` waits for an
 * event instead of a time (a maintenance window's start, end or reminder). A fan-out that keeps failing without progress
 * ends FAILED (D23): the sender is told and may retry it (back to sending, from where it stopped) or withdraw it.
 */
export const AnnouncementStatusEnum = z.enum(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'EXPIRED', 'WITHDRAWN', 'FAILED']);
export type AnnouncementStatus = z.infer<typeof AnnouncementStatusEnum>;

export const AnnouncementSeverityEnum = z.enum(['info', 'warning', 'critical']);
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeverityEnum>;

/**
 * Where it shows. The first three live in the admin shell (persisted per person, so someone who signs in later still gets the
 * popup and the banner); the others leave through the notification dispatcher (`inapp` is the bell).
 */
export const AnnouncementChannelEnum = z.enum(['popup', 'toast', 'banner', 'inapp', 'mail', 'push', 'sms']);
export type AnnouncementChannel = z.infer<typeof AnnouncementChannelEnum>;

/** The shell's own channels: never through the dispatcher. */
export const LIVE_CHANNELS: readonly AnnouncementChannel[] = ['popup', 'toast', 'banner'];

/**
 * What each sender may use (D15): the platform operator every channel; a tenant admin, to their own workspace, banner,
 * toast, the bell and mail. SMS costs money and stays with the platform; so do the popup and push.
 */
export const PLATFORM_CHANNELS: readonly AnnouncementChannel[] = AnnouncementChannelEnum.options;
export const TENANT_CHANNELS: readonly AnnouncementChannel[] = ['toast', 'banner', 'inapp', 'mail'];

/** The member roles an audience can be narrowed to (tenant_member's built-in roles). */
export const AnnouncementRoleEnum = z.enum(['OWNER', 'ADMIN', 'USER']);
export type AnnouncementRole = z.infer<typeof AnnouncementRoleEnum>;

/** Which notice of a maintenance window a MAINTENANCE announcement is. */
export const MaintenanceStageEnum = z.enum(['scheduled', 'reminder', 'start', 'end']);
export type MaintenanceStage = z.infer<typeof MaintenanceStageEnum>;
