// Timezone reference for the TimezoneSelect. The zone list reuses common's
// `TIMEZONES` (the IANA validation authority behind TimezoneSchema), so the
// selector's options always match what the DTOs accept. Offset labels are
// computed once at module load via Intl — sorted by offset, then zone name.
import { TIMEZONES, DEFAULT_TIMEZONE } from '@kuraykaraaslan-labs/common/server/common.timezone';

export type TimezoneOption = { value: string; label: string };

const NOW = new Date();

function zoneInfo(zone: string): { label: string; minutes: number } {
  let off = 'UTC+00:00';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(NOW);
    const raw = (parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT').replace('GMT', 'UTC');
    off = raw === 'UTC' ? 'UTC+00:00' : raw;
  } catch { /* keep default */ }
  const m = off.match(/UTC([+-])(\d{2}):(\d{2})/);
  const minutes = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
  return { label: `(${off}) ${zone.replace(/_/g, ' ')}`, minutes };
}

// Ensure the UTC alias is present (Intl omits it in some runtimes).
const ZONES = TIMEZONES.includes(DEFAULT_TIMEZONE) ? TIMEZONES : [DEFAULT_TIMEZONE, ...TIMEZONES];

export const TIMEZONE_OPTIONS: TimezoneOption[] = ZONES
  .map((z) => ({ value: z, ...zoneInfo(z) }))
  .sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value))
  .map(({ value, label }) => ({ value, label }));

export { DEFAULT_TIMEZONE };
