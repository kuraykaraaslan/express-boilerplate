/**
 * Where "an announcement went out to people of this tenant" is signalled (docs/phases/47-announcements): the announcement
 * fan-out publishes on the tenant's channel after each batch, the in-app notification stream every open admin session
 * already holds forwards it as a named event, and the shell's announcement component reads its list again. One stream
 * per session, not a second one. The signal carries nothing: who sees what is decided by the read, never by the message.
 * Import-free, so the browser side reads the same names.
 */
export const announcementLiveChannel = (tenantId: string): string => `announcements:live:${tenantId}`;

/** The event name the stream forwards the signal under. */
export const ANNOUNCEMENT_LIVE_EVENT = 'announcements.live';

/**
 * The one message that is not a plain "read again": a withdrawal, which also took entries out of the bell. The stream
 * forwards it under its own name, still without a payload.
 */
export const ANNOUNCEMENT_RECALL_SIGNAL = 'recall';
export const ANNOUNCEMENT_RECALL_EVENT = 'announcements.recall';

/** The window event the stream's listener raises for it, for the shell's announcement component. */
export const ANNOUNCEMENT_LIVE_DOM_EVENT = 'announcements:live';
