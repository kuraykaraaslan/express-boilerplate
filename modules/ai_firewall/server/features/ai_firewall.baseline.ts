import { ROUTE_CLASSES, type RouteClass } from './ai_firewall.feature-windows';

/**
 * Per-actor baselines (docs/phases/55-ai-firewall/02 §2.1): what is USUAL for one person or API key, persisted daily from the day
 * profile the feature store keeps in Redis, and per role as the cold-start prior. Pure: the day's profile in, the new baseline out.
 *
 *   hours        share of the actor's activity per UTC hour (EWMA of each day's shares; sums to about 1)
 *   countries,   share per country, ASN, device (EWMA of each day's shares; keys below MAP_MIN_WEIGHT dropped, at most MAP_TOP_K kept;
 *   asns,        devices are keyed tags of the user agent, never the user agent)
 *   devices
 *   volume       requests per day per route class (EWMA)
 *   exportBytes, subjects, adminActions, addresses: per day (EWMA): bytes answered on export routes, distinct subjects touched, admin
 *                writes, distinct addresses used
 *
 * EWMA with α = 2 / (N + 1), N = BASELINE_SPAN_DAYS: a day weighs about as much as the two weeks before it. The first day is taken
 * as it is. A day without activity is not folded (the job only sees actors that were active), so a holiday does not drag "usual" to 0.
 */
export const BASELINE_SPAN_DAYS = 14;
export const BASELINE_ALPHA = 2 / (BASELINE_SPAN_DAYS + 1);
export const MAP_TOP_K = 16;
export const MAP_MIN_WEIGHT = 0.01;
/** A baseline counts as the actor's own from this many days; before that the role prior fills in (cold start). */
export const BASELINE_MIN_DAYS = 3;

export interface BaselineData {
  hours: number[];
  countries: Record<string, number>;
  asns: Record<string, number>;
  devices: Record<string, number>;
  volume: Partial<Record<RouteClass, number>>;
  exportBytes: number;
  subjects: number;
  adminActions: number;
  addresses: number;
}

export interface Baseline {
  /** Days folded in. */
  days: number;
  /** The last day folded, `YYYYMMDD`. */
  lastDay: string;
  data: BaselineData;
}

/** One actor's day, read from its profile hash and the day's distinct counts. */
export interface DayProfile {
  hours: number[];
  countries: Record<string, number>;
  asns: Record<string, number>;
  devices: Record<string, number>;
  volume: Partial<Record<RouteClass, number>>;
  exportBytes: number;
  adminActions: number;
  subjects: number;
  addresses: number;
  role: string | null;
}

const ROLE_RE = /^[A-Z_]{1,32}$/;

export function emptyBaselineData(): BaselineData {
  return { hours: new Array(24).fill(0), countries: {}, asns: {}, devices: {}, volume: {}, exportBytes: 0, subjects: 0, adminActions: 0, addresses: 0 };
}

/** The day profile from the Redis hash (fields as the folds write them) and the day's two distinct counts. */
export function dayProfileOf(hash: Record<string, string> | null | undefined, subjects: number, addresses: number): DayProfile {
  const p: DayProfile = {
    hours: new Array(24).fill(0), countries: {}, asns: {}, devices: {}, volume: {}, exportBytes: 0, adminActions: 0,
    subjects: Number.isFinite(subjects) && subjects > 0 ? subjects : 0, addresses: Number.isFinite(addresses) && addresses > 0 ? addresses : 0,
    role: null,
  };
  for (const [field, raw] of Object.entries(hash ?? {})) {
    if (field === 'r') { if (ROLE_RE.test(raw)) p.role = raw; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const hour = /^h(\d{2})$/.exec(field);
    if (hour) { const h = Number(hour[1]); if (h < 24) p.hours[h] = (p.hours[h] ?? 0) + n; continue; }
    if (field.startsWith('v:')) {
      const c = field.slice(2) as RouteClass;
      if ((ROUTE_CLASSES as readonly string[]).includes(c)) p.volume[c] = (p.volume[c] ?? 0) + n;
      continue;
    }
    if (field.startsWith('c:')) { p.countries[field.slice(2)] = n; continue; }
    if (field.startsWith('a:')) { p.asns[field.slice(2)] = n; continue; }
    if (field.startsWith('d:')) { p.devices[field.slice(2)] = n; continue; }
    if (field === 'xb') p.exportBytes = n;
    else if (field === 'adm') p.adminActions = n;
  }
  return p;
}

/** Whether the day shows any activity worth folding. */
export const isActiveDay = (p: DayProfile): boolean => p.hours.some((h) => h > 0) || Object.values(p.volume).some((v) => (v ?? 0) > 0);

const shares = (counts: Record<string, number>): Record<string, number> => {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, n] of Object.entries(counts)) out[k] = n / total;
  return out;
};

const ewma = (prev: number, day: number, alpha: number): number => prev + alpha * (day - prev);

