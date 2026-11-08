/**
 * The audit list's whole-day bounds. The table's date filter sends `YYYY-MM-DD`; the query filters an inclusive
 * `createdAt` range, so a day runs from 00:00:00.000 to 23:59:59.999 UTC. Anything that is not a day is passed on
 * unchanged for the DTO to refuse.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function dayStart(day: string | null): string | undefined {
  if (!day) return undefined;
  return DAY.test(day) ? `${day}T00:00:00.000Z` : day;
}

export function dayEnd(day: string | null): string | undefined {
  if (!day) return undefined;
  return DAY.test(day) ? `${day}T23:59:59.999Z` : day;
}
