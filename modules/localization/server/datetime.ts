// Canonical date/time display-preference options — the single source used by
// every date-format / time-format / first-day-of-week picker in the app. Values
// match the user_preferences enums (DateFormat / TimeFormat / FirstDayOfWeek).
export type DateTimeOption = { value: string; label: string };

/** ISO 639-1-independent date layouts. Values: DateFormatEnum. */
export const DATE_FORMAT_OPTIONS: DateTimeOption[] = [
  { value: 'DD_MM_YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
  { value: 'MM_DD_YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
  { value: 'YYYY_MM_DD', label: 'YYYY-MM-DD (2026-12-31)' },
];

/** Clock convention. Values: TimeFormatEnum. */
export const TIME_FORMAT_OPTIONS: DateTimeOption[] = [
  { value: 'H24', label: '24-hour (14:30)' },
  { value: 'H12', label: '12-hour (2:30 PM)' },
];

/** First day of the week. Values: FirstDayOfWeekEnum. */
export const FIRST_DAY_OPTIONS: DateTimeOption[] = [
  { value: 'MON', label: 'Monday' },
  { value: 'SUN', label: 'Sunday' },
];