function blendMap(prev: Record<string, number>, day: Record<string, number>, alpha: number, first: boolean): Record<string, number> {
  const s = shares(day);
  const merged: Record<string, number> = {};
  if (first) Object.assign(merged, s);
  else {
    for (const k of new Set([...Object.keys(prev), ...Object.keys(s)])) merged[k] = ewma(prev[k] ?? 0, s[k] ?? 0, alpha);
  }
  return Object.fromEntries(
    Object.entries(merged).filter(([, w]) => w >= MAP_MIN_WEIGHT).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, MAP_TOP_K),
  );
}

/** The baseline after one more day. `prev` null = the actor's first day. A day older than or equal to `prev.lastDay` changes nothing. */
export function updateBaseline(prev: Baseline | null, day: DayProfile, dayId: string, alpha: number = BASELINE_ALPHA): Baseline {
  if (prev && prev.lastDay >= dayId) return prev;
  const first = !prev || prev.days <= 0;
  const p = prev?.data ?? emptyBaselineData();
  const hourTotal = day.hours.reduce((s, n) => s + n, 0);
  const hourShares = day.hours.map((n) => (hourTotal > 0 ? n / hourTotal : 0));
  const volume: Partial<Record<RouteClass, number>> = {};
  for (const c of ROUTE_CLASSES) {
    const v = first ? day.volume[c] ?? 0 : ewma(p.volume[c] ?? 0, day.volume[c] ?? 0, alpha);
    if (v > 0) volume[c] = v;
  }
  const num = (prevValue: number, dayValue: number) => (first ? dayValue : ewma(prevValue, dayValue, alpha));
  return {
    days: (prev?.days ?? 0) + 1,
    lastDay: dayId,
    data: {
      hours: first ? hourShares : p.hours.map((h, i) => ewma(h, hourShares[i] ?? 0, alpha)),
      countries: blendMap(p.countries, day.countries, alpha, first),
      asns: blendMap(p.asns, day.asns, alpha, first),
      devices: blendMap(p.devices, day.devices, alpha, first),
      volume,
      exportBytes: num(p.exportBytes, day.exportBytes),
      subjects: num(p.subjects, day.subjects),
      adminActions: num(p.adminActions, day.adminActions),
      addresses: num(p.addresses, day.addresses),
    },
  };
}

/** The mean of several baselines' data: the day's contribution to a role prior. Countries, ASNs and devices are never pooled. */
export function meanBaselineData(items: readonly BaselineData[]): BaselineData | null {
  if (items.length === 0) return null;
  const out = emptyBaselineData();
  const n = items.length;
  for (const d of items) {
    d.hours.forEach((h, i) => { out.hours[i] = (out.hours[i] ?? 0) + h / n; });
    for (const c of ROUTE_CLASSES) if (d.volume[c]) out.volume[c] = (out.volume[c] ?? 0) + d.volume[c]! / n;
    out.exportBytes += d.exportBytes / n;
    out.subjects += d.subjects / n;
    out.adminActions += d.adminActions / n;
    out.addresses += d.addresses / n;
  }
  return out;
}

/**
 * A role's prior after one more day: the EWMA of the mean of the day's baselines of that role's actors. People's countries, networks
 * and devices are not part of a prior (another person's usual country says nothing about a new member, and pooling them would mix
 * people's data).
 */
export function updateRolePrior(prev: Baseline | null, members: readonly BaselineData[], dayId: string, alpha: number = BASELINE_ALPHA): Baseline | null {
  const mean = meanBaselineData(members);
  if (!mean) return prev;
  if (prev && prev.lastDay >= dayId) return prev;
  if (!prev || prev.days <= 0) return { days: 1, lastDay: dayId, data: mean };
  const p = prev.data;
  const volume: Partial<Record<RouteClass, number>> = {};
  for (const c of ROUTE_CLASSES) {
    const v = ewma(p.volume[c] ?? 0, mean.volume[c] ?? 0, alpha);
    if (v > 0) volume[c] = v;
  }
  return {
    days: prev.days + 1,
    lastDay: dayId,
    data: {
      hours: p.hours.map((h, i) => ewma(h, mean.hours[i] ?? 0, alpha)),
      countries: {}, asns: {}, devices: {},
      volume,
      exportBytes: ewma(p.exportBytes, mean.exportBytes, alpha),
      subjects: ewma(p.subjects, mean.subjects, alpha),
      adminActions: ewma(p.adminActions, mean.adminActions, alpha),
      addresses: ewma(p.addresses, mean.addresses, alpha),
    },
  };
}

/** A stored `data` value back into the shape (a damaged row reads as empty rather than throwing). */
export function baselineDataOf(raw: unknown): BaselineData {
  const d = emptyBaselineData();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<BaselineData>;
  if (Array.isArray(r.hours) && r.hours.length === 24) d.hours = r.hours.map((h) => (Number.isFinite(Number(h)) ? Number(h) : 0));
  const map = (m: unknown): Record<string, number> =>
    (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m as Record<string, unknown>).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) : {});
  d.countries = map(r.countries);
  d.asns = map(r.asns);
  d.devices = map(r.devices);
  d.volume = map(r.volume) as Partial<Record<RouteClass, number>>;
  for (const k of ['exportBytes', 'subjects', 'adminActions', 'addresses'] as const) d[k] = Number.isFinite(Number(r[k])) ? Number(r[k]) : 0;
  return d;
}
