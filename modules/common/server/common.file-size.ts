/**
 * Human-readable file sizes for messages and lists ("25 MB", "1.5 GB").
 *
 * Binary steps (1 KB = 1024 B), the way storage limits are configured: a tenant's
 * `maxFileSizeMb` of 25 is 25 * 1024 * 1024 bytes and reads back as "25 MB".
 * At most one decimal, and none when it would be ".0".
 *
 * Client-safe and import-free, so any UI can use it.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, useGrouping: false }).format(value)} ${UNITS[unit]}`;
}
