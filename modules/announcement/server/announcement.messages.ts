const AnnouncementMessages = {
  NOT_FOUND: 'Announcement not found',
  NOT_EDITABLE: 'Only a draft or a scheduled announcement can be changed',
  NOT_SENDABLE: 'This announcement was already sent or withdrawn',
  FOLLOWS_WINDOW: 'This maintenance notice goes out with its window and cannot be sent or scheduled by hand',
  ALREADY_CLOSED: 'This announcement is already withdrawn or expired',
  CHANNEL_NOT_ALLOWED: 'This channel is not available to the sender',
  AUDIENCE_NOT_ALLOWED: 'A workspace announcement reaches its own workspace only',
  CONTENT_MISSING_DEFAULT: 'The default language needs a title',
  SEND_AT_PAST: 'The send time is in the past',
  EXPIRES_BEFORE_SEND: 'The expiry must come after the send time',
  CRITICAL_POPUP_RATE: 'A critical popup went out less than an hour ago; wait before sending another',
  MAIL_DAILY_CAP: 'The day\'s mail limit for announcements of this kind is reached',
  NO_RECIPIENTS: 'Nobody matches this audience',
  FACET_UNAVAILABLE: 'The audience filter cannot be answered right now; try again later',
  LINK_INVALID: 'The link must be an app path or an https address',
  NOT_RETRYABLE: 'Only an announcement whose sending failed can be retried',
  RETRY_EXPIRED: 'This announcement has expired; it can only be withdrawn',
  RETRY_WINDOW_MOVED_ON: 'Its maintenance window has moved on since this notice failed; it can only be withdrawn',
  FANOUT_LOST: 'The sending job was lost',
  FANOUT_ERROR: 'The sending job kept failing on an internal error (the server log has the details)',
} as const;

export default AnnouncementMessages;
